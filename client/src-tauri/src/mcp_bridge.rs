//! MCP stdio JSON-RPC bridge for Hive Nest (desktop / Tauri only).
//! Spawns user-configured MCP servers, speaks Content-Length framed JSON-RPC
//! (with NDJSON fallback), and exposes start/stop/list/call to the frontend.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpStartArgs {
    pub id: String,
    pub name: Option<String>,
    pub command: String,
    pub args: Option<Vec<String>>,
    pub env: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpToolInfo {
    pub name: String,
    pub description: Option<String>,
    pub input_schema: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpStartResult {
    pub server_id: String,
    pub status: String,
    pub tools: Vec<McpToolInfo>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpCallArgs {
    pub server_id: String,
    pub tool: String,
    pub arguments: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpCallResult {
    pub ok: bool,
    pub content: String,
    pub error: Option<String>,
}

struct PendingMap {
    map: HashMap<u64, Sender<Result<Value, String>>>,
}

struct LiveServer {
    child: Child,
    stdin: ChildStdin,
    pending: Arc<Mutex<PendingMap>>,
    next_id: AtomicU64,
    tools: Vec<McpToolInfo>,
    _reader: thread::JoinHandle<()>,
}

pub struct McpBridge {
    servers: Mutex<HashMap<String, LiveServer>>,
}

impl Default for McpBridge {
    fn default() -> Self {
        Self {
            servers: Mutex::new(HashMap::new()),
        }
    }
}

fn write_message(stdin: &mut ChildStdin, msg: &Value) -> Result<(), String> {
    let body = serde_json::to_vec(msg).map_err(|e| e.to_string())?;
    // Prefer Content-Length framing (MCP / LSP style).
    let header = format!("Content-Length: {}\r\n\r\n", body.len());
    stdin
        .write_all(header.as_bytes())
        .map_err(|e| format!("stdin write header: {e}"))?;
    stdin
        .write_all(&body)
        .map_err(|e| format!("stdin write body: {e}"))?;
    stdin.flush().map_err(|e| format!("stdin flush: {e}"))?;
    Ok(())
}

fn read_one_message(reader: &mut BufReader<impl Read>) -> Result<Value, String> {
    let mut content_length: Option<usize> = None;
    let mut saw_header = false;
    loop {
        let mut line = String::new();
        let n = reader
            .read_line(&mut line)
            .map_err(|e| format!("read header: {e}"))?;
        if n == 0 {
            return Err("MCP server closed stdout".into());
        }
        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed.is_empty() {
            if saw_header {
                break;
            }
            continue;
        }
        // NDJSON fallback: a bare JSON object on one line
        if trimmed.starts_with('{') && content_length.is_none() && !saw_header {
            return serde_json::from_str(trimmed).map_err(|e| format!("ndjson parse: {e}"));
        }
        saw_header = true;
        let lower = trimmed.to_ascii_lowercase();
        if let Some(rest) = lower.strip_prefix("content-length:") {
            content_length = Some(
                rest.trim()
                    .parse()
                    .map_err(|_| format!("bad Content-Length: {trimmed}"))?,
            );
        }
    }
    let len = content_length.ok_or_else(|| "missing Content-Length".to_string())?;
    let mut buf = vec![0u8; len];
    reader
        .read_exact(&mut buf)
        .map_err(|e| format!("read body ({len}): {e}"))?;
    serde_json::from_slice(&buf).map_err(|e| format!("json body: {e}"))
}

fn spawn_reader(
    mut reader: BufReader<impl Read + Send + 'static>,
    pending: Arc<Mutex<PendingMap>>,
) -> thread::JoinHandle<()> {
    thread::spawn(move || loop {
        match read_one_message(&mut reader) {
            Ok(msg) => {
                // Notifications have no id
                let id = msg.get("id").and_then(|v| v.as_u64().or_else(|| v.as_i64().map(|i| i as u64)));
                if let Some(id) = id {
                    if let Ok(mut p) = pending.lock() {
                        if let Some(tx) = p.map.remove(&id) {
                            let res = if let Some(err) = msg.get("error") {
                                Err(err.to_string())
                            } else {
                                Ok(msg.get("result").cloned().unwrap_or(Value::Null))
                            };
                            let _ = tx.send(res);
                        }
                    }
                }
            }
            Err(e) => {
                eprintln!("[mcp] reader stop: {e}");
                // Fail all pending
                if let Ok(mut p) = pending.lock() {
                    for (_, tx) in p.map.drain() {
                        let _ = tx.send(Err(e.clone()));
                    }
                }
                break;
            }
        }
    })
}

impl McpBridge {
    fn request(
        &self,
        server_id: &str,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<Value, String> {
        let mut servers = self.servers.lock().map_err(|e| e.to_string())?;
        let live = servers
            .get_mut(server_id)
            .ok_or_else(|| format!("MCP server not running: {server_id}"))?;
        let id = live.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx): (Sender<Result<Value, String>>, Receiver<Result<Value, String>>) =
            mpsc::channel();
        {
            let mut p = live.pending.lock().map_err(|e| e.to_string())?;
            p.map.insert(id, tx);
        }
        let msg = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        });
        write_message(&mut live.stdin, &msg)?;
        drop(servers); // release lock while waiting
        let deadline = Instant::now() + timeout;
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(format!("MCP timeout waiting for {method}"));
            }
            match rx.recv_timeout(remaining.min(Duration::from_millis(200))) {
                Ok(Ok(v)) => return Ok(v),
                Ok(Err(e)) => return Err(e),
                Err(mpsc::RecvTimeoutError::Timeout) => continue,
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    return Err("MCP reader disconnected".into())
                }
            }
        }
    }

    fn notify(&self, server_id: &str, method: &str, params: Value) -> Result<(), String> {
        let mut servers = self.servers.lock().map_err(|e| e.to_string())?;
        let live = servers
            .get_mut(server_id)
            .ok_or_else(|| format!("MCP server not running: {server_id}"))?;
        let msg = json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params,
        });
        write_message(&mut live.stdin, &msg)
    }

    pub fn start(&self, args: McpStartArgs) -> McpStartResult {
        let id = args.id.clone();
        // Stop existing
        let _ = self.stop(&id);

        let command = args.command.trim().to_string();
        if command.is_empty() {
            return McpStartResult {
                server_id: id,
                status: "error".into(),
                tools: vec![],
                error: Some("Missing command".into()),
            };
        }
        if command.chars().any(|c| matches!(c, '\n' | '\r' | ';' | '|' | '&' | '`' | '$')) {
            return McpStartResult {
                server_id: id,
                status: "error".into(),
                tools: vec![],
                error: Some(
                    "Command must be an executable path without shell metacharacters; put flags in args"
                        .into(),
                ),
            };
        }

        let mut cmd = Command::new(&command);
        if let Some(a) = &args.args {
            cmd.args(a);
        }
        if let Some(env) = &args.env {
            for (k, v) in env {
                cmd.env(k, v);
            }
        }
        cmd.stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                return McpStartResult {
                    server_id: id,
                    status: "error".into(),
                    tools: vec![],
                    error: Some(format!("spawn {}: {e}", command)),
                }
            }
        };

        let stdin = match child.stdin.take() {
            Some(s) => s,
            None => {
                let _ = child.kill();
                return McpStartResult {
                    server_id: id,
                    status: "error".into(),
                    tools: vec![],
                    error: Some("no stdin".into()),
                };
            }
        };
        let stdout = match child.stdout.take() {
            Some(s) => s,
            None => {
                let _ = child.kill();
                return McpStartResult {
                    server_id: id,
                    status: "error".into(),
                    tools: vec![],
                    error: Some("no stdout".into()),
                };
            }
        };

        // Drain stderr so the process doesn't block
        if let Some(stderr) = child.stderr.take() {
            let sid = id.clone();
            thread::spawn(move || {
                let mut r = BufReader::new(stderr);
                let mut line = String::new();
                while r.read_line(&mut line).ok().filter(|n| *n > 0).is_some() {
                    eprintln!("[mcp:{sid}:err] {}", line.trim_end());
                    line.clear();
                }
            });
        }

        let pending = Arc::new(Mutex::new(PendingMap {
            map: HashMap::new(),
        }));
        let reader = spawn_reader(BufReader::new(stdout), pending.clone());

        {
            let mut servers = self.servers.lock().unwrap();
            servers.insert(
                id.clone(),
                LiveServer {
                    child,
                    stdin,
                    pending,
                    next_id: AtomicU64::new(1),
                    tools: vec![],
                    _reader: reader,
                },
            );
        }

        // initialize
        let init = self.request(
            &id,
            "initialize",
            json!({
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": { "name": "hivenest", "version": "0.1.0" }
            }),
            Duration::from_secs(15),
        );
        if let Err(e) = init {
            let _ = self.stop(&id);
            return McpStartResult {
                server_id: id,
                status: "error".into(),
                tools: vec![],
                error: Some(format!("initialize: {e}")),
            };
        }
        let _ = self.notify(&id, "notifications/initialized", json!({}));

        let listed = self.request(&id, "tools/list", json!({}), Duration::from_secs(15));
        let tools = match listed {
            Ok(v) => parse_tools(&v),
            Err(e) => {
                let _ = self.stop(&id);
                return McpStartResult {
                    server_id: id,
                    status: "error".into(),
                    tools: vec![],
                    error: Some(format!("tools/list: {e}")),
                };
            }
        };

        if let Ok(mut servers) = self.servers.lock() {
            if let Some(live) = servers.get_mut(&id) {
                live.tools = tools.clone();
            }
        }

        McpStartResult {
            server_id: id,
            status: "connected".into(),
            tools,
            error: None,
        }
    }

    pub fn stop(&self, server_id: &str) -> Result<(), String> {
        let mut servers = self.servers.lock().map_err(|e| e.to_string())?;
        if let Some(mut live) = servers.remove(server_id) {
            let _ = live.child.kill();
            let _ = live.child.wait();
        }
        Ok(())
    }

    pub fn list_tools(&self, server_id: &str) -> Result<Vec<McpToolInfo>, String> {
        // Refresh from server
        let v = self.request(server_id, "tools/list", json!({}), Duration::from_secs(15))?;
        let tools = parse_tools(&v);
        if let Ok(mut servers) = self.servers.lock() {
            if let Some(live) = servers.get_mut(server_id) {
                live.tools = tools.clone();
            }
        }
        Ok(tools)
    }

    pub fn cached_tools(&self, server_id: &str) -> Result<Vec<McpToolInfo>, String> {
        let servers = self.servers.lock().map_err(|e| e.to_string())?;
        let live = servers
            .get(server_id)
            .ok_or_else(|| format!("MCP server not running: {server_id}"))?;
        Ok(live.tools.clone())
    }

    pub fn is_running(&self, server_id: &str) -> bool {
        self.servers
            .lock()
            .map(|s| s.contains_key(server_id))
            .unwrap_or(false)
    }

    pub fn call_tool(&self, args: McpCallArgs) -> McpCallResult {
        let params = json!({
            "name": args.tool,
            "arguments": args.arguments.unwrap_or_else(|| json!({}))
        });
        match self.request(&args.server_id, "tools/call", params, Duration::from_secs(120)) {
            Ok(v) => {
                let content = format_call_result(&v);
                McpCallResult {
                    ok: true,
                    content,
                    error: None,
                }
            }
            Err(e) => McpCallResult {
                ok: false,
                content: String::new(),
                error: Some(e),
            },
        }
    }

    pub fn running_ids(&self) -> Vec<String> {
        self.servers
            .lock()
            .map(|s| s.keys().cloned().collect())
            .unwrap_or_default()
    }
}

fn parse_tools(v: &Value) -> Vec<McpToolInfo> {
    let arr = v
        .get("tools")
        .and_then(|t| t.as_array())
        .cloned()
        .unwrap_or_default();
    arr.into_iter()
        .filter_map(|t| {
            let name = t.get("name")?.as_str()?.to_string();
            Some(McpToolInfo {
                name,
                description: t
                    .get("description")
                    .and_then(|d| d.as_str())
                    .map(|s| s.to_string()),
                input_schema: t.get("inputSchema").cloned().or_else(|| t.get("input_schema").cloned()),
            })
        })
        .collect()
}

fn format_call_result(v: &Value) -> String {
    if let Some(arr) = v.get("content").and_then(|c| c.as_array()) {
        return arr
            .iter()
            .map(|c| {
                c.get("text")
                    .and_then(|t| t.as_str())
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| c.to_string())
            })
            .collect::<Vec<_>>()
            .join("\n");
    }
    v.to_string()
}
