package api_test

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/hivenest/hivenest/sessiond/internal/api"
	"github.com/hivenest/hivenest/sessiond/internal/config"
	"github.com/hivenest/hivenest/sessiond/internal/proposal"
	"github.com/hivenest/hivenest/sessiond/internal/session"
	"github.com/hivenest/hivenest/sessiond/internal/sshx"
	"github.com/hivenest/hivenest/sessiond/internal/store"
	"golang.org/x/crypto/ssh"
)

func TestHostExecProposalFlow(t *testing.T) {
	addr, keyPath, cleanup := startTestSSHServer(t)
	defer cleanup()

	dir := t.TempDir()
	cfg := config.Config{
		Listen:         "127.0.0.1:0",
		Token:          "test-token",
		DataDir:        dir,
		TokenFile:      filepath.Join(dir, "sessiond.token"),
		HostsFile:      filepath.Join(dir, "hosts.json"),
		AuditFile:      filepath.Join(dir, "audit.jsonl"),
		KnownHostsFile: filepath.Join(dir, "known_hosts.json"),
	}
	hosts := store.NewHostStore(cfg.HostsFile)
	audit := store.NewAuditLog(cfg.AuditFile)
	kh := sshx.NewKnownHosts(cfg.KnownHostsFile)
	props := proposal.NewStore()
	sessions := session.NewManager(hosts, audit, props, kh)
	srv := api.New(cfg, hosts, audit, props, sessions, kh)
	ts := httptest.NewServer(srv.Handler())
	defer ts.Close()

	do := func(method, path string, body any) (int, map[string]any) {
		t.Helper()
		var rdr io.Reader
		if body != nil {
			b, _ := json.Marshal(body)
			rdr = bytes.NewReader(b)
		}
		req, _ := http.NewRequest(method, ts.URL+path, rdr)
		req.Header.Set("X-HiveNest-Token", cfg.Token)
		if body != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		var m map[string]any
		_ = json.NewDecoder(res.Body).Decode(&m)
		return res.StatusCode, m
	}

	code, _ := do("GET", "/health", nil)
	if code != 200 {
		t.Fatalf("health %d", code)
	}

	code, host := do("POST", "/v1/hosts", map[string]any{
		"name": "smoke", "host": "127.0.0.1", "port": addr.Port, "user": "hive",
		"identity_file": keyPath, "use_agent": false,
	})
	if code != 201 {
		t.Fatalf("create host %d %#v", code, host)
	}
	hostID := host["id"].(string)

	code, hk := do("POST", "/v1/sessions", map[string]any{"host_id": hostID})
	if code != 409 || hk["code"] != "host_key_unknown" {
		t.Fatalf("expected host_key_unknown, got %d %#v", code, hk)
	}
	code, sess := do("POST", "/v1/sessions", map[string]any{"host_id": hostID, "accept_host_key": true})
	if code != 201 {
		t.Fatalf("open session %d %#v", code, sess)
	}
	sid := sess["id"].(string)

	code, execRes := do("POST", "/v1/sessions/"+sid+"/exec", map[string]any{
		"command": "echo hivenest-ok", "actor": "user",
	})
	if code != 200 {
		t.Fatalf("exec low %d %#v", code, execRes)
	}
	if execRes["stdout"] != "hivenest-ok\n" {
		t.Fatalf("stdout %#v", execRes)
	}

	code, denied := do("POST", "/v1/sessions/"+sid+"/exec", map[string]any{
		"command": "rm -rf /tmp/x", "actor": "agent",
	})
	if code != 409 || denied["code"] != "approval_required" {
		t.Fatalf("expected approval_required, got %d %#v", code, denied)
	}

	code, prop := do("POST", "/v1/sessions/"+sid+"/proposals", map[string]any{
		"command": "rm -rf /tmp/x", "reason": "cleanup",
	})
	if code != 201 {
		t.Fatalf("proposal %d %#v", code, prop)
	}
	pid := prop["id"].(string)

	code, prop = do("POST", "/v1/proposals/"+pid+"/approve", map[string]any{})
	if code != 200 {
		t.Fatalf("approve %d %#v", code, prop)
	}
	tok := prop["approve_token"].(string)

	code, execRes = do("POST", "/v1/sessions/"+sid+"/exec", map[string]any{
		"command": "rm -rf /tmp/x", "proposal_id": pid, "approve_token": tok, "actor": "agent",
	})
	if code != 200 {
		t.Fatalf("exec approved %d %#v", code, execRes)
	}

	code, _ = do("DELETE", "/v1/sessions/"+sid, nil)
	if code != 204 && code != 200 {
		// NoContent has empty body; httptest may report 204
	}
}

