package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"runtime"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/hivenest/hivenest/protocol"
	"github.com/hivenest/hivenest/worker/internal/config"
	"github.com/hivenest/hivenest/worker/internal/modules"
)

// Agent dials out to Queen, heartbeats, runs allowlisted jobs, and forwards alerts.
type Agent struct {
	cfg     config.Config
	version string

	mu     sync.Mutex
	sendCh chan protocol.Envelope // set while session active
}

func New(cfg config.Config, version string) *Agent {
	return &Agent{cfg: cfg, version: version}
}

// EnqueueAlert queues a guard/alert message for the active WS session.
func (a *Agent) EnqueueAlert(kind, severity string, payload json.RawMessage) {
	env := protocol.Envelope{
		Type:     protocol.TypeAlert,
		AlertID:  uuid.NewString(),
		WorkerID: a.cfg.NodeID,
		Kind:     kind,
		Severity: severity,
		Payload:  payload,
		TS:       time.Now().Unix(),
	}
	a.mu.Lock()
	ch := a.sendCh
	a.mu.Unlock()
	if ch == nil {
		return
	}
	select {
	case ch <- env:
	default:
		log.Printf("worker: alert queue full; dropping %s", kind)
	}
}

func (a *Agent) DialLoop(ctx context.Context) error {
	backoff := time.Second
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		err := a.session(ctx)
		a.mu.Lock()
		a.sendCh = nil
		a.mu.Unlock()
		if ctx.Err() != nil {
			return ctx.Err()
		}
		log.Printf("worker: disconnected (%v); retry in %s", err, backoff)
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(backoff):
			if backoff < 30*time.Second {
				backoff *= 2
			}
		}
	}
}

func (a *Agent) session(ctx context.Context) error {
	if a.cfg.BootstrapToken == "" {
		return fmt.Errorf("HIVENEST_BOOTSTRAP_TOKEN is required")
	}

	dialer := websocket.Dialer{HandshakeTimeout: 10 * time.Second}
	header := http.Header{}
	header.Set("User-Agent", "HiveNest-Worker/"+a.version)
	header.Set("X-HiveNest-Token", a.cfg.BootstrapToken)

	log.Printf("worker: dialing %s", a.cfg.QueenURL)
	ws, resp, err := dialer.DialContext(ctx, a.cfg.QueenURL, header)
	if err != nil {
		if resp != nil {
			return fmt.Errorf("dial: %w (http %s)", err, resp.Status)
		}
		return err
	}
	defer ws.Close()

	out := make(chan protocol.Envelope, 32)
	a.mu.Lock()
	a.sendCh = out
	a.mu.Unlock()

	host, _ := os.Hostname()
	hello := protocol.Envelope{
		Type:     protocol.TypeHello,
		WorkerID: a.cfg.NodeID,
		Hostname: host,
		Version:  a.version,
		Region:   a.cfg.Region,
		Country:  a.cfg.Country,
		OS:       runtime.GOOS,
		Arch:     runtime.GOARCH,
		Token:    a.cfg.BootstrapToken,
		TS:       time.Now().Unix(),
	}
	if err := writeJSON(ws, hello); err != nil {
		return err
	}

	_ = ws.SetReadDeadline(time.Now().Add(15 * time.Second))
	_, data, err := ws.ReadMessage()
	if err != nil {
		return fmt.Errorf("hello ack: %w", err)
	}
	var ack protocol.Envelope
	if err := json.Unmarshal(data, &ack); err != nil {
		return err
	}
	if ack.Type == protocol.TypeError {
		return fmt.Errorf("queen rejected hello: %s", ack.Message)
	}
	if ack.Type != protocol.TypeHelloAck {
		log.Printf("worker: expected hello_ack, got %s", ack.Type)
	} else {
		log.Printf("worker: registered with queen as %s", a.cfg.NodeID)
	}
	_ = ws.SetReadDeadline(time.Time{})

	errCh := make(chan error, 3)

	go func() {
		t := time.NewTicker(20 * time.Second)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				errCh <- ctx.Err()
				return
			case env := <-out:
				if err := writeJSON(ws, env); err != nil {
					errCh <- err
					return
				}
			case <-t.C:
				hb := protocol.Envelope{
					Type:     protocol.TypeHeartbeat,
					WorkerID: a.cfg.NodeID,
					TS:       time.Now().Unix(),
				}
				if err := writeJSON(ws, hb); err != nil {
					errCh <- err
					return
				}
			}
		}
	}()

	go func() {
		for {
			_, data, err := ws.ReadMessage()
			if err != nil {
				errCh <- err
				return
			}
			var env protocol.Envelope
			if err := json.Unmarshal(data, &env); err != nil {
				log.Printf("worker: bad message: %v", err)
				continue
			}
			switch env.Type {
			case protocol.TypeJob:
				a.handleJob(ws, env)
			case protocol.TypeHelloAck:
			case protocol.TypeError:
				log.Printf("worker: queen error: %s", env.Message)
			default:
				log.Printf("worker: ignore type %q", env.Type)
			}
		}
	}()

	select {
	case <-ctx.Done():
		_ = ws.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""))
		return ctx.Err()
	case err := <-errCh:
		return err
	}
}

func (a *Agent) handleJob(_ *websocket.Conn, env protocol.Envelope) {
	log.Printf("worker: job %s module=%s", env.JobID, env.Module)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	res := modules.Run(ctx, env.Module, env.Params)
	out := protocol.Envelope{
		Type:       protocol.TypeJobResult,
		JobID:      env.JobID,
		WorkerID:   a.cfg.NodeID,
		Module:     env.Module,
		OK:         res.OK,
		Output:     res.Output,
		Error:      res.Error,
		FinishedAt: time.Now().UTC().Format(time.RFC3339Nano),
	}
	a.mu.Lock()
	ch := a.sendCh
	a.mu.Unlock()
	if ch == nil {
		log.Printf("worker: no send channel for job result")
		return
	}
	select {
	case ch <- out:
	case <-time.After(5 * time.Second):
		log.Printf("worker: timeout queueing job result")
	}
}

func writeJSON(ws *websocket.Conn, v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	_ = ws.SetWriteDeadline(time.Now().Add(10 * time.Second))
	return ws.WriteMessage(websocket.TextMessage, b)
}
