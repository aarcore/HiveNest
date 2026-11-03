package hub

import (
	"crypto/subtle"
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/hivenest/hivenest/protocol"
	"github.com/hivenest/hivenest/queen/internal/store"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  4096,
	WriteBufferSize: 4096,
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

type conn struct {
	workerID string
	ws       *websocket.Conn
	send     chan []byte
}

// Hub tracks live Worker WebSocket sessions and pushes jobs.
type Hub struct {
	store          store.Store
	bootstrapToken string

	mu    sync.RWMutex
	conns map[string]*conn
}

func New(st store.Store, bootstrapToken string) *Hub {
	return &Hub{
		store:          st,
		bootstrapToken: bootstrapToken,
		conns:          make(map[string]*conn),
	}
}

func (h *Hub) OnlineCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.conns)
}

func (h *Hub) IsOnline(workerID string) bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	_, ok := h.conns[workerID]
	return ok
}

func (h *Hub) SendJob(workerID, jobID, module string, params json.RawMessage) error {
	h.mu.RLock()
	c, ok := h.conns[workerID]
	h.mu.RUnlock()
	if !ok {
		return ErrWorkerOffline
	}
	env := protocol.Envelope{
		Type:     protocol.TypeJob,
		JobID:    jobID,
		Module:   module,
		Params:   params,
		WorkerID: workerID,
	}
	b, err := json.Marshal(env)
	if err != nil {
		return err
	}
	select {
	case c.send <- b:
		h.store.MarkJobDispatched(jobID)
		return nil
	case <-time.After(5 * time.Second):
		return ErrSendTimeout
	}
}

var (
	ErrWorkerOffline = errString("worker offline")
	ErrSendTimeout   = errString("send timeout")
)

type errString string

func (e errString) Error() string { return string(e) }

func extractToken(r *http.Request) string {
	if t := strings.TrimSpace(r.Header.Get("X-HiveNest-Token")); t != "" {
		return t
	}
	if auth := r.Header.Get("Authorization"); strings.HasPrefix(strings.ToLower(auth), "bearer ") {
		return strings.TrimSpace(auth[7:])
	}
	return strings.TrimSpace(r.URL.Query().Get("token"))
}

func (h *Hub) tokenOK(got string) bool {
	want := h.bootstrapToken
	if want == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(got), []byte(want)) == 1
}

// ServeWS upgrades the HTTP request to a Worker WebSocket session.
func (h *Hub) ServeWS(w http.ResponseWriter, r *http.Request) {
	if h.bootstrapToken == "" {
		http.Error(w, "queen bootstrap token not configured (set HIVENEST_BOOTSTRAP_TOKEN)", http.StatusServiceUnavailable)
		return
	}
	// Early reject when client already sent a wrong token at upgrade time.
	if early := extractToken(r); early != "" && !h.tokenOK(early) {
		http.Error(w, "invalid bootstrap token", http.StatusUnauthorized)
		return
	}

	ws, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("hub: upgrade: %v", err)
		return
	}
	c := &conn{
		ws:   ws,
		send: make(chan []byte, 64),
	}
	go h.writePump(c)
	h.readPump(c, extractToken(r))
}

func (h *Hub) register(c *conn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if old, ok := h.conns[c.workerID]; ok && old != c {
		close(old.send)
		_ = old.ws.Close()
	}
	h.conns[c.workerID] = c
}

func (h *Hub) unregister(c *conn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	cur, ok := h.conns[c.workerID]
	if !ok || cur != c {
		return
	}
	delete(h.conns, c.workerID)
	close(c.send)
	h.store.MarkWorkerOffline(c.workerID)
	log.Printf("hub: worker %s offline", c.workerID)
}

