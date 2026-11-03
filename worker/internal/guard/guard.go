package guard

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"os"
	"runtime"
	"strconv"
	"strings"
	"time"
)

// Config for Worker security-guard loops.
type Config struct {
	Enabled     bool `json:"enabled"`
	IntervalSec int  `json:"interval_sec"`
	ReportOnly  bool `json:"report_only"`
}

func DefaultConfig() Config {
	return Config{
		Enabled:     true,
		IntervalSec: 60, // demo-friendly; override via HIVENEST_GUARD_INTERVAL_SEC
		ReportOnly:  true,
	}
}

func (c Config) Interval() time.Duration {
	if c.IntervalSec <= 0 {
		return time.Minute
	}
	return time.Duration(c.IntervalSec) * time.Second
}

// Reporter pushes structured alerts to Queen (via Agent).
type Reporter func(kind, severity string, payload json.RawMessage)

// Guard runs local security baseline checks and reports to Queen.
type Guard struct {
	cfg    Config
	report Reporter
}

func New(cfg Config, report Reporter) *Guard {
	return &Guard{cfg: cfg, report: report}
}

func (g *Guard) Run(ctx context.Context) {
	if !g.cfg.Enabled {
		log.Printf("guard: disabled")
		return
	}
	interval := g.cfg.Interval()
	log.Printf("guard: security-guard running (report_only=%v interval=%s)", g.cfg.ReportOnly, interval)
	// Brief delay so Agent can finish hello before first alert push.
	select {
	case <-ctx.Done():
		return
	case <-time.After(3 * time.Second):
		g.tickOnce(ctx)
	}
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			g.tickOnce(ctx)
		}
	}
}

func (g *Guard) tickOnce(ctx context.Context) {
	snap, err := Snapshot(ctx)
	if err != nil {
		log.Printf("guard: snapshot error: %v", err)
		return
	}
	ports, _ := snap["listening_ports"].([]map[string]any)
	log.Printf("guard: baseline tick hostname=%v listening_ports=%d", snap["hostname"], len(ports))
	if g.report == nil {
		return
	}
	b, err := json.Marshal(snap)
	if err != nil {
		return
	}
	g.report("guard.snapshot", "info", b)
}

// Snapshot collects a portable security-oriented host snapshot.
func Snapshot(ctx context.Context) (map[string]any, error) {
	_ = ctx
	host, _ := os.Hostname()
	ports, portNote := listeningPorts()
	return map[string]any{
		"hostname":        host,
		"os":              runtime.GOOS,
		"arch":            runtime.GOARCH,
		"uptime_sec":      UptimeSeconds(),
		"listening_ports": ports,
		"ports_note":      portNote,
		"fim": map[string]any{
			"status":  "stub",
			"watched": []string{},
			"note":    "FIM baseline not enabled in MVP; candidate for Rust rewrite",
		},
		"collected_at": time.Now().UTC().Format(time.RFC3339Nano),
	}, nil
}

func UptimeSeconds() float64 {
	if runtime.GOOS != "linux" {
		return 0
	}
	b, err := os.ReadFile("/proc/uptime")
	if err != nil {
		return 0
	}
	fields := strings.Fields(string(b))
	if len(fields) < 1 {
		return 0
	}
	v, err := strconv.ParseFloat(fields[0], 64)
	if err != nil {
		return 0
	}
	return v
}

func listeningPorts() ([]map[string]any, string) {
	if runtime.GOOS == "linux" {
		ports, err := listenPortsFromProc()
		if err != nil {
			return nil, "proc read failed: " + err.Error()
		}
		return ports, "from /proc/net/tcp{,6}"
	}
	return []map[string]any{}, "listening port enumeration best-effort on " + runtime.GOOS + " (full support on Linux)"
}

func listenPortsFromProc() ([]map[string]any, error) {
	seen := map[string]struct{}{}
	var out []map[string]any
	for _, path := range []string{"/proc/net/tcp", "/proc/net/tcp6"} {
		f, err := os.Open(path)
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return nil, err
		}
		sc := bufio.NewScanner(f)
		first := true
		for sc.Scan() {
			line := sc.Text()
			if first {
				first = false
				continue
			}
			fields := strings.Fields(line)
			if len(fields) < 4 {
				continue
			}
			if fields[3] != "0A" {
				continue
			}
			port, err := parseProcPort(fields[1])
			if err != nil {
				continue
			}
			key := fmt.Sprintf("%d", port)
			if _, ok := seen[key]; ok {
				continue
			}
			seen[key] = struct{}{}
			out = append(out, map[string]any{
				"port":     port,
				"protocol": "tcp",
				"state":    "LISTEN",
			})
		}
		_ = f.Close()
		if err := sc.Err(); err != nil {
			return out, err
		}
	}
	_ = net.IPv4zero
	return out, nil
}

func parseProcPort(local string) (int, error) {
	parts := strings.Split(local, ":")
	if len(parts) != 2 {
		return 0, fmt.Errorf("bad local %q", local)
	}
	v, err := strconv.ParseUint(parts[1], 16, 16)
	if err != nil {
		return 0, err
	}
	return int(v), nil
}
