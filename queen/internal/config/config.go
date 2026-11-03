package config

import (
	"encoding/json"
	"net"
	"net/url"
	"os"
	"strconv"
	"strings"
)

// Config holds Queen runtime settings.
// BootstrapToken (HIVENEST_BOOTSTRAP_TOKEN) must match Worker enrollment token.
// PublicURL (HIVENEST_PUBLIC_URL) is the configured Queen HTTP base URL
// used for bootstrap download links (/install, /releases) when no tunnel is active.
// WorkerDialURL (HIVENEST_WORKER_DIAL_URL) is the WebSocket URL remote workers
// must dial (written into worker.env as HIVENEST_QUEEN_URL). If empty, derived
// from PublicURL — which is wrong for remote hosts when PublicURL is localhost.
// AdvertiseHost (HIVENEST_ADVERTISE_HOST) optionally forces the LAN/public host
// used when auto-building a callback URL (e.g. host LAN IP behind Docker).
// DemoTunnel (HIVENEST_DEMO_TUNNEL) when true starts a local demo tunnel at boot
// (default false — never silently open tunnels).
type Config struct {
	Listen         string `json:"listen"`
	DatabaseURL    string `json:"database_url"`
	BootstrapToken string `json:"bootstrap_token"`
	PublicURL      string `json:"public_url"`
	WorkerDialURL  string `json:"worker_dial_url"`
	AdvertiseHost  string `json:"advertise_host"`
	DemoTunnel     bool   `json:"demo_tunnel"`
	TunnelBin      string `json:"tunnel_bin"`
	InstallDir     string `json:"install_dir"`
	ArtifactDir    string `json:"artifact_dir"`
	TLSCertFile    string `json:"tls_cert_file"`
	TLSKeyFile     string `json:"tls_key_file"`
	ClientCAFile   string `json:"client_ca_file"`
}

func Default() Config {
	return Config{
		Listen:         ":8080",
		DatabaseURL:    "sqlite:///data/hivenest.db",
		BootstrapToken: "hivenest-dev-token",
		PublicURL:      "http://127.0.0.1:8080",
		TunnelBin:      "cloudflared",
		InstallDir:     "./install",
		ArtifactDir:    "./dist",
	}
}

func LoadFile(path string, cfg *Config) error {
	b, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(b, cfg)
}

// ApplyEnv overlays well-known environment variables.
func ApplyEnv(cfg *Config) {
	if v := os.Getenv("HIVENEST_LISTEN"); v != "" {
		cfg.Listen = v
	}
	if v := os.Getenv("HIVENEST_DATABASE_URL"); v != "" {
		cfg.DatabaseURL = v
	}
	if v := os.Getenv("HIVENEST_BOOTSTRAP_TOKEN"); v != "" {
		cfg.BootstrapToken = v
	}
	if v := os.Getenv("HIVENEST_PUBLIC_URL"); v != "" {
		cfg.PublicURL = v
	}
	if v := os.Getenv("HIVENEST_WORKER_DIAL_URL"); v != "" {
		cfg.WorkerDialURL = v
	}
	if v := os.Getenv("HIVENEST_ADVERTISE_HOST"); v != "" {
		cfg.AdvertiseHost = v
	}
	if v := os.Getenv("HIVENEST_TUNNEL_BIN"); v != "" {
		cfg.TunnelBin = v
	}
	if v := os.Getenv("HIVENEST_DEMO_TUNNEL"); v != "" {
		cfg.DemoTunnel = parseBool(v)
	}
	if v := os.Getenv("HIVENEST_INSTALL_DIR"); v != "" {
		cfg.InstallDir = v
	}
	if v := os.Getenv("HIVENEST_ARTIFACT_DIR"); v != "" {
		cfg.ArtifactDir = v
	}
	if v := os.Getenv("HIVENEST_TLS_CERT"); v != "" {
		cfg.TLSCertFile = v
	}
	if v := os.Getenv("HIVENEST_TLS_KEY"); v != "" {
		cfg.TLSKeyFile = v
	}
	if v := os.Getenv("HIVENEST_CLIENT_CA"); v != "" {
		cfg.ClientCAFile = v
	}
}

func parseBool(v string) bool {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}

// ListenPort extracts the TCP port from Listen (e.g. ":8080" → 8080).
func (c Config) ListenPort() int {
	addr := strings.TrimSpace(c.Listen)
	if addr == "" {
		return 8080
	}
	if strings.HasPrefix(addr, ":") {
		if p, err := strconv.Atoi(addr[1:]); err == nil && p > 0 {
			return p
		}
		return 8080
	}
	_, port, err := net.SplitHostPort(addr)
	if err != nil {
		return 8080
	}
	p, err := strconv.Atoi(port)
	if err != nil || p <= 0 {
		return 8080
	}
	return p
}

// EffectiveWorkerDialURL returns the canonical ws(s)://…/v1/worker/ws from
// explicit WorkerDialURL or PublicURL (no LAN/tunnel auto-pick — see endpoints).
func (c Config) EffectiveWorkerDialURL() string {
	raw := strings.TrimSpace(c.WorkerDialURL)
	if raw == "" {
		raw = strings.TrimSpace(c.PublicURL)
	}
	return NormalizeWorkerDialURL(raw)
}

