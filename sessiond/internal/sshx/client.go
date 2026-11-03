// Package sshx dials SSH using identity files, the platform SSH agent, and/or password.
package sshx

import (
	"fmt"
	"net"
	"os"
	"strings"
	"time"

	"github.com/hivenest/hivenest/sessiond/internal/config"
	"golang.org/x/crypto/ssh"
)

// DialOpts configures an outbound SSH connection.
// Password is used only for this dial; callers must not persist it.
type DialOpts struct {
	Host         string
	Port         int
	User         string
	IdentityFile string // optional path; expanded via config.ExpandPath
	UseAgent     bool
	Password     string // optional target password; never log or store
	Timeout      time.Duration

	// Host key TOFU. When KnownHosts is nil, host keys are ignored (tests only).
	KnownHosts     *KnownHosts
	AcceptHostKey  bool // accept & persist unknown key on this dial
	ReplaceHostKey bool // replace mismatch (user confirmed MITM risk)

	// Optional jump / bastion. Prefer JumpClient when JumpHostID(s) were resolved by caller.
	// ProxyJump is OpenSSH-style: one hop "user@host:port", or a comma chain "b1,b2".
	// Bastion auth is SEPARATE from the target: use JumpIdentityFile / JumpUseAgent /
	// JumpPassword / JumpHopAuths — never reuse target IdentityFile or Password.
	ProxyJump        string
	JumpIdentityFile string      // bastion key for hop 0 when JumpHopAuths empty (ProxyJump path)
	JumpUseAgent     bool        // bastion agent for hop 0 when JumpHopAuths empty
	JumpPassword     string      // bastion password for hop 0 when JumpHopAuths empty
	JumpHopAuths     []HopAuth   // optional per-hop auth aligned with ParseJumpChain
	JumpClient       *ssh.Client // if set, dial target through this already-open bastion
}

// HopAuth is per-hop bastion authentication for ProxyJump chains.
// Callers must never copy the target IdentityFile / Password into these fields.
type HopAuth struct {
	IdentityFile string
	UseAgent     bool
	Password     string
}

// DialResult holds the target SSH client and optional jump hop clients (outer→inner).
type DialResult struct {
	Client *ssh.Client
	Jump   *ssh.Client   // outermost hop (compat); same as Jumps[0] when set
	Jumps  []*ssh.Client // all hops outer→inner; Close closes Client then hops reverse
}

// Close closes the target client and, if present, jump hop connections (inner→outer).
func (r *DialResult) Close() error {
	if r == nil {
		return nil
	}
	var first error
	if r.Client != nil {
		if err := r.Client.Close(); err != nil {
			first = err
		}
	}
	jumps := r.Jumps
	if len(jumps) == 0 && r.Jump != nil {
		jumps = []*ssh.Client{r.Jump}
	}
	for i := len(jumps) - 1; i >= 0; i-- {
		if jumps[i] == nil {
			continue
		}
		if err := jumps[i].Close(); err != nil && first == nil {
			first = err
		}
	}
	return first
}

