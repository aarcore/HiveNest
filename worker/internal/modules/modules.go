package modules

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"runtime"
	"strings"
	"time"

	"github.com/hivenest/hivenest/protocol"
	"github.com/hivenest/hivenest/worker/internal/guard"
	"golang.org/x/sys/unix"
)

// Result is the structured module output returned to Queen.
type Result struct {
	OK     bool
	Output json.RawMessage
	Error  string
}

// Run executes an allowlisted module. Arbitrary shell is never invoked.
func Run(ctx context.Context, module string, params json.RawMessage) Result {
	if !protocol.IsAllowedModule(module) {
		return fail(fmt.Sprintf("module not allowlisted: %s", module))
	}
	switch module {
	case "echo":
		return runEcho(params)
	case "host.uname":
		return runUname()
	case "host.info":
		return runInfo(ctx)
	case "host.disk":
		return runDisk(ctx)
	case "pkg.list":
		return runPkgList(ctx)
	case "guard.snapshot":
		return runGuardSnapshot(ctx)
	default:
		return fail(fmt.Sprintf("unimplemented module: %s", module))
	}
}

func runEcho(params json.RawMessage) Result {
	var body map[string]any
	if len(params) > 0 && string(params) != "null" {
		if err := json.Unmarshal(params, &body); err != nil {
			return fail("invalid params: " + err.Error())
		}
	} else {
		body = map[string]any{"message": "pong"}
	}
	body["echoed_at"] = time.Now().UTC().Format(time.RFC3339Nano)
	return ok(body)
}

func runUname() Result {
	host, _ := os.Hostname()
	return ok(map[string]any{
		"hostname": host,
		"os":       runtime.GOOS,
		"arch":     runtime.GOARCH,
		"num_cpu":  runtime.NumCPU(),
		"go":       runtime.Version(),
	})
}

func runInfo(ctx context.Context) Result {
	_ = ctx
	host, _ := os.Hostname()
	uptime := guard.UptimeSeconds()
	var mem runtime.MemStats
	runtime.ReadMemStats(&mem)
	return ok(map[string]any{
		"hostname":     host,
		"os":           runtime.GOOS,
		"arch":         runtime.GOARCH,
		"num_cpu":      runtime.NumCPU(),
		"uptime_sec":   uptime,
		"goroutines":   runtime.NumGoroutine(),
		"heap_alloc":   mem.HeapAlloc,
		"worker_pid":   os.Getpid(),
		"collected_at": time.Now().UTC().Format(time.RFC3339Nano),
	})
}

func runDisk(ctx context.Context) Result {
	_ = ctx
	paths := diskPaths()
	var mounts []map[string]any
	for _, p := range paths {
		var st unix.Statfs_t
		if err := unix.Statfs(p, &st); err != nil {
			mounts = append(mounts, map[string]any{"path": p, "error": err.Error()})
			continue
		}
		bs := uint64(st.Bsize)
		total := bs * st.Blocks
		free := bs * st.Bfree
		avail := bs * st.Bavail
		used := total - free
		var usedPct float64
		if total > 0 {
			usedPct = float64(used) / float64(total) * 100
		}
		mounts = append(mounts, map[string]any{
			"path":        p,
			"total_bytes": total,
			"free_bytes":  free,
			"avail_bytes": avail,
			"used_bytes":  used,
			"used_pct":    usedPct,
		})
	}
	return ok(map[string]any{
		"mounts":       mounts,
		"note":         "df-like via statfs; no shell",
		"collected_at": time.Now().UTC().Format(time.RFC3339Nano),
	})
}

func diskPaths() []string {
	seen := map[string]struct{}{"/": {}}
	out := []string{"/"}
	f, err := os.Open("/proc/mounts")
	if err != nil {
		return out
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		fields := strings.Fields(sc.Text())
		if len(fields) < 3 {
			continue
		}
		mp, fstype := fields[1], fields[2]
		switch fstype {
		case "ext4", "ext3", "xfs", "btrfs", "zfs", "apfs", "hfs", "vfat", "exfat":
		default:
			continue
		}
		if _, ok := seen[mp]; ok {
			continue
		}
		seen[mp] = struct{}{}
		out = append(out, mp)
		if len(out) >= 12 {
			break
		}
	}
	return out
}

// runPkgList is intentionally a safe stub: reads os-release only, no package DB shelling.
func runPkgList(ctx context.Context) Result {
	_ = ctx
	osRelease := map[string]string{}
	if b, err := os.ReadFile("/etc/os-release"); err == nil {
		for _, line := range strings.Split(string(b), "\n") {
			line = strings.TrimSpace(line)
			if line == "" || strings.HasPrefix(line, "#") {
				continue
			}
			k, v, ok := strings.Cut(line, "=")
			if !ok {
				continue
			}
			v = strings.Trim(v, `"'`)
			osRelease[k] = v
		}
	}
	return ok(map[string]any{
		"status":     "stub",
		"os_release": osRelease,
		"packages":   []any{},
		"note":       "pkg.list MVP returns os-release only; full inventory later (still no arbitrary shell)",
		"collected_at": time.Now().UTC().Format(time.RFC3339Nano),
	})
}

func runGuardSnapshot(ctx context.Context) Result {
	snap, err := guard.Snapshot(ctx)
	if err != nil {
		return fail(err.Error())
	}
	return ok(snap)
}

func ok(v any) Result {
	b, err := json.Marshal(v)
	if err != nil {
		return fail(err.Error())
	}
	return Result{OK: true, Output: b}
}

func fail(msg string) Result {
	return Result{OK: false, Error: msg}
}