func (h *Hub) writePump(c *conn) {
	ticker := time.NewTicker(30 * time.Second)
	defer func() {
		ticker.Stop()
		_ = c.ws.Close()
	}()
	for {
		select {
		case msg, ok := <-c.send:
			_ = c.ws.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				_ = c.ws.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.ws.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		case <-ticker.C:
			_ = c.ws.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.ws.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

func (h *Hub) readPump(c *conn, upgradeToken string) {
	defer func() {
		if c.workerID != "" {
			h.unregister(c)
		} else {
			_ = c.ws.Close()
		}
	}()
	c.ws.SetReadLimit(1 << 20)
	_ = c.ws.SetReadDeadline(time.Now().Add(90 * time.Second))
	c.ws.SetPongHandler(func(string) error {
		_ = c.ws.SetReadDeadline(time.Now().Add(90 * time.Second))
		return nil
	})

	authed := false
	for {
		_, data, err := c.ws.ReadMessage()
		if err != nil {
			return
		}
		_ = c.ws.SetReadDeadline(time.Now().Add(90 * time.Second))

		var env protocol.Envelope
		if err := json.Unmarshal(data, &env); err != nil {
			log.Printf("hub: bad json: %v", err)
			continue
		}
		if !authed {
			if env.Type != protocol.TypeHello {
				h.reply(c, protocol.Envelope{Type: protocol.TypeError, Message: "hello required first"})
				return
			}
			tok := env.Token
			if tok == "" {
				tok = upgradeToken
			}
			if !h.tokenOK(tok) {
				h.reply(c, protocol.Envelope{Type: protocol.TypeError, Message: "invalid or missing bootstrap token"})
				time.Sleep(50 * time.Millisecond)
				return
			}
			authed = true
		}
		h.handle(c, env, c.ws.RemoteAddr().String())
	}
}

func (h *Hub) handle(c *conn, env protocol.Envelope, remote string) {
	switch env.Type {
	case protocol.TypeHello:
		if env.WorkerID == "" {
			h.reply(c, protocol.Envelope{Type: protocol.TypeError, Message: "worker_id required"})
			return
		}
		c.workerID = env.WorkerID
		h.register(c)
		h.store.UpsertOnlineWorker(store.Worker{
			ID:         env.WorkerID,
			Hostname:   env.Hostname,
			Version:    env.Version,
			Region:     env.Region,
			Country:    env.Country,
			OS:         env.OS,
			Arch:       env.Arch,
			RemoteAddr: remote,
		})
		log.Printf("hub: worker %s online (%s %s/%s)", env.WorkerID, env.Hostname, env.OS, env.Arch)
		h.reply(c, protocol.Envelope{Type: protocol.TypeHelloAck, WorkerID: env.WorkerID, Message: "welcome"})

	case protocol.TypeHeartbeat:
		if c.workerID == "" {
			return
		}
		h.store.TouchWorker(c.workerID)

	case protocol.TypeJobResult:
		if env.JobID == "" {
			return
		}
		finished := time.Now().UTC()
		if env.FinishedAt != "" {
			if t, err := time.Parse(time.RFC3339Nano, env.FinishedAt); err == nil {
				finished = t
			}
		}
		if _, ok := h.store.CompleteJob(env.JobID, env.OK, env.Output, env.Error, finished); ok {
			log.Printf("hub: job %s result ok=%v module=%s", env.JobID, env.OK, env.Module)
		} else {
			log.Printf("hub: job result for unknown id %s", env.JobID)
		}

	case protocol.TypeAlert:
		if c.workerID == "" {
			return
		}
		payload := env.Payload
		if len(payload) == 0 {
			payload = env.Output
		}
		id := env.AlertID
		if id == "" {
			id = uuid.NewString()
		}
		kind := env.Kind
		if kind == "" {
			kind = "guard.snapshot"
		}
		sev := env.Severity
		if sev == "" {
			sev = "info"
		}
		a := h.store.AddAlert(store.Alert{
			ID:       id,
			WorkerID: c.workerID,
			Kind:     kind,
			Severity: sev,
			Payload:  payload,
		})
		log.Printf("hub: alert %s kind=%s worker=%s", a.ID, a.Kind, a.WorkerID)

	default:
		log.Printf("hub: ignore type %q from %s", env.Type, c.workerID)
	}
}

func (h *Hub) reply(c *conn, env protocol.Envelope) {
	b, err := json.Marshal(env)
	if err != nil {
		return
	}
	select {
	case c.send <- b:
	default:
		log.Printf("hub: send buffer full for %s", c.workerID)
	}
}