// Dial opens an SSH client with TOFU host-key checking when KnownHosts is set.
func Dial(opts DialOpts) (*DialResult, error) {
	if opts.Port <= 0 {
		opts.Port = 22
	}
	if opts.Timeout <= 0 {
		opts.Timeout = 20 * time.Second
	}
	if opts.User == "" || opts.Host == "" {
		return nil, fmt.Errorf("user and host are required")
	}

	auths, err := buildAuths(opts)
	if err != nil {
		return nil, err
	}

	cfg := &ssh.ClientConfig{
		User:            opts.User,
		Auth:            auths,
		HostKeyCallback: hostKeyCallback(opts),
		Timeout:         opts.Timeout,
	}
	addr := net.JoinHostPort(opts.Host, fmt.Sprintf("%d", opts.Port))

	// Already have a jump client from caller (JumpHostID path). Caller owns jump lifetime.
	if opts.JumpClient != nil {
		client, err := dialVia(opts.JumpClient, addr, cfg)
		if err != nil {
			return nil, mapAuthErr(err)
		}
		return &DialResult{Client: client}, nil
	}

	// Inline ProxyJump string (single hop or comma-separated multi-hop).
	// Each hop uses JumpHopAuths[i] or Jump* for hop 0 — never target IdentityFile/Password.
	if pj := strings.TrimSpace(opts.ProxyJump); pj != "" {
		specs, err := ParseJumpChain(pj)
		if err != nil {
			return nil, err
		}
		var hopClients []*ssh.Client
		var prev *ssh.Client
		closeHops := func() {
			for i := len(hopClients) - 1; i >= 0; i-- {
				if hopClients[i] != nil {
					_ = hopClients[i].Close()
				}
			}
		}
		for i, spec := range specs {
			ju, jh, jp, err := ParseJump(spec)
			if err != nil {
				closeHops()
				return nil, fmt.Errorf("proxy jump[%d]: %w", i, err)
			}
			if ju == "" {
				ju = opts.User
			}
			ha := hopAuthAt(opts, i, len(specs))
			jumpIdentity := ha.IdentityFile
			jumpAgent := ha.UseAgent
			jumpPass := ha.Password
			// Soft-default agent when this hop has no key/password (never fall back to target).
			if jumpIdentity == "" && jumpPass == "" && !jumpAgent {
				jumpAgent = true
			}
			jumpOpts := DialOpts{
				Host:           jh,
				Port:           jp,
				User:           ju,
				IdentityFile:   jumpIdentity,
				UseAgent:       jumpAgent,
				Password:       jumpPass,
				Timeout:        opts.Timeout,
				KnownHosts:     opts.KnownHosts,
				AcceptHostKey:  opts.AcceptHostKey,
				ReplaceHostKey: opts.ReplaceHostKey,
				JumpClient:     prev,
			}
			jumpRes, err := Dial(jumpOpts)
			if err != nil {
				closeHops()
				if jumpPass == "" && isSSHAuthError(err) {
					return nil, &JumpPasswordRequiredError{
						Jump:     spec,
						HopIndex: i,
						Message:  fmt.Sprintf("proxy jump[%d] %q requires password (passwords are not stored; supply jump_password / jump_passwords on connect)", i, spec),
					}
				}
				return nil, fmt.Errorf("proxy jump[%d] %q: %w", i, spec, err)
			}
			hopClients = append(hopClients, jumpRes.Client)
			prev = jumpRes.Client
		}
		client, err := dialVia(prev, addr, cfg)
		if err != nil {
			closeHops()
			return nil, mapAuthErr(err)
		}
		return &DialResult{Client: client, Jump: hopClients[0], Jumps: hopClients}, nil
	}

	client, err := ssh.Dial("tcp", addr, cfg)
	if err != nil {
		return nil, mapAuthErr(err)
	}
	return &DialResult{Client: client}, nil
}

func dialVia(jump *ssh.Client, addr string, cfg *ssh.ClientConfig) (*ssh.Client, error) {
	conn, err := jump.Dial("tcp", addr)
	if err != nil {
		return nil, fmt.Errorf("jump dial %s: %w", addr, err)
	}
	cc, chans, reqs, err := ssh.NewClientConn(conn, addr, cfg)
	if err != nil {
		_ = conn.Close()
		return nil, mapAuthErr(err)
	}
	return ssh.NewClient(cc, chans, reqs), nil
}

func hostKeyCallback(opts DialOpts) ssh.HostKeyCallback {
	if opts.KnownHosts == nil {
		return ssh.InsecureIgnoreHostKey()
	}
	return opts.KnownHosts.Callback(opts.Host, opts.Port, opts.AcceptHostKey, opts.ReplaceHostKey)
}


func mapAuthErr(err error) error {
	if err == nil {
		return nil
	}
	msg := err.Error()
	if strings.Contains(msg, "unexpected message type 51") {
		return fmt.Errorf("ssh authentication failed (check username/password): %w", err)
	}
	return err
}

