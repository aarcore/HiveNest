package store

import (
	"encoding/json"
	"time"
)

type WorkerStatus string

const (
	WorkerOnline  WorkerStatus = "online"
	WorkerOffline WorkerStatus = "offline"
)

type Worker struct {
	ID          string       `json:"id"`
	Hostname    string       `json:"hostname"`
	Version     string       `json:"version"`
	Region      string       `json:"region"`
	Country     string       `json:"country"`
	OS          string       `json:"os"`
	Arch        string       `json:"arch"`
	Status      WorkerStatus `json:"status"`
	ConnectedAt time.Time    `json:"connected_at"`
	LastSeenAt  time.Time    `json:"last_seen_at"`
	RemoteAddr  string       `json:"remote_addr,omitempty"`
}

type JobStatus string

const (
	JobQueued     JobStatus = "queued"
	JobDispatched JobStatus = "dispatched"
	JobSucceeded  JobStatus = "succeeded"
	JobFailed     JobStatus = "failed"
)

type Job struct {
	ID         string          `json:"id"`
	WorkerID   string          `json:"worker_id"`
	Module     string          `json:"module"`
	Params     json.RawMessage `json:"params,omitempty"`
	Status     JobStatus       `json:"status"`
	CreatedAt  time.Time       `json:"created_at"`
	UpdatedAt  time.Time       `json:"updated_at"`
	FinishedAt *time.Time      `json:"finished_at,omitempty"`
	OK         *bool           `json:"ok,omitempty"`
	Output     json.RawMessage `json:"output,omitempty"`
	Error      string          `json:"error,omitempty"`
}

type Alert struct {
	ID        string          `json:"id"`
	WorkerID  string          `json:"worker_id"`
	Kind      string          `json:"kind"`
	Severity  string          `json:"severity"`
	Payload   json.RawMessage `json:"payload,omitempty"`
	CreatedAt time.Time       `json:"created_at"`
}

// Store persists workers, jobs, and alerts.
type Store interface {
	UpsertOnlineWorker(w Worker)
	TouchWorker(id string)
	MarkWorkerOffline(id string)
	ListWorkers() []Worker
	GetWorker(id string) (Worker, bool)

	CreateJob(j Job) Job
	MarkJobDispatched(id string)
	UpdateJobProgress(id string, status JobStatus, output json.RawMessage, errMsg string) (Job, bool)
	CompleteJob(id string, ok bool, output json.RawMessage, errMsg string, finishedAt time.Time) (Job, bool)
	GetJob(id string) (Job, bool)
	ListJobs(limit int) []Job

	AddAlert(a Alert) Alert
	ListAlerts(limit int) []Alert

	Close() error
}
