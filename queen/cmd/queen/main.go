package main

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/hivenest/hivenest/queen/internal/api"
	"github.com/hivenest/hivenest/queen/internal/config"
	"github.com/hivenest/hivenest/queen/internal/endpoints"
	"github.com/hivenest/hivenest/queen/internal/enroll"
	"github.com/hivenest/hivenest/queen/internal/hub"
	"github.com/hivenest/hivenest/queen/internal/store"
	"github.com/hivenest/hivenest/queen/internal/tunnel"
	"github.com/hivenest/hivenest/queen/internal/ui"
)

var version = "0.5.0-dev"

func main() {
	cfgPath := flag.String("config", "", "optional config file path")
	flag.Parse()

	cfg := config.Default()
	if *cfgPath != "" {
		if err := config.LoadFile(*cfgPath, &cfg); err != nil {
			log.Fatalf("config: %v", err)
		}
	}
	config.ApplyEnv(&cfg)

	// Local non-docker convenience: default sqlite under ./data
	if strings.HasPrefix(cfg.DatabaseURL, "sqlite:///data/") {
		if _, err := os.Stat("/data"); err != nil {
			_ = os.MkdirAll("data", 0o755)
			cfg.DatabaseURL = "sqlite://" + filepath.Join("data", "hivenest.db")
		}
	}

	st, err := store.OpenFromURL(cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("store: %v", err)
	}
	defer st.Close()

	if cfg.BootstrapToken == "" {
		log.Fatal("HIVENEST_BOOTSTRAP_TOKEN (or config bootstrap_token) is required")
	}

	localTarget := endpoints.LocalTunnelTarget(cfg.Listen, cfg.ListenPort())
	tun := tunnel.New(cfg.TunnelBin, localTarget)
	ep := endpoints.New(cfg, tun)

	snap := ep.Snapshot()
	log.Printf("callback endpoints: %s", ep.Describe())
	if snap.DialSource == "configured_loopback" {
		log.Printf("WARNING: worker dial URL is loopback (%s). Remote SSH enroll will be refused until you set HIVENEST_WORKER_DIAL_URL / HIVENEST_ADVERTISE_HOST / non-loopback PUBLIC_URL, enable demo tunnel, or pass queen_ws_url per request.",
			snap.WorkerDialURL)
	}
	if len(snap.LANCandidates) > 0 {
		log.Printf("LAN dial candidates: %s", strings.Join(snap.LANCandidates, ", "))
	}

	if cfg.DemoTunnel {
		log.Printf("HIVENEST_DEMO_TUNNEL=1 — starting demo tunnel to %s (requires %s)", localTarget, cfg.TunnelBin)
		ctx, cancel := context.WithTimeout(context.Background(), 50*time.Second)
		stTunnel, err := tun.Start(ctx)
		cancel()
		if err != nil {
			log.Printf("demo tunnel start failed: %v (UI can retry via POST /v1/tunnel)", err)
		} else {
			log.Printf("demo tunnel public URL: %s", stTunnel.PublicURL)
		}
	} else {
		if path, ok := tun.BinPath(); ok {
			log.Printf("demo tunnel available via POST /v1/tunnel {\"enabled\":true} (bin=%s); default OFF", path)
		} else {
			log.Printf("demo tunnel binary %q not found — install cloudflared to enable local demo tunnel", cfg.TunnelBin)
		}
	}

	h := hub.New(st, cfg.BootstrapToken)
	enr := enroll.New(enroll.Config{
		ArtifactDir:    cfg.ArtifactDir,
		InstallDir:     cfg.InstallDir,
		BootstrapToken: cfg.BootstrapToken,
		QueenWSURL:     ep.WorkerDialURL(),
	}, st)
	srvAPI := &api.Server{
		Version:            version,
		Store:              st,
		Hub:                h,
		UI:                 ui.Handler(),
		BootstrapTokenHint: cfg.BootstrapToken,
		PublicURL:          cfg.PublicURL,
		WorkerDialURL:      cfg.EffectiveWorkerDialURL(),
		InstallDir:         cfg.InstallDir,
		ArtifactDir:        cfg.ArtifactDir,
		Enroller:           enr,
		Endpoints:          ep,
		Tunnel:             tun,
	}

	mux := http.NewServeMux()
	srvAPI.Register(mux)

	httpSrv := &http.Server{
		Addr:              cfg.Listen,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		log.Printf("HiveNest Queen %s listening on %s (db=%s public=%s tls=%v)",
			version, cfg.Listen, cfg.DatabaseURL, cfg.PublicURL, cfg.TLSCertFile != "" && cfg.TLSKeyFile != "")
		var err error
		if cfg.TLSCertFile != "" && cfg.TLSKeyFile != "" {
			httpSrv.TLSConfig = buildTLS(cfg)
			err = httpSrv.ListenAndServeTLS(cfg.TLSCertFile, cfg.TLSKeyFile)
		} else {
			err = httpSrv.ListenAndServe()
		}
		if err != nil && err != http.ErrServerClosed {
			log.Fatalf("listen: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop

	_, _ = tun.Stop()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = httpSrv.Shutdown(ctx)
	fmt.Println("queen stopped")
}

func buildTLS(cfg config.Config) *tls.Config {
	tlsCfg := &tls.Config{MinVersion: tls.VersionTLS12}
	if cfg.ClientCAFile == "" {
		return tlsCfg
	}
	pem, err := os.ReadFile(cfg.ClientCAFile)
	if err != nil {
		log.Fatalf("client ca: %v", err)
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(pem) {
		log.Fatal("client ca: no certificates parsed")
	}
	tlsCfg.ClientCAs = pool
	tlsCfg.ClientAuth = tls.RequireAndVerifyClientCert
	return tlsCfg
}
