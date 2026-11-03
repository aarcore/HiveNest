package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/hivenest/hivenest/worker/internal/agent"
	"github.com/hivenest/hivenest/worker/internal/config"
	"github.com/hivenest/hivenest/worker/internal/guard"
)

var version = "0.5.0-dev"

func main() {
	cfgPath := flag.String("config", "", "optional config file path")
	queenURL := flag.String("queen", "", "Queen WebSocket URL (overrides config)")
	flag.Parse()

	cfg := config.Default()
	if *cfgPath != "" {
		if err := config.LoadFile(*cfgPath, &cfg); err != nil {
			log.Fatalf("config: %v", err)
		}
	}
	if *queenURL != "" {
		cfg.QueenURL = *queenURL
	}
	config.ApplyEnv(&cfg)

	if cfg.BootstrapToken == "" {
		log.Fatal("HIVENEST_BOOTSTRAP_TOKEN is required")
	}

	log.Printf("HiveNest Worker %s starting; dial-out to %s (node_id=%s)", version, cfg.QueenURL, cfg.NodeID)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	a := agent.New(cfg, version)
	g := guard.New(cfg.Guard, a.EnqueueAlert)
	go g.Run(ctx)

	go func() {
		if err := a.DialLoop(ctx); err != nil && ctx.Err() == nil {
			log.Printf("agent dial loop ended: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	cancel()
	time.Sleep(200 * time.Millisecond)
	fmt.Println("worker stopped")
}
