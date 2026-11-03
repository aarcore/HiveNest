package store

import (
	"encoding/json"
	"sync"
	"time"
)

// Memory is an in-memory Store used when DatabaseURL is memory://.
type Memory struct {
	mu        sync.RWMutex
	workers   map[string]*Worker
	jobs      map[string]*Job
	jobOrder  []string
	alerts    []Alert
}

func NewMemory() *Memory {
	return &Memory{
		workers: make(map[string]*Worker),
		jobs:    make(map[string]*Job),
	}
}

func (m *Memory) Close() error { return nil }

func (m *Memory) UpsertOnlineWorker(w Worker) {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := time.Now().UTC()
	existing, ok := m.workers[w.ID]
	if !ok {
		w.ConnectedAt = now
		w.LastSeenAt = now
		w.Status = WorkerOnline
		cp := w
		m.workers[w.ID] = &cp
		return
	}
	existing.Hostname = w.Hostname
	existing.Version = w.Version
	existing.Region = w.Region
	existing.Country = w.Country
	existing.OS = w.OS
	existing.Arch = w.Arch
	existing.RemoteAddr = w.RemoteAddr
	existing.Status = WorkerOnline
	existing.LastSeenAt = now
	if existing.ConnectedAt.IsZero() {
		existing.ConnectedAt = now
	}
}

func (m *Memory) TouchWorker(id string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if w, ok := m.workers[id]; ok {
		w.LastSeenAt = time.Now().UTC()
		w.Status = WorkerOnline
	}
}

func (m *Memory) MarkWorkerOffline(id string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if w, ok := m.workers[id]; ok {
		w.Status = WorkerOffline
		w.LastSeenAt = time.Now().UTC()
	}
}

func (m *Memory) ListWorkers() []Worker {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]Worker, 0, len(m.workers))
	for _, w := range m.workers {
		out = append(out, *w)
	}
	return out
}

func (m *Memory) GetWorker(id string) (Worker, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	w, ok := m.workers[id]
	if !ok {
		return Worker{}, false
	}
	return *w, true
}

func (m *Memory) CreateJob(j Job) Job {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := time.Now().UTC()
	j.CreatedAt = now
	j.UpdatedAt = now
	j.Status = JobQueued
	cp := j
	m.jobs[j.ID] = &cp
	m.jobOrder = append(m.jobOrder, j.ID)
	return cp
}

func (m *Memory) MarkJobDispatched(id string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if j, ok := m.jobs[id]; ok {
		j.Status = JobDispatched
		j.UpdatedAt = time.Now().UTC()
	}
}

func (m *Memory) UpdateJobProgress(id string, status JobStatus, output json.RawMessage, errMsg string) (Job, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	j, found := m.jobs[id]
	if !found {
		return Job{}, false
	}
	if status != "" {
		j.Status = status
	}
	if output != nil {
		j.Output = output
	}
	if errMsg != "" {
		j.Error = errMsg
	}
	j.UpdatedAt = time.Now().UTC()
	return *j, true
}

func (m *Memory) CompleteJob(id string, ok bool, output json.RawMessage, errMsg string, finishedAt time.Time) (Job, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	j, found := m.jobs[id]
	if !found {
		return Job{}, false
	}
	j.OK = &ok
	j.Output = output
	j.Error = errMsg
	j.FinishedAt = &finishedAt
	j.UpdatedAt = time.Now().UTC()
	if ok {
		j.Status = JobSucceeded
	} else {
		j.Status = JobFailed
	}
	return *j, true
}

func (m *Memory) GetJob(id string) (Job, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	j, ok := m.jobs[id]
	if !ok {
		return Job{}, false
	}
	return *j, true
}

func (m *Memory) ListJobs(limit int) []Job {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if limit <= 0 || limit > len(m.jobOrder) {
		limit = len(m.jobOrder)
	}
	start := len(m.jobOrder) - limit
	out := make([]Job, 0, limit)
	for i := len(m.jobOrder) - 1; i >= start; i-- {
		if j, ok := m.jobs[m.jobOrder[i]]; ok {
			out = append(out, *j)
		}
	}
	return out
}

func (m *Memory) AddAlert(a Alert) Alert {
	m.mu.Lock()
	defer m.mu.Unlock()
	a.CreatedAt = time.Now().UTC()
	m.alerts = append(m.alerts, a)
	if len(m.alerts) > 500 {
		m.alerts = m.alerts[len(m.alerts)-500:]
	}
	return a
}

func (m *Memory) ListAlerts(limit int) []Alert {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if limit <= 0 || limit > len(m.alerts) {
		limit = len(m.alerts)
	}
	out := make([]Alert, 0, limit)
	for i := len(m.alerts) - 1; i >= len(m.alerts)-limit; i-- {
		out = append(out, m.alerts[i])
	}
	return out
}
