package tools

import (
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
)

// Name identifies a structured tool.
type Name string

const (
	ListFiles     Name = "list_files"
	ReadFile      Name = "read_file"
	StatPath      Name = "stat_path"
	DiskFree      Name = "disk_free"
	ListProcesses Name = "list_processes"
	WriteFile     Name = "write_file"
	Mkdir         Name = "mkdir"
	RemoveFile    Name = "remove_file"
	RemoveDir     Name = "rmdir"
)

// Request is the Agent/tool API input.
type Request struct {
	Tool         Name   `json:"tool"`
	Path         string `json:"path,omitempty"`
	Pattern      string `json:"pattern,omitempty"`
	Content      string `json:"content,omitempty"` // write_file body
	User         string `json:"user,omitempty"`    // list_processes user filter
	Limit        int    `json:"limit,omitempty"`  // list_processes max rows
	Actor        string `json:"actor,omitempty"`  // user | agent
	ProposalID   string `json:"proposal_id,omitempty"`
	ApproveToken string `json:"approve_token,omitempty"`
}

// Result is a structured tool outcome (also rendered as summary text for the LLM).
type Result struct {
	Tool       Name           `json:"tool"`
	Risk       string         `json:"risk"` // low | medium | high
	OK         bool           `json:"ok"`
	Summary    string         `json:"summary"`
	Data       map[string]any `json:"data,omitempty"`
	DurationMS int64          `json:"duration_ms"`
	Via        string         `json:"via"` // sftp | exec
	Error      string         `json:"error,omitempty"`
}

// ExecFunc runs a remote command on the open SSH session (controlled templates only).
type ExecFunc func(cmd string) (stdout, stderr string, code int, err error)

// Run executes a structured tool against an open SSH client.
func Run(client *ssh.Client, req Request, exec ExecFunc) (*Result, error) {
	start := time.Now()
	actor := req.Actor
	if actor == "" {
		actor = "agent"
	}
	_ = actor

	var (
		res *Result
		err error
	)
	level := ToolRisk(req.Tool)
	switch req.Tool {
	case ListFiles, ReadFile, StatPath, WriteFile, Mkdir, RemoveFile, RemoveDir:
		if client == nil && exec == nil {
			return nil, fmt.Errorf("no ssh client or exec runner")
		}
		switch req.Tool {
		case ListFiles:
			res, err = runListFiles(client, exec, req.Path)
		case ReadFile:
			res, err = runReadFile(client, exec, req.Path)
		case StatPath:
			res, err = runStatPath(client, exec, req.Path)
		case WriteFile:
			res, err = runWriteFile(client, exec, req.Path, req.Content)
		case Mkdir:
			res, err = runMkdir(client, exec, req.Path)
		case RemoveFile:
			res, err = runRemoveFile(client, exec, req.Path)
		case RemoveDir:
			res, err = runRemoveDir(client, exec, req.Path)
		}
	case DiskFree:
		if exec == nil {
			return nil, fmt.Errorf("no exec runner")
		}
		res, err = runDiskFree(exec, req.Path)
	case ListProcesses:
		if exec == nil {
			return nil, fmt.Errorf("no exec runner")
		}
		res, err = runListProcesses(exec, req.Pattern, req.User, req.Limit)
	default:
		return nil, fmt.Errorf("unknown tool %q", req.Tool)
	}
	if res == nil {
		res = &Result{Tool: req.Tool, Risk: string(level)}
	}
	res.Tool = req.Tool
	res.Risk = string(level)
	res.DurationMS = time.Since(start).Milliseconds()
	if err != nil {
		res.OK = false
		if res.Error == "" {
			res.Error = err.Error()
		}
		if res.Summary == "" {
			res.Summary = res.Error
		}
		return res, err
	}
	res.OK = true
	return res, nil
}

func openSFTP(client *ssh.Client) (*sftp.Client, error) {
	if client == nil {
		return nil, fmt.Errorf("no ssh client")
	}
	// Test / restricted sshd may accept the session but never speak SFTP.
	// Bound the handshake so we fall back to controlled exec quickly.
	type outcome struct {
		c   *sftp.Client
		err error
	}
	ch := make(chan outcome, 1)
	go func() {
		c, err := sftp.NewClient(client)
		ch <- outcome{c, err}
	}()
	select {
	case o := <-ch:
		return o.c, o.err
	case <-time.After(2 * time.Second):
		return nil, fmt.Errorf("sftp open timeout")
	}
}

