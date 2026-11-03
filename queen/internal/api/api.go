package api

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/hivenest/hivenest/protocol"
	"github.com/hivenest/hivenest/queen/internal/config"
	"github.com/hivenest/hivenest/queen/internal/endpoints"
	"github.com/hivenest/hivenest/queen/internal/enroll"
	"github.com/hivenest/hivenest/queen/internal/hub"
	"github.com/hivenest/hivenest/queen/internal/store"
	"github.com/hivenest/hivenest/queen/internal/tunnel"
)

// Server wires HTTP/WS routes for Queen.
type Server struct {
	Version            string
	Store              store.Store
	Hub                *hub.Hub
	UI                 http.Handler
	BootstrapTokenHint string // shown in UI for local demo (same as configured token)
	PublicURL          string // configured fallback; prefer Endpoints when set
	WorkerDialURL      string // configured fallback; prefer Endpoints when set
	InstallDir         string
	ArtifactDir        string
	Enroller           *enroll.Enroller
	Endpoints          *endpoints.Resolver
	Tunnel             *tunnel.Manager
}

func (s *Server) Register(mux *http.ServeMux) {
	mux.HandleFunc("/healthz", s.handleHealthz)
	mux.HandleFunc("/v1/workers", s.handleWorkers)
	mux.HandleFunc("/v1/jobs", s.handleJobs)
	mux.HandleFunc("/v1/jobs/", s.handleJobByID)
	mux.HandleFunc("/v1/alerts", s.handleAlerts)
	mux.HandleFunc("/v1/meta", s.handleMeta)
	mux.HandleFunc("/v1/bootstrap/command", s.handleBootstrapCommand)
	mux.HandleFunc("/v1/enroll/ssh", s.handleEnrollSSH)
	mux.HandleFunc("/v1/tunnel", s.handleTunnel)
	mux.HandleFunc("/v1/worker/ws", s.Hub.ServeWS)
	mux.HandleFunc("/agent/ws", s.Hub.ServeWS)

	if d := strings.TrimSpace(s.InstallDir); d != "" {
		mux.Handle("/install/", http.StripPrefix("/install/", http.FileServer(http.Dir(d))))
	}
	if d := strings.TrimSpace(s.ArtifactDir); d != "" {
		mux.Handle("/releases/", http.StripPrefix("/releases/", http.FileServer(http.Dir(d))))
	}

	if s.UI != nil {
		mux.Handle("/", s.UI)
	} else {
		mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path != "/" {
				http.NotFound(w, r)
				return
			}
			http.Redirect(w, r, "/healthz", http.StatusFound)
		})
	}
}

func (s *Server) handleHealthz(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"status":         "ok",
		"service":        "hivenest-queen",
		"version":        s.Version,
		"workers_online": s.Hub.OnlineCount(),
	})
}

func (s *Server) handleMeta(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	modules := make([]string, 0, len(protocol.AllowedModules))
	for m := range protocol.AllowedModules {
		modules = append(modules, m)
	}
	public := s.PublicURL
	dial := s.WorkerDialURL
	payload := map[string]any{
		"version":              s.Version,
		"bootstrap_token_hint": s.BootstrapTokenHint,
		"bootstrap_token_env":  "HIVENEST_BOOTSTRAP_TOKEN",
		"public_url":           public,
		"worker_dial_url":      dial,
		"callback_url":         dial,
		"worker_dial_loopback": config.IsLoopbackDialURL(dial) || isLoopbackDial(dial),
		"allowed_modules":      modules,
		"worker_ws":            "/v1/worker/ws",
		"bootstrap_command":    "/v1/bootstrap/command",
		"enroll_ssh":           "/v1/enroll/ssh",
		"tunnel_api":           "/v1/tunnel",
		"note":                 "Local demo uses shared bootstrap token; production should rotate and prefer mTLS. Callback URL auto-picks LAN/advertise/tunnel when PUBLIC_URL is loopback. Optional demo tunnel: POST /v1/tunnel {enabled:true} (needs cloudflared). Never use 127.0.0.1 for remote workers.",
	}
	if s.Endpoints != nil {
		snap := s.Endpoints.Snapshot()
		payload["configured_public_url"] = snap.ConfiguredPublicURL
		payload["configured_dial_url"] = snap.ConfiguredDialURL
		payload["public_url"] = snap.PublicURL
		payload["worker_dial_url"] = snap.WorkerDialURL
		payload["callback_url"] = snap.CallbackURL
		payload["worker_dial_loopback"] = snap.WorkerDialLoopback
		payload["dial_source"] = snap.DialSource
		payload["lan_candidates"] = snap.LANCandidates
		payload["suggested_public_url"] = snap.SuggestedPublicURL
		payload["suggested_dial_url"] = snap.SuggestedDialURL
		payload["advertise_host"] = snap.AdvertiseHost
		payload["tunnel"] = snap.Tunnel
	} else if s.Tunnel != nil {
		payload["tunnel"] = s.Tunnel.Status()
	}
	writeJSON(w, http.StatusOK, payload)
}

