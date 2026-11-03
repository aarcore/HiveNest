package api

import (
	"fmt"
	"net/http"
	"net/url"
	"strings"
)

func (s *Server) handleBootstrapCommand(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	public := strings.TrimRight(s.effectivePublicURL(), "/")
	if public == "" {
		writeErr(w, http.StatusServiceUnavailable, "HIVENEST_PUBLIC_URL not configured")
		return
	}
	token := s.BootstrapTokenHint
	wsURL := strings.TrimSpace(s.effectiveWorkerDialURL())
	if wsURL == "" {
		wsURL = httpToWS(public) + "/v1/worker/ws"
	}
	installURL := public + "/install/install-worker.sh"
	unitURL := public + "/install/hivenest-worker.service"
	amd64URL := public + "/releases/hivenest-worker-linux-amd64"
	arm64URL := public + "/releases/hivenest-worker-linux-arm64"

	envPrefix := fmt.Sprintf("HIVENEST_PUBLIC_URL=%s HIVENEST_QUEEN_URL=%s HIVENEST_BOOTSTRAP_TOKEN=%s",
		shellQuote(public), shellQuote(wsURL), shellQuote(token))

	twoStep := []string{
		fmt.Sprintf("curl -fsSL %s -o /tmp/install-worker.sh", shellQuote(installURL)),
		fmt.Sprintf("sudo %s bash /tmp/install-worker.sh", envPrefix),
	}
	oneLiner := fmt.Sprintf("curl -fsSL %s | sudo env %s bash", shellQuote(installURL), envPrefix)
	offline := []string{
		"# On build machine:",
		"make release-worker",
		"scp dist/hivenest-worker-linux-amd64 install/install-worker.sh install/hivenest-worker.service root@HOST:/tmp/hivenest/",
		"# On target host:",
		fmt.Sprintf("sudo HIVENEST_LOCAL_BINARY=/tmp/hivenest/hivenest-worker-linux-amd64 HIVENEST_QUEEN_URL=%s HIVENEST_BOOTSTRAP_TOKEN=%s bash /tmp/hivenest/install-worker.sh",
			shellQuote(wsURL), shellQuote(token)),
	}

	extra := map[string]any{}
	if s.Endpoints != nil {
		snap := s.Endpoints.Snapshot()
		extra["callback_url"] = snap.CallbackURL
		extra["dial_source"] = snap.DialSource
		extra["lan_candidates"] = snap.LANCandidates
		extra["configured_public_url"] = snap.ConfiguredPublicURL
		if snap.Tunnel != nil {
			extra["tunnel"] = snap.Tunnel
		}
	}
	payload := map[string]any{
		"version":         s.Version,
		"public_url":      public,
		"queen_ws_url":    wsURL,
		"callback_url":    wsURL,
		"bootstrap_token": token,
		"urls": map[string]string{
			"install_script": installURL,
			"unit_file":      unitURL,
			"worker_amd64":   amd64URL,
			"worker_arm64":   arm64URL,
		},
		"recommended": []map[string]any{
			{
				"id":          "download-then-run",
				"title":       "两步安装（推荐：先下载再执行，便于审阅脚本）",
				"commands":    twoStep,
				"description": "不把脚本直接 pipe 进 bash。",
			},
			{
				"id":          "one-liner",
				"title":       "一键安装（请先打开 install-worker.sh 审阅）",
				"commands":    []string{oneLiner},
				"description": "仅在信任 Queen 源时使用。",
			},
			{
				"id":          "scp-offline",
				"title":       "离线 / scp",
				"commands":    offline,
				"description": "无公网下载时，用 make release-worker 产物拷到目标机。",
			},
		},
		"note": "生产环境请轮换引导令牌，并尽快启用 TLS/mTLS；令牌会出现在本接口响应中，勿对公网匿名暴露。回调地址优先：演示隧道 > WORKER_DIAL_URL > 非 loopback PUBLIC_URL > 自动局域网/ADVERTISE_HOST。",
	}
	for k, v := range extra {
		payload[k] = v
	}
	writeJSON(w, http.StatusOK, payload)
}

func httpToWS(public string) string {
	u, err := url.Parse(public)
	if err != nil || u.Scheme == "" {
		if strings.HasPrefix(public, "https://") {
			return "wss://" + strings.TrimPrefix(public, "https://")
		}
		return "ws://" + strings.TrimPrefix(strings.TrimPrefix(public, "http://"), "//")
	}
	switch u.Scheme {
	case "https":
		u.Scheme = "wss"
	case "http":
		u.Scheme = "ws"
	}
	u.Path = strings.TrimRight(u.Path, "/")
	return strings.TrimRight(u.String(), "/")
}

func shellQuote(s string) string {
	if s == "" {
		return "''"
	}
	if !strings.ContainsAny(s, " \t\n'\"\\$`") {
		return s
	}
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}
