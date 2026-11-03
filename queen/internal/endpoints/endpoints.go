// Package endpoints resolves Queen public HTTP and worker dial (callback) URLs.
package endpoints

import (
	"fmt"
	"strconv"
	"strings"
	"sync"

	"github.com/hivenest/hivenest/queen/internal/config"
	"github.com/hivenest/hivenest/queen/internal/tunnel"
)

// Snapshot is JSON-friendly URL state for /v1/meta and UI.
type Snapshot struct {
	ConfiguredPublicURL string   `json:"configured_public_url"`
	ConfiguredDialURL   string   `json:"configured_dial_url,omitempty"`
	AdvertiseHost       string   `json:"advertise_host,omitempty"`
	PublicURL           string   `json:"public_url"`
	CallbackURL         string   `json:"callback_url"`
	WorkerDialURL       string   `json:"worker_dial_url"`
	WorkerDialLoopback  bool     `json:"worker_dial_loopback"`
	DialSource          string   `json:"dial_source"`
	LANCandidates       []string `json:"lan_candidates"`
	SuggestedPublicURL  string   `json:"suggested_public_url,omitempty"`
	SuggestedDialURL    string   `json:"suggested_dial_url,omitempty"`
	Tunnel              any      `json:"tunnel,omitempty"`
}

// Resolver computes effective public + dial URLs with optional tunnel.
type Resolver struct {
	mu               sync.RWMutex
	configuredPublic string
	configuredDial   string // explicit WORKER_DIAL only (may be empty)
	advertiseHost    string
	listenPort       int
	tls              bool
	tunnel           *tunnel.Manager
}

func New(cfg config.Config, tun *tunnel.Manager) *Resolver {
	return &Resolver{
		configuredPublic: strings.TrimRight(strings.TrimSpace(cfg.PublicURL), "/"),
		configuredDial:   strings.TrimSpace(cfg.WorkerDialURL),
		advertiseHost:    strings.TrimSpace(cfg.AdvertiseHost),
		listenPort:       cfg.ListenPort(),
		tls:              cfg.TLSCertFile != "" && cfg.TLSKeyFile != "",
		tunnel:           tun,
	}
}

func (r *Resolver) SetTunnel(t *tunnel.Manager) {
	r.mu.Lock()
	r.tunnel = t
	r.mu.Unlock()
}

// PublicURL is the HTTP base workers/browsers should use for /install and /releases.
func (r *Resolver) PublicURL() string {
	return r.Snapshot().PublicURL
}

// WorkerDialURL is the ws(s) callback workers should dial.
func (r *Resolver) WorkerDialURL() string {
	return r.Snapshot().WorkerDialURL
}

func (r *Resolver) Snapshot() Snapshot {
	r.mu.RLock()
	cfgPublic := r.configuredPublic
	cfgDial := r.configuredDial
	adv := r.advertiseHost
	port := r.listenPort
	tls := r.tls
	tun := r.tunnel
	r.mu.RUnlock()

	lan := config.DetectLANIPv4()
	var lanDial []string
	var usableLAN []string
	for _, ip := range lan {
		base := config.BuildHTTPBase(ip, port, tls)
		lanDial = append(lanDial, config.NormalizeWorkerDialURL(base))
		if !config.IsLikelyContainerNet(ip) {
			usableLAN = append(usableLAN, ip)
		}
	}

	suggestedPublic := ""
	if adv != "" {
		suggestedPublic = config.BuildHTTPBase(adv, port, tls)
	} else if len(usableLAN) > 0 {
		// Prefer real LAN (e.g. 192.168/x); skip Docker/k8s-only bridges for auto dial.
		suggestedPublic = config.BuildHTTPBase(usableLAN[0], port, tls)
	}
	suggestedDial := config.NormalizeWorkerDialURL(suggestedPublic)

	var tunStatus tunnel.Status
	if tun != nil {
		tunStatus = tun.Status()
	}

	snap := Snapshot{
		ConfiguredPublicURL: cfgPublic,
		ConfiguredDialURL:   config.NormalizeWorkerDialURL(cfgDial),
		AdvertiseHost:       adv,
		LANCandidates:       lanDial,
		SuggestedPublicURL:  suggestedPublic,
		SuggestedDialURL:    suggestedDial,
		Tunnel:              tunStatus,
	}

	// Priority for effective public + dial:
	// 1) active demo tunnel
	// 2) explicit WORKER_DIAL_URL
	// 3) non-loopback PUBLIC_URL
	// 4) advertise host / LAN suggestion
	// 5) configured PUBLIC_URL (may be loopback)
	switch {
	case tunStatus.Running && tunStatus.PublicURL != "":
		snap.PublicURL = strings.TrimRight(tunStatus.PublicURL, "/")
		snap.WorkerDialURL = config.NormalizeWorkerDialURL(snap.PublicURL)
		snap.DialSource = "demo_tunnel"
	case cfgDial != "":
		snap.WorkerDialURL = config.NormalizeWorkerDialURL(cfgDial)
		if base := config.HTTPBaseFromDial(snap.WorkerDialURL); base != "" {
			snap.PublicURL = base
		} else {
			snap.PublicURL = cfgPublic
		}
		snap.DialSource = "HIVENEST_WORKER_DIAL_URL"
	case cfgPublic != "" && !config.IsLoopbackDialURL(cfgPublic):
		snap.PublicURL = cfgPublic
		snap.WorkerDialURL = config.NormalizeWorkerDialURL(cfgPublic)
		snap.DialSource = "HIVENEST_PUBLIC_URL"
	case suggestedPublic != "":
		snap.PublicURL = suggestedPublic
		snap.WorkerDialURL = suggestedDial
		if adv != "" {
			snap.DialSource = "HIVENEST_ADVERTISE_HOST"
		} else {
			snap.DialSource = "auto_lan"
		}
	default:
		snap.PublicURL = cfgPublic
		snap.WorkerDialURL = config.NormalizeWorkerDialURL(cfgPublic)
		snap.DialSource = "configured_loopback"
	}

	snap.CallbackURL = snap.WorkerDialURL
	snap.WorkerDialLoopback = config.IsLoopbackDialURL(snap.WorkerDialURL)
	return snap
}

// Describe returns a one-line log hint.
func (r *Resolver) Describe() string {
	s := r.Snapshot()
	return fmt.Sprintf("public=%s dial=%s source=%s loopback=%v", s.PublicURL, s.WorkerDialURL, s.DialSource, s.WorkerDialLoopback)
}

// LocalTunnelTarget is what cloudflared should forward to inside this process/network.
func LocalTunnelTarget(listen string, port int) string {
	host := "127.0.0.1"
	if port <= 0 {
		port = 8080
	}
	_ = listen
	return "http://" + host + ":" + strconv.Itoa(port)
}
