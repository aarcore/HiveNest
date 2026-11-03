// Package api exposes the loopback HTTP/WebSocket API for sessiond.
package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"

	"github.com/gorilla/websocket"
	"github.com/hivenest/hivenest/sessiond/internal/auth"
	"github.com/hivenest/hivenest/sessiond/internal/config"
	"github.com/hivenest/hivenest/sessiond/internal/proposal"
	"github.com/hivenest/hivenest/sessiond/internal/risk"
	"github.com/hivenest/hivenest/sessiond/internal/session"
	"github.com/hivenest/hivenest/sessiond/internal/sshx"
	"github.com/hivenest/hivenest/sessiond/internal/store"
	"github.com/hivenest/hivenest/sessiond/internal/tools"
)

// Server wires stores and the session manager to HTTP routes.
type Server struct {
	cfg        config.Config
	hosts      *store.HostStore
	audit      *store.AuditLog
	proposals  *proposal.Store
	sessions   *session.Manager
	knownHosts *sshx.KnownHosts
	upgrader   websocket.Upgrader
}

func New(cfg config.Config, hosts *store.HostStore, audit *store.AuditLog, props *proposal.Store, sessions *session.Manager, kh *sshx.KnownHosts) *Server {
	return &Server{
		cfg: cfg, hosts: hosts, audit: audit, proposals: props, sessions: sessions, knownHosts: kh,
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool {
				// loopback-only server; allow local smoke UI / Tauri webview
				return true
			},
		},
	}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", s.handleHealth)
	mux.HandleFunc("GET /{$}", s.handleSmokeIndex)
	mux.HandleFunc("GET /smoke.js", s.handleSmokeJS)

	api := http.NewServeMux()
	api.HandleFunc("GET /v1/hosts", s.handleListHosts)
	api.HandleFunc("POST /v1/hosts", s.handleCreateHost)
	api.HandleFunc("GET /v1/hosts/{id}", s.handleGetHost)
	api.HandleFunc("PUT /v1/hosts/{id}", s.handleUpdateHost)
	api.HandleFunc("DELETE /v1/hosts/{id}", s.handleDeleteHost)

	api.HandleFunc("GET /v1/sessions", s.handleListSessions)
	api.HandleFunc("POST /v1/sessions", s.handleOpenSession)
	api.HandleFunc("GET /v1/sessions/{id}", s.handleGetSession)
	api.HandleFunc("DELETE /v1/sessions/{id}", s.handleCloseSession)
	api.HandleFunc("POST /v1/sessions/{id}/exec", s.handleExec)
	api.HandleFunc("POST /v1/sessions/{id}/tools", s.handleTool)
	api.HandleFunc("GET /v1/sessions/{id}/ws", s.handlePTYWS)
	api.HandleFunc("POST /v1/sessions/{id}/proposals", s.handleCreateProposal)
	api.HandleFunc("GET /v1/sessions/{id}/proposals", s.handleListProposals)

	api.HandleFunc("POST /v1/proposals/{id}/approve", s.handleApproveProposal)
	api.HandleFunc("POST /v1/proposals/{id}/deny", s.handleDenyProposal)
	api.HandleFunc("GET /v1/proposals/{id}", s.handleGetProposal)

	api.HandleFunc("GET /v1/audit", s.handleAudit)

	api.HandleFunc("GET /v1/known-hosts", s.handleListKnownHosts)
	api.HandleFunc("POST /v1/known-hosts/accept", s.handleAcceptKnownHost)
	api.HandleFunc("DELETE /v1/known-hosts", s.handleDeleteKnownHost)

	mux.Handle("/v1/", auth.Middleware(s.cfg.Token, api))
	return withCORS(mux)
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-HiveNest-Token")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":       true,
		"service":  "hivenest-sessiond",
		"goos":     config.GOOS(),
		"listen":   s.cfg.Listen,
		"data_dir": s.cfg.DataDir,
	})
}

func (s *Server) handleListHosts(w http.ResponseWriter, r *http.Request) {
	list, err := s.hosts.List()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"hosts": list})
}

func (s *Server) handleCreateHost(w http.ResponseWriter, r *http.Request) {
	var in store.HostInput
	if err := readJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	h, err := s.hosts.Create(in)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusCreated, h)
}

func (s *Server) handleGetHost(w http.ResponseWriter, r *http.Request) {
	h, err := s.hosts.Get(r.PathValue("id"))
	if err != nil {
		writeErr(w, http.StatusNotFound, err)
		return
	}
	writeJSON(w, http.StatusOK, h)
}

func (s *Server) handleUpdateHost(w http.ResponseWriter, r *http.Request) {
	var in store.HostInput
	if err := readJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	h, err := s.hosts.Update(r.PathValue("id"), in)
	if err != nil {
		writeErr(w, http.StatusNotFound, err)
		return
	}
	writeJSON(w, http.StatusOK, h)
}

