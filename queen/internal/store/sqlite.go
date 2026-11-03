package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

// SQLite persists workers, jobs, and alerts to a file (pure Go driver).
type SQLite struct {
	db *sql.DB
}

func OpenSQLite(path string) (*SQLite, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil && filepath.Dir(path) != "." {
		return nil, err
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	s := &SQLite{db: db}
	if _, err := db.Exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;`); err != nil {
		_ = db.Close()
		return nil, err
	}
	if err := s.migrate(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return s, nil
}

func (s *SQLite) Close() error { return s.db.Close() }

func (s *SQLite) migrate() error {
	_, err := s.db.Exec(`
CREATE TABLE IF NOT EXISTS workers (
  id TEXT PRIMARY KEY,
  hostname TEXT,
  version TEXT,
  region TEXT,
  country TEXT,
  os TEXT,
  arch TEXT,
  status TEXT,
  connected_at TEXT,
  last_seen_at TEXT,
  remote_addr TEXT
);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  worker_id TEXT,
  module TEXT,
  params TEXT,
  status TEXT,
  created_at TEXT,
  updated_at TEXT,
  finished_at TEXT,
  ok INTEGER,
  output TEXT,
  error TEXT
);
CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  worker_id TEXT,
  kind TEXT,
  severity TEXT,
  payload TEXT,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created_at);
CREATE INDEX IF NOT EXISTS idx_alerts_created ON alerts(created_at);
`)
	return err
}

func fmtTime(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.UTC().Format(time.RFC3339Nano)
}

func parseTime(v string) time.Time {
	if v == "" {
		return time.Time{}
	}
	t, err := time.Parse(time.RFC3339Nano, v)
	if err != nil {
		t, _ = time.Parse(time.RFC3339, v)
	}
	return t
}

func (s *SQLite) UpsertOnlineWorker(w Worker) {
	now := time.Now().UTC()
	var existingStatus string
	var connectedAt string
	err := s.db.QueryRow(`SELECT status, connected_at FROM workers WHERE id = ?`, w.ID).Scan(&existingStatus, &connectedAt)
	if err == sql.ErrNoRows {
		_, _ = s.db.Exec(`INSERT INTO workers(id,hostname,version,region,country,os,arch,status,connected_at,last_seen_at,remote_addr)
			VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
			w.ID, w.Hostname, w.Version, w.Region, w.Country, w.OS, w.Arch, string(WorkerOnline),
			fmtTime(now), fmtTime(now), w.RemoteAddr)
		return
	}
	connAt := connectedAt
	if connAt == "" {
		connAt = fmtTime(now)
	}
	_, _ = s.db.Exec(`UPDATE workers SET hostname=?, version=?, region=?, country=?, os=?, arch=?, status=?, connected_at=?, last_seen_at=?, remote_addr=? WHERE id=?`,
		w.Hostname, w.Version, w.Region, w.Country, w.OS, w.Arch, string(WorkerOnline), connAt, fmtTime(now), w.RemoteAddr, w.ID)
}

func (s *SQLite) TouchWorker(id string) {
	_, _ = s.db.Exec(`UPDATE workers SET last_seen_at=?, status=? WHERE id=?`, fmtTime(time.Now().UTC()), string(WorkerOnline), id)
}

func (s *SQLite) MarkWorkerOffline(id string) {
	_, _ = s.db.Exec(`UPDATE workers SET status=?, last_seen_at=? WHERE id=?`, string(WorkerOffline), fmtTime(time.Now().UTC()), id)
}

func (s *SQLite) ListWorkers() []Worker {
	rows, err := s.db.Query(`SELECT id,hostname,version,region,country,os,arch,status,connected_at,last_seen_at,remote_addr FROM workers ORDER BY last_seen_at DESC`)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []Worker
	for rows.Next() {
		var w Worker
		var status, ca, la string
		if err := rows.Scan(&w.ID, &w.Hostname, &w.Version, &w.Region, &w.Country, &w.OS, &w.Arch, &status, &ca, &la, &w.RemoteAddr); err != nil {
			continue
		}
		w.Status = WorkerStatus(status)
		w.ConnectedAt = parseTime(ca)
		w.LastSeenAt = parseTime(la)
		out = append(out, w)
	}
	return out
}

