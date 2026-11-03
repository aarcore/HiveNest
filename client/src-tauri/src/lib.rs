mod mcp_bridge;
mod secrets;

use mcp_bridge::{McpBridge, McpCallArgs, McpCallResult, McpStartArgs, McpStartResult, McpToolInfo};
use secrets::{secret_delete, secret_get, secret_set};
use std::sync::Mutex;
use tauri::State;
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

struct AppMcp(Mutex<McpBridge>);

#[tauri::command]
fn mcp_start(state: State<'_, AppMcp>, args: McpStartArgs) -> McpStartResult {
    state.0.lock().expect("mcp lock").start(args)
}

#[tauri::command]
fn mcp_stop(state: State<'_, AppMcp>, server_id: String) -> Result<(), String> {
    state.0.lock().expect("mcp lock").stop(&server_id)
}

#[tauri::command]
fn mcp_list_tools(state: State<'_, AppMcp>, server_id: String) -> Result<Vec<McpToolInfo>, String> {
    state.0.lock().expect("mcp lock").list_tools(&server_id)
}

#[tauri::command]
fn mcp_cached_tools(state: State<'_, AppMcp>, server_id: String) -> Result<Vec<McpToolInfo>, String> {
    state.0.lock().expect("mcp lock").cached_tools(&server_id)
}

#[tauri::command]
fn mcp_call_tool(state: State<'_, AppMcp>, args: McpCallArgs) -> McpCallResult {
    state.0.lock().expect("mcp lock").call_tool(args)
}

#[tauri::command]
fn mcp_is_running(state: State<'_, AppMcp>, server_id: String) -> bool {
    state.0.lock().expect("mcp lock").is_running(&server_id)
}

#[tauri::command]
fn mcp_running_ids(state: State<'_, AppMcp>) -> Vec<String> {
    state.0.lock().expect("mcp lock").running_ids()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_shell::init())
        .manage(AppMcp(Mutex::new(McpBridge::default())))
        .invoke_handler(tauri::generate_handler![
            mcp_start,
            mcp_stop,
            mcp_list_tools,
            mcp_cached_tools,
            mcp_call_tool,
            mcp_is_running,
            mcp_running_ids,
            secret_set,
            secret_get,
            secret_delete,
        ])
        .setup(|app| {
            // Prefer env token so Vite/UI can match; default to dev-smoke-token for local builds.
            let token = std::env::var("HIVENEST_SESSIOND_TOKEN")
                .unwrap_or_else(|_| "dev-smoke-token".into());
            let listen = std::env::var("HIVENEST_SESSIOND_LISTEN")
                .unwrap_or_else(|_| "127.0.0.1:7788".into());

            // If sessiond is already running (dev workflow), skip sidecar.
            let already_up = std::net::TcpStream::connect("127.0.0.1:7788").is_ok();
            if already_up {
                eprintln!("[hivenest] sessiond already listening on 7788 — not spawning sidecar");
                return Ok(());
            }

            let sidecar = app.shell().sidecar("sessiond").map_err(|e| e.to_string())?;
            let (mut rx, _child) = sidecar
                .env("HIVENEST_SESSIOND_TOKEN", &token)
                .env("HIVENEST_SESSIOND_LISTEN", &listen)
                .spawn()
                .map_err(|e| e.to_string())?;

            tauri::async_runtime::spawn(async move {
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(line) => {
                            eprintln!("[sessiond] {}", String::from_utf8_lossy(&line));
                        }
                        CommandEvent::Stderr(line) => {
                            eprintln!("[sessiond:err] {}", String::from_utf8_lossy(&line));
                        }
                        CommandEvent::Error(err) => {
                            eprintln!("[sessiond] error: {err}");
                        }
                        CommandEvent::Terminated(payload) => {
                            eprintln!("[sessiond] exited: {:?}", payload);
                            break;
                        }
                        _ => {}
                    }
                }
            });

            let _ = app.handle();
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Hive Nest");
}
