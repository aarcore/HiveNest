package store

import (
	"path/filepath"
	"testing"
)

func TestAlignProxyJumpHopsPadsAndMirrorsHop0(t *testing.T) {
	hops, id, agent, auth := alignProxyJumpHops(
		"jump@b1:22,jump@b2:22",
		[]JumpHopSpec{{IdentityFile: "~/.ssh/a", AuthMethod: AuthMethodKey}},
		"", false, "",
	)
	if len(hops) != 2 {
		t.Fatalf("len=%d want 2", len(hops))
	}
	if hops[0].IdentityFile != "~/.ssh/a" || hops[0].AuthMethod != AuthMethodKey {
		t.Fatalf("hop0=%+v", hops[0])
	}
	if hops[1].IdentityFile != "" {
		t.Fatalf("hop1 should be empty pad, got %+v", hops[1])
	}
	if id != "~/.ssh/a" || agent || auth != AuthMethodKey {
		t.Fatalf("mirror id=%q agent=%v auth=%q", id, agent, auth)
	}
}

func TestAlignProxyJumpHopsSeedsFromJumpStar(t *testing.T) {
	hops, id, agent, auth := alignProxyJumpHops(
		"bastion@1.2.3.4:22",
		nil,
		"~/.ssh/jump", true, AuthMethodKey,
	)
	if len(hops) != 1 {
		t.Fatalf("len=%d", len(hops))
	}
	if hops[0].IdentityFile != "~/.ssh/jump" || !hops[0].UseAgent {
		t.Fatalf("seeded=%+v", hops[0])
	}
	if id != "~/.ssh/jump" || !agent || auth != AuthMethodKey {
		t.Fatalf("mirror mismatch")
	}
}

func TestCreateProxyJumpPersistsAlignedHops(t *testing.T) {
	dir := t.TempDir()
	s := NewHostStore(filepath.Join(dir, "hosts.json"))
	h, err := s.Create(HostInput{
		Name:             "t",
		Host:             "10.0.0.1",
		Port:             22,
		User:             "u",
		ProxyJump:        "j@b:22,j@c:22",
		JumpIdentityFile: "~/.ssh/j0",
		JumpAuthMethod:   AuthMethodKey,
		JumpHops: []JumpHopSpec{
			{IdentityFile: "~/.ssh/j0", AuthMethod: AuthMethodKey},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(h.JumpHops) != 2 {
		t.Fatalf("JumpHops len=%d want 2: %+v", len(h.JumpHops), h.JumpHops)
	}
	if h.JumpIdentityFile != "~/.ssh/j0" {
		t.Fatalf("JumpIdentityFile=%q", h.JumpIdentityFile)
	}
	if h.JumpHostID != "" || len(h.JumpHostIDs) != 0 {
		t.Fatalf("profile jump should be empty when using proxy_jump")
	}
}
