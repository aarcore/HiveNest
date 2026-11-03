package api

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"time"
)

type tunnelToggleRequest struct {
	Enabled *bool `json:"enabled"`
}

func (s *Server) handleTunnel(w http.ResponseWriter, r *http.Request) {
	if s.Tunnel == nil {
		writeErr(w, http.StatusServiceUnavailable, "tunnel manager not configured")
		return
	}
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, http.StatusOK, map[string]any{
			"tunnel":   s.Tunnel.Status(),
			"endpoint": s.snapshotURLs(),
		})
	case http.MethodPost:
		body, err := io.ReadAll(io.LimitReader(r.Body, 1<<16))
		if err != nil {
			writeErr(w, http.StatusBadRequest, "read body")
			return
		}
		var req tunnelToggleRequest
		if err := json.Unmarshal(body, &req); err != nil || req.Enabled == nil {
			writeErr(w, http.StatusBadRequest, "json body required: {\"enabled\": true|false}")
			return
		}
		if *req.Enabled {
			ctx, cancel := context.WithTimeout(r.Context(), 50*time.Second)
			defer cancel()
			st, err := s.Tunnel.Start(ctx)
			if err != nil && st.PublicURL == "" {
				writeJSON(w, http.StatusBadGateway, map[string]any{
					"error":    err.Error(),
					"tunnel":   st,
					"endpoint": s.snapshotURLs(),
				})
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{
				"tunnel":   st,
				"endpoint": s.snapshotURLs(),
				"note":     "隧道已请求开启；回调地址将使用公网 URL（若已拿到）。",
			})
			return
		}
		st, _ := s.Tunnel.Stop()
		writeJSON(w, http.StatusOK, map[string]any{
			"tunnel":   st,
			"endpoint": s.snapshotURLs(),
			"note":     "隧道已关闭；恢复配置/局域网回调地址。",
		})
	default:
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) snapshotURLs() map[string]any {
	if s.Endpoints != nil {
		snap := s.Endpoints.Snapshot()
		return map[string]any{
			"public_url":           snap.PublicURL,
			"callback_url":         snap.CallbackURL,
			"worker_dial_url":      snap.WorkerDialURL,
			"worker_dial_loopback": snap.WorkerDialLoopback,
			"dial_source":          snap.DialSource,
			"lan_candidates":       snap.LANCandidates,
			"suggested_public_url": snap.SuggestedPublicURL,
			"suggested_dial_url":   snap.SuggestedDialURL,
		}
	}
	return map[string]any{
		"public_url":      s.PublicURL,
		"worker_dial_url": s.WorkerDialURL,
		"callback_url":    s.WorkerDialURL,
	}
}
