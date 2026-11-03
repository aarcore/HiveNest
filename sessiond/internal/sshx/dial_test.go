package sshx_test

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/hivenest/hivenest/sessiond/internal/sshx"
	"golang.org/x/crypto/ssh"
)

func TestDialExecAndPTY(t *testing.T) {
	addr, keyPath, cleanup := startTestSSHServer(t)
	defer cleanup()

	res, err := sshx.Dial(sshx.DialOpts{
		Host:         "127.0.0.1",
		Port:         addr.Port,
		User:         "hive",
		IdentityFile: keyPath,
		UseAgent:     false,
		Timeout:      5 * time.Second,
	})
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer res.Close()
	client := res.Client

	sess, err := client.NewSession()
	if err != nil {
		t.Fatal(err)
	}
	out, err := sess.CombinedOutput("echo hivenest-ok")
	_ = sess.Close()
	if err != nil {
		t.Fatalf("exec: %v (%q)", err, out)
	}
	if string(out) != "hivenest-ok\n" {
		t.Fatalf("unexpected output %q", out)
	}

	sess2, err := client.NewSession()
	if err != nil {
		t.Fatal(err)
	}
	defer sess2.Close()
	if err := sess2.RequestPty("xterm", 24, 80, ssh.TerminalModes{}); err != nil {
		t.Fatalf("pty: %v", err)
	}
	if err := sess2.Shell(); err != nil {
		t.Fatalf("shell: %v", err)
	}
}

func TestDialPassword(t *testing.T) {
	addr, cleanup := startPasswordSSHServer(t, "hive", "s3cret")
	defer cleanup()

	res, err := sshx.Dial(sshx.DialOpts{
		Host:     "127.0.0.1",
		Port:     addr.Port,
		User:     "hive",
		Password: "s3cret",
		UseAgent: false,
		Timeout:  5 * time.Second,
	})
	if err != nil {
		t.Fatalf("dial with password: %v", err)
	}
	defer res.Close()
	client := res.Client
	sess, err := client.NewSession()
	if err != nil {
		t.Fatal(err)
	}
	out, err := sess.CombinedOutput("echo hivenest-ok")
	_ = sess.Close()
	if err != nil {
		t.Fatalf("exec: %v (%q)", err, out)
	}
	if string(out) != "hivenest-ok\n" {
		t.Fatalf("unexpected output %q", out)
	}

	_, err = sshx.Dial(sshx.DialOpts{
		Host: "127.0.0.1", Port: addr.Port, User: "hive", Password: "wrong", UseAgent: false, Timeout: 5 * time.Second,
	})
	if err == nil {
		t.Fatal("expected dial failure with wrong password")
	}
}

func startPasswordSSHServer(t *testing.T, user, password string) (addr *net.TCPAddr, cleanup func()) {
	t.Helper()
	_, hostPriv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	hostSigner, err := ssh.NewSignerFromKey(hostPriv)
	if err != nil {
		t.Fatal(err)
	}
	cfg := &ssh.ServerConfig{
		PasswordCallback: func(conn ssh.ConnMetadata, pass []byte) (*ssh.Permissions, error) {
			if conn.User() == user && string(pass) == password {
				return &ssh.Permissions{}, nil
			}
			return nil, fmt.Errorf("bad password")
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
			go handleSSHConn(c, cfg)
		}
	}()
	cleanup = func() { _ = ln.Close(); <-done }
	return ln.Addr().(*net.TCPAddr), cleanup
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
			go handleSSHConn(c, cfg)
		}
	}()
	cleanup = func() { _ = ln.Close(); <-done }
	return ln.Addr().(*net.TCPAddr), clientKeyPath, cleanup
}

func handleSSHConn(nConn net.Conn, cfg *ssh.ServerConfig) {
	_, chans, reqs, err := ssh.NewServerConn(nConn, cfg)
	if err != nil {
		_ = nConn.Close()
		return
	}
	go ssh.DiscardRequests(reqs)
	for newChannel := range chans {
		switch newChannel.ChannelType() {
		case "direct-tcpip":
			// ProxyJump / -L style: payload is dest host/port + originator host/port.
			payload := newChannel.ExtraData()
			dest, _, err := parseDirectTCPIP(payload)
			if err != nil {
				_ = newChannel.Reject(ssh.ConnectionFailed, err.Error())
				continue
			}
			rconn, err := net.DialTimeout("tcp", dest, 3*time.Second)
			if err != nil {
				_ = newChannel.Reject(ssh.ConnectionFailed, err.Error())
				continue
			}
			ch, reqs, err := newChannel.Accept()
			if err != nil {
				_ = rconn.Close()
				continue
			}
			go ssh.DiscardRequests(reqs)
			go func() {
				defer ch.Close()
				defer rconn.Close()
				go func() { _, _ = io.Copy(rconn, ch); _ = rconn.Close() }()
				_, _ = io.Copy(ch, rconn)
			}()
		case "session":
			ch, requests, err := newChannel.Accept()
			if err != nil {
				continue
			}
			go func(ch ssh.Channel, requests <-chan *ssh.Request) {
				defer ch.Close()
				for req := range requests {
					switch req.Type {
					case "pty-req":
						_ = req.Reply(true, nil)
					case "shell":
						_ = req.Reply(true, nil)
						_, _ = io.WriteString(ch, "welcome\n")
						buf := make([]byte, 256)
						_, _ = ch.Read(buf)
						return
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
							_, _ = io.WriteString(ch, "unknown\n")
						}
						_, _ = ch.SendRequest("exit-status", false, []byte{0, 0, 0, 0})
						return
					default:
						if req.WantReply {
							_ = req.Reply(false, nil)
						}
					}
				}
			}(ch, requests)
		default:
			_ = newChannel.Reject(ssh.UnknownChannelType, "unknown")
		}
	}
}