// NormalizeWorkerDialURL accepts http(s)/ws(s) base or full WS path and returns
// a ws(s) URL ending with /v1/worker/ws.
func NormalizeWorkerDialURL(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	raw = strings.TrimRight(raw, "/")
	switch {
	case strings.HasPrefix(raw, "https://"):
		raw = "wss://" + strings.TrimPrefix(raw, "https://")
	case strings.HasPrefix(raw, "http://"):
		raw = "ws://" + strings.TrimPrefix(raw, "http://")
	case strings.HasPrefix(raw, "wss://"), strings.HasPrefix(raw, "ws://"):
		// keep
	default:
		raw = "ws://" + raw
	}
	raw = strings.TrimRight(raw, "/")
	if strings.HasSuffix(raw, "/v1/worker/ws") {
		return raw
	}
	if strings.HasSuffix(raw, "/agent/ws") {
		return raw
	}
	return raw + "/v1/worker/ws"
}

// HTTPBaseFromDial converts a ws(s) dial URL to an http(s) base (no path).
func HTTPBaseFromDial(dial string) string {
	dial = strings.TrimSpace(dial)
	if dial == "" {
		return ""
	}
	u, err := url.Parse(dial)
	if err != nil || u.Host == "" {
		return ""
	}
	switch u.Scheme {
	case "wss":
		u.Scheme = "https"
	case "ws":
		u.Scheme = "http"
	case "https", "http":
		// keep
	default:
		u.Scheme = "http"
	}
	u.Path = ""
	u.RawQuery = ""
	u.Fragment = ""
	return strings.TrimRight(u.String(), "/")
}

// IsLoopbackDialURL reports whether the host in a URL is localhost / 127.0.0.1 / ::1.
func IsLoopbackDialURL(raw string) bool {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return false
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		host := raw
		if i := strings.Index(raw, "://"); i >= 0 {
			host = raw[i+3:]
		}
		if j := strings.Index(host, "/"); j >= 0 {
			host = host[:j]
		}
		h, _, err := net.SplitHostPort(host)
		if err != nil {
			h = host
		}
		return isLoopbackHost(h)
	}
	h := u.Hostname()
	return isLoopbackHost(h)
}

func isLoopbackHost(h string) bool {
	h = strings.Trim(strings.ToLower(h), "[]")
	switch h {
	case "localhost", "127.0.0.1", "::1", "0.0.0.0":
		return true
	}
	if ip := net.ParseIP(h); ip != nil {
		return ip.IsLoopback()
	}
	return false
}

// DetectLANIPv4 returns non-loopback, non-link-local IPv4 addresses on up interfaces.
func DetectLANIPv4() []string {
	ifaces, err := net.Interfaces()
	if err != nil {
		return nil
	}
	seen := map[string]bool{}
	var out []string
	for _, iface := range ifaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		name := strings.ToLower(iface.Name)
		// Skip common virtual / docker / vpn interfaces for "suggested" first pick
		// (still listed later if nothing else — we collect all then sort preference).
		_ = name
		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, a := range addrs {
			var ip net.IP
			switch v := a.(type) {
			case *net.IPNet:
				ip = v.IP
			case *net.IPAddr:
				ip = v.IP
			}
			if ip == nil {
				continue
			}
			ip = ip.To4()
			if ip == nil || ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsUnspecified() {
				continue
			}
			s := ip.String()
			if seen[s] {
				continue
			}
			seen[s] = true
			out = append(out, s)
		}
	}
	return preferLANOrder(out)
}

func preferLANOrder(ips []string) []string {
	if len(ips) <= 1 {
		return ips
	}
	var preferred, rest []string
	for _, ip := range ips {
		if isLikelyPrivateLAN(ip) && !IsLikelyContainerNet(ip) {
			preferred = append(preferred, ip)
		} else {
			rest = append(rest, ip)
		}
	}
	return append(preferred, rest...)
}

func isLikelyPrivateLAN(ip string) bool {
	p := net.ParseIP(ip)
	if p == nil {
		return false
	}
	return p.IsPrivate()
}

func IsLikelyContainerNet(ip string) bool {
	// Docker default bridges often 172.16.0.0/12; keep them but deprioritize.
	p := net.ParseIP(ip)
	if p == nil {
		return false
	}
	v4 := p.To4()
	if v4 == nil {
		return false
	}
	// 172.16–172.31
	if v4[0] == 172 && v4[1] >= 16 && v4[1] <= 31 {
		return true
	}
	// 10.0.0.0/8 also common in k8s — keep after RFC1918 "home" 192.168
	if v4[0] == 10 {
		return true
	}
	return false
}

// BuildHTTPBase builds http://host:port (or https if tls).
func BuildHTTPBase(host string, port int, tls bool) string {
	host = strings.TrimSpace(host)
	if host == "" {
		return ""
	}
	// host may already include :port
	if strings.Contains(host, "://") {
		return strings.TrimRight(host, "/")
	}
	scheme := "http"
	if tls {
		scheme = "https"
	}
	h := host
	if _, _, err := net.SplitHostPort(host); err != nil {
		// no port in host
		if port > 0 {
			h = net.JoinHostPort(host, strconv.Itoa(port))
		}
	}
	return scheme + "://" + h
}
