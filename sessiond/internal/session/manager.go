// Package session manages SSH connections, interactive PTY, and one-shot exec.
package session

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/hivenest/hivenest/sessiond/internal/proposal"
	"github.com/hivenest/hivenest/sessiond/internal/risk"
	"github.com/hivenest/hivenest/sessiond/internal/sshx"
	"github.com/hivenest/hivenest/sessiond/internal/store"
	"github.com/hivenest/hivenest/sessiond/internal/tools"
	"golang.org/x/crypto/ssh"
)

// Manager tracks open SSH sessions.
type Manager struct {
	hosts      *store.HostStore
	audit      *store.AuditLog
	proposals  *proposal.Store
	knownHosts *sshx.KnownHosts

	mu       sync.Mutex
	sessions map[string]*Session
}

func NewManager(hosts *store.HostStore, audit *store.AuditLog, props *proposal.Store, kh *sshx.KnownHosts) *Manager {
	return &Manager{
		hosts:      hosts,
		audit:      audit,
		proposals:  props,
		knownHosts: kh,
		sessions:   map[string]*Session{},
	}
}

// Session is one SSH client connection bound to a host profile.
type Session struct {
	ID        string    `json:"id"`
	HostID    string    `json:"host_id"`
	HostName  string    `json:"host_name"`
	User      string    `json:"user"`
	Remote    string    `json:"remote"` // user@host:port or local:user@hostname
	CreatedAt time.Time `json:"created_at"`
	HasPTY    bool      `json:"has_pty"`
	IsLocal   bool      `json:"is_local,omitempty"`

	client    *ssh.Client
	jump      *ssh.Client   // outermost bastion (compat)
	jumps     []*ssh.Client // all hop clients outer→inner
	mu        sync.Mutex
	pty       *ptyBridge
	localPty  *localPtyBridge
	localHome string
	// ptyGen bumps on every attach attempt so a slower/stale AttachPTY
	// (e.g. React StrictMode double WS) cannot close a newer live PTY.
	ptyGen uint64
}

// OpenOptions carries connect-time secrets that must not be persisted on the host profile.
type OpenOptions struct {
	Password       string            // optional target password; used once for dial, never written to hosts/audit
	JumpPassword   string            // optional single bastion password (legacy / first hop)
	JumpPasswords  map[string]string // optional per-hop: host id or "proxy:N" (never reuse target Password)
	AcceptHostKey  bool              // TOFU: persist unknown host key and continue
	ReplaceHostKey bool              // TOFU: replace mismatched key after explicit user confirm
}

func (o OpenOptions) jumpPasswordFor(key string) string {
	if o.JumpPasswords != nil {
		if p := o.JumpPasswords[key]; p != "" {
			return p
		}
	}
	return o.JumpPassword
}