func parseDirectTCPIP(payload []byte) (dest string, origin string, err error) {
	// string destAddr, uint32 destPort, string origAddr, uint32 origPort
	r := payload
	readStr := func() (string, error) {
		if len(r) < 4 {
			return "", fmt.Errorf("short payload")
		}
		n := int(r[0])<<24 | int(r[1])<<16 | int(r[2])<<8 | int(r[3])
		r = r[4:]
		if n < 0 || n > len(r) {
			return "", fmt.Errorf("bad string len")
		}
		s := string(r[:n])
		r = r[n:]
		return s, nil
	}
	readU32 := func() (uint32, error) {
		if len(r) < 4 {
			return 0, fmt.Errorf("short u32")
		}
		v := uint32(r[0])<<24 | uint32(r[1])<<16 | uint32(r[2])<<8 | uint32(r[3])
		r = r[4:]
		return v, nil
	}
	da, err := readStr()
	if err != nil {
		return "", "", err
	}
	dp, err := readU32()
	if err != nil {
		return "", "", err
	}
	oa, err := readStr()
	if err != nil {
		return "", "", err
	}
	op, err := readU32()
	if err != nil {
		return "", "", err
	}
	return net.JoinHostPort(da, fmt.Sprintf("%d", dp)), net.JoinHostPort(oa, fmt.Sprintf("%d", op)), nil
}
func TestParseJump(t *testing.T) {
	u, h, p, err := sshx.ParseJump("alice@bastion.example:2222")
	if err != nil || u != "alice" || h != "bastion.example" || p != 2222 {
		t.Fatalf("got %q %q %d %v", u, h, p, err)
	}
	u, h, p, err = sshx.ParseJump("10.0.0.1")
	if err != nil || u != "" || h != "10.0.0.1" || p != 22 {
		t.Fatalf("bare got %q %q %d %v", u, h, p, err)
	}
}

func TestProxyJumpDoesNotReuseTargetPassword(t *testing.T) {
	// Bastion accepts only password "jump-secret"; target accepts "target-secret".
	jumpAddr, jumpCleanup := startPasswordSSHServer(t, "jump", "jump-secret")
	defer jumpCleanup()
	targetAddr, targetCleanup := startPasswordSSHServer(t, "tgt", "target-secret")
	defer targetCleanup()

	// Wrong: if Dial reused target password for jump, this would incorrectly succeed on jump
	// when JumpPassword empty and Password=target-secret — we assert it fails / requires jump pw.
	_, err := sshx.Dial(sshx.DialOpts{
		Host:         "127.0.0.1",
		Port:         targetAddr.Port,
		User:         "tgt",
		Password:     "target-secret",
		ProxyJump:    fmt.Sprintf("jump@127.0.0.1:%d", jumpAddr.Port),
		JumpPassword: "", // must NOT fall back to target password
		UseAgent:     false,
		Timeout:      5 * time.Second,
	})
	if err == nil {
		t.Fatal("expected failure when JumpPassword empty (must not reuse target Password)")
	}
	var jreq *sshx.JumpPasswordRequiredError
	if !errors.As(err, &jreq) {
		// May wrap as plain auth error depending on available methods; still must not succeed.
		t.Logf("dial err (ok if auth failed): %v", err)
	}

	res, err := sshx.Dial(sshx.DialOpts{
		Host:         "127.0.0.1",
		Port:         targetAddr.Port,
		User:         "tgt",
		Password:     "target-secret",
		ProxyJump:    fmt.Sprintf("jump@127.0.0.1:%d", jumpAddr.Port),
		JumpPassword: "jump-secret",
		UseAgent:     false,
		Timeout:      5 * time.Second,
	})
	if err != nil {
		t.Fatalf("dial with separate jump password: %v", err)
	}
	defer res.Close()
}