func startTestSSHServer(t *testing.T) (addr *net.TCPAddr, clientKeyPath string, cleanup func()) {
	t.Helper()
	_, hostPriv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	hostSigner, err := ssh.NewSignerFromKey(hostPriv)
	if err != nil {
		t.Fatal(err)
	}
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	clientSigner, err := ssh.NewSignerFromKey(priv)
	if err != nil {
		t.Fatal(err)
	}
	block, err := ssh.MarshalPrivateKey(priv, "")
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	clientKeyPath = filepath.Join(dir, "id_ed25519")
	if err := os.WriteFile(clientKeyPath, pem.EncodeToMemory(block), 0o600); err != nil {
		t.Fatal(err)
	}
	cfg := &ssh.ServerConfig{
		PublicKeyCallback: func(conn ssh.ConnMetadata, key ssh.PublicKey) (*ssh.Permissions, error) {
			if conn.User() != "hive" {
				return nil, fmt.Errorf("bad user")
			}
			if string(key.Marshal()) == string(clientSigner.PublicKey().Marshal()) {
				return &ssh.Permissions{}, nil
			}
			return nil, fmt.Errorf("bad key")
		},
	}
	cfg.AddHostKey(hostSigner)
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan struct{})
	go func() {
		defer close(done)
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			go func(nConn net.Conn) {
				_, chans, reqs, err := ssh.NewServerConn(nConn, cfg)
				if err != nil {
					_ = nConn.Close()
					return
				}
				go ssh.DiscardRequests(reqs)
				for newChannel := range chans {
					if newChannel.ChannelType() != "session" {
						_ = newChannel.Reject(ssh.UnknownChannelType, "unknown")
						continue
					}
					ch, requests, err := newChannel.Accept()
					if err != nil {
						continue
					}
					go func(ch ssh.Channel, requests <-chan *ssh.Request) {
						defer ch.Close()
						for req := range requests {
							switch req.Type {
							case "subsystem":
								// No SFTP — force tools package exec fallback.
								if req.WantReply {
									_ = req.Reply(false, nil)
								}
							case "exec":
								_ = req.Reply(true, nil)
								cmd := ""
								if len(req.Payload) >= 4 {
									n := int(req.Payload[0])<<24 | int(req.Payload[1])<<16 | int(req.Payload[2])<<8 | int(req.Payload[3])
									if n > 0 && 4+n <= len(req.Payload) {
										cmd = string(req.Payload[4 : 4+n])
									}
								}
								if cmd == "echo hivenest-ok" {
									_, _ = io.WriteString(ch, "hivenest-ok\n")
								} else {
									_, _ = io.WriteString(ch, "ran:"+cmd+"\n")
								}
								_, _ = ch.SendRequest("exit-status", false, []byte{0, 0, 0, 0})
								return
							default:
								if req.WantReply {
									_ = req.Reply(true, nil)
								}
							}
						}
					}(ch, requests)
				}
			}(c)
		}
	}()
	return ln.Addr().(*net.TCPAddr), clientKeyPath, func() { _ = ln.Close(); <-done }
}


func TestSessionToolsAPI(t *testing.T) {
	addr, keyPath, cleanup := startTestSSHServer(t)
	defer cleanup()

	dir := t.TempDir()
	cfg := config.Config{
		Listen: "127.0.0.1:0", Token: "test-token", DataDir: dir,
		TokenFile: filepath.Join(dir, "sessiond.token"),
		HostsFile: filepath.Join(dir, "hosts.json"),
		AuditFile: filepath.Join(dir, "audit.jsonl"),
		KnownHostsFile: filepath.Join(dir, "known_hosts.json"),
	}
	hosts := store.NewHostStore(cfg.HostsFile)
	audit := store.NewAuditLog(cfg.AuditFile)
	kh := sshx.NewKnownHosts(cfg.KnownHostsFile)
	props := proposal.NewStore()
	sessions := session.NewManager(hosts, audit, props, kh)
	srv := api.New(cfg, hosts, audit, props, sessions, kh)
	ts := httptest.NewServer(srv.Handler())
	defer ts.Close()

	do := func(method, path string, body any) (int, map[string]any) {
		t.Helper()
		var rdr io.Reader
		if body != nil {
			b, _ := json.Marshal(body)
			rdr = bytes.NewReader(b)
		}
		req, _ := http.NewRequest(method, ts.URL+path, rdr)
		req.Header.Set("X-HiveNest-Token", cfg.Token)
		if body != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		var m map[string]any
		_ = json.NewDecoder(res.Body).Decode(&m)
		return res.StatusCode, m
	}

	_, host := do("POST", "/v1/hosts", map[string]any{
		"name": "tools", "host": "127.0.0.1", "port": addr.Port, "user": "hive",
		"identity_file": keyPath, "use_agent": false,
	})
	hostID := host["id"].(string)
	_, sess := do("POST", "/v1/sessions", map[string]any{"host_id": hostID, "accept_host_key": true})
	sid := sess["id"].(string)

	// Bad path rejected
	code, bad := do("POST", "/v1/sessions/"+sid+"/tools", map[string]any{
		"tool": "list_files", "path": "../etc/passwd",
	})
	if code != 400 {
		t.Fatalf("expected 400 for bad path, got %d %#v", code, bad)
	}

	// list_files falls back to exec on test server (no SFTP subsystem)
	code, listed := do("POST", "/v1/sessions/"+sid+"/tools", map[string]any{
		"tool": "list_files", "path": "/tmp", "actor": "agent",
	})
	if code != 200 {
		t.Fatalf("list_files %d %#v", code, listed)
	}
	if listed["tool"] != "list_files" || listed["risk"] != "low" {
		t.Fatalf("%#v", listed)
	}

	code, df := do("POST", "/v1/sessions/"+sid+"/tools", map[string]any{
		"tool": "disk_free", "actor": "agent",
	})
	if code != 200 {
		t.Fatalf("disk_free %d %#v", code, df)
	}
}


