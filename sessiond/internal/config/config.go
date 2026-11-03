// Package config loads sessiond runtime settings (loopback listen, data dir, token).
package config

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
)

const (
	DefaultPort = 7788
	EnvListen   = "HIVENEST_SESSIOND_LISTEN"
	EnvToken    = "HIVENEST_SESSIOND_TOKEN"
	EnvData     = "HIVENEST_SESSIOND_DATA"
)

// Config is process-wide sessiond configuration.
type Config struct {
	Listen         string // host:port, must be loopback
	Token          string // local API bearer token
	DataDir        string // OS-aware app data directory
	TokenFile      string
	HostsFile      string
	AuditFile      string
	KnownHostsFile string
}

// Load reads env and resolves portable paths. Generates a token if unset.
func Load() (Config, error) {
	dataDir, err := resolveDataDir()
	if err != nil {
		return Config{}, err
	}
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		return Config{}, fmt.Errorf("create data dir: %w", err)
	}

	listen := strings.TrimSpace(os.Getenv(EnvListen))
	if listen == "" {
		listen = fmt.Sprintf("127.0.0.1:%d", DefaultPort)
	}
	if err := assertLoopback(listen); err != nil {
		return Config{}, err
	}

	token := strings.TrimSpace(os.Getenv(EnvToken))
	tokenFile := filepath.Join(dataDir, "sessiond.token")
	if token == "" {
		if b, err := os.ReadFile(tokenFile); err == nil {
			token = strings.TrimSpace(string(b))
		}
	}
	if token == "" {
		token, err = randomToken(24)
		if err != nil {
			return Config{}, err
		}
	}
	if err := os.WriteFile(tokenFile, []byte(token+"\n"), 0o600); err != nil {
		return Config{}, fmt.Errorf("write token file: %w", err)
	}

	return Config{
		Listen:         listen,
		Token:          token,
		DataDir:        dataDir,
		TokenFile:      tokenFile,
		HostsFile:      filepath.Join(dataDir, "hosts.json"),
		AuditFile:      filepath.Join(dataDir, "audit.jsonl"),
		KnownHostsFile: filepath.Join(dataDir, "known_hosts.json"),
	}, nil
}

func resolveDataDir() (string, error) {
	if v := strings.TrimSpace(os.Getenv(EnvData)); v != "" {
		return expandHome(v)
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	switch runtime.GOOS {
	case "windows":
		if base := os.Getenv("APPDATA"); base != "" {
			return filepath.Join(base, "HiveNest", "sessiond"), nil
		}
		return filepath.Join(home, "AppData", "Roaming", "HiveNest", "sessiond"), nil
	case "darwin":
		return filepath.Join(home, "Library", "Application Support", "HiveNest", "sessiond"), nil
	default: // linux and other unix
		if xdg := os.Getenv("XDG_DATA_HOME"); xdg != "" {
			return filepath.Join(xdg, "hivenest", "sessiond"), nil
		}
		return filepath.Join(home, ".local", "share", "hivenest", "sessiond"), nil
	}
}

// ExpandPath expands ~ and environment-style home for key/identity paths.
func ExpandPath(p string) (string, error) {
	return expandHome(p)
}

func expandHome(p string) (string, error) {
	p = strings.TrimSpace(p)
	if p == "" {
		return "", fmt.Errorf("empty path")
	}
	if strings.HasPrefix(p, "~/") || p == "~" {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		if p == "~" {
			return home, nil
		}
		return filepath.Join(home, p[2:]), nil
	}
	// Windows-style %USERPROFILE%\...
	if runtime.GOOS == "windows" && strings.Contains(p, "%") {
		return os.ExpandEnv(p), nil
	}
	return p, nil
}

func assertLoopback(addr string) error {
	host, _, err := splitHostPort(addr)
	if err != nil {
		return fmt.Errorf("listen address: %w", err)
	}
	h := strings.ToLower(host)
	switch h {
	case "127.0.0.1", "localhost", "::1", "[::1]":
		return nil
	default:
		return fmt.Errorf("sessiond must bind loopback only (got %q); set %s=127.0.0.1:%d", addr, EnvListen, DefaultPort)
	}
}

func splitHostPort(addr string) (host, port string, err error) {
	// net.SplitHostPort requires brackets for IPv6; handle bare :port too.
	if strings.HasPrefix(addr, ":") {
		return "0.0.0.0", strings.TrimPrefix(addr, ":"), nil
	}
	i := strings.LastIndex(addr, ":")
	if i < 0 {
		return "", "", fmt.Errorf("missing port in %q", addr)
	}
	host, port = addr[:i], addr[i+1:]
	if _, err := strconv.Atoi(port); err != nil {
		return "", "", fmt.Errorf("bad port in %q", addr)
	}
	return host, port, nil
}

func randomToken(nBytes int) (string, error) {
	b := make([]byte, nBytes)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// DefaultSSHDir returns ~/.ssh (or %USERPROFILE%\.ssh on Windows).
func DefaultSSHDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".ssh"), nil
}

// GOOS reports the build/runtime OS for /health.
func GOOS() string { return runtime.GOOS }