func TestProxyJumpUsesSeparateIdentity(t *testing.T) {
	// Bastion accepts only keyA; target accepts only keyB. ProxyJump with JumpIdentityFile=keyA
	// and IdentityFile=keyB must succeed. Using target key for bastion must fail.
	bastionAddr, bastionKey, cleanupB := startTestSSHServer(t)
	defer cleanupB()
	targetAddr, targetKey, cleanupT := startTestSSHServer(t)
	defer cleanupT()

	pj := fmt.Sprintf("hive@127.0.0.1:%d", bastionAddr.Port)

	// Wrong: no JumpIdentityFile, agent soft-default only — bastion needs its key.
	_, err := sshx.Dial(sshx.DialOpts{
		Host: "127.0.0.1", Port: targetAddr.Port, User: "hive",
		IdentityFile: targetKey, UseAgent: false, Timeout: 5 * time.Second,
		ProxyJump: pj,
	})
	if err == nil {
		t.Fatal("expected ProxyJump without jump identity to fail against key-only bastion")
	}

	res, err := sshx.Dial(sshx.DialOpts{
		Host: "127.0.0.1", Port: targetAddr.Port, User: "hive",
		IdentityFile: targetKey, UseAgent: false, Timeout: 5 * time.Second,
		ProxyJump:        pj,
		JumpIdentityFile: bastionKey,
		JumpUseAgent:     false,
	})
	if err != nil {
		t.Fatalf("ProxyJump with separate jump identity: %v", err)
	}
	defer res.Close()
	sess, err := res.Client.NewSession()
	if err != nil {
		t.Fatal(err)
	}
	out, err := sess.CombinedOutput("echo hivenest-ok")
	_ = sess.Close()
	if err != nil {
		t.Fatalf("exec via jump: %v (%q)", err, out)
	}
	if string(out) != "hivenest-ok\n" {
		t.Fatalf("output %q", out)
	}
}

func TestParseJumpChain(t *testing.T) {
	got, err := sshx.ParseJumpChain(" a@b:1 , c@d:2 , e ")
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 3 || got[0] != "a@b:1" || got[1] != "c@d:2" || got[2] != "e" {
		t.Fatalf("got %#v", got)
	}
	if _, err := sshx.ParseJumpChain(" , , "); err == nil {
		t.Fatal("expected empty chain error")
	}
}

func TestMultiHopProxyJumpSeparateAuth(t *testing.T) {
	// hop0 password-only, hop1 key-only, target key-only — each hop must use its own auth.
	hop0Addr, hop0Cleanup := startPasswordSSHServer(t, "h0", "hop0-secret")
	defer hop0Cleanup()
	hop1Addr, hop1Key, hop1Cleanup := startTestSSHServer(t)
	defer hop1Cleanup()
	targetAddr, targetKey, targetCleanup := startTestSSHServer(t)
	defer targetCleanup()

	pj := fmt.Sprintf("h0@127.0.0.1:%d,hive@127.0.0.1:%d", hop0Addr.Port, hop1Addr.Port)

	// Must not reuse target key/password for hops.
	_, err := sshx.Dial(sshx.DialOpts{
		Host: "127.0.0.1", Port: targetAddr.Port, User: "hive",
		IdentityFile: targetKey, UseAgent: false, Timeout: 5 * time.Second,
		ProxyJump: pj,
		JumpHopAuths: []sshx.HopAuth{
			{Password: "wrong"}, // wrong hop0 password
			{IdentityFile: hop1Key, UseAgent: false},
		},
	})
	if err == nil {
		t.Fatal("expected multi-hop failure with wrong hop0 password")
	}

	// Target password must not authenticate hop0.
	_, err = sshx.Dial(sshx.DialOpts{
		Host: "127.0.0.1", Port: targetAddr.Port, User: "hive",
		IdentityFile: targetKey, Password: "hop0-secret", UseAgent: false, Timeout: 5 * time.Second,
		ProxyJump:        pj,
		JumpIdentityFile: "", // no hop auth — soft agent; must fail, not use target password
		JumpPassword:     "",
	})
	if err == nil {
		t.Fatal("expected failure when hop auth missing (must not reuse target Password)")
	}

	res, err := sshx.Dial(sshx.DialOpts{
		Host: "127.0.0.1", Port: targetAddr.Port, User: "hive",
		IdentityFile: targetKey, UseAgent: false, Timeout: 8 * time.Second,
		ProxyJump: pj,
		JumpHopAuths: []sshx.HopAuth{
			{Password: "hop0-secret"},
			{IdentityFile: hop1Key, UseAgent: false},
		},
	})
	if err != nil {
		t.Fatalf("multi-hop dial: %v", err)
	}
	defer res.Close()
	if len(res.Jumps) != 2 {
		t.Fatalf("expected 2 jump clients, got %d", len(res.Jumps))
	}
	sess, err := res.Client.NewSession()
	if err != nil {
		t.Fatal(err)
	}
	out, err := sess.CombinedOutput("echo hivenest-ok")
	_ = sess.Close()
	if err != nil || string(out) != "hivenest-ok\n" {
		t.Fatalf("exec via multi-hop: %v (%q)", err, out)
	}
}