func (s *SQLite) GetWorker(id string) (Worker, bool) {
	var w Worker
	var status, ca, la string
	err := s.db.QueryRow(`SELECT id,hostname,version,region,country,os,arch,status,connected_at,last_seen_at,remote_addr FROM workers WHERE id=?`, id).
		Scan(&w.ID, &w.Hostname, &w.Version, &w.Region, &w.Country, &w.OS, &w.Arch, &status, &ca, &la, &w.RemoteAddr)
	if err != nil {
		return Worker{}, false
	}
	w.Status = WorkerStatus(status)
	w.ConnectedAt = parseTime(ca)
	w.LastSeenAt = parseTime(la)
	return w, true
}

func (s *SQLite) CreateJob(j Job) Job {
	now := time.Now().UTC()
	j.CreatedAt = now
	j.UpdatedAt = now
	j.Status = JobQueued
	params := ""
	if len(j.Params) > 0 {
		params = string(j.Params)
	}
	_, _ = s.db.Exec(`INSERT INTO jobs(id,worker_id,module,params,status,created_at,updated_at,finished_at,ok,output,error)
		VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
		j.ID, j.WorkerID, j.Module, params, string(j.Status), fmtTime(j.CreatedAt), fmtTime(j.UpdatedAt), "", nil, "", "")
	return j
}

func (s *SQLite) MarkJobDispatched(id string) {
	_, _ = s.db.Exec(`UPDATE jobs SET status=?, updated_at=? WHERE id=?`, string(JobDispatched), fmtTime(time.Now().UTC()), id)
}

func (s *SQLite) UpdateJobProgress(id string, status JobStatus, output json.RawMessage, errMsg string) (Job, bool) {
	j, ok := s.GetJob(id)
	if !ok {
		return Job{}, false
	}
	if status != "" {
		j.Status = status
	}
	out := ""
	if output != nil {
		j.Output = output
		out = string(output)
	} else if len(j.Output) > 0 {
		out = string(j.Output)
	}
	if errMsg != "" {
		j.Error = errMsg
	}
	_, err := s.db.Exec(`UPDATE jobs SET status=?, updated_at=?, output=?, error=? WHERE id=?`,
		string(j.Status), fmtTime(time.Now().UTC()), out, j.Error, id)
	if err != nil {
		return Job{}, false
	}
	return s.GetJob(id)
}

func (s *SQLite) CompleteJob(id string, ok bool, output json.RawMessage, errMsg string, finishedAt time.Time) (Job, bool) {
	status := JobSucceeded
	okInt := 1
	if !ok {
		status = JobFailed
		okInt = 0
	}
	out := ""
	if len(output) > 0 {
		out = string(output)
	}
	_, err := s.db.Exec(`UPDATE jobs SET status=?, updated_at=?, finished_at=?, ok=?, output=?, error=? WHERE id=?`,
		string(status), fmtTime(time.Now().UTC()), fmtTime(finishedAt), okInt, out, errMsg, id)
	if err != nil {
		return Job{}, false
	}
	return s.GetJob(id)
}

func (s *SQLite) GetJob(id string) (Job, bool) {
	var j Job
	var status, ca, ua, fa, params, output string
	var okNull sql.NullInt64
	err := s.db.QueryRow(`SELECT id,worker_id,module,params,status,created_at,updated_at,finished_at,ok,output,error FROM jobs WHERE id=?`, id).
		Scan(&j.ID, &j.WorkerID, &j.Module, &params, &status, &ca, &ua, &fa, &okNull, &output, &j.Error)
	if err != nil {
		return Job{}, false
	}
	j.Status = JobStatus(status)
	j.CreatedAt = parseTime(ca)
	j.UpdatedAt = parseTime(ua)
	if fa != "" {
		t := parseTime(fa)
		j.FinishedAt = &t
	}
	if params != "" {
		j.Params = json.RawMessage(params)
	}
	if output != "" {
		j.Output = json.RawMessage(output)
	}
	if okNull.Valid {
		v := okNull.Int64 == 1
		j.OK = &v
	}
	return j, true
}

func (s *SQLite) ListJobs(limit int) []Job {
	if limit <= 0 {
		limit = 50
	}
	rows, err := s.db.Query(`SELECT id,worker_id,module,params,status,created_at,updated_at,finished_at,ok,output,error FROM jobs ORDER BY created_at DESC LIMIT ?`, limit)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []Job
	for rows.Next() {
		var j Job
		var status, ca, ua, fa, params, output string
		var okNull sql.NullInt64
		if err := rows.Scan(&j.ID, &j.WorkerID, &j.Module, &params, &status, &ca, &ua, &fa, &okNull, &output, &j.Error); err != nil {
			continue
		}
		j.Status = JobStatus(status)
		j.CreatedAt = parseTime(ca)
		j.UpdatedAt = parseTime(ua)
		if fa != "" {
			t := parseTime(fa)
			j.FinishedAt = &t
		}
		if params != "" {
			j.Params = json.RawMessage(params)
		}
		if output != "" {
			j.Output = json.RawMessage(output)
		}
		if okNull.Valid {
			v := okNull.Int64 == 1
			j.OK = &v
		}
		out = append(out, j)
	}
	return out
}

func (s *SQLite) AddAlert(a Alert) Alert {
	a.CreatedAt = time.Now().UTC()
	payload := ""
	if len(a.Payload) > 0 {
		payload = string(a.Payload)
	}
	_, _ = s.db.Exec(`INSERT INTO alerts(id,worker_id,kind,severity,payload,created_at) VALUES(?,?,?,?,?,?)`,
		a.ID, a.WorkerID, a.Kind, a.Severity, payload, fmtTime(a.CreatedAt))
	return a
}

func (s *SQLite) ListAlerts(limit int) []Alert {
	if limit <= 0 {
		limit = 50
	}
	rows, err := s.db.Query(`SELECT id,worker_id,kind,severity,payload,created_at FROM alerts ORDER BY created_at DESC LIMIT ?`, limit)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []Alert
	for rows.Next() {
		var a Alert
		var payload, ca string
		if err := rows.Scan(&a.ID, &a.WorkerID, &a.Kind, &a.Severity, &payload, &ca); err != nil {
			continue
		}
		a.CreatedAt = parseTime(ca)
		if payload != "" {
			a.Payload = json.RawMessage(payload)
		}
		out = append(out, a)
	}
	return out
}

// OpenFromURL opens memory:// or sqlite:///path or sqlite:path.
func OpenFromURL(url string) (Store, error) {
	u := strings.TrimSpace(url)
	if u == "" || u == "memory://" || u == ":memory:" {
		return NewMemory(), nil
	}
	path := u
	switch {
	case strings.HasPrefix(u, "sqlite:///"):
		path = strings.TrimPrefix(u, "sqlite:///")
		if !strings.HasPrefix(path, "/") {
			path = "/" + path
		}
	case strings.HasPrefix(u, "sqlite://"):
		path = strings.TrimPrefix(u, "sqlite://")
	case strings.HasPrefix(u, "sqlite:"):
		path = strings.TrimPrefix(u, "sqlite:")
	case strings.HasPrefix(u, "file:"):
		path = strings.TrimPrefix(u, "file:")
	default:
		return nil, fmt.Errorf("unsupported database url %q (use memory:// or sqlite:///path)", u)
	}
	if path == "" {
		return nil, fmt.Errorf("empty sqlite path")
	}
	return OpenSQLite(path)
}