func (m *Manager) Open(hostID string, opts OpenOptions) (*Session, error) {
	if IsLocalHostID(hostID) {
		return m.OpenLocal()
	}
	h, err := m.hosts.Get(hostID)
	if err != nil {
		return nil, err
	}
	identity := h.IdentityFile
	useAgent := h.UseAgent
	if h.AuthMethod == store.AuthMethodPassword {
		if opts.Password == "" {
			return nil, &PasswordRequiredError{
				Kind:    "target",
				HostID:  hostID,
				Message: "password required for this host (passwords are not stored; supply on connect)",
			}
		}
		identity = ""
		useAgent = false
	}

	var jumpClient *ssh.Client
	var jumpChain []*ssh.Client
	chainIDs := h.JumpChainIDs()
	if len(chainIDs) > 0 {
		seen := map[string]bool{hostID: true}
		var prev *ssh.Client
		for i, jid := range chainIDs {
			if seen[jid] {
				closeJumpChain(jumpChain)
				return nil, fmt.Errorf("jump_host_ids cycle or self-reference at hop %d", i)
			}
			seen[jid] = true
			jh, err := m.hosts.Get(jid)
			if err != nil {
				closeJumpChain(jumpChain)
				return nil, fmt.Errorf("jump host[%d]: %w", i, err)
			}
			jIdentity := jh.IdentityFile
			jAgent := jh.UseAgent
			jPass := opts.jumpPasswordFor(jh.ID)
			if jh.AuthMethod == store.AuthMethodPassword {
				if jPass == "" {
					closeJumpChain(jumpChain)
					return nil, &PasswordRequiredError{
						Kind:     "jump",
						HostID:   jh.ID,
						HopIndex: i,
						Message:  fmt.Sprintf("jump host[%d] %q requires password (passwords are not stored; supply jump_password / jump_passwords on connect)", i, jh.Name),
					}
				}
				jIdentity = ""
				jAgent = false
			} else if jh.AuthMethod == store.AuthMethodKey || jIdentity != "" {
				jAgent = jAgent || jh.UseAgent
			} else if jh.AuthMethod == store.AuthMethodAgent {
				jIdentity = ""
				jAgent = true
			}
			jr, err := sshx.Dial(sshx.DialOpts{
				Host:           jh.Host,
				Port:           jh.Port,
				User:           jh.User,
				IdentityFile:   jIdentity,
				UseAgent:       jAgent,
				Password:       jPass,
				KnownHosts:     m.knownHosts,
				AcceptHostKey:  opts.AcceptHostKey,
				ReplaceHostKey: opts.ReplaceHostKey,
				JumpClient:     prev,
			})
			if err != nil {
				closeJumpChain(jumpChain)
				_ = m.audit.Append(store.AuditEntry{
					Action: "session.open", HostID: hostID, Actor: "user", OK: false,
					Detail: fmt.Sprintf("jump[%d]: ", i) + sanitizeDialErr(err.Error(), opts.Password, jPass, opts.JumpPassword),
				})
				return nil, fmt.Errorf("jump dial[%d] failed: %w", i, err)
			}
			jumpChain = append(jumpChain, jr.Client)
			prev = jr.Client
		}
		jumpClient = prev
	}

	dialOpts := sshx.DialOpts{
		Host:           h.Host,
		Port:           h.Port,
		User:           h.User,
		IdentityFile:   identity,
		UseAgent:       useAgent,
		Password:       opts.Password,
		JumpPassword:   opts.JumpPassword,
		KnownHosts:     m.knownHosts,
		AcceptHostKey:  opts.AcceptHostKey,
		ReplaceHostKey: opts.ReplaceHostKey,
		ProxyJump:      "",
		JumpClient:     jumpClient,
	}
	if jumpClient == nil && strings.TrimSpace(h.ProxyJump) != "" {
		specs, err := sshx.ParseJumpChain(h.ProxyJump)
		if err != nil {
			return nil, err
		}
		hopAuths := make([]sshx.HopAuth, len(specs))
		for i := range specs {
			pass := opts.jumpPasswordFor(fmt.Sprintf("proxy:%d", i))
			if pass == "" && i == 0 {
				pass = opts.JumpPassword
			}
			// Prefer JumpHops[i]; hop 0 also falls back to Jump* fields.
			var jIdentity string
			var jAgent bool
			var jAuth string
			if i < len(h.JumpHops) {
				spec := h.JumpHops[i]
				jIdentity = spec.IdentityFile
				jAgent = spec.UseAgent
				jAuth = spec.AuthMethod
			} else if i == 0 {
				jIdentity = h.JumpIdentityFile
				jAgent = h.JumpUseAgent
				jAuth = h.JumpAuthMethod
			}
			switch jAuth {
			case store.AuthMethodPassword:
				if pass == "" {
					return nil, &PasswordRequiredError{
						Kind:     "jump",
						HostID:   hostID,
						HopIndex: i,
						Message:  fmt.Sprintf("proxy jump[%d] %q requires password (passwords are not stored; supply jump_passwords proxy:%d)", i, specs[i], i),
					}
				}
				jIdentity = ""
				jAgent = false
			case store.AuthMethodAgent:
				jIdentity = ""
				jAgent = true
			case store.AuthMethodKey:
				// keep identity / agent flags
			default:
				// unset: key if provided, else agent soft-default inside Dial
			}
			hopAuths[i] = sshx.HopAuth{IdentityFile: jIdentity, UseAgent: jAgent, Password: pass}
		}
		dialOpts.ProxyJump = h.ProxyJump
		dialOpts.JumpHopAuths = hopAuths
		if len(specs) == 1 {
			dialOpts.JumpIdentityFile = hopAuths[0].IdentityFile
			dialOpts.JumpUseAgent = hopAuths[0].UseAgent
			dialOpts.JumpPassword = hopAuths[0].Password
		}
	}

	res, err := sshx.Dial(dialOpts)
	if err != nil {
		closeJumpChain(jumpChain)
		var jreq *sshx.JumpPasswordRequiredError
		if errors.As(err, &jreq) {
			_ = m.audit.Append(store.AuditEntry{
				Action: "session.open", HostID: hostID, Actor: "user", OK: false,
				Detail: "proxy_jump password required",
			})
			return nil, &PasswordRequiredError{
				Kind:     "jump",
				HostID:   hostID,
				HopIndex: jreq.HopIndex,
				Message:  jreq.Message,
			}
		}
		secrets := []string{opts.Password, opts.JumpPassword}
		for _, p := range opts.JumpPasswords {
			secrets = append(secrets, p)
		}
		_ = m.audit.Append(store.AuditEntry{
			Action: "session.open", HostID: hostID, Actor: "user", OK: false,
			Detail: sanitizeDialErr(err.Error(), secrets...),
		})
		return nil, fmt.Errorf("ssh dial failed: %w", err)
	}

	// Prefer explicit jump_host_ids chain; else take ProxyJump-owned hops from DialResult.
	jumps := jumpChain
	if len(jumps) == 0 {
		if len(res.Jumps) > 0 {
			jumps = res.Jumps
		} else if res.Jump != nil {
			jumps = []*ssh.Client{res.Jump}
		}
	}
	var jump *ssh.Client
	if len(jumps) > 0 {
		jump = jumps[0]
	}

	s := &Session{
		ID:        uuid.NewString(),
		HostID:    h.ID,
		HostName:  h.Name,
		User:      h.User,
		Remote:    fmt.Sprintf("%s@%s:%d", h.User, h.Host, h.Port),
		CreatedAt: time.Now().UTC(),
		client:    res.Client,
		jump:      jump,
		jumps:     jumps,
	}
	m.mu.Lock()
	m.sessions[s.ID] = s
	m.mu.Unlock()
	_ = m.audit.Append(store.AuditEntry{
		Action: "session.open", HostID: h.ID, SessionID: s.ID, Actor: "user", OK: true, Detail: s.Remote,
	})
	return s, nil
}