func (s *Server) handleWorkers(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"workers": s.Store.ListWorkers()})
}

func (s *Server) handleAlerts(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	limit := 30
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			limit = n
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"alerts": s.Store.ListAlerts(limit)})
}

type createJobRequest struct {
	WorkerID string          `json:"worker_id"`
	Module   string          `json:"module"`
	Params   json.RawMessage `json:"params"`
}

func (s *Server) handleJobs(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		limit := 50
		if v := r.URL.Query().Get("limit"); v != "" {
			if n, err := strconv.Atoi(v); err == nil && n > 0 {
				limit = n
			}
		}
		writeJSON(w, http.StatusOK, map[string]any{"jobs": s.Store.ListJobs(limit)})
	case http.MethodPost:
		s.createJob(w, r)
	default:
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) createJob(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "read body")
		return
	}
	var req createJobRequest
	if err := json.Unmarshal(body, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	req.WorkerID = strings.TrimSpace(req.WorkerID)
	req.Module = strings.TrimSpace(req.Module)
	if req.WorkerID == "" || req.Module == "" {
		writeErr(w, http.StatusBadRequest, "worker_id and module required")
		return
	}
	if !protocol.IsAllowedModule(req.Module) {
		writeErr(w, http.StatusBadRequest, "module not allowlisted")
		return
	}
	if !s.Hub.IsOnline(req.WorkerID) {
		writeErr(w, http.StatusConflict, "worker offline")
		return
	}

	job := s.Store.CreateJob(store.Job{
		ID:       uuid.NewString(),
		WorkerID: req.WorkerID,
		Module:   req.Module,
		Params:   req.Params,
	})
	if err := s.Hub.SendJob(job.WorkerID, job.ID, job.Module, job.Params); err != nil {
		if errors.Is(err, hub.ErrWorkerOffline) {
			writeErr(w, http.StatusConflict, "worker offline")
			return
		}
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	if j, ok := s.Store.GetJob(job.ID); ok {
		job = j
	}
	writeJSON(w, http.StatusAccepted, job)
}

func (s *Server) handleJobByID(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	id := strings.TrimPrefix(r.URL.Path, "/v1/jobs/")
	id = strings.Trim(id, "/")
	if id == "" {
		writeErr(w, http.StatusBadRequest, "job id required")
		return
	}
	j, ok := s.Store.GetJob(id)
	if !ok {
		writeErr(w, http.StatusNotFound, "job not found")
		return
	}
	writeJSON(w, http.StatusOK, j)
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

func isLoopbackDial(u string) bool {
	return strings.Contains(strings.ToLower(u), "://127.0.0.1") ||
		strings.Contains(strings.ToLower(u), "://localhost") ||
		strings.Contains(strings.ToLower(u), "://[::1]")
}


func (s *Server) effectivePublicURL() string {
	if s.Endpoints != nil {
		return s.Endpoints.PublicURL()
	}
	return s.PublicURL
}

func (s *Server) effectiveWorkerDialURL() string {
	if s.Endpoints != nil {
		return s.Endpoints.WorkerDialURL()
	}
	return s.WorkerDialURL
}
