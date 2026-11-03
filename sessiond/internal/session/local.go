package session

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"os/user"
	"runtime"
	"sync"
	"time"

	"github.com/creack/pty"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/hivenest/hivenest/sessiond/internal/store"
)

// LocalHostID is the sentinel host_id for a machine-local shell session.
const LocalHostID = "__local__"

func IsLocalHostID(id string) bool {
	return id == LocalHostID || id == "local"
}

func (m *Manager) OpenLocal() (*Session, error) {
	u, err := user.Current()
	username := "local"
	home := ""
	if err == nil {
		username = u.Username
		home = u.HomeDir
	}
	host, _ := os.Hostname()
	if host == "" {
		host = "localhost"
	}
	s := &Session{
		ID:        uuid.NewString(),
		HostID:    LocalHostID,
		HostName:  "Local",
		User:      username,
		Remote:    fmt.Sprintf("local:%s@%s", username, host),
		CreatedAt: time.Now().UTC(),
		IsLocal:   true,
		localHome: home,
	}
	m.mu.Lock()
	m.sessions[s.ID] = s
	m.mu.Unlock()
	_ = m.audit.Append(store.AuditEntry{
		Action: "session.open", HostID: LocalHostID, SessionID: s.ID, Actor: "user", OK: true, Detail: s.Remote,
	})
	return s, nil
}

func defaultShell() (string, []string) {
	shell := os.Getenv("SHELL")
	if shell == "" {
		if runtime.GOOS == "windows" {
			return "powershell.exe", nil
		}
		shell = "/bin/bash"
	}
	if runtime.GOOS == "windows" {
		return shell, nil
	}
	return shell, []string{"-l"}
}

func runLocalExec(cmd string) (stdout, stderr string, exitCode int, err error) {
	shell, _ := defaultShell()
	var c *exec.Cmd
	if runtime.GOOS == "windows" {
		c = exec.Command(shell, "-NoProfile", "-Command", cmd)
	} else {
		c = exec.Command(shell, "-lc", cmd)
	}
	var outBuf, errBuf bytes.Buffer
	c.Stdout = &outBuf
	c.Stderr = &errBuf
	runErr := c.Run()
	stdout, stderr = outBuf.String(), errBuf.String()
	if runErr != nil {
		if ee, ok := runErr.(*exec.ExitError); ok {
			return stdout, stderr, ee.ExitCode(), nil
		}
		return stdout, stderr, -1, runErr
	}
	return stdout, stderr, 0, nil
}

func (m *Manager) AttachLocalPTY(sessionID string, ws *websocket.Conn, cols, rows int) error {
	s, err := m.Get(sessionID)
	if err != nil {
		return err
	}
	if !s.IsLocal {
		return fmt.Errorf("not a local session")
	}
	if cols <= 0 {
		cols = 80
	}
	if rows <= 0 {
		rows = 24
	}

	gen := s.beginPTYAttach()

	shell, args := defaultShell()
	cmd := exec.Command(shell, args...)
	cmd.Env = os.Environ()
	if s.localHome != "" {
		cmd.Dir = s.localHome
	}
	ptmx, err := pty.Start(cmd)
	if err != nil {
		return fmt.Errorf("local pty: %w", err)
	}
	_ = pty.Setsize(ptmx, &pty.Winsize{Rows: uint16(rows), Cols: uint16(cols)})

	bridge := &localPtyBridge{ws: ws, ptmx: ptmx, cmd: cmd}
	s.mu.Lock()
	if gen != s.ptyGen {
		s.mu.Unlock()
		bridge.close()
		return fmt.Errorf("pty attach superseded")
	}
	s.localPty = bridge
	s.HasPTY = true
	s.mu.Unlock()

	_ = m.audit.Append(store.AuditEntry{
		Action: "session.pty", HostID: s.HostID, SessionID: s.ID, Actor: "user", OK: true, Detail: "local",
	})

	done := make(chan struct{})
	go func() {
		defer close(done)
		buf := make([]byte, 32*1024)
		for {
			n, er := ptmx.Read(buf)
			if n > 0 {
				_ = ws.WriteMessage(websocket.BinaryMessage, buf[:n])
			}
			if er != nil {
				return
			}
		}
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
					_ = pty.Setsize(ptmx, &pty.Winsize{Rows: uint16(ctrl.Rows), Cols: uint16(ctrl.Cols)})
				}
				continue
			}
			_, _ = ptmx.Write(data)
			continue
		}
		if mt == websocket.BinaryMessage {
			_, _ = ptmx.Write(data)
		}
	}
	bridge.close()
	<-done
	s.mu.Lock()
	if s.localPty == bridge {
		s.localPty = nil
		s.HasPTY = false
	}
	s.mu.Unlock()
	return nil
}

type localPtyBridge struct {
	ws   *websocket.Conn
	ptmx *os.File
	cmd  *exec.Cmd
	once sync.Once
}

func (p *localPtyBridge) close() {
	p.once.Do(func() {
		_ = p.ptmx.Close()
		if p.cmd != nil && p.cmd.Process != nil {
			_ = p.cmd.Process.Kill()
			_, _ = p.cmd.Process.Wait()
		}
		_ = p.ws.Close()
	})
}
