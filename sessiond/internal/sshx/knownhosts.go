package sshx

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"sync"
	"time"

	"golang.org/x/crypto/ssh"
)

// HostKeyIssue is returned when TOFU requires user decision.
type HostKeyIssue struct {
	Code            string `json:"code"` // host_key_unknown | host_key_mismatch
	Host            string `json:"host"`
	Port            int    `json:"port"`
	KeyType         string `json:"key_type"`
	FingerprintSHA256 string `json:"fingerprint_sha256"`
	PublicKey       string `json:"public_key"` // OpenSSH authorized_keys line body (type + b64)
	PreviousFingerprint string `json:"previous_fingerprint,omitempty"`
}

func (e *HostKeyIssue) Error() string {
	if e.Code == "host_key_mismatch" {
		return fmt.Sprintf("REMOTE HOST IDENTIFICATION HAS CHANGED for %s:%d (%s). Expected %s, got %s",
			e.Host, e.Port, e.KeyType, e.PreviousFingerprint, e.FingerprintSHA256)
	}
	return fmt.Sprintf("unknown host key for %s:%d (%s) fingerprint %s — accept to continue",
		e.Host, e.Port, e.KeyType, e.FingerprintSHA256)
}

// KnownHostEntry is one trusted host key.
type KnownHostEntry struct {
	Host              string    `json:"host"`
	Port              int       `json:"port"`
	KeyType           string    `json:"key_type"`
	PublicKey         string    `json:"public_key"`
	FingerprintSHA256 string    `json:"fingerprint_sha256"`
	AcceptedAt        time.Time `json:"accepted_at"`
}

type knownHostFile struct {
	Entries []KnownHostEntry `json:"entries"`
}

// KnownHosts is a JSON-backed TOFU store.
type KnownHosts struct {
	path string
	mu   sync.Mutex
}

func NewKnownHosts(path string) *KnownHosts {
	return &KnownHosts{path: path}
}

func (k *KnownHosts) load() (knownHostFile, error) {
	var f knownHostFile
	b, err := os.ReadFile(k.path)
	if err != nil {
		if os.IsNotExist(err) {
			return knownHostFile{Entries: []KnownHostEntry{}}, nil
		}
		return f, err
	}
	if err := json.Unmarshal(b, &f); err != nil {
		return f, err
	}
	if f.Entries == nil {
		f.Entries = []KnownHostEntry{}
	}
	return f, nil
}

func (k *KnownHosts) save(f knownHostFile) error {
	b, err := json.MarshalIndent(f, "", "  ")
	if err != nil {
		return err
	}
	tmp := k.path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, k.path)
}

func hostPortKey(host string, port int) string {
	if port <= 0 {
		port = 22
	}
	return net.JoinHostPort(host, fmt.Sprintf("%d", port))
}

func Fingerprint(key ssh.PublicKey) string {
	return ssh.FingerprintSHA256(key)
}

func PublicKeyLine(key ssh.PublicKey) string {
	return key.Type() + " " + base64.StdEncoding.EncodeToString(key.Marshal())
}

func ParsePublicKeyLine(line string) (ssh.PublicKey, error) {
	pk, _, _, _, err := ssh.ParseAuthorizedKey([]byte(line))
	return pk, err
}

func (k *KnownHosts) List() ([]KnownHostEntry, error) {
	k.mu.Lock()
	defer k.mu.Unlock()
	f, err := k.load()
	return f.Entries, err
}

func (k *KnownHosts) Find(host string, port int) (KnownHostEntry, bool, error) {
	k.mu.Lock()
	defer k.mu.Unlock()
	f, err := k.load()
	if err != nil {
		return KnownHostEntry{}, false, err
	}
	hp := hostPortKey(host, port)
	for _, e := range f.Entries {
		if hostPortKey(e.Host, e.Port) == hp {
			return e, true, nil
		}
	}
	return KnownHostEntry{}, false, nil
}

// Accept stores or replaces the host key for host:port.
func (k *KnownHosts) Accept(host string, port int, publicKeyLine string) (KnownHostEntry, error) {
	if port <= 0 {
		port = 22
	}
	pk, err := ParsePublicKeyLine(publicKeyLine)
	if err != nil {
		return KnownHostEntry{}, fmt.Errorf("invalid public key: %w", err)
	}
	entry := KnownHostEntry{
		Host:              host,
		Port:              port,
		KeyType:           pk.Type(),
		PublicKey:         PublicKeyLine(pk),
		FingerprintSHA256: Fingerprint(pk),
		AcceptedAt:        time.Now().UTC(),
	}
	k.mu.Lock()
	defer k.mu.Unlock()
	f, err := k.load()
	if err != nil {
		return KnownHostEntry{}, err
	}
	hp := hostPortKey(host, port)
	out := f.Entries[:0]
	for _, e := range f.Entries {
		if hostPortKey(e.Host, e.Port) == hp {
			continue
		}
		out = append(out, e)
	}
	out = append(out, entry)
	f.Entries = out
	if err := k.save(f); err != nil {
		return KnownHostEntry{}, err
	}
	return entry, nil
}

func (k *KnownHosts) Delete(host string, port int) error {
	k.mu.Lock()
	defer k.mu.Unlock()
	f, err := k.load()
	if err != nil {
		return err
	}
	hp := hostPortKey(host, port)
	out := f.Entries[:0]
	found := false
	for _, e := range f.Entries {
		if hostPortKey(e.Host, e.Port) == hp {
			found = true
			continue
		}
		out = append(out, e)
	}
	if !found {
		return fmt.Errorf("known host not found")
	}
	f.Entries = out
	return k.save(f)
}

// Callback returns an ssh.HostKeyCallback. If acceptUnknown is true, unknown keys
// are stored and accepted (used after UI confirmation on the same dial retry).
// Mismatch always fails unless replaceMismatch is true.
func (k *KnownHosts) Callback(host string, port int, acceptUnknown, replaceMismatch bool) ssh.HostKeyCallback {
	return func(hostname string, remote net.Addr, key ssh.PublicKey) error {
		fp := Fingerprint(key)
		line := PublicKeyLine(key)
		existing, ok, err := k.Find(host, port)
		if err != nil {
			return err
		}
		if !ok {
			if acceptUnknown {
				_, err := k.Accept(host, port, line)
				return err
			}
			return &HostKeyIssue{
				Code:              "host_key_unknown",
				Host:              host,
				Port:              port,
				KeyType:           key.Type(),
				FingerprintSHA256: fp,
				PublicKey:         line,
			}
		}
		if existing.FingerprintSHA256 == fp || existing.PublicKey == line {
			return nil
		}
		if replaceMismatch {
			_, err := k.Accept(host, port, line)
			return err
		}
		return &HostKeyIssue{
			Code:                "host_key_mismatch",
			Host:                host,
			Port:                port,
			KeyType:             key.Type(),
			FingerprintSHA256:   fp,
			PublicKey:           line,
			PreviousFingerprint: existing.FingerprintSHA256,
		}
	}
}
