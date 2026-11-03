// Package tunnel manages an optional local demo reverse tunnel (cloudflared quick tunnel).
// Default is OFF — never start unless HIVENEST_DEMO_TUNNEL=1 or API enable.
package tunnel

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"os/exec"
	"regexp"
	"strings"
	"sync"
	"time"
)

var (
	ErrNotInstalled = errors.New("tunnel binary not found (install cloudflared or set HIVENEST_TUNNEL_BIN)")
	ErrAlreadyRunning = errors.New("tunnel already running")
	ErrNotRunning = errors.New("tunnel not running")
	tryCFURL = regexp.MustCompile(`https://[a-zA-Z0-9.-]+\.trycloudflare\.com`)
)

// Status is a snapshot of the tunnel manager.
type Status struct {
	Enabled    bool   `json:"enabled"`
	Running    bool   `json:"running"`
	Provider   string `json:"provider"`
	PublicURL  string `json:"public_url,omitempty"`
	LocalURL   string `json:"local_url,omitempty"`
	Bin        string `json:"bin"`
	BinFound   bool   `json:"bin_found"`
	Error      string `json:"error,omitempty"`
	StartedAt  string `json:"started_at,omitempty"`
	Note       string `json:"note,omitempty"`
}

// Manager starts/stops a quick tunnel process.
type Manager struct {
	mu        sync.Mutex
	bin       string
	localURL  string // e.g. http://127.0.0.1:8080
	cmd       *exec.Cmd
	cancel    context.CancelFunc
	publicURL string
	errMsg    string
	startedAt time.Time
	wantOn    bool
}

func New(bin, localURL string) *Manager {
	if strings.TrimSpace(bin) == "" {
		bin = "cloudflared"
	}
	return &Manager{bin: bin, localURL: localURL}
}

func (m *Manager) BinPath() (string, bool) {
	m.mu.Lock()
	bin := m.bin
	m.mu.Unlock()
	path, err := exec.LookPath(bin)
	if err != nil {
		return bin, false
	}
	return path, true
}

func (m *Manager) Status() Status {
	m.mu.Lock()
	defer m.mu.Unlock()
	path, found := lookPathLocked(m.bin)
	st := Status{
		Enabled:   m.wantOn,
		Running:   m.cmd != nil && m.publicURL != "",
		Provider:  "cloudflared-quick",
		PublicURL: m.publicURL,
		LocalURL:  m.localURL,
		Bin:       path,
		BinFound:  found,
		Error:     m.errMsg,
		Note:      "演示用临时隧道，默认关闭。生产请用显式 HIVENEST_PUBLIC_URL / 云上蜂后。",
	}
	if m.cmd != nil && m.publicURL == "" && m.wantOn {
		st.Running = false
		st.Enabled = true
		if st.Error == "" {
			st.Error = "starting"
		}
	}
	if !m.startedAt.IsZero() {
		st.StartedAt = m.startedAt.UTC().Format(time.RFC3339)
	}
	return st
}

func lookPathLocked(bin string) (string, bool) {
	path, err := exec.LookPath(bin)
	if err != nil {
		return bin, false
	}
	return path, true
}

