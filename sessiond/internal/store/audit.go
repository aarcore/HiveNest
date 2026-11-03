package store

import (
	"encoding/json"
	"os"
	"sync"
	"time"

	"github.com/google/uuid"
)

// AuditEntry records a local action (session open, exec, proposal, approve).
type AuditEntry struct {
	ID        string    `json:"id"`
	At        time.Time `json:"at"`
	Action    string    `json:"action"`
	HostID    string    `json:"host_id,omitempty"`
	SessionID string    `json:"session_id,omitempty"`
	Actor     string    `json:"actor"` // user | agent
	Command   string    `json:"command,omitempty"`
	Risk      string    `json:"risk,omitempty"`
	ExitCode  *int      `json:"exit_code,omitempty"`
	OK        bool      `json:"ok"`
	Detail    string    `json:"detail,omitempty"`
}

// AuditLog appends JSONL lines under the data directory.
type AuditLog struct {
	path string
	mu   sync.Mutex
}

func NewAuditLog(path string) *AuditLog {
	return &AuditLog{path: path}
}

func (a *AuditLog) Append(e AuditEntry) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if e.ID == "" {
		e.ID = uuid.NewString()
	}
	if e.At.IsZero() {
		e.At = time.Now().UTC()
	}
	b, err := json.Marshal(e)
	if err != nil {
		return err
	}
	f, err := os.OpenFile(a.path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = f.Write(append(b, '\n'))
	return err
}

// ListRecent returns up to limit newest entries (scans file; fine for MVP).
func (a *AuditLog) ListRecent(limit int) ([]AuditEntry, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	b, err := os.ReadFile(a.path)
	if err != nil {
		if os.IsNotExist(err) {
			return []AuditEntry{}, nil
		}
		return nil, err
	}
	var all []AuditEntry
	start := 0
	for i := 0; i <= len(b); i++ {
		if i == len(b) || b[i] == '\n' {
			line := b[start:i]
			start = i + 1
			if len(line) == 0 {
				continue
			}
			var e AuditEntry
			if json.Unmarshal(line, &e) == nil {
				all = append(all, e)
			}
		}
	}
	if limit <= 0 || limit > len(all) {
		limit = len(all)
	}
	out := make([]AuditEntry, limit)
	for i := 0; i < limit; i++ {
		out[i] = all[len(all)-1-i]
	}
	return out, nil
}