func (s *Server) handleDeleteHost(w http.ResponseWriter, r *http.Request) {
	if err := s.hosts.Delete(r.PathValue("id")); err != nil {
		writeErr(w, http.StatusNotFound, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleListSessions(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"sessions": s.sessions.List()})
}

func (s *Server) handleOpenSession(w http.ResponseWriter, r *http.Request) {
	var body struct {
		HostID         string            `json:"host_id"`
		Password       string            `json:"password"`       // connect-time only; never persisted
		JumpPassword   string            `json:"jump_password"`  // single bastion password; never persisted
		JumpPasswords  map[string]string `json:"jump_passwords"` // per-hop host id or proxy:N; never persisted
		AcceptHostKey  bool              `json:"accept_host_key"`
		ReplaceHostKey bool              `json:"replace_host_key"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	sess, err := s.sessions.Open(body.HostID, session.OpenOptions{
		Password:       body.Password,
		JumpPassword:   body.JumpPassword,
		JumpPasswords:  body.JumpPasswords,
		AcceptHostKey:  body.AcceptHostKey,
		ReplaceHostKey: body.ReplaceHostKey,
	})
	body.Password = ""
	body.JumpPassword = ""
	body.JumpPasswords = nil
	if err != nil {
		if hk := session.AsHostKeyIssue(err); hk != nil {
			writeJSON(w, http.StatusConflict, map[string]any{
				"error":    hk.Error(),
				"code":     hk.Code,
				"host_key": hk,
			})
			return
		}
		var pref *session.PasswordRequiredError
		if errors.As(err, &pref) {
			code := "password_required"
			if pref.Kind == "jump" {
				code = "jump_password_required"
			}
			writeJSON(w, http.StatusBadRequest, map[string]any{
				"error":     pref.Message,
				"code":      code,
				"kind":      pref.Kind,
				"host_id":   pref.HostID,
				"hop_index": pref.HopIndex,
			})
			return
		}
		status := http.StatusBadGateway
		if strings.Contains(err.Error(), "password required") {
			status = http.StatusBadRequest
		}
		writeErr(w, status, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"id": sess.ID, "host_id": sess.HostID, "host_name": sess.HostName,
		"user": sess.User, "remote": sess.Remote, "created_at": sess.CreatedAt, "has_pty": sess.HasPTY,
		"is_local": sess.IsLocal,
	})
}

func (s *Server) handleListKnownHosts(w http.ResponseWriter, r *http.Request) {
	list, err := s.knownHosts.List()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"entries": list})
}

func (s *Server) handleAcceptKnownHost(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Host      string `json:"host"`
		Port      int    `json:"port"`
		PublicKey string `json:"public_key"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	entry, err := s.knownHosts.Accept(body.Host, body.Port, body.PublicKey)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	_ = s.audit.Append(store.AuditEntry{
		Action: "known_hosts.accept", Actor: "user", OK: true,
		Detail: fmt.Sprintf("%s:%d %s", entry.Host, entry.Port, entry.FingerprintSHA256),
	})
	writeJSON(w, http.StatusOK, entry)
}

func (s *Server) handleDeleteKnownHost(w http.ResponseWriter, r *http.Request) {
	host := r.URL.Query().Get("host")
	port := atoiDefault(r.URL.Query().Get("port"), 22)
	if host == "" {
		writeErr(w, http.StatusBadRequest, fmt.Errorf("host query required"))
		return
	}
	if err := s.knownHosts.Delete(host, port); err != nil {
		writeErr(w, http.StatusNotFound, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleGetSession(w http.ResponseWriter, r *http.Request) {
	sess, err := s.sessions.Get(r.PathValue("id"))
	if err != nil {
		writeErr(w, http.StatusNotFound, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"id": sess.ID, "host_id": sess.HostID, "host_name": sess.HostName,
		"user": sess.User, "remote": sess.Remote, "created_at": sess.CreatedAt, "has_pty": sess.HasPTY,
		"is_local": sess.IsLocal,
	})
}

func (s *Server) handleCloseSession(w http.ResponseWriter, r *http.Request) {
	if err := s.sessions.Close(r.PathValue("id")); err != nil {
		writeErr(w, http.StatusNotFound, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleExec(w http.ResponseWriter, r *http.Request) {
	var req session.ExecRequest
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	res, err := s.sessions.Exec(r.PathValue("id"), req)
	var need *session.ApprovalRequiredError
	if errors.As(err, &need) {
		writeJSON(w, http.StatusConflict, map[string]any{
			"error": need.Message, "code": "approval_required", "risk": need.Risk,
		})
		return
	}
	if err != nil && res == nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	status := http.StatusOK
	if err != nil {
		status = http.StatusOK // still return stdout/stderr with exit info
	}
	writeJSON(w, status, res)
}


func (s *Server) handleTool(w http.ResponseWriter, r *http.Request) {
	var req tools.Request
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	res, err := s.sessions.RunTool(r.PathValue("id"), req)
	var need *session.ApprovalRequiredError
	if errors.As(err, &need) {
		display, _ := tools.DisplayCommand(req)
		writeJSON(w, http.StatusConflict, map[string]any{
			"error": need.Message, "code": "approval_required", "risk": need.Risk,
			"tool": req.Tool, "command": display,
		})
		return
	}
	if res == nil && err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	status := http.StatusOK
	if err != nil || (res != nil && !res.OK) {
		// Validation errors → 400; remote failures still return body with ok=false.
		if res == nil {
			writeErr(w, http.StatusBadRequest, err)
			return
		}
		if strings.Contains(res.Error, "required") || strings.Contains(res.Error, "disallowed") ||
			strings.Contains(res.Error, "unknown tool") || strings.Contains(res.Error, "too long") ||
			strings.Contains(res.Error, "must be") || strings.Contains(res.Error, "must not") {
			writeJSON(w, http.StatusBadRequest, res)
			return
		}
	}
	writeJSON(w, status, res)
}

func (s *Server) handlePTYWS(w http.ResponseWriter, r *http.Request) {
	if !auth.Check(r, s.cfg.Token) {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}
	id := r.PathValue("id")
	cols := atoiDefault(r.URL.Query().Get("cols"), 80)
	rows := atoiDefault(r.URL.Query().Get("rows"), 24)
	ws, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("ws upgrade: %v", err)
		return
	}
	defer ws.Close()
	if err := s.sessions.AttachPTY(id, ws, cols, rows); err != nil {
		_ = ws.WriteMessage(websocket.TextMessage, []byte(`{"type":"error","message":`+jsonString(err.Error())+`}`))
	}
}

func (s *Server) handleCreateProposal(w http.ResponseWriter, r *http.Request) {
	sid := r.PathValue("id")
	sess, err := s.sessions.Get(sid)
	if err != nil {
		writeErr(w, http.StatusNotFound, err)
		return
	}
	var body struct {
		Command string `json:"command"`
		Reason  string `json:"reason"`
		Risk    string `json:"risk"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	var level risk.Level
	switch body.Risk {
	case "low", "medium", "high":
		level = risk.Level(body.Risk)
	}
	p, err := s.proposals.Create(proposal.CreateInput{
		SessionID: sid, HostID: sess.HostID, Command: body.Command, Reason: body.Reason, Risk: level,
	})
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	_ = s.audit.Append(store.AuditEntry{
		Action: "proposal.create", HostID: sess.HostID, SessionID: sid, Actor: "agent",
		Command: p.Command, Risk: string(p.Risk), OK: true, Detail: p.ID,
	})
	writeJSON(w, http.StatusCreated, p)
}

func (s *Server) handleListProposals(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"proposals": s.proposals.ListBySession(r.PathValue("id"))})
}

func (s *Server) handleGetProposal(w http.ResponseWriter, r *http.Request) {
	p, err := s.proposals.Get(r.PathValue("id"))
	if err != nil {
		writeErr(w, http.StatusNotFound, err)
		return
	}
	writeJSON(w, http.StatusOK, p)
}

func (s *Server) handleApproveProposal(w http.ResponseWriter, r *http.Request) {
	p, err := s.proposals.Approve(r.PathValue("id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	_ = s.audit.Append(store.AuditEntry{
		Action: "proposal.approve", HostID: p.HostID, SessionID: p.SessionID, Actor: "user",
		Command: p.Command, Risk: string(p.Risk), OK: true, Detail: p.ID,
	})
	writeJSON(w, http.StatusOK, p)
}

func (s *Server) handleDenyProposal(w http.ResponseWriter, r *http.Request) {
	p, err := s.proposals.Deny(r.PathValue("id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	_ = s.audit.Append(store.AuditEntry{
		Action: "proposal.deny", HostID: p.HostID, SessionID: p.SessionID, Actor: "user",
		Command: p.Command, Risk: string(p.Risk), OK: true, Detail: p.ID,
	})
	writeJSON(w, http.StatusOK, p)
}

func (s *Server) handleAudit(w http.ResponseWriter, r *http.Request) {
	list, err := s.audit.ListRecent(atoiDefault(r.URL.Query().Get("limit"), 100))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"entries": list})
}

func readJSON(r *http.Request, dst any) error {
	defer r.Body.Close()
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		return fmt.Errorf("invalid JSON: %w", err)
	}
	return nil
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, err error) {
	writeJSON(w, status, map[string]string{"error": err.Error()})
}

func atoiDefault(s string, def int) int {
	if s == "" {
		return def
	}
	var n int
	if _, err := fmt.Sscanf(s, "%d", &n); err != nil || n <= 0 {
		return def
	}
	return n
}

func jsonString(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}