func runListFiles(client *ssh.Client, exec ExecFunc, rawPath string) (*Result, error) {
	p, err := SafePath(rawPath)
	if err != nil {
		return nil, err
	}
	if sc, err := openSFTP(client); err == nil {
		defer sc.Close()
		entries, err := sc.ReadDir(expandHomeHint(p))
		if err == nil {
			lines := make([]string, 0, len(entries))
			names := make([]string, 0, len(entries))
			for _, e := range entries {
				mode := e.Mode().String()
				names = append(names, e.Name())
				lines = append(lines, fmt.Sprintf("%s %8d %s", mode, e.Size(), e.Name()))
			}
			summary := strings.Join(lines, "\n")
			if summary == "" {
				summary = "(empty directory)"
			}
			return &Result{
				Summary: summary,
				Via:     "sftp",
				Data: map[string]any{
					"path":     p,
					"count":    len(names),
					"entries":  names,
					"listing":  lines,
				},
			}, nil
		}
	}
	// Exec fallback (test servers / hosts without sftp subsystem).
	cmd := fmt.Sprintf("ls -la -- %s", shellSingleQuote(p))
	stdout, stderr, code, err := exec(cmd)
	if err != nil {
		return &Result{Via: "exec", Summary: stderr, Error: err.Error()}, err
	}
	if code != 0 {
		msg := strings.TrimSpace(stderr)
		if msg == "" {
			msg = strings.TrimSpace(stdout)
		}
		return &Result{Via: "exec", Summary: msg, Error: fmt.Sprintf("exit %d", code)}, fmt.Errorf("list_files exit %d", code)
	}
	return &Result{
		Summary: stdout,
		Via:     "exec",
		Data:    map[string]any{"path": p, "raw": stdout},
	}, nil
}

func runReadFile(client *ssh.Client, exec ExecFunc, rawPath string) (*Result, error) {
	p, err := SafePath(rawPath)
	if err != nil {
		return nil, err
	}
	if sc, err := openSFTP(client); err == nil {
		defer sc.Close()
		f, err := sc.Open(expandHomeHint(p))
		if err == nil {
			defer f.Close()
			buf := make([]byte, MaxReadBytes+1)
			n, rerr := io.ReadFull(f, buf)
			if rerr == io.ErrUnexpectedEOF || rerr == io.EOF {
				rerr = nil
			}
			if rerr != nil && rerr != io.ErrUnexpectedEOF {
				// partial ok
			}
			truncated := n > MaxReadBytes
			if truncated {
				n = MaxReadBytes
			}
			content := string(buf[:n])
			summary := content
			if truncated {
				summary += "\n…(truncated)"
			}
			return &Result{
				Summary: summary,
				Via:     "sftp",
				Data: map[string]any{
					"path":      p,
					"bytes":     n,
					"truncated": truncated,
					"content":   content,
				},
			}, nil
		}
	}
	cmd := fmt.Sprintf("head -c %d -- %s", MaxReadBytes, shellSingleQuote(p))
	stdout, stderr, code, err := exec(cmd)
	if err != nil {
		return &Result{Via: "exec", Summary: stderr, Error: err.Error()}, err
	}
	if code != 0 {
		msg := strings.TrimSpace(stderr)
		if msg == "" {
			msg = strings.TrimSpace(stdout)
		}
		return &Result{Via: "exec", Summary: msg, Error: fmt.Sprintf("exit %d", code)}, fmt.Errorf("read_file exit %d", code)
	}
	return &Result{
		Summary: stdout,
		Via:     "exec",
		Data:    map[string]any{"path": p, "bytes": len(stdout), "content": stdout},
	}, nil
}

func runStatPath(client *ssh.Client, exec ExecFunc, rawPath string) (*Result, error) {
	p, err := SafePath(rawPath)
	if err != nil {
		return nil, err
	}
	if sc, err := openSFTP(client); err == nil {
		defer sc.Close()
		st, err := sc.Stat(expandHomeHint(p))
		if err == nil {
			summary := fmt.Sprintf("path=%s size=%d mode=%s is_dir=%v mod=%s",
				p, st.Size(), st.Mode().String(), st.IsDir(), st.ModTime().UTC().Format(time.RFC3339))
			return &Result{
				Summary: summary,
				Via:     "sftp",
				Data: map[string]any{
					"path":     p,
					"size":     st.Size(),
					"mode":     st.Mode().String(),
					"is_dir":   st.IsDir(),
					"mod_time": st.ModTime().UTC().Format(time.RFC3339),
				},
			}, nil
		}
	}
	q := shellSingleQuote(p)
	cmd := fmt.Sprintf("stat %s 2>/dev/null || ls -ld -- %s", q, q)
	stdout, stderr, code, err := exec(cmd)
	if err != nil {
		return &Result{Via: "exec", Summary: stderr, Error: err.Error()}, err
	}
	if code != 0 {
		msg := strings.TrimSpace(stderr)
		if msg == "" {
			msg = strings.TrimSpace(stdout)
		}
		return &Result{Via: "exec", Summary: msg, Error: fmt.Sprintf("exit %d", code)}, fmt.Errorf("stat_path exit %d", code)
	}
	return &Result{
		Summary: stdout,
		Via:     "exec",
		Data:    map[string]any{"path": p, "raw": stdout},
	}, nil
}

