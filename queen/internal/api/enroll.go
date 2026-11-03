package api

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/hivenest/hivenest/queen/internal/config"
	"github.com/hivenest/hivenest/queen/internal/enroll"
	"github.com/hivenest/hivenest/queen/internal/store"
)

type enrollSSHRequest struct {
	Host          string `json:"host"`
	Port          int    `json:"port"`
	User          string `json:"user"`
	Auth          struct {
		Password   string `json:"password"`
		PrivateKey string `json:"private_key"`
	} `json:"auth"`
	WorkerID       string `json:"worker_id"`
	Region         string `json:"region"`
	Country        string `json:"country"`
	Sudo           bool   `json:"sudo"`
	QueenWSURL     string `json:"queen_ws_url"`
	WorkerDialURL  string `json:"worker_dial_url"`
}

func (s *Server) handleEnrollSSH(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if s.Enroller == nil {
		writeErr(w, http.StatusServiceUnavailable, "enroller not configured")
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "read body")
		return
	}
	var req enrollSSHRequest
	if err := json.Unmarshal(body, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	req.Host = strings.TrimSpace(req.Host)
	req.User = strings.TrimSpace(req.User)
	if req.Host == "" || req.User == "" {
		writeErr(w, http.StatusBadRequest, "host and user required")
		return
	}
	if req.Auth.Password == "" && strings.TrimSpace(req.Auth.PrivateKey) == "" {
		writeErr(w, http.StatusBadRequest, "auth.password or auth.private_key required")
		return
	}
	if req.Port <= 0 {
		req.Port = 22
	}

	override := strings.TrimSpace(req.QueenWSURL)
	if override == "" {
		override = strings.TrimSpace(req.WorkerDialURL)
	}
	dial := override
	if dial == "" {
		dial = s.effectiveWorkerDialURL()
	}
	dial = config.NormalizeWorkerDialURL(dial)
	if dial == "" {
		writeErr(w, http.StatusBadRequest, "worker dial URL empty; set HIVENEST_WORKER_DIAL_URL or pass queen_ws_url")
		return
	}
	if config.IsLoopbackDialURL(dial) {
		writeErr(w, http.StatusBadRequest,
			"worker dial URL is localhost/loopback ("+dial+") — remote host cannot reach Queen. "+
				"Set HIVENEST_WORKER_DIAL_URL (or HIVENEST_PUBLIC_URL) to a LAN/public address, or pass queen_ws_url / worker_dial_url in the request (e.g. ws://YOUR_LAN_IP:8080/v1/worker/ws)")
		return
	}

	safeParams, _ := json.Marshal(map[string]any{
		"host":            req.Host,
		"port":            req.Port,
		"user":            req.User,
		"sudo":            req.Sudo,
		"region":          req.Region,
		"country":         req.Country,
		"worker_id":       req.WorkerID,
		"queen_ws_url":    dial,
		"auth":            map[string]bool{"password": req.Auth.Password != "", "private_key": req.Auth.PrivateKey != ""},
		"dial_overridden": override != "",
	})

	job := s.Store.CreateJob(store.Job{
		ID:       uuid.NewString(),
		WorkerID: req.WorkerID,
		Module:   "enroll.ssh",
		Params:   safeParams,
	})
	s.Store.MarkJobDispatched(job.ID)

	er := enroll.Request{
		Host:       req.Host,
		Port:       req.Port,
		User:       req.User,
		WorkerID:   req.WorkerID,
		Region:     req.Region,
		Country:    req.Country,
		Sudo:       req.Sudo,
		QueenWSURL: dial,
		Auth: enroll.Auth{
			Password:   req.Auth.Password,
			PrivateKey: req.Auth.PrivateKey,
		},
	}
	req.Auth.Password = ""
	req.Auth.PrivateKey = ""

	go func(jobID string, er enroll.Request) {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
		defer cancel()
		s.Enroller.Run(ctx, jobID, er)
		er.Auth.Password = ""
		er.Auth.PrivateKey = ""
	}(job.ID, er)

	if j, ok := s.Store.GetJob(job.ID); ok {
		job = j
	}
	writeJSON(w, http.StatusAccepted, job)
}