func (m *Manager) Get(id string) (*Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.sessions[id]
	if !ok {
		return nil, fmt.Errorf("session not found")
	}
	return s, nil
}

func (m *Manager) List() []*Session {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]*Session, 0, len(m.sessions))
	for _, s := range m.sessions {
		out = append(out, s)
	}
	return out
}

func (m *Manager) Close(id string) error {
	m.mu.Lock()
	s, ok := m.sessions[id]
	if ok {
		delete(m.sessions, id)
	}
	m.mu.Unlock()
	if !ok {
		return fmt.Errorf("session not found")
	}
	s.mu.Lock()
	if s.pty != nil {
		s.pty.close()
		s.pty = nil
	}
	if s.localPty != nil {
		s.localPty.close()
		s.localPty = nil
	}
	s.mu.Unlock()
	var err error
	if s.IsLocal || s.client == nil {
		err = nil
	} else {
		err = s.client.Close()
		jumps := s.jumps
		if len(jumps) == 0 && s.jump != nil {
			jumps = []*ssh.Client{s.jump}
		}
		for i := len(jumps) - 1; i >= 0; i-- {
			if jumps[i] != nil {
				_ = jumps[i].Close()
			}
		}
	}
	_ = m.audit.Append(store.AuditEntry{
		Action: "session.close", HostID: s.HostID, SessionID: s.ID, Actor: "user", OK: err == nil,
	})
	return err
}

// ExecResult is the outcome of a one-shot remote command.
type ExecResult struct {
	Command    string `json:"command"`
	Stdout     string `json:"stdout"`
	Stderr     string `json:"stderr"`
	ExitCode   int    `json:"exit_code"`
	Risk       string `json:"risk"`
	DurationMS int64  `json:"duration_ms"`
}

type ExecRequest struct {
	Command      string `json:"command"`
	ProposalID   string `json:"proposal_id"`
	ApproveToken string `json:"approve_token"`
	Actor        string `json:"actor"` // user | agent
}

func (m *Manager) Exec(sessionID string, req ExecRequest) (*ExecResult, error) {
	s, err := m.Get(sessionID)
	if err != nil {
		return nil, err
	}
	cmd := req.Command
	if cmd == "" {
		return nil, fmt.Errorf("command is required")
	}
	level := risk.Classify(cmd)
	actor := req.Actor
	if actor == "" {
		actor = "user"
	}

	if risk.NeedsApproval(level) {
		if req.ProposalID == "" {
			return nil, &ApprovalRequiredError{Risk: level, Message: "approval required for this command; create a proposal first"}
		}
		if _, err := m.proposals.ConsumeForExec(req.ProposalID, req.ApproveToken, cmd, sessionID); err != nil {
			return nil, err
		}
	}

	start := time.Now()
	var stdout, stderr string
	var code int
	if s.IsLocal || s.client == nil {
		stdout, stderr, code, err = runLocalExec(cmd)
	} else {
		stdout, stderr, code, err = runExec(s.client, cmd)
	}
	dur := time.Since(start).Milliseconds()
	res := &ExecResult{
		Command: cmd, Stdout: stdout, Stderr: stderr, ExitCode: code,
		Risk: string(level), DurationMS: dur,
	}
	ok := err == nil && code == 0
	detail := ""
	if err != nil {
		detail = err.Error()
	}
	ec := code
	_ = m.audit.Append(store.AuditEntry{
		Action: "session.exec", HostID: s.HostID, SessionID: s.ID, Actor: actor,
		Command: cmd, Risk: string(level), ExitCode: &ec, OK: ok, Detail: detail,
	})
	if err != nil && stdout == "" && stderr == "" {
		return res, err
	}
	return res, nil
}

