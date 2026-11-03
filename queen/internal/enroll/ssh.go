// Package enroll implements Queen-driven host enrollment over SSH.
// Credentials from the API request exist only in memory for the duration of a job
// and must never be written to logs or persisted job output.
package enroll

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/hivenest/hivenest/queen/internal/store"
	"golang.org/x/crypto/ssh"
)

// Auth holds ephemeral SSH credentials (never log or persist).
type Auth struct {
	Password   string // optional
	PrivateKey string // PEM, optional
}

// Request is the sanitized enrollment intent (no secrets).
type Request struct {
	Host       string
	Port       int
	User       string
	Auth       Auth
	WorkerID   string
	Region     string
	Country    string
	Sudo       bool
	QueenWSURL string // optional per-request override (ws/wss); never log
}

// Config for the enroller.
type Config struct {
	ArtifactDir    string
	InstallDir     string
	BootstrapToken string
	QueenWSURL     string // e.g. ws://queen:8080/v1/worker/ws
	DialTimeout    time.Duration
}

// Enroller runs SSH enrollment jobs against the job store.
type Enroller struct {
	cfg   Config
	store store.Store
}

func New(cfg Config, st store.Store) *Enroller {
	if cfg.DialTimeout <= 0 {
		cfg.DialTimeout = 20 * time.Second
	}
	return &Enroller{cfg: cfg, store: st}
}

type progress struct {
	Host     string   `json:"host"`
	Port     int      `json:"port"`
	User     string   `json:"user"`
	Sudo     bool     `json:"sudo"`
	WorkerID string   `json:"worker_id"`
	Region   string   `json:"region,omitempty"`
	Country  string   `json:"country,omitempty"`
	Arch     string   `json:"arch,omitempty"`
	Log      []string `json:"log"`
}

func (e *Enroller) startProgress(req Request) progress {
	return progress{
		Host:     req.Host,
		Port:     req.Port,
		User:     req.User,
		Sudo:     req.Sudo,
		WorkerID: req.WorkerID,
		Region:   req.Region,
		Country:  req.Country,
		Log:      []string{},
	}
}

func (e *Enroller) save(jobID string, status store.JobStatus, p *progress, errMsg string) {
	b, _ := json.Marshal(p)
	_, _ = e.store.UpdateJobProgress(jobID, status, b, errMsg)
}

func (e *Enroller) step(jobID string, p *progress, msg string) {
	p.Log = append(p.Log, fmt.Sprintf("%s %s", time.Now().UTC().Format(time.RFC3339), msg))
	e.save(jobID, store.JobDispatched, p, "")
	// Safe operational log only — never include credentials.
	log.Printf("enroll %s: %s", jobID[:8], msg)
}

