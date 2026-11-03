// Package proposal holds in-memory command proposals (approve-before-exec).
package proposal

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/hivenest/hivenest/sessiond/internal/risk"
)

type Status string

const (
	Pending  Status = "pending"
	Approved Status = "approved"
	Denied   Status = "denied"
	Consumed Status = "consumed"
	Expired  Status = "expired"
)

// Proposal is an Agent (or user) suggested command awaiting approval.
type Proposal struct {
	ID          string     `json:"id"`
	SessionID   string     `json:"session_id"`
	HostID      string     `json:"host_id"`
	Command     string     `json:"command"`
	Reason      string     `json:"reason,omitempty"`
	Risk        risk.Level `json:"risk"`
	Status      Status     `json:"status"`
	ApproveToken string    `json:"approve_token,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
	ApprovedAt  *time.Time `json:"approved_at,omitempty"`
	ExpiresAt   time.Time  `json:"expires_at"`
}

// Store is process-local; fine for MVP sidecar.
type Store struct {
	mu   sync.Mutex
	byID map[string]*Proposal
	ttl  time.Duration
}

func NewStore() *Store {
	return &Store{byID: map[string]*Proposal{}, ttl: 30 * time.Minute}
}

type CreateInput struct {
	SessionID string
	HostID    string
	Command   string
	Reason    string
	// Risk optional override (e.g. structured tools). Empty → Classify(Command).
	Risk risk.Level
}

func (s *Store) Create(in CreateInput) (*Proposal, error) {
	cmd := trim(in.Command)
	if cmd == "" {
		return nil, fmt.Errorf("command is required")
	}
	if in.SessionID == "" {
		return nil, fmt.Errorf("session_id is required")
	}
	level := in.Risk
	if level == "" {
		level = risk.Classify(cmd)
	}
	now := time.Now().UTC()
	p := &Proposal{
		ID:        uuid.NewString(),
		SessionID: in.SessionID,
		HostID:    in.HostID,
		Command:   cmd,
		Reason:    in.Reason,
		Risk:      level,
		Status:    Pending,
		CreatedAt: now,
		ExpiresAt: now.Add(s.ttl),
	}
	s.mu.Lock()
	s.byID[p.ID] = p
	s.mu.Unlock()
	return clone(p), nil
}

func (s *Store) Get(id string) (*Proposal, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, ok := s.byID[id]
	if !ok {
		return nil, fmt.Errorf("proposal not found")
	}
	s.expireLocked(p)
	return clone(p), nil
}

func (s *Store) Approve(id string) (*Proposal, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, ok := s.byID[id]
	if !ok {
		return nil, fmt.Errorf("proposal not found")
	}
	s.expireLocked(p)
	if p.Status != Pending {
		return nil, fmt.Errorf("proposal is %s", p.Status)
	}
	tok, err := randomHex(16)
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	p.Status = Approved
	p.ApproveToken = tok
	p.ApprovedAt = &now
	return clone(p), nil
}

func (s *Store) Deny(id string) (*Proposal, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, ok := s.byID[id]
	if !ok {
		return nil, fmt.Errorf("proposal not found")
	}
	if p.Status != Pending {
		return nil, fmt.Errorf("proposal is %s", p.Status)
	}
	p.Status = Denied
	return clone(p), nil
}

// ConsumeForExec validates an approved proposal for a command and marks it used.
func (s *Store) ConsumeForExec(proposalID, approveToken, command, sessionID string) (*Proposal, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, ok := s.byID[proposalID]
	if !ok {
		return nil, fmt.Errorf("proposal not found")
	}
	s.expireLocked(p)
	if p.Status != Approved {
		return nil, fmt.Errorf("proposal is %s (need approved)", p.Status)
	}
	if p.SessionID != sessionID {
		return nil, fmt.Errorf("proposal session mismatch")
	}
	if approveToken != "" && p.ApproveToken != approveToken {
		return nil, fmt.Errorf("invalid approve_token")
	}
	if trim(p.Command) != trim(command) {
		return nil, fmt.Errorf("command does not match approved proposal")
	}
	p.Status = Consumed
	return clone(p), nil
}

func (s *Store) ListBySession(sessionID string) []*Proposal {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []*Proposal
	for _, p := range s.byID {
		if p.SessionID == sessionID {
			s.expireLocked(p)
			out = append(out, clone(p))
		}
	}
	return out
}

func (s *Store) expireLocked(p *Proposal) {
	if p.Status == Pending || p.Status == Approved {
		if time.Now().UTC().After(p.ExpiresAt) {
			p.Status = Expired
		}
	}
}

func clone(p *Proposal) *Proposal {
	c := *p
	return &c
}

func trim(s string) string {
	for len(s) > 0 && (s[0] == ' ' || s[0] == '\t' || s[0] == '\n' || s[0] == '\r') {
		s = s[1:]
	}
	for len(s) > 0 {
		c := s[len(s)-1]
		if c == ' ' || c == '\t' || c == '\n' || c == '\r' {
			s = s[:len(s)-1]
			continue
		}
		break
	}
	return s
}

func randomHex(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
