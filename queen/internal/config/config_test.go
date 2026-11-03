package config

import "testing"

func TestNormalizeWorkerDialURL(t *testing.T) {
	cases := map[string]string{
		"http://192.168.1.10:8080":              "ws://192.168.1.10:8080/v1/worker/ws",
		"https://queen.example.com":            "wss://queen.example.com/v1/worker/ws",
		"ws://10.0.0.2:8080/v1/worker/ws":      "ws://10.0.0.2:8080/v1/worker/ws",
		"192.168.1.10:8080":                    "ws://192.168.1.10:8080/v1/worker/ws",
	}
	for in, want := range cases {
		if got := NormalizeWorkerDialURL(in); got != want {
			t.Fatalf("%q => %q, want %q", in, got, want)
		}
	}
}

func TestIsLoopbackDialURL(t *testing.T) {
	if !IsLoopbackDialURL("ws://127.0.0.1:8080/v1/worker/ws") {
		t.Fatal("expected loopback")
	}
	if IsLoopbackDialURL("ws://192.168.1.10:8080/v1/worker/ws") {
		t.Fatal("expected non-loopback")
	}
}

func TestHTTPBaseFromDial(t *testing.T) {
	got := HTTPBaseFromDial("wss://abc.trycloudflare.com/v1/worker/ws")
	if got != "https://abc.trycloudflare.com" {
		t.Fatalf("got %q", got)
	}
}

func TestBuildHTTPBase(t *testing.T) {
	got := BuildHTTPBase("192.168.1.5", 8080, false)
	if got != "http://192.168.1.5:8080" {
		t.Fatalf("got %q", got)
	}
}

func TestListenPort(t *testing.T) {
	cfg := Config{Listen: ":9090"}
	if cfg.ListenPort() != 9090 {
		t.Fatal(cfg.ListenPort())
	}
}