// Run executes enrollment asynchronously-friendly (blocking until done).
func (e *Enroller) Run(ctx context.Context, jobID string, req Request) {
	p := e.startProgress(req)
	e.step(jobID, &p, "starting SSH enrollment")

	if req.Port <= 0 {
		req.Port = 22
	}
	if req.User == "" {
		e.fail(jobID, &p, "user required")
		return
	}
	if req.Host == "" {
		e.fail(jobID, &p, "host required")
		return
	}
	if req.Auth.Password == "" && req.Auth.PrivateKey == "" {
		e.fail(jobID, &p, "password or private_key required")
		return
	}
	wsURL := strings.TrimSpace(req.QueenWSURL)
	if wsURL == "" {
		wsURL = strings.TrimSpace(e.cfg.QueenWSURL)
	}
	if e.cfg.BootstrapToken == "" || wsURL == "" {
		e.fail(jobID, &p, "queen bootstrap token / worker dial url not configured")
		return
	}
	// Defense in depth: never write loopback dial URL for remote enroll.
	if looksLoopbackWS(wsURL) {
		e.fail(jobID, &p, "worker dial URL is localhost/loopback — remote worker cannot reach Queen; set HIVENEST_WORKER_DIAL_URL or pass queen_ws_url")
		return
	}
	e.step(jobID, &p, "worker will dial "+redactURLPath(wsURL))
	if req.WorkerID == "" {
		req.WorkerID = uuid.NewString()
		p.WorkerID = req.WorkerID
		e.step(jobID, &p, "generated worker_id")
	}

	client, err := e.dial(ctx, req)
	if err != nil {
		e.fail(jobID, &p, "ssh dial failed: "+e.redactErr(err))
		return
	}
	defer client.Close()
	e.step(jobID, &p, "ssh connected")

	osName, archRaw, err := e.detectPlatform(client)
	if err != nil {
		e.fail(jobID, &p, "detect platform: "+e.redactErr(err))
		return
	}
	if !strings.EqualFold(osName, "linux") {
		e.fail(jobID, &p, "unsupported OS "+osName+" (need linux)")
		return
	}
	arch, err := mapArch(archRaw)
	if err != nil {
		e.fail(jobID, &p, err.Error())
		return
	}
	p.Arch = arch
	e.step(jobID, &p, "detected "+osName+"/"+arch)

	binPath := filepath.Join(e.cfg.ArtifactDir, "hivenest-worker-linux-"+arch)
	bin, err := os.ReadFile(binPath)
	if err != nil {
		e.fail(jobID, &p, "read worker artifact: "+err.Error()+" (run make release-worker)")
		return
	}
	unitPath := filepath.Join(e.cfg.InstallDir, "hivenest-worker.service")
	unit, err := os.ReadFile(unitPath)
	if err != nil {
		e.fail(jobID, &p, "read unit file: "+err.Error())
		return
	}

	remoteTmp := fmt.Sprintf("/tmp/hivenest-enroll-%s", jobID[:8])
	if err := e.run(client, req.Sudo, fmt.Sprintf("mkdir -p %s", shQuote(remoteTmp))); err != nil {
		e.fail(jobID, &p, "mkdir remote tmp: "+e.redactErr(err))
		return
	}
	e.step(jobID, &p, "uploading worker binary")
	if err := e.upload(client, req.Sudo, remoteTmp+"/hivenest-worker", bin, 0o755); err != nil {
		e.fail(jobID, &p, "upload binary: "+e.redactErr(err))
		return
	}
	e.step(jobID, &p, "uploading systemd unit")
	if err := e.upload(client, req.Sudo, remoteTmp+"/hivenest-worker.service", unit, 0o644); err != nil {
		e.fail(jobID, &p, "upload unit: "+e.redactErr(err))
		return
	}

	envBody := fmt.Sprintf("# Managed by HiveNest SSH enroll\nHIVENEST_QUEEN_URL=%s\nHIVENEST_BOOTSTRAP_TOKEN=%s\nHIVENEST_NODE_ID=%s\nHIVENEST_REGION=%s\nHIVENEST_COUNTRY=%s\n",
		wsURL, e.cfg.BootstrapToken, req.WorkerID, req.Region, req.Country)
	e.step(jobID, &p, "writing /etc/hivenest/worker.env")
	if err := e.upload(client, req.Sudo, remoteTmp+"/worker.env", []byte(envBody), 0o600); err != nil {
		e.fail(jobID, &p, "upload env: "+e.redactErr(err))
		return
	}

	setup := strings.Join([]string{
		"set -euo pipefail",
		"install -d -m 0755 /usr/local/bin /etc/hivenest",
		"install -m 0755 " + shQuote(remoteTmp+"/hivenest-worker") + " /usr/local/bin/hivenest-worker",
		"install -m 0600 " + shQuote(remoteTmp+"/worker.env") + " /etc/hivenest/worker.env",
		"install -m 0644 " + shQuote(remoteTmp+"/hivenest-worker.service") + " /etc/systemd/system/hivenest-worker.service",
		"systemctl daemon-reload",
		"systemctl enable hivenest-worker.service",
		"systemctl restart hivenest-worker.service",
		"systemctl is-active hivenest-worker.service",
		"rm -rf " + shQuote(remoteTmp),
	}, "\n")
	e.step(jobID, &p, "installing binary + systemd")
	out, err := e.runOut(client, req.Sudo, setup)
	if err != nil {
		e.fail(jobID, &p, "remote setup failed: "+e.redactErr(err)+" | "+trimOut(out))
		return
	}
	e.step(jobID, &p, "systemd active: "+strings.TrimSpace(out))

	b, _ := json.Marshal(p)
	_, _ = e.store.CompleteJob(jobID, true, b, "", time.Now().UTC())
	log.Printf("enroll %s: succeeded worker_id=%s host=%s", jobID[:8], req.WorkerID, req.Host)
}

func (e *Enroller) fail(jobID string, p *progress, msg string) {
	p.Log = append(p.Log, fmt.Sprintf("%s ERROR %s", time.Now().UTC().Format(time.RFC3339), msg))
	b, _ := json.Marshal(p)
	_, _ = e.store.CompleteJob(jobID, false, b, msg, time.Now().UTC())
	log.Printf("enroll %s: failed: %s", jobID[:8], msg)
}

func (e *Enroller) dial(ctx context.Context, req Request) (*ssh.Client, error) {
	var auths []ssh.AuthMethod
	if req.Auth.PrivateKey != "" {
		signer, err := ssh.ParsePrivateKey([]byte(req.Auth.PrivateKey))
		if err != nil {
			// Try with empty passphrase only; encrypted keys without passphrase fail clearly.
			return nil, fmt.Errorf("parse private key: %w", err)
		}
		auths = append(auths, ssh.PublicKeys(signer))
	}
	if req.Auth.Password != "" {
		auths = append(auths, ssh.Password(req.Auth.Password))
	}
	cfg := &ssh.ClientConfig{
		User:            req.User,
		Auth:            auths,
		HostKeyCallback: ssh.InsecureIgnoreHostKey(), // demo; document TOFU/known_hosts later
		Timeout:         e.cfg.DialTimeout,
	}
	addr := net.JoinHostPort(req.Host, fmt.Sprintf("%d", req.Port))
	d := net.Dialer{Timeout: e.cfg.DialTimeout}
	conn, err := d.DialContext(ctx, "tcp", addr)
	if err != nil {
		return nil, err
	}
	c, chans, reqs, err := ssh.NewClientConn(conn, addr, cfg)
	if err != nil {
		_ = conn.Close()
		return nil, err
	}
	return ssh.NewClient(c, chans, reqs), nil
}

