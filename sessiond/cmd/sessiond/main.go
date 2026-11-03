// Command sessiond is the local HiveNest SSH session sidecar (loopback API).
// Builds for windows, linux, and darwin (GOOS).
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/hivenest/hivenest/sessiond/internal/api"
	"github.com/hivenest/hivenest/sessiond/internal/config"
	"github.com/hivenest/hivenest/sessiond/internal/proposal"
	"github.com/hivenest/hivenest/sessiond/internal/session"
	"github.com/hivenest/hivenest/sessiond/internal/sshx"
	"github.com/hivenest/hivenest/sessiond/internal/store"
)

var version = "0.1.0-dev"

func main() {
	showVersion := flag.Bool("version", false, "print version and exit")
	flag.Parse()
	if *showVersion {
		fmt.Printf("hivenest-sessiond %s %s\n", version, config.GOOS())
		return
	}

	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config: %v", err)
	}

	hosts := store.NewHostStore(cfg.HostsFile)
	audit := store.NewAuditLog(cfg.AuditFile)
	kh := sshx.NewKnownHosts(cfg.KnownHostsFile)
	props := proposal.NewStore()
	sessions := session.NewManager(hosts, audit, props, kh)
	srvAPI := api.New(cfg, hosts, audit, props, sessions, kh)

	httpSrv := &http.Server{
		Addr:              cfg.Listen,
		Handler:           srvAPI.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	ln, err := net.Listen("tcp", cfg.Listen)
	if err != nil {
		log.Fatalf("listen %s: %v", cfg.Listen, err)
	}

	log.Printf("hivenest-sessiond %s starting on http://%s (goos=%s)", version, cfg.Listen, config.GOOS())
	log.Printf("data dir: %s", cfg.DataDir)
	log.Printf("auth token file: %s", cfg.TokenFile)
	log.Printf("known hosts: %s", cfg.KnownHostsFile)
	log.Printf("smoke UI: http://%s/  (pass token via X-HiveNest-Token)", cfg.Listen)

	go func() {
		if err := httpSrv.Serve(ln); err != nil && err != http.ErrServerClosed {
			log.Fatalf("serve: %v", err)
		}
	}()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	<-ctx.Done()
	stop()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = httpSrv.Shutdown(shutdownCtx)
	log.Printf("sessiond stopped")
}
