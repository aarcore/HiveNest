package sshx_test

import (
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/hivenest/hivenest/sessiond/internal/sshx"
)

// A bastion host-key prompt must name the hop, not the target: showing the
// target's identity for a bastion fingerprint asks the user to judge the wrong
// machine.
func TestBastionHostKeyIssueCarriesHopOrigin(t *testing.T) {
	bastionAddr, _, cleanupB := startTestSSHServer(t)
	defer cleanupB()
	targetAddr, targetKey, cleanupT := startTestSSHServer(t)
	defer cleanupT()

	kh := sshx.NewKnownHosts(t.TempDir() + "/known_hosts.json")

	// Unknown bastion key with no accept flag: the dial must fail with an issue
	// labelled as the bastion's.
	_, err := sshx.Dial(sshx.DialOpts{
		Host:             "127.0.0.1",
		Port:             targetAddr.Port,
		User:             "hive",
		IdentityFile:     targetKey,
		UseAgent:         false,
		Timeout:          5 * time.Second,
		KnownHosts:       kh,
		ProxyJump:        fmt.Sprintf("hive@127.0.0.1:%d", bastionAddr.Port),
		JumpIdentityFile: targetKey, // bastion is key-only in this fixture
	})
	if err == nil {
		t.Fatal("expected host key issue for unknown bastion")
	}
	var issue *sshx.HostKeyIssue
	if !errors.As(err, &issue) {
		t.Fatalf("expected HostKeyIssue, got %v", err)
	}
	if issue.Origin != "bastion" {
		t.Errorf("origin = %q, want bastion", issue.Origin)
	}
	if issue.HopIndex != 0 {
		t.Errorf("hop index = %d, want 0", issue.HopIndex)
	}
	if issue.HopLabel == "" {
		t.Error("expected a hop label naming user@host:port")
	}
	if issue.Host != "127.0.0.1" || issue.Port != bastionAddr.Port {
		t.Errorf("issue points at %s:%d, want the bastion %s:%d",
			issue.Host, issue.Port, "127.0.0.1", bastionAddr.Port)
	}
}

// The target's own first-contact prompt must not claim to be a bastion.
func TestTargetHostKeyIssueIsNotLabelledBastion(t *testing.T) {
	targetAddr, targetKey, cleanup := startTestSSHServer(t)
	defer cleanup()

	kh := sshx.NewKnownHosts(t.TempDir() + "/known_hosts.json")
	_, err := sshx.Dial(sshx.DialOpts{
		Host:         "127.0.0.1",
		Port:         targetAddr.Port,
		User:         "hive",
		IdentityFile: targetKey,
		UseAgent:     false,
		Timeout:      5 * time.Second,
		KnownHosts:   kh,
	})
	var issue *sshx.HostKeyIssue
	if !errors.As(err, &issue) {
		t.Fatalf("expected HostKeyIssue, got %v", err)
	}
	if issue.Origin == "bastion" {
		t.Error("target key wrongly labelled as a bastion")
	}
}