func runDiskFree(exec ExecFunc, rawPath string) (*Result, error) {
	var cmd string
	pathArg := ""
	if strings.TrimSpace(rawPath) != "" {
		p, err := SafePath(rawPath)
		if err != nil {
			return nil, err
		}
		pathArg = p
		cmd = fmt.Sprintf("df -hP -- %s", shellSingleQuote(p))
	} else {
		cmd = "df -hP"
	}
	stdout, stderr, code, err := exec(cmd)
	if err != nil {
		return &Result{Via: "exec", Summary: stderr, Error: err.Error()}, err
	}
	if code != 0 {
		// Some busybox/df lack -P; retry without.
		stdout2, stderr2, code2, err2 := exec(strings.Replace(cmd, "df -hP", "df -h", 1))
		if err2 == nil && code2 == 0 {
			stdout, stderr, code = stdout2, stderr2, code2
		} else {
			msg := strings.TrimSpace(stderr)
			if msg == "" {
				msg = strings.TrimSpace(stdout)
			}
			return &Result{Via: "exec", Summary: msg, Error: fmt.Sprintf("exit %d", code)}, fmt.Errorf("disk_free exit %d", code)
		}
	}
	rows := parseDF(stdout)
	return &Result{
		Summary: stdout,
		Via:     "exec",
		Data: map[string]any{
			"path": pathArg,
			"rows": rows,
			"raw":  stdout,
		},
	}, nil
}

func runListProcesses(exec ExecFunc, pattern, user string, limit int) (*Result, error) {
	pat, err := SafeProcessPattern(pattern)
	if err != nil {
		return nil, err
	}
	userFilter, err := SafeUser(user)
	if err != nil {
		return nil, err
	}
	if limit <= 0 {
		limit = DefaultProcessLimit
	}
	if limit > MaxProcessLimit {
		limit = MaxProcessLimit
	}
	// Fetch a generous ps dump, then filter/parse locally (safer than shell pipelines).
	cmd := "ps auxww"
	stdout, stderr, code, err := exec(cmd)
	if err != nil {
		return &Result{Via: "exec", Summary: stderr, Error: err.Error()}, err
	}
	if code != 0 && strings.TrimSpace(stdout) == "" {
		msg := strings.TrimSpace(stderr)
		return &Result{Via: "exec", Summary: msg, Error: fmt.Sprintf("exit %d", code)}, fmt.Errorf("list_processes exit %d", code)
	}
	procs := parsePS(stdout, pat, userFilter)
	truncated := false
	if len(procs) > limit {
		procs = procs[:limit]
		truncated = true
	}
	lines := make([]string, 0, len(procs))
	for _, row := range procs {
		lines = append(lines, fmt.Sprintf("%s\t%s\t%s\t%s", row["user"], row["pid"], row["stat"], row["command"]))
	}
	summary := strings.Join(lines, "\n")
	if summary == "" {
		summary = "(no matching processes)"
	}
	if truncated {
		summary += "\n…(truncated)"
	}
	return &Result{
		Summary: summary,
		Via:     "exec",
		Data: map[string]any{
			"pattern":   pat,
			"user":      userFilter,
			"limit":     limit,
			"lines":     lines,
			"processes": procs,
			"count":     len(procs),
			"truncated": truncated,
		},
	}, nil
}

// parsePS parses `ps auxww` output and filters by optional name pattern / user.
func parsePS(stdout, pattern, user string) []map[string]string {
	lines := splitNonEmpty(stdout)
	var out []map[string]string
	for i, line := range lines {
		fields := strings.Fields(line)
		if len(fields) < 11 {
			continue
		}
		// Skip header
		if i == 0 && strings.EqualFold(fields[0], "USER") {
			continue
		}
		u := fields[0]
		pid := fields[1]
		stat := fields[7]
		cmd := strings.Join(fields[10:], " ")
		if user != "" && !strings.EqualFold(u, user) {
			continue
		}
		if pattern != "" && !strings.Contains(cmd, pattern) && !strings.Contains(u, pattern) {
			continue
		}
		out = append(out, map[string]string{
			"user":    u,
			"pid":     pid,
			"stat":    stat,
			"command": cmd,
			"%cpu":    fields[2],
			"%mem":    fields[3],
		})
	}
	return out
}