func buildAuths(opts DialOpts) ([]ssh.AuthMethod, error) {
	var auths []ssh.AuthMethod
	if opts.Password != "" {
		pw := opts.Password
		// Prefer keyboard-interactive first: many OpenSSH images set
		// PasswordAuthentication no and only accept PAM via kbd-interactive.
		// Offering ssh.Password first then KI can yield "unexpected message type 51".
		auths = append(auths, ssh.KeyboardInteractive(func(user, instruction string, questions []string, echos []bool) ([]string, error) {
			answers := make([]string, len(questions))
			for i := range questions {
				answers[i] = pw
			}
			return answers, nil
		}))
		auths = append(auths, ssh.Password(pw))
	}
	if opts.IdentityFile != "" {
		path, err := config.ExpandPath(opts.IdentityFile)
		if err != nil {
			return nil, fmt.Errorf("identity file path: %w", err)
		}
		signer, err := loadSigner(path)
		if err != nil {
			return nil, err
		}
		auths = append(auths, ssh.PublicKeys(signer))
	}
	if opts.UseAgent {
		if a, err := agentAuth(); err == nil {
			auths = append(auths, a)
		} else if opts.IdentityFile == "" && opts.Password == "" {
			return nil, fmt.Errorf("ssh agent unavailable: %w (set identity_file, password, or start an agent)", err)
		}
	}
	if len(auths) == 0 {
		return nil, fmt.Errorf("no SSH auth method: set password, identity_file, and/or use_agent")
	}
	return auths, nil
}

func loadSigner(path string) (ssh.Signer, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read identity file: %w", err)
	}
	signer, err := ssh.ParsePrivateKey(b)
	if err != nil {
		return nil, fmt.Errorf("parse identity file (encrypted keys need ssh-agent): %w", err)
	}
	return signer, nil
}

// ParseJumpChain splits an OpenSSH-style ProxyJump value on commas ("b1,b2").
func ParseJumpChain(s string) ([]string, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil, fmt.Errorf("empty proxy_jump")
	}
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		out = append(out, p)
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("empty proxy_jump")
	}
	return out, nil
}

func hopAuthAt(opts DialOpts, i, n int) HopAuth {
	if i >= 0 && i < len(opts.JumpHopAuths) {
		return opts.JumpHopAuths[i]
	}
	// Compat: Jump* applies to the only hop, or to hop 0 of a longer chain.
	if n == 1 || i == 0 {
		return HopAuth{
			IdentityFile: opts.JumpIdentityFile,
			UseAgent:     opts.JumpUseAgent,
			Password:     opts.JumpPassword,
		}
	}
	// Later hops without JumpHopAuths: agent soft-default inside Dial; never target auth.
	return HopAuth{}
}

// ParseJump parses user@host:port / host:port / host (default port 22).
func ParseJump(s string) (user, host string, port int, err error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return "", "", 0, fmt.Errorf("empty proxy_jump")
	}
	port = 22
	if at := strings.LastIndex(s, "@"); at >= 0 {
		user = s[:at]
		s = s[at+1:]
	}
	h, p, e := net.SplitHostPort(s)
	if e == nil {
		host = h
		fmt.Sscanf(p, "%d", &port)
		if port <= 0 {
			port = 22
		}
		return user, host, port, nil
	}
	// bare hostname
	if strings.Contains(s, ":") && !strings.HasPrefix(s, "[") {
		// IPv6 without brackets is ambiguous; treat as host only if parse failed
	}
	return user, s, port, nil
}

// JumpPasswordRequiredError means a ProxyJump hop needs a connect-time password.
type JumpPasswordRequiredError struct {
	Jump     string
	HopIndex int
	Message  string
}

func (e *JumpPasswordRequiredError) Error() string { return e.Message }

func isSSHAuthError(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "unable to authenticate") ||
		strings.Contains(msg, "no supported methods remain") ||
		strings.Contains(msg, "permission denied") ||
		strings.Contains(msg, "no ssh auth method")
}
