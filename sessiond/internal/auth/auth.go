// Package auth validates the local sessiond bearer token on HTTP/WS.
package auth

import (
	"crypto/subtle"
	"net/http"
	"strings"
)

const Header = "X-HiveNest-Token"
const QueryParam = "token"

// Middleware rejects requests that do not present the expected token.
func Middleware(token string, next http.Handler) http.Handler {
	want := []byte(token)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got := extract(r)
		if subtle.ConstantTimeCompare([]byte(got), want) != 1 {
			http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func extract(r *http.Request) string {
	if h := r.Header.Get(Header); h != "" {
		return strings.TrimSpace(h)
	}
	if a := r.Header.Get("Authorization"); strings.HasPrefix(strings.ToLower(a), "bearer ") {
		return strings.TrimSpace(a[7:])
	}
	if q := r.URL.Query().Get(QueryParam); q != "" {
		return strings.TrimSpace(q)
	}
	return ""
}

// Check returns true if the request carries a valid token (for WS upgrade).
func Check(r *http.Request, token string) bool {
	got := extract(r)
	return subtle.ConstantTimeCompare([]byte(got), []byte(token)) == 1
}