func (e *Enroller) detectPlatform(client *ssh.Client) (osName, arch string, err error) {
	out, err := e.runOut(client, false, "uname -s; uname -m")
	if err != nil {
		return "", "", err
	}
	lines := strings.Split(strings.TrimSpace(out), "\n")
	if len(lines) < 2 {
		return "", "", fmt.Errorf("unexpected uname output")
	}
	return strings.TrimSpace(lines[0]), strings.TrimSpace(lines[1]), nil
}

func mapArch(raw string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "x86_64", "amd64":
		return "amd64", nil
	case "aarch64", "arm64":
		return "arm64", nil
	default:
		return "", fmt.Errorf("unsupported arch %q (need amd64 or arm64)", raw)
	}
}

func (e *Enroller) wrap(sudo bool, script string) string {
	if !sudo {
		return script
	}
	// Non-interactive sudo; target should allow NOPASSWD or be root.
	return "sudo -n bash -lc " + shQuote(script)
}

func (e *Enroller) run(client *ssh.Client, sudo bool, script string) error {
	_, err := e.runOut(client, sudo, script)
	return err
}

func (e *Enroller) runOut(client *ssh.Client, sudo bool, script string) (string, error) {
	session, err := client.NewSession()
	if err != nil {
		return "", err
	}
	defer session.Close()
	var stdout, stderr bytes.Buffer
	session.Stdout = &stdout
	session.Stderr = &stderr
	cmd := e.wrap(sudo, script)
	err = session.Run(cmd)
	out := stdout.String()
	if err != nil {
		return out, fmt.Errorf("%w: %s", err, strings.TrimSpace(stderr.String()))
	}
	return out, nil
}

func (e *Enroller) upload(client *ssh.Client, sudo bool, remotePath string, data []byte, mode os.FileMode) error {
	// Stage via cat to a user-writable tmp path first when using sudo.
	tmp := remotePath
	if sudo && (strings.HasPrefix(remotePath, "/etc/") || strings.HasPrefix(remotePath, "/usr/")) {
		tmp = "/tmp/hivenest-upload-" + filepath.Base(remotePath)
	}
	session, err := client.NewSession()
	if err != nil {
		return err
	}
	stdin, err := session.StdinPipe()
	if err != nil {
		session.Close()
		return err
	}
	session.Stdout = io.Discard
	session.Stderr = io.Discard
	cmd := fmt.Sprintf("cat > %s", shQuote(tmp))
	if err := session.Start(cmd); err != nil {
		session.Close()
		return err
	}
	if _, err := io.Copy(stdin, bytes.NewReader(data)); err != nil {
		_ = stdin.Close()
		_ = session.Close()
		return err
	}
	_ = stdin.Close()
	if err := session.Wait(); err != nil {
		return err
	}
	_ = session.Close()

	chmod := fmt.Sprintf("chmod %o %s", mode, shQuote(tmp))
	if err := e.run(client, false, chmod); err != nil {
		return err
	}
	if tmp != remotePath {
		move := fmt.Sprintf("install -D -m %o %s %s", mode, shQuote(tmp), shQuote(remotePath))
		if err := e.run(client, sudo, move); err != nil {
			return err
		}
		_ = e.run(client, false, "rm -f "+shQuote(tmp))
	}
	return nil
}

func shQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}

func (e *Enroller) redactErr(err error) string {
	msg := sanitizeErr(err)
	if tok := e.cfg.BootstrapToken; tok != "" {
		msg = strings.ReplaceAll(msg, tok, "[REDACTED]")
	}
	return msg
}

func sanitizeErr(err error) string {
	if err == nil {
		return ""
	}
	// Never echo credentials; truncate noisy remote stderr.
	msg := err.Error()
	msg = strings.ReplaceAll(msg, "\n", " ")
	if len(msg) > 400 {
		msg = msg[:400] + "…"
	}
	return msg
}

func trimOut(s string) string {
	s = strings.TrimSpace(s)
	if len(s) > 300 {
		return s[:300] + "…"
	}
	return s
}

func looksLoopbackWS(raw string) bool {
	raw = strings.ToLower(strings.TrimSpace(raw))
	for _, needle := range []string{"://127.0.0.1", "://localhost", "://[::1]", "://::1"} {
		if strings.Contains(raw, needle) {
			return true
		}
	}
	return false
}

func redactURLPath(u string) string {
	// Safe for logs: full dial URL has no secrets; keep as-is but truncate extremes.
	u = strings.TrimSpace(u)
	if len(u) > 200 {
		return u[:200] + "…"
	}
	return u
}
