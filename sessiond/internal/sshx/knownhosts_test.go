package sshx_test

import (
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/hivenest/hivenest/sessiond/internal/sshx"
)

func TestKnownHostsTOFU(t *testing.T) {
	addr, keyPath, cleanup := startTestSSHServer(t)
	defer cleanup()

	kh := sshx.NewKnownHosts(filepath.Join(t.TempDir(), "known_hosts.json"))

	_, err := sshx.Dial(sshx.DialOpts{
		Host: "127.0.0.1", Port: addr.Port, User: "hive", IdentityFile: keyPath,
		UseAgent: false, Timeout: 5 * time.Second, KnownHosts: kh,
	})
	var issue *sshx.HostKeyIssue
	if !errors.As(err, &issue) || issue.Code != "host_key_unknown" {
		t.Fatalf("want host_key_unknown, got %v", err)
	}

	res, err := sshx.Dial(sshx.DialOpts{
		Host: "127.0.0.1", Port: addr.Port, User: "hive", IdentityFile: keyPath,
		UseAgent: false, Timeout: 5 * time.Second, KnownHosts: kh, AcceptHostKey: true,
	})
	if err != nil {
		t.Fatalf("accept dial: %v", err)
	}
	_ = res.Close()

	res2, err := sshx.Dial(sshx.DialOpts{
		Host: "127.0.0.1", Port: addr.Port, User: "hive", IdentityFile: keyPath,
		UseAgent: false, Timeout: 5 * time.Second, KnownHosts: kh,
	})
	if err != nil {
		t.Fatalf("second dial should trust stored key: %v", err)
	}
	_ = res2.Close()
}
