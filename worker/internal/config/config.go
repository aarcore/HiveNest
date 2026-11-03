package config

import (
	"encoding/json"
	"os"
	"strconv"

	"github.com/google/uuid"
	"github.com/hivenest/hivenest/worker/internal/guard"
)

// Config holds Worker runtime settings.
type Config struct {
	QueenURL       string       `json:"queen_url"`
	NodeID         string       `json:"node_id"`
	Region         string       `json:"region"`
	Country        string       `json:"country"`
	BootstrapToken string       `json:"bootstrap_token"`
	Guard          guard.Config `json:"guard"`
}

func Default() Config {
	return Config{
		QueenURL:       "ws://127.0.0.1:8080/v1/worker/ws",
		NodeID:         "",
		Region:         "",
		Country:        "",
		BootstrapToken: "hivenest-dev-token",
		Guard:          guard.DefaultConfig(),
	}
}

func LoadFile(path string, cfg *Config) error {
	b, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(b, cfg)
}

// ApplyEnv overlays environment variables and ensures NodeID is set.
func ApplyEnv(cfg *Config) {
	if v := os.Getenv("HIVENEST_QUEEN_URL"); v != "" {
		cfg.QueenURL = v
	}
	if v := os.Getenv("HIVENEST_NODE_ID"); v != "" {
		cfg.NodeID = v
	}
	if v := os.Getenv("HIVENEST_REGION"); v != "" {
		cfg.Region = v
	}
	if v := os.Getenv("HIVENEST_COUNTRY"); v != "" {
		cfg.Country = v
	}
	if v := os.Getenv("HIVENEST_BOOTSTRAP_TOKEN"); v != "" {
		cfg.BootstrapToken = v
	}
	if v := os.Getenv("HIVENEST_GUARD_INTERVAL_SEC"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			cfg.Guard.IntervalSec = n
		}
	}
	if cfg.NodeID == "" {
		cfg.NodeID = uuid.NewString()
	}
}