// Start launches cloudflared quick tunnel. Idempotent if already up.
func (m *Manager) Start(ctx context.Context) (Status, error) {
	m.mu.Lock()
	if m.cmd != nil && m.publicURL != "" {
		st := m.statusLocked()
		m.mu.Unlock()
		return st, nil
	}
	if m.cmd != nil {
		// still starting
		st := m.statusLocked()
		m.mu.Unlock()
		return st, nil
	}
	path, err := exec.LookPath(m.bin)
	if err != nil {
		m.wantOn = true
		m.errMsg = ErrNotInstalled.Error() + ": " + m.bin
		st := m.statusLocked()
		m.mu.Unlock()
		return st, ErrNotInstalled
	}
	local := m.localURL
	if local == "" {
		local = "http://127.0.0.1:8080"
	}
	runCtx, cancel := context.WithCancel(context.Background())
	cmd := exec.CommandContext(runCtx, path, "tunnel", "--url", local, "--no-autoupdate")
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		cancel()
		m.errMsg = err.Error()
		st := m.statusLocked()
		m.mu.Unlock()
		return st, err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		cancel()
		m.errMsg = err.Error()
		st := m.statusLocked()
		m.mu.Unlock()
		return st, err
	}
	if err := cmd.Start(); err != nil {
		cancel()
		m.errMsg = err.Error()
		st := m.statusLocked()
		m.mu.Unlock()
		return st, err
	}
	m.cmd = cmd
	m.cancel = cancel
	m.wantOn = true
	m.publicURL = ""
	m.errMsg = ""
	m.startedAt = time.Now().UTC()
	m.mu.Unlock()

	urlCh := make(chan string, 1)
	go m.scanOutput(stdout, urlCh)
	go m.scanOutput(stderr, urlCh)
	go m.waitCmd(cmd, cancel)

	// Wait for public URL (bounded).
	waitCtx := ctx
	if waitCtx == nil {
		var c context.CancelFunc
		waitCtx, c = context.WithTimeout(context.Background(), 45*time.Second)
		defer c()
	}
	select {
	case u := <-urlCh:
		m.mu.Lock()
		m.publicURL = strings.TrimRight(u, "/")
		m.errMsg = ""
		st := m.statusLocked()
		m.mu.Unlock()
		log.Printf("demo tunnel up: %s → %s", local, st.PublicURL)
		return st, nil
	case <-waitCtx.Done():
		m.mu.Lock()
		if m.publicURL == "" {
			m.errMsg = "timeout waiting for tunnel URL (cloudflared may be blocked or slow)"
		}
		st := m.statusLocked()
		m.mu.Unlock()
		if st.PublicURL != "" {
			return st, nil
		}
		return st, fmt.Errorf("%s", st.Error)
	}
}

func (m *Manager) scanOutput(r io.Reader, urlCh chan<- string) {
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for sc.Scan() {
		line := sc.Text()
		if u := tryCFURL.FindString(line); u != "" {
			select {
			case urlCh <- u:
			default:
			}
		}
	}
}

func (m *Manager) waitCmd(cmd *exec.Cmd, cancel context.CancelFunc) {
	err := cmd.Wait()
	cancel()
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.cmd == cmd {
		m.cmd = nil
		m.cancel = nil
		if m.wantOn {
			if err != nil {
				m.errMsg = "tunnel exited: " + err.Error()
			} else {
				m.errMsg = "tunnel exited"
			}
		}
		m.publicURL = ""
	}
}

// Stop terminates the tunnel process.
func (m *Manager) Stop() (Status, error) {
	m.mu.Lock()
	m.wantOn = false
	cancel := m.cancel
	cmd := m.cmd
	m.publicURL = ""
	m.errMsg = ""
	m.cancel = nil
	m.cmd = nil
	m.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	if cmd != nil && cmd.Process != nil {
		_ = cmd.Process.Kill()
		_, _ = cmd.Process.Wait()
	}
	m.mu.Lock()
	st := m.statusLocked()
	m.mu.Unlock()
	return st, nil
}

func (m *Manager) statusLocked() Status {
	path, found := lookPathLocked(m.bin)
	st := Status{
		Enabled:   m.wantOn,
		Running:   m.cmd != nil && m.publicURL != "",
		Provider:  "cloudflared-quick",
		PublicURL: m.publicURL,
		LocalURL:  m.localURL,
		Bin:       path,
		BinFound:  found,
		Error:     m.errMsg,
		Note:      "演示用临时隧道，默认关闭。生产请用显式 HIVENEST_PUBLIC_URL / 云上蜂后。",
	}
	if m.cmd != nil && m.publicURL == "" && m.wantOn {
		if st.Error == "" {
			st.Error = "starting"
		}
	}
	if !m.startedAt.IsZero() {
		st.StartedAt = m.startedAt.UTC().Format(time.RFC3339)
	}
	return st
}

// PublicURL returns the current tunnel URL or empty.
func (m *Manager) PublicURL() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.publicURL
}