// PasswordRequiredError signals the client must supply a connect-time password.
type PasswordRequiredError struct {
	Kind     string // target | jump
	HostID   string
	HopIndex int
	Message  string
}

func (e *PasswordRequiredError) Error() string { return e.Message }

// ApprovalRequiredError signals the client must use proposal → approve.
type ApprovalRequiredError struct {
	Risk    risk.Level
	Message string
}

func (e *ApprovalRequiredError) Error() string { return e.Message }

func runExec(client *ssh.Client, cmd string) (stdout, stderr string, exitCode int, err error) {
	sess, err := client.NewSession()
	if err != nil {
		return "", "", -1, err
	}
	defer sess.Close()
	var outBuf, errBuf bytes.Buffer
	sess.Stdout = &outBuf
	sess.Stderr = &errBuf
	runErr := sess.Run(cmd)
	stdout, stderr = outBuf.String(), errBuf.String()
	if runErr != nil {
		if ee, ok := runErr.(*ssh.ExitError); ok {
			return stdout, stderr, ee.ExitStatus(), nil
		}
		return stdout, stderr, -1, runErr
	}
	return stdout, stderr, 0, nil
}

// AttachPTY upgrades a websocket to a bidirectional interactive shell.

// RunTool executes a structured Agent tool (SFTP / controlled exec).
// Low-risk tools run immediately; medium/high (writes/deletes) require an approved proposal
// whose command matches tools.DisplayCommand(req), same gate as Exec.
func (m *Manager) RunTool(sessionID string, req tools.Request) (*tools.Result, error) {
	s, err := m.Get(sessionID)
	if err != nil {
		return nil, err
	}
	if req.Actor == "" {
		req.Actor = "agent"
	}
	level := risk.ClassifyTool(string(req.Tool))
	display, derr := tools.DisplayCommand(req)
	if derr != nil {
		return &tools.Result{Tool: req.Tool, Risk: string(level), OK: false, Error: derr.Error(), Summary: derr.Error()}, derr
	}
	if risk.NeedsApproval(level) {
		if req.ProposalID == "" {
			return nil, &ApprovalRequiredError{
				Risk:    level,
				Message: fmt.Sprintf("approval required for tool %s (%s); create a proposal first", req.Tool, level),
			}
		}
		if _, err := m.proposals.ConsumeForExec(req.ProposalID, req.ApproveToken, display, sessionID); err != nil {
			return nil, err
		}
	}
	execFn := func(cmd string) (string, string, int, error) {
		if s.IsLocal || s.client == nil {
			return runLocalExec(cmd)
		}
		return runExec(s.client, cmd)
	}
	res, err := tools.Run(s.client, req, execFn)
	ok := err == nil && res != nil && res.OK
	detail := ""
	if res != nil {
		detail = res.Via
		if res.Error != "" {
			detail = res.Error
		}
		res.Risk = string(level)
	} else if err != nil {
		detail = err.Error()
	}
	_ = m.audit.Append(store.AuditEntry{
		Action: "session.tool", HostID: s.HostID, SessionID: s.ID, Actor: req.Actor,
		Command: display, Risk: string(level), OK: ok, Detail: string(req.Tool) + " " + detail,
	})
	if res == nil {
		return nil, err
	}
	return res, err
}


// beginPTYAttach invalidates any in-flight attach and closes an existing bridge.
// Callers must pass the returned gen to claimPTY*; a mismatched gen means superseded.
func (s *Session) beginPTYAttach() (gen uint64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.ptyGen++
	gen = s.ptyGen
	if s.pty != nil {
		s.pty.close()
		s.pty = nil
	}
	if s.localPty != nil {
		s.localPty.close()
		s.localPty = nil
	}
	s.HasPTY = false
	return gen
}

