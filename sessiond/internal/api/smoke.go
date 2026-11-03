package api

import (
	"embed"
	"io/fs"
	"net/http"
)

//go:embed static/*
var smokeFS embed.FS

func (s *Server) handleSmokeIndex(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}
	b, err := smokeFS.ReadFile("static/smoke.html")
	if err != nil {
		http.Error(w, "smoke ui missing", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write(b)
}

func (s *Server) handleSmokeJS(w http.ResponseWriter, r *http.Request) {
	b, err := smokeFS.ReadFile("static/smoke.js")
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
	_, _ = w.Write(b)
}

// Ensure embed fs.FS satisfies unused import if needed.
var _ fs.FS = smokeFS