func expandHomeHint(p string) string {
	// SFTP servers usually resolve relative to login home for paths without leading /.
	// We only accept absolute or ~/ — map ~/x to relative x for sftp when needed.
	if p == "~" {
		return "."
	}
	if strings.HasPrefix(p, "~/") {
		return strings.TrimPrefix(p, "~/")
	}
	return p
}

func splitNonEmpty(s string) []string {
	var out []string
	for _, line := range strings.Split(s, "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		out = append(out, line)
	}
	return out
}

func parseDF(stdout string) []map[string]string {
	lines := splitNonEmpty(stdout)
	if len(lines) == 0 {
		return nil
	}
	// Skip header
	start := 0
	if strings.Contains(strings.ToLower(lines[0]), "filesystem") {
		start = 1
	}
	var rows []map[string]string
	for _, line := range lines[start:] {
		fields := strings.Fields(line)
		if len(fields) < 6 {
			continue
		}
		// df -hP: Filesystem Size Used Avail Use% Mounted
		mounted := fields[5]
		if len(fields) > 6 {
			mounted = strings.Join(fields[5:], " ")
		}
		rows = append(rows, map[string]string{
			"filesystem": fields[0],
			"size":       fields[1],
			"used":       fields[2],
			"avail":      fields[3],
			"use_pct":    fields[4],
			"mounted":    mounted,
		})
	}
	return rows
}

// DisplayCommand returns the equivalent audited shell form (for UI / proposals).
func DisplayCommand(req Request) (string, error) {
	switch req.Tool {
	case ListFiles:
		p, err := SafePath(req.Path)
		if err != nil {
			return "", err
		}
		return fmt.Sprintf("ls -la -- %s", shellSingleQuote(p)), nil
	case ReadFile:
		p, err := SafePath(req.Path)
		if err != nil {
			return "", err
		}
		return fmt.Sprintf("head -c %d -- %s", MaxReadBytes, shellSingleQuote(p)), nil
	case StatPath:
		p, err := SafePath(req.Path)
		if err != nil {
			return "", err
		}
		q := shellSingleQuote(p)
		return fmt.Sprintf("stat %s 2>/dev/null || ls -ld -- %s", q, q), nil
	case DiskFree:
		if strings.TrimSpace(req.Path) != "" {
			p, err := SafePath(req.Path)
			if err != nil {
				return "", err
			}
			return fmt.Sprintf("df -h -- %s", shellSingleQuote(p)), nil
		}
		return "df -h", nil
	case ListProcesses:
		pat, err := SafeProcessPattern(req.Pattern)
		if err != nil {
			return "", err
		}
		user, err := SafeUser(req.User)
		if err != nil {
			return "", err
		}
		parts := []string{"ps auxww"}
		if user != "" {
			parts = append(parts, "# user="+user)
		}
		if pat != "" {
			parts = append(parts, "# pattern="+pat)
		}
		if req.Limit > 0 {
			parts = append(parts, fmt.Sprintf("# limit=%d", req.Limit))
		}
		return strings.Join(parts, " "), nil
	case WriteFile:
		p, err := SafePath(req.Path)
		if err != nil {
			return "", err
		}
		if len(req.Content) > MaxWriteBytes {
			return "", fmt.Errorf("content too long (max %d bytes)", MaxWriteBytes)
		}
		return writeFileExecCmd(p, req.Content), nil
	case Mkdir:
		p, err := SafePath(req.Path)
		if err != nil {
			return "", err
		}
		return fmt.Sprintf("mkdir -p -- %s", shellSingleQuote(p)), nil
	case RemoveFile:
		p, err := SafePath(req.Path)
		if err != nil {
			return "", err
		}
		return fmt.Sprintf("rm -- %s", shellSingleQuote(p)), nil
	case RemoveDir:
		p, err := SafePath(req.Path)
		if err != nil {
			return "", err
		}
		return fmt.Sprintf("rmdir -- %s", shellSingleQuote(p)), nil
	default:
		return "", fmt.Errorf("unknown tool")
	}
}

// ToolRisk returns the approve-gate risk for a structured tool.
func ToolRisk(tool Name) string {
	switch tool {
	case WriteFile, Mkdir:
		return "medium"
	case RemoveFile, RemoveDir:
		return "high"
	default:
		return "low"
	}
}