func TestSessionWriteToolApproveGate(t *testing.T) {
	addr, keyPath, cleanup := startTestSSHServer(t)
	defer cleanup()

	dir := t.TempDir()
	cfg := config.Config{
		Listen: "127.0.0.1:0", Token: "test-token", DataDir: dir,
		TokenFile: filepath.Join(dir, "sessiond.token"),
		HostsFile: filepath.Join(dir, "hosts.json"),
		AuditFile: filepath.Join(dir, "audit.jsonl"),
		KnownHostsFile: filepath.Join(dir, "known_hosts.json"),
	}
	hosts := store.NewHostStore(cfg.HostsFile)
	audit := store.NewAuditLog(cfg.AuditFile)
	kh := sshx.NewKnownHosts(cfg.KnownHostsFile)
	props := proposal.NewStore()
	sessions := session.NewManager(hosts, audit, props, kh)
	srv := api.New(cfg, hosts, audit, props, sessions, kh)
	ts := httptest.NewServer(srv.Handler())
	defer ts.Close()

	do := func(method, path string, body any) (int, map[string]any) {
		t.Helper()
		var rdr io.Reader
		if body != nil {
			b, _ := json.Marshal(body)
			rdr = bytes.NewReader(b)
		}
		req, _ := http.NewRequest(method, ts.URL+path, rdr)
		req.Header.Set("X-HiveNest-Token", cfg.Token)
		if body != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		var m map[string]any
		_ = json.NewDecoder(res.Body).Decode(&m)
		return res.StatusCode, m
	}

	_, host := do("POST", "/v1/hosts", map[string]any{
		"name": "write", "host": "127.0.0.1", "port": addr.Port, "user": "hive",
		"identity_file": keyPath, "use_agent": false,
	})
	hostID := host["id"].(string)
	_, sess := do("POST", "/v1/sessions", map[string]any{"host_id": hostID, "accept_host_key": true})
	sid := sess["id"].(string)

	toolBody := map[string]any{
		"tool": "write_file", "path": "/tmp/hivenest-write.txt", "content": "hello", "actor": "agent",
	}
	code, denied := do("POST", "/v1/sessions/"+sid+"/tools", toolBody)
	if code != 409 || denied["code"] != "approval_required" {
		t.Fatalf("expected 409 approval_required, got %d %#v", code, denied)
	}
	if denied["risk"] != "medium" {
		t.Fatalf("risk %#v", denied)
	}
	cmd, _ := denied["command"].(string)
	if cmd == "" {
		t.Fatal("expected display command in 409 body")
	}

	code, prop := do("POST", "/v1/sessions/"+sid+"/proposals", map[string]any{
		"command": cmd, "reason": "agent write", "risk": "medium",
	})
	if code != 201 {
		t.Fatalf("proposal %d %#v", code, prop)
	}
	pid := prop["id"].(string)
	code, approved := do("POST", "/v1/proposals/"+pid+"/approve", map[string]any{})
	if code != 200 {
		t.Fatalf("approve %d %#v", code, approved)
	}
	token, _ := approved["approve_token"].(string)

	toolBody["proposal_id"] = pid
	toolBody["approve_token"] = token
	code, wrote := do("POST", "/v1/sessions/"+sid+"/tools", toolBody)
	if code != 200 {
		t.Fatalf("write after approve %d %#v", code, wrote)
	}
	if wrote["ok"] != true || wrote["risk"] != "medium" {
		t.Fatalf("%#v", wrote)
	}

	// High-risk remove without proposal
	code, rm := do("POST", "/v1/sessions/"+sid+"/tools", map[string]any{
		"tool": "remove_file", "path": "/tmp/hivenest-write.txt", "actor": "agent",
	})
	if code != 409 || rm["risk"] != "high" {
		t.Fatalf("remove gate %d %#v", code, rm)
	}

	// Richer list_processes still low / auto
	code, ps := do("POST", "/v1/sessions/"+sid+"/tools", map[string]any{
		"tool": "list_processes", "pattern": "ran", "user": "hive", "limit": 5, "actor": "agent",
	})
	if code != 200 || ps["risk"] != "low" {
		t.Fatalf("list_processes %d %#v", code, ps)
	}
}
