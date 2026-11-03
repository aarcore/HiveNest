// Package protocol defines the JSON message shapes exchanged over the
// Queen ↔ Worker WebSocket. TLS/mTLS wraps the transport; this package
// stays transport-agnostic so mTLS can be added later without changing
// message types.
package protocol

import "encoding/json"

const (
	TypeHello     = "hello"
	TypeHelloAck  = "hello_ack"
	TypeHeartbeat = "heartbeat"
	TypeJob       = "job"
	TypeJobResult = "job_result"
	TypeAlert     = "alert"
	TypeError     = "error"
)

// Envelope is the wire wrapper. Type selects which payload fields matter.
type Envelope struct {
	Type string `json:"type"`

	// hello / heartbeat / job_result / alert
	WorkerID string `json:"worker_id,omitempty"`
	Hostname string `json:"hostname,omitempty"`
	Version  string `json:"version,omitempty"`
	Region   string `json:"region,omitempty"`
	Country  string `json:"country,omitempty"`
	OS       string `json:"os,omitempty"`
	Arch     string `json:"arch,omitempty"`
	TS       int64  `json:"ts,omitempty"`

	// Enrollment: shared bootstrap token (HIVENEST_BOOTSTRAP_TOKEN).
	Token string `json:"token,omitempty"`

	// job / job_result
	JobID  string          `json:"job_id,omitempty"`
	Module string          `json:"module,omitempty"`
	Params json.RawMessage `json:"params,omitempty"`

	// job_result
	OK         bool            `json:"ok,omitempty"`
	Output     json.RawMessage `json:"output,omitempty"`
	Error      string          `json:"error,omitempty"`
	FinishedAt string          `json:"finished_at,omitempty"`

	// alert
	AlertID  string          `json:"alert_id,omitempty"`
	Kind     string          `json:"kind,omitempty"`
	Severity string          `json:"severity,omitempty"`
	Payload  json.RawMessage `json:"payload,omitempty"`

	// error / hello_ack
	Message string `json:"message,omitempty"`
}

// AllowedModules is the MVP allowlist. Workers refuse anything else.
var AllowedModules = map[string]bool{
	"echo":           true,
	"host.uname":     true,
	"host.info":      true,
	"host.disk":      true,
	"pkg.list":       true,
	"guard.snapshot": true,
}

func IsAllowedModule(name string) bool {
	return AllowedModules[name]
}
