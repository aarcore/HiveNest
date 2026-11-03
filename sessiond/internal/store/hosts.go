package store

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)

// AuthMethod hints how the client should authenticate. Passwords are NEVER stored
// in HostProfile — supply them only on session open (see session.OpenOptions).
const (
	AuthMethodKey      = "key"
	AuthMethodPassword = "password"
	AuthMethodAgent    = "agent"
)

// HostProfile is a saved SSH target (no secrets inline; identity path, agent, or password-at-connect).
type HostProfile struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Host         string `json:"host"`
	Port         int    `json:"port"`
	User         string `json:"user"`
	IdentityFile string `json:"identity_file,omitempty"` // path; OS-expanded at dial
	UseAgent     bool   `json:"use_agent"`
	AuthMethod   string `json:"auth_method,omitempty"` // key | password | agent (preference only)
	// JumpHostIDs is an ordered multi-hop bastion chain (preferred). Each hop uses that
	// host profile's own identity_file / auth_method — never the target's.
	JumpHostIDs []string `json:"jump_host_ids,omitempty"`
	// JumpHostID is a single bastion (legacy). When JumpHostIDs is empty, treated as a one-hop chain.
	// When JumpHostIDs is set, JumpHostID mirrors the first hop for older clients.
	JumpHostID string `json:"jump_host_id,omitempty"`
	// ProxyJump is OpenSSH-style "user@host:port" or "b1,b2" when no jump host ids are set.
	ProxyJump string `json:"proxy_jump,omitempty"`
	// Jump* auth applies only to ProxyJump string bastions (not JumpHostID(s) profiles,
	// which use each bastion host's own identity_file / auth_method).
	JumpIdentityFile string    `json:"jump_identity_file,omitempty"`
	JumpUseAgent     bool      `json:"jump_use_agent,omitempty"`
	JumpAuthMethod   string    `json:"jump_auth_method,omitempty"` // key | password | agent
	// JumpHops optional per-hop auth for ProxyJump *string* chains (index-aligned with ParseJumpChain).
	// Prefer jump_host_ids profiles when each hop needs a full host identity.
	JumpHops  []JumpHopSpec `json:"jump_hops,omitempty"`
	Tags      []string     `json:"tags,omitempty"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}

// JumpHopSpec is per-hop bastion auth for a ProxyJump string chain entry.
type JumpHopSpec struct {
	IdentityFile string `json:"identity_file,omitempty"`
	UseAgent     bool   `json:"use_agent,omitempty"`
	AuthMethod   string `json:"auth_method,omitempty"` // key | password | agent
}

// HostStore is a JSON file-backed CRUD store for host profiles.
type HostStore struct {
	path string
	mu   sync.Mutex
}

func NewHostStore(path string) *HostStore {
	return &HostStore{path: path}
}

type hostFile struct {
	Hosts []HostProfile `json:"hosts"`
}

func (s *HostStore) load() (hostFile, error) {
	var f hostFile
	b, err := os.ReadFile(s.path)
	if err != nil {
		if os.IsNotExist(err) {
			return hostFile{Hosts: []HostProfile{}}, nil
		}
		return f, err
	}
	if err := json.Unmarshal(b, &f); err != nil {
		return f, err
	}
	if f.Hosts == nil {
		f.Hosts = []HostProfile{}
	}
	return f, nil
}

func (s *HostStore) save(f hostFile) error {
	b, err := json.MarshalIndent(f, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

func (s *HostStore) List() ([]HostProfile, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	f, err := s.load()
	return f.Hosts, err
}

func (s *HostStore) Get(id string) (HostProfile, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	f, err := s.load()
	if err != nil {
		return HostProfile{}, err
	}
	for _, h := range f.Hosts {
		if h.ID == id {
			return h, nil
		}
	}
	return HostProfile{}, fmt.Errorf("host not found")
}

type HostInput struct {
	Name             string   `json:"name"`
	Host             string   `json:"host"`
	Port             int      `json:"port"`
	User             string   `json:"user"`
	IdentityFile     string   `json:"identity_file"`
	UseAgent         *bool    `json:"use_agent"`
	AuthMethod       string   `json:"auth_method"` // key | password | agent; password never persisted as secret
	JumpHostID       string   `json:"jump_host_id"`
	JumpHostIDs      []string `json:"jump_host_ids"`
	ProxyJump        string   `json:"proxy_jump"`
	JumpIdentityFile string        `json:"jump_identity_file"`
	JumpUseAgent     *bool         `json:"jump_use_agent"`
	JumpAuthMethod   string        `json:"jump_auth_method"`
	JumpHops         []JumpHopSpec `json:"jump_hops"`
	Tags             []string      `json:"tags"`
}

func (s *HostStore) Create(in HostInput) (HostProfile, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if in.Host == "" || in.User == "" {
		return HostProfile{}, fmt.Errorf("host and user are required")
	}
	if in.Port <= 0 {
		in.Port = 22
	}
	if in.Name == "" {
		in.Name = in.User + "@" + in.Host
	}
	authMethod := normalizeAuthMethod(in.AuthMethod)
	useAgent := true
	if in.UseAgent != nil {
		useAgent = *in.UseAgent
	} else if authMethod == AuthMethodPassword {
		useAgent = false
	} else if authMethod == AuthMethodKey {
		useAgent = false
	}
	if authMethod == AuthMethodPassword && in.IdentityFile == "" {
		// password-at-connect hosts do not need an identity path
	}
	now := time.Now().UTC()
	jumpAuth := normalizeAuthMethod(in.JumpAuthMethod)
	jumpAgent := false
	if in.JumpUseAgent != nil {
		jumpAgent = *in.JumpUseAgent
	} else if jumpAuth == AuthMethodAgent {
		jumpAgent = true
	} else if jumpAuth == AuthMethodKey {
		jumpAgent = false
	}
	jumpIdentity := in.JumpIdentityFile
	if jumpAuth == AuthMethodPassword || jumpAuth == AuthMethodAgent {
		jumpIdentity = ""
	}
	jumpHostIDs, jumpHostID, proxyJump := normalizeJumpFields(in.JumpHostIDs, in.JumpHostID, in.ProxyJump)
	useProfileJump := len(jumpHostIDs) > 0 || jumpHostID != ""
	if useProfileJump {
		jumpIdentity = ""
		jumpAgent = false
		jumpAuth = ""
	}
	hops := normalizeJumpHops(in.JumpHops, useProfileJump)
	if !useProfileJump && proxyJump != "" {
		hops, jumpIdentity, jumpAgent, jumpAuth = alignProxyJumpHops(proxyJump, hops, jumpIdentity, jumpAgent, jumpAuth)
	}
	h := HostProfile{
		ID:               uuid.NewString(),
		Name:             in.Name,
		Host:             in.Host,
		Port:             in.Port,
		User:             in.User,
		IdentityFile:     in.IdentityFile,
		UseAgent:         useAgent,
		AuthMethod:       authMethod,
		JumpHostIDs:      jumpHostIDs,
		JumpHostID:       jumpHostID,
		ProxyJump:        proxyJump,
		JumpIdentityFile: jumpIdentity,
		JumpUseAgent:     jumpAgent,
		JumpAuthMethod:   jumpAuth,
		JumpHops:         hops,
		Tags:             in.Tags,
		CreatedAt:        now,
		UpdatedAt:        now,
	}
	f, err := s.load()
	if err != nil {
		return HostProfile{}, err
	}
	f.Hosts = append(f.Hosts, h)
	if err := s.save(f); err != nil {
		return HostProfile{}, err
	}
	return h, nil
}

func (s *HostStore) Update(id string, in HostInput) (HostProfile, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	f, err := s.load()
	if err != nil {
		return HostProfile{}, err
	}
	for i := range f.Hosts {
		if f.Hosts[i].ID != id {
			continue
		}
		h := &f.Hosts[i]
		if in.Name != "" {
			h.Name = in.Name
		}
		if in.Host != "" {
			h.Host = in.Host
		}
		if in.Port > 0 {
			h.Port = in.Port
		}
		if in.User != "" {
			h.User = in.User
		}
		if in.AuthMethod != "" {
			h.AuthMethod = normalizeAuthMethod(in.AuthMethod)
		}
		// Full-form edits always send auth_method; password mode clears identity path.
		if h.AuthMethod == AuthMethodPassword {
			h.IdentityFile = ""
		} else if in.IdentityFile != "" || in.AuthMethod != "" {
			// Allow replacing identity; empty string clears when auth_method present.
			h.IdentityFile = in.IdentityFile
		}
		if in.UseAgent != nil {
			h.UseAgent = *in.UseAgent
		} else if in.AuthMethod == AuthMethodPassword {
			h.UseAgent = false
		} else if in.AuthMethod == AuthMethodAgent {
			h.UseAgent = true
		}
		if in.Tags != nil {
			h.Tags = in.Tags
		}
		// Always apply jump fields on full-form edits (empty clears).
		h.JumpHostIDs, h.JumpHostID, h.ProxyJump = normalizeJumpFields(in.JumpHostIDs, in.JumpHostID, in.ProxyJump)
		if len(h.JumpHostIDs) > 0 || h.JumpHostID != "" {
			h.JumpIdentityFile = ""
			h.JumpUseAgent = false
			h.JumpAuthMethod = ""
			h.JumpHops = nil
		} else {
			h.JumpAuthMethod = normalizeAuthMethod(in.JumpAuthMethod)
			if in.JumpUseAgent != nil {
				h.JumpUseAgent = *in.JumpUseAgent
			} else if in.JumpAuthMethod == AuthMethodAgent {
				h.JumpUseAgent = true
			} else if in.JumpAuthMethod == AuthMethodPassword {
				h.JumpUseAgent = false
			}
			if h.JumpAuthMethod == AuthMethodPassword || h.JumpAuthMethod == AuthMethodAgent {
				h.JumpIdentityFile = ""
			} else {
				h.JumpIdentityFile = in.JumpIdentityFile
			}
			hops := normalizeJumpHops(in.JumpHops, false)
			if h.ProxyJump != "" {
				hops, h.JumpIdentityFile, h.JumpUseAgent, h.JumpAuthMethod = alignProxyJumpHops(
					h.ProxyJump, hops, h.JumpIdentityFile, h.JumpUseAgent, h.JumpAuthMethod,
				)
			} else {
				hops = nil
				h.JumpIdentityFile = ""
				h.JumpUseAgent = false
				h.JumpAuthMethod = ""
			}
			h.JumpHops = hops
		}
		h.UpdatedAt = time.Now().UTC()
		if err := s.save(f); err != nil {
			return HostProfile{}, err
		}
		return *h, nil
	}
	return HostProfile{}, fmt.Errorf("host not found")
}

func (s *HostStore) Delete(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	f, err := s.load()
	if err != nil {
		return err
	}
	out := f.Hosts[:0]
	found := false
	for _, h := range f.Hosts {
		if h.ID == id {
			found = true
			continue
		}
		out = append(out, h)
	}
	if !found {
		return fmt.Errorf("host not found")
	}
	f.Hosts = out
	return s.save(f)
}

// JumpChainIDs returns the ordered bastion host ids (JumpHostIDs, or legacy JumpHostID).
func (h HostProfile) JumpChainIDs() []string {
	if len(h.JumpHostIDs) > 0 {
		out := make([]string, 0, len(h.JumpHostIDs))
		for _, id := range h.JumpHostIDs {
			id = trimID(id)
			if id != "" {
				out = append(out, id)
			}
		}
		return out
	}
	if id := trimID(h.JumpHostID); id != "" {
		return []string{id}
	}
	return nil
}

func trimID(s string) string { return strings.TrimSpace(s) }

// normalizeJumpFields prefers jump_host_ids; clears proxy_jump when any profile jump is set.
func normalizeJumpFields(ids []string, single, proxy string) (jumpIDs []string, jumpID, proxyJump string) {
	seen := map[string]bool{}
	for _, id := range ids {
		id = trimID(id)
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		jumpIDs = append(jumpIDs, id)
	}
	single = trimID(single)
	if len(jumpIDs) > 0 {
		return jumpIDs, jumpIDs[0], ""
	}
	if single != "" {
		return nil, single, ""
	}
	return nil, "", proxy
}



// alignProxyJumpHops pads/trims JumpHops to the ProxyJump chain length and keeps hop-0
// Jump* fields in sync (parity with jump_host_ids per-profile identity).
func alignProxyJumpHops(proxy string, hops []JumpHopSpec, hop0Identity string, hop0Agent bool, hop0Auth string) ([]JumpHopSpec, string, bool, string) {
	proxy = strings.TrimSpace(proxy)
	if proxy == "" {
		return nil, "", false, ""
	}
	n := 0
	for _, part := range strings.Split(proxy, ",") {
		if strings.TrimSpace(part) != "" {
			n++
		}
	}
	if n == 0 {
		return nil, "", false, ""
	}
	out := make([]JumpHopSpec, n)
	for i := 0; i < n; i++ {
		if i < len(hops) {
			out[i] = hops[i]
		}
	}
	// Seed hop 0 from Jump* when hop entry empty.
	if out[0].AuthMethod == "" && out[0].IdentityFile == "" && !out[0].UseAgent {
		out[0] = JumpHopSpec{
			IdentityFile: hop0Identity,
			UseAgent:     hop0Agent,
			AuthMethod:   normalizeAuthMethod(hop0Auth),
		}
		if out[0].AuthMethod == AuthMethodPassword || out[0].AuthMethod == AuthMethodAgent {
			out[0].IdentityFile = ""
		}
		if out[0].AuthMethod == AuthMethodAgent {
			out[0].UseAgent = true
		}
	}
	h0 := out[0]
	id := h0.IdentityFile
	agent := h0.UseAgent
	auth := h0.AuthMethod
	if auth == AuthMethodPassword || auth == AuthMethodAgent {
		id = ""
	}
	if auth == AuthMethodAgent {
		agent = true
	}
	return out, id, agent, auth
}

func normalizeJumpHops(in []JumpHopSpec, clear bool) []JumpHopSpec {
	if clear || len(in) == 0 {
		return nil
	}
	out := make([]JumpHopSpec, 0, len(in))
	for _, h := range in {
		auth := normalizeAuthMethod(h.AuthMethod)
		identity := h.IdentityFile
		agent := h.UseAgent
		if auth == AuthMethodPassword || auth == AuthMethodAgent {
			identity = ""
		}
		if auth == AuthMethodAgent {
			agent = true
		}
		out = append(out, JumpHopSpec{IdentityFile: identity, UseAgent: agent, AuthMethod: auth})
	}
	return out
}

func normalizeAuthMethod(m string) string {
	switch m {
	case AuthMethodKey, AuthMethodPassword, AuthMethodAgent:
		return m
	default:
		return ""
	}
}