func (s *Session) ptyGenCurrent() uint64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.ptyGen
}

func (m *Manager) AttachPTY(sessionID string, ws *websocket.Conn, cols, rows int) error {
	s, err := m.Get(sessionID)
	if err != nil {
		return err
	}
	if s.IsLocal {
		return m.AttachLocalPTY(sessionID, ws, cols, rows)
	}
	if cols <= 0 {
		cols = 80
	}
	if rows <= 0 {
		rows = 24
	}
	if s.client == nil {
		return fmt.Errorf("session has no SSH client")
	}

	gen := s.beginPTYAttach()

	sshSess, err := s.client.NewSession()
	if err != nil {
		return err
	}
	modes := ssh.TerminalModes{
		ssh.ECHO:          1,
		ssh.TTY_OP_ISPEED: 14400,
		ssh.TTY_OP_OSPEED: 14400,
	}
	if err := sshSess.RequestPty("xterm-256color", rows, cols, modes); err != nil {
		_ = sshSess.Close()
		return fmt.Errorf("request pty: %w", err)
	}
	stdin, err := sshSess.StdinPipe()
	if err != nil {
		_ = sshSess.Close()
		return err
	}
	stdout, err := sshSess.StdoutPipe()
	if err != nil {
		_ = sshSess.Close()
		return err
	}
	stderr, err := sshSess.StderrPipe()
	if err != nil {
		_ = sshSess.Close()
		return err
	}
	if err := sshSess.Shell(); err != nil {
		_ = sshSess.Close()
		return fmt.Errorf("start shell: %w", err)
	}

	bridge := &ptyBridge{ws: ws, sess: sshSess, stdin: stdin}
	s.mu.Lock()
	if gen != s.ptyGen {
		s.mu.Unlock()
		bridge.close()
		return fmt.Errorf("pty attach superseded")
	}
	// beginPTYAttach already closed prior bridges; install this one.
	s.pty = bridge
	s.HasPTY = true
	s.mu.Unlock()

	_ = m.audit.Append(store.AuditEntry{
		Action: "session.pty", HostID: s.HostID, SessionID: s.ID, Actor: "user", OK: true,
	})

	done := make(chan struct{})
	go func() {
		defer close(done)
		buf := make([]byte, 32*1024)
		copyOut := func(r io.Reader) {
			for {
				n, er := r.Read(buf)
				if n > 0 {
					_ = ws.WriteMessage(websocket.BinaryMessage, buf[:n])
				}
				if er != nil {
					return
				}
			}
		}
		go copyOut(stderr)
		copyOut(stdout)
	}()

	for {
		mt, data, er := ws.ReadMessage()
		if er != nil {
			break
		}
		if mt == websocket.TextMessage {
			var ctrl struct {
				Type string `json:"type"`
				Cols int    `json:"cols"`
				Rows int    `json:"rows"`
			}
			if json.Unmarshal(data, &ctrl) == nil && ctrl.Type == "resize" {
				if ctrl.Cols > 0 && ctrl.Rows > 0 {
					_ = sshSess.WindowChange(ctrl.Rows, ctrl.Cols)
				}
				continue
			}
			_, _ = stdin.Write(data)
			continue
		}
		if mt == websocket.BinaryMessage {
			_, _ = stdin.Write(data)
		}
	}
	bridge.close()
	<-done
	s.mu.Lock()
	if s.pty == bridge {
		s.pty = nil
		s.HasPTY = false
	}
	s.mu.Unlock()
	return nil
}

type ptyBridge struct {
	ws    *websocket.Conn
	sess  *ssh.Session
	stdin io.WriteCloser
	once  sync.Once
}

func (p *ptyBridge) close() {
	p.once.Do(func() {
		_ = p.stdin.Close()
		_ = p.sess.Close()
		_ = p.ws.Close()
	})
}

func sanitizeDialErr(detail string, secrets ...string) string {
	out := detail
	for _, password := range secrets {
		if password == "" {
			continue
		}
		out = strings.ReplaceAll(out, password, "***")
	}
	return out
}

// AsHostKeyIssue unwraps sshx.HostKeyIssue from dial errors.
func AsHostKeyIssue(err error) *sshx.HostKeyIssue {
	var hk *sshx.HostKeyIssue
	if errors.As(err, &hk) {
		return hk
	}
	return nil
}

func closeJumpChain(chain []*ssh.Client) {
	for i := len(chain) - 1; i >= 0; i-- {
		if chain[i] != nil {
			_ = chain[i].Close()
		}
	}
}
