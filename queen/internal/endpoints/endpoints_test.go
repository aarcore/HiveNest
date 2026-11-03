package endpoints

import (
	"testing"

	"github.com/hivenest/hivenest/queen/internal/config"
)

func TestResolverPrefersExplicitDial(t *testing.T) {
	cfg := config.Config{
		Listen:        ":8080",
		PublicURL:     "http://127.0.0.1:8080",
		WorkerDialURL: "ws://203.0.113.9:8080/v1/worker/ws",
	}
	r := New(cfg, nil)
	snap := r.Snapshot()
	if snap.DialSource != "HIVENEST_WORKER_DIAL_URL" {
		t.Fatalf("source=%s", snap.DialSource)
	}
	if snap.WorkerDialURL != "ws://203.0.113.9:8080/v1/worker/ws" {
		t.Fatalf("dial=%s", snap.WorkerDialURL)
	}
	if snap.WorkerDialLoopback {
		t.Fatal("should not be loopback")
	}
}

func TestResolverAdvertiseHost(t *testing.T) {
	cfg := config.Config{
		Listen:        ":8080",
		PublicURL:     "http://127.0.0.1:8080",
		AdvertiseHost: "192.168.88.10",
	}
	r := New(cfg, nil)
	snap := r.Snapshot()
	if snap.DialSource != "HIVENEST_ADVERTISE_HOST" {
		t.Fatalf("source=%s", snap.DialSource)
	}
	if snap.PublicURL != "http://192.168.88.10:8080" {
		t.Fatalf("public=%s", snap.PublicURL)
	}
	if snap.CallbackURL != "ws://192.168.88.10:8080/v1/worker/ws" {
		t.Fatalf("callback=%s", snap.CallbackURL)
	}
}
