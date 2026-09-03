use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Instant;
use tauri::State;

const MAX_LOG_LINES: usize = 1000;

/// `Command::new` that never flashes a console window on Windows. Every
/// spawn in this file must go through this: a GUI app spawning a
/// console-subsystem program (python, pip, hostname) otherwise pops a
/// visible terminal — and the long-lived bridge python leaves one open
/// for the app's entire lifetime.
fn hidden_command<S: AsRef<std::ffi::OsStr>>(program: S) -> Command {
    #[allow(unused_mut)]
    let mut cmd = Command::new(program);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentProcess {
    pub agent_id: String,
    pub agent_name: String,
    pub status: AgentStatus,
    pub uptime_secs: Option<u64>,
    pub exit_code: Option<i32>,
    pub crash_reason: Option<String>,
    /// Machine-readable category for `crash_reason`. Currently only
    /// `"auth"` (the agent's AgentGram API key was rejected) — the UI
    /// turns that into a one-click "generate a new key" fix instead of
    /// a dead-end error string.
    pub crash_kind: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum AgentStatus {
    Running,
    Stopped,
    Crashed,
    Starting,
    /// Agent runs on an org host VM, not this device. The desktop
    /// observes its presence over the WebSocket connection but does
    /// not own its lifecycle — start_agent intentionally does not
    /// spawn a local subprocess for these.
    Remote,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartAgentArgs {
    pub agent_id: String,
    pub agent_name: String,
    pub api_key: String,
    pub backend: Option<String>,
    pub model: Option<String>,
    pub llm_api_key: Option<String>,
    pub base_url: Option<String>,
    pub max_tokens: Option<u32>,
    pub history_limit: Option<u32>,
    pub execution_mode: Option<String>,
    pub dangerously_skip_permissions: Option<bool>,
    /// Per-agent opt-in for the local computer-use MCP server. When true,
    /// the bridge gets `AGENTGRAM_COMPUTER_USE=local` and Claude CLI spawns
    /// the desktop's computer_use_mcp_server.py with the agent's stdio MCP
    /// servers. Off by default; user toggles in AgentConfig → Behavior.
    pub computer_use_enabled: Option<bool>,
    /// Optional allow-list of app names the computer-use server is allowed
    /// to interact with. Empty/None = allow any (except the hardcoded deny
    /// list). When non-empty, the MCP server refuses every action whose
    /// focused app doesn't substring-match an entry.
    pub computer_use_allowed_apps: Option<Vec<String>>,
    pub effort: Option<String>,
    pub api_url: Option<String>,
    pub add_dirs: Option<Vec<String>>,
    /// CLI connection (auth/runtime) for local Claude Code / Codex agents:
    /// `"subscription"` (use the machine's `claude login`, the default),
    /// `"anthropic"` (Anthropic-direct API key), `"bedrock"` (AWS Bedrock),
    /// `"vertex"` (GCP Vertex), `"openai"` (Codex direct). Drives which
    /// `CLAUDE_CODE_USE_*` env we set — and, just as importantly, which we
    /// UNSET so an ambient/managed env can't override the user's choice.
    pub cli_connection: Option<String>,
    /// AWS region for `cli_connection = "bedrock"` (Claude Code requires
    /// AWS_REGION explicitly; it does not read ~/.aws for this).
    pub aws_region: Option<String>,
    /// GCP region + project for `cli_connection = "vertex"`
    /// (CLOUD_ML_REGION / ANTHROPIC_VERTEX_PROJECT_ID).
    pub vertex_region: Option<String>,
    pub vertex_project: Option<String>,
    /// Server-set runtime. `"local"` (default, today's behavior) spawns
    /// the bridge on this device. `"org_host"` is owned by a registered
    /// org host VM; start_agent skips the subprocess entirely and just
    /// returns a stub AgentProcess in the Remote state. Wake/delivery
    /// is the backend's job (it broadcasts to the host channel).
    #[serde(default)]
    pub runtime: Option<String>,
}

struct RunningAgent {
    child: Child,
    started_at: Instant,
    agent_name: String,
    /// Shared log buffer — written by background reader thread, read by get_agent_logs
    logs: Arc<Mutex<Vec<String>>>,
    crash_reason: Option<String>,
    crash_kind: Option<String>,
    /// Used to fire a synchronous offline ping to the backend at shutdown.
    /// SIGTERM gives the bridge ~2s to deregister itself, but Force Quit /
    /// SIGKILL / crash would otherwise leave the agent "online" for 90s.
    agent_id: String,
    api_key: String,
    api_url: String,
}

pub struct ProcessManager {
    agents: HashMap<String, RunningAgent>,
}

impl ProcessManager {
    pub fn new() -> Self {
        kill_orphan_bridges();
        Self {
            agents: HashMap::new(),
        }
    }

    pub fn kill_all(&mut self) {
        let ids: Vec<String> = self.agents.keys().cloned().collect();
        for id in ids {
            if let Some(mut agent) = self.agents.remove(&id) {
                mark_offline_sync(&agent.api_url, &agent.agent_id, &agent.api_key);
                graceful_kill(&mut agent.child);
            }
        }
    }

    fn check_process_status(&mut self, agent_id: &str) -> (AgentStatus, Option<i32>) {
        if let Some(agent) = self.agents.get_mut(agent_id) {
            match agent.child.try_wait() {
                Ok(Some(status)) => {
                    let code = status.code();
                    if !status.success() && agent.crash_reason.is_none() {
                        // Try to extract crash reason from collected logs
                        if let Some((reason, kind)) = extract_crash_reason(&agent.logs) {
                            agent.crash_reason = Some(reason);
                            agent.crash_kind = kind.map(str::to_string);
                        }
                    }
                    if status.success() {
                        (AgentStatus::Stopped, code)
                    } else {
                        (AgentStatus::Crashed, code)
                    }
                }
                Ok(None) => (AgentStatus::Running, None),
                Err(_) => (AgentStatus::Crashed, None),
            }
        } else {
            (AgentStatus::Stopped, None)
        }
    }
}

/// Human-readable name of this machine. Passed to the bridge as
/// AGENTGRAM_DEVICE_NAME (reported to the backend in executor metadata)
/// and exposed to the frontend via get_device_name — both sides MUST use
/// the same value so "is that agent running on THIS device?" comparisons
/// work. Prefers the user-facing name (macOS ComputerName) over the raw
/// mDNS hostname.
pub fn compute_device_name() -> String {
    #[cfg(target_os = "macos")]
    {
        if let Ok(out) = hidden_command("scutil").args(["--get", "ComputerName"]).output() {
            if out.status.success() {
                let name = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if !name.is_empty() {
                    return name;
                }
            }
        }
    }
    if let Ok(name) = std::env::var("COMPUTERNAME") {
        let name = name.trim().to_string();
        if !name.is_empty() {
            return name;
        }
    }
    if let Ok(out) = hidden_command("hostname").output() {
        if out.status.success() {
            let name = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !name.is_empty() {
                return name.trim_end_matches(".local").to_string();
            }
        }
    }
    String::new()
}

#[tauri::command]
pub fn get_device_name() -> String {
    compute_device_name()
}

/// Where the bundled bridge lives and which Python runs it — so the
/// "Connect CLI session" dialog can print an exact `python -m agentchat
/// connect …` command (#148). Falls back to `python3` when the venv has
/// not been created yet (no agent has ever been started on this machine).
#[derive(serde::Serialize)]
pub struct BridgePaths {
    #[serde(rename = "bridgeDir")]
    pub bridge_dir: String,
    pub python: String,
}

#[tauri::command]
pub fn get_bridge_paths(app: tauri::AppHandle) -> Result<BridgePaths, String> {
    let bridge_dir = bridge_dir_for(&app)?;
    let python = match bridge_venv_python(&app) {
        Ok(p) if p.exists() => p.to_string_lossy().to_string(),
        _ => "python3".to_string(),
    };
    Ok(BridgePaths {
        bridge_dir: bridge_dir.to_string_lossy().to_string(),
        python,
    })
}

/// Run one `python -m agentchat <args>` in the bundled bridge with its venv
/// Python and return stdout. Shared by the external-agent (#148) session
/// picker commands: the logic lives in the bridge (testable Python), Rust
/// only shells out.
fn run_agentchat_cli(app: &tauri::AppHandle, args: &[&str]) -> Result<String, String> {
    let bridge_dir = bridge_dir_for(app)?;
    let python = match bridge_venv_python(app) {
        Ok(p) if p.exists() => p.to_string_lossy().to_string(),
        _ => "python3".to_string(),
    };
    let output = hidden_command(&python)
        .arg("-m")
        .arg("agentchat")
        .args(args)
        .current_dir(&bridge_dir)
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("Failed to run the bridge CLI: {e}"))?;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "bridge CLI exited with {}: {}",
            output.status,
            err.lines().last().unwrap_or("").trim()
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Claude Code sessions on this machine (external agents #148): the desktop
/// session picker. JSON straight from `python -m agentchat sessions`.
#[tauri::command]
pub fn list_claude_sessions(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let out = run_agentchat_cli(&app, &["sessions"])?;
    // The CLI prints one JSON line; tolerate log noise before it.
    let json_line = out
        .lines()
        .rev()
        .find(|l| l.trim_start().starts_with('['))
        .ok_or_else(|| "bridge CLI returned no session list".to_string())?;
    serde_json::from_str(json_line).map_err(|e| format!("bad session list: {e}"))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BindClaudeSessionArgs {
    pub session_id: String,
    pub cwd: Option<String>,
    pub agent_id: String,
    pub api_key: String,
    pub display_name: String,
    pub gateway_url: String,
    /// Name for the session, applied by the hook on its first prompt.
    pub title: Option<String>,
}

/// Bind one Claude Code session to one external agent: writes the agent's
/// credentials + the session map under ~/.agentchat and makes sure the
/// user-scope hooks/MCP server are installed. Local files only — the
/// desktop already fetched the key from the backend.
#[tauri::command]
pub fn bind_claude_session(
    app: tauri::AppHandle,
    args: BindClaudeSessionArgs,
) -> Result<serde_json::Value, String> {
    let mut cli: Vec<&str> = vec!["bind", "--session", &args.session_id];
    cli.extend_from_slice(&[
        "--agent-id",
        &args.agent_id,
        "--api-key",
        &args.api_key,
        "--display-name",
        &args.display_name,
        "--gateway-url",
        &args.gateway_url,
        "--install",
    ]);
    if let Some(cwd) = args.cwd.as_deref() {
        cli.push("--cwd");
        cli.push(cwd);
    }
    if let Some(title) = args.title.as_deref().filter(|t| !t.trim().is_empty()) {
        cli.push("--title");
        cli.push(title);
    }
    let out = run_agentchat_cli(&app, &cli)?;
    let json_line = out
        .lines()
        .rev()
        .find(|l| l.trim_start().starts_with('{'))
        .ok_or_else(|| "bridge CLI returned no result".to_string())?;
    serde_json::from_str(json_line).map_err(|e| format!("bad bind result: {e}"))
}

/// Is the Claude desktop app installed here? Its `claude://` deep links are
/// how the picker starts a session INSIDE the app (survives a closed
/// terminal). macOS: the bundle exists; Windows: the scheme is registered.
#[tauri::command]
pub fn claude_desktop_available() -> bool {
    #[cfg(target_os = "macos")]
    {
        return std::path::Path::new("/Applications/Claude.app").is_dir()
            || dirs_home()
                .map(|h| h.join("Applications").join("Claude.app").is_dir())
                .unwrap_or(false);
    }
    #[cfg(target_os = "windows")]
    {
        return hidden_command("reg")
            .args(["query", "HKCU\\Software\\Classes\\claude"])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
    }
    #[allow(unreachable_code)]
    false
}

fn dirs_home() -> Option<std::path::PathBuf> {
    std::env::var_os("HOME").map(std::path::PathBuf::from)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenClaudeDesktopSessionArgs {
    pub folder: String,
    pub session_id: String,
    /// The one-line first prompt of the seed turn (shows in the transcript).
    pub seed_prompt: String,
}

/// Start a NEW Claude Code session INSIDE the Claude desktop app, in
/// `folder`, with a session id we chose (#148).
///
/// `claude://code/new?folder=…` was unreliable — sessions kept landing in a
/// scratch workspace — and gives no session id up front. What works: create
/// the session ourselves headlessly (`claude -p` with `--session-id`, cwd =
/// folder) and hand it to the app with `claude://resume?session=<id>`, which
/// imports the transcript, keeps its cwd, and continues it in the app under
/// the same id (`local_<id>`). The picker has already bound the id, and the
/// seed turn runs with an empty AGNTCHAT_HOME so its hooks stay silent
/// (no session card, no mirrored seed); the app-run session's first prompt
/// then reports as the agent and applies the picker's title.
#[tauri::command]
pub fn open_claude_desktop_session(args: OpenClaudeDesktopSessionArgs) -> Result<(), String> {
    if !args
        .session_id
        .chars()
        .all(|c| c.is_ascii_hexdigit() || c == '-')
    {
        return Err("invalid session id".to_string());
    }
    let dir = std::path::Path::new(&args.folder);
    if !dir.is_dir() {
        return Err(format!("not a folder: {}", args.folder));
    }
    let silent_home = std::env::temp_dir().join(format!("agntchat-seed-{}", args.session_id));
    std::fs::create_dir_all(&silent_home).map_err(|e| format!("temp dir: {e}"))?;
    // Through the login shell so `claude` resolves on the user's PATH — a
    // GUI app's own PATH is minimal. No MCP servers for the seed turn: it
    // only has to write the transcript.
    let script = "cd \"$0\" && claude --session-id \"$1\" --model haiku --max-turns 1 \
        --mcp-config '{\"mcpServers\":{}}' --strict-mcp-config -p \"$2\"";
    #[cfg(target_os = "windows")]
    let output = hidden_command("cmd")
        .args([
            "/c",
            &format!(
                "cd /d \"{}\" && claude --session-id {} --model haiku --max-turns 1 --mcp-config \"{{\\\"mcpServers\\\":{{}}}}\" --strict-mcp-config -p \"{}\"",
                args.folder,
                args.session_id,
                args.seed_prompt.replace('"', "'")
            ),
        ])
        .env("AGNTCHAT_HOME", &silent_home)
        .stdin(Stdio::null())
        .output();
    #[cfg(not(target_os = "windows"))]
    let output = hidden_command("/bin/zsh")
        .args(["-lc", script, &args.folder, &args.session_id, &args.seed_prompt])
        .env("AGNTCHAT_HOME", &silent_home)
        .stdin(Stdio::null())
        .output();
    let output = output.map_err(|e| format!("could not run claude to create the session: {e}"))?;
    let _ = std::fs::remove_dir_all(&silent_home);
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "claude could not create the session ({}): {}",
            output.status,
            err.lines().last().unwrap_or("").trim()
        ));
    }
    let url = format!("claude://resume?session={}", args.session_id);
    #[cfg(target_os = "macos")]
    let status = hidden_command("open").arg(&url).status();
    #[cfg(target_os = "windows")]
    let status = hidden_command("cmd").args(["/c", "start", "", &url]).status();
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let status = hidden_command("xdg-open").arg(&url).status();
    match status {
        Ok(s) if s.success() => Ok(()),
        Ok(s) => Err(format!("could not open the Claude app ({s})")),
        Err(e) => Err(format!("could not open the Claude app: {e}")),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RekeyExternalAgentArgs {
    pub agent_id: String,
    pub api_key: String,
    pub display_name: String,
    pub gateway_url: String,
}

/// After the owner regenerates an external agent's API key, rewrite the
/// credentials this machine saved for it (session bindings, project
/// bindings, machine default) so its sessions don't go stale and offline.
#[tauri::command]
pub fn rekey_external_agent(
    app: tauri::AppHandle,
    args: RekeyExternalAgentArgs,
) -> Result<serde_json::Value, String> {
    let out = run_agentchat_cli(
        &app,
        &[
            "rekey",
            "--agent-id",
            &args.agent_id,
            "--api-key",
            &args.api_key,
            "--display-name",
            &args.display_name,
            "--gateway-url",
            &args.gateway_url,
        ],
    )?;
    let json_line = out
        .lines()
        .rev()
        .find(|l| l.trim_start().starts_with('{'))
        .ok_or_else(|| "bridge CLI returned no result".to_string())?;
    serde_json::from_str(json_line).map_err(|e| format!("bad rekey result: {e}"))
}

/// Start a NEW Claude Code session in a terminal, pre-bound (#148): the
/// picker generated the session id and already ran `bind` for it, so the
/// session reports as the chosen agent from its first hook, and the channel
/// flag makes agntchat messages reach it live. macOS opens Terminal via
/// AppleScript; Windows opens a new console. Nothing is captured — the
/// user's terminal owns the process.
#[tauri::command]
pub fn launch_claude_session(folder: String, session_id: String) -> Result<(), String> {
    if !session_id
        .chars()
        .all(|c| c.is_ascii_hexdigit() || c == '-')
    {
        return Err("invalid session id".to_string());
    }
    let dir = std::path::Path::new(&folder);
    if !dir.is_dir() {
        return Err(format!("not a folder: {folder}"));
    }
    let claude_args = format!(
        "--session-id {session_id} --dangerously-load-development-channels server:agntchat"
    );

    #[cfg(target_os = "macos")]
    {
        // POSIX single-quote the folder for the shell, then escape for the
        // AppleScript string literal.
        let sh_folder = format!("'{}'", folder.replace('\'', "'\\''"));
        let shell_cmd = format!("cd {sh_folder} && claude {claude_args}");
        let applescript_cmd = shell_cmd.replace('\\', "\\\\").replace('"', "\\\"");
        let status = hidden_command("osascript")
            .arg("-e")
            .arg(format!("tell application \"Terminal\" to do script \"{applescript_cmd}\""))
            .arg("-e")
            .arg("tell application \"Terminal\" to activate")
            .status()
            .map_err(|e| format!("could not open Terminal: {e}"))?;
        if !status.success() {
            return Err(format!("Terminal refused to open the session ({status})"));
        }
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        // `start` opens a new console; `cmd /k` keeps it open when claude exits.
        let status = std::process::Command::new("cmd")
            .args([
                "/c",
                "start",
                "",
                "cmd",
                "/k",
                &format!("cd /d \"{folder}\" && claude {claude_args}"),
            ])
            .status()
            .map_err(|e| format!("could not open a console: {e}"))?;
        if !status.success() {
            return Err(format!("console launch failed ({status})"));
        }
        return Ok(());
    }

    #[allow(unreachable_code)]
    Err("launching a terminal is supported on macOS and Windows only".to_string())
}

/// Extract crash reason from collected log lines, providing user-friendly
/// messages with actionable fix instructions for common failure modes.
/// Returns `(reason, kind)` — `kind` is a machine-readable category the UI
/// can act on (currently only `"auth"`).
fn extract_crash_reason(logs: &Arc<Mutex<Vec<String>>>) -> Option<(String, Option<&'static str>)> {
    let lines = logs.lock().ok()?;
    if lines.is_empty() {
        return None;
    }

    let all_text = lines.join("\n");

    // --- Missing Python packages ---
    if let Some(module) = extract_missing_module(&all_text) {
        let install_hint = match module.as_str() {
            "httpx" | "websockets" =>
                format!("Missing Python package '{module}'. Run: pip3 install -r desktop/bridge/requirements.txt"),
            "anthropic" =>
                format!("Missing Python package '{module}'. Run: pip3 install anthropic"),
            "openai" =>
                format!("Missing Python package '{module}'. Run: pip3 install openai"),
            _ =>
                format!("Missing Python package '{module}'. Run: pip3 install {module}"),
        };
        return Some((install_hint, None));
    }

    // --- Authentication failures (the agent's AgentGram API key) ---
    // The bridge logs the specific cause after "AUTH_FAILED: " (invalid vs
    // deactivated) — surface that verbatim when present.
    if let Some(line) = lines.iter().find(|l| l.contains("AUTH_FAILED:")) {
        let detail = line
            .split("AUTH_FAILED:")
            .nth(1)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or("The agent's API key was rejected by the server.");
        return Some((detail.to_string(), Some("auth")));
    }
    if all_text.contains("AUTH_FAILED") || all_text.contains("401") {
        return Some(("The agent's API key was rejected — it may have been regenerated on another device. Generate a new key to run the agent on this computer.".to_string(), Some("auth")));
    }
    if all_text.contains("AuthError") {
        return Some(("Authentication error — the agent's API key doesn't work. Generate a new key to run the agent on this computer.".to_string(), Some("auth")));
    }

    // --- LLM API key issues ---
    if all_text.contains("AuthenticationError") && all_text.contains("api_key") {
        return Some(("LLM API key is invalid or expired. Update it in agent settings under LLM Provider.".to_string(), None));
    }
    if all_text.contains("Invalid API Key") || all_text.contains("Incorrect API key") {
        return Some(("LLM API key is invalid. Check your API key in agent settings.".to_string(), None));
    }
    if all_text.contains("RateLimitError") || all_text.contains("rate_limit") {
        return Some(("LLM rate limit exceeded. Wait a moment and try again, or check your API plan limits.".to_string(), None));
    }
    if all_text.contains("InsufficientQuotaError") || all_text.contains("insufficient_quota") {
        return Some(("LLM API quota exceeded. Check your billing/usage at your LLM provider's dashboard.".to_string(), None));
    }

    // --- Network / connection issues ---
    if all_text.contains("ConnectionError") || all_text.contains("ConnectError") {
        if all_text.contains("agentchat-backend") || all_text.contains("fly.dev") {
            return Some(("Cannot connect to AgentGram server. Check your internet connection.".to_string(), None));
        }
        return Some(("Connection error — check your internet connection and try again.".to_string(), None));
    }
    if all_text.contains("TimeoutError") || all_text.contains("timed out") {
        return Some(("Request timed out. The server may be busy — try again in a moment.".to_string(), None));
    }

    // --- Python runtime errors ---
    if all_text.contains("SyntaxError") {
        return Some(("Python syntax error in bridge script. This is a bug — please report it.".to_string(), None));
    }
    if all_text.contains("PermissionError") {
        return Some(("Permission denied — the bridge script doesn't have access to a required file or directory.".to_string(), None));
    }

    // --- Generic: find the last meaningful error line ---
    for line in lines.iter().rev() {
        // Look for Python traceback final lines
        if line.starts_with("ModuleNotFoundError:")
            || line.starts_with("ImportError:")
            || line.starts_with("RuntimeError:")
            || line.starts_with("ValueError:")
            || line.starts_with("TypeError:")
            || line.starts_with("OSError:")
            || line.starts_with("FileNotFoundError:")
            || line.contains("Error:") {
            let cleaned = if let Some(pos) = line.find("] ") {
                line[pos + 2..].to_string()
            } else {
                line.clone()
            };
            return Some((cleaned, None));
        }
    }

    // Last resort: return the last non-empty line
    lines
        .iter()
        .rev()
        .find(|l| !l.trim().is_empty())
        .cloned()
        .map(|l| (l, None))
}

/// Parse "ModuleNotFoundError: No module named 'xxx'" from log text.
fn extract_missing_module(text: &str) -> Option<String> {
    for line in text.lines() {
        if line.contains("ModuleNotFoundError") && line.contains("No module named") {
            // Extract the module name from quotes
            if let Some(start) = line.find('\'') {
                if let Some(end) = line[start + 1..].find('\'') {
                    let module = &line[start + 1..start + 1 + end];
                    // Return the top-level package name
                    return Some(module.split('.').next().unwrap_or(module).to_string());
                }
            }
        }
    }
    None
}

/// Spawn a background thread that reads stderr lines and appends to the shared log buffer.
fn spawn_log_reader(stderr: std::process::ChildStderr, logs: Arc<Mutex<Vec<String>>>) {
    std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines() {
            match line {
                Ok(l) => {
                    if let Ok(mut buf) = logs.lock() {
                        buf.push(l);
                        // Trim if over max
                        if buf.len() > MAX_LOG_LINES {
                            let drain_count = buf.len() - MAX_LOG_LINES;
                            buf.drain(0..drain_count);
                        }
                    }
                }
                Err(_) => break,
            }
        }
    });
}

#[tauri::command]
pub fn start_agent(
    app: tauri::AppHandle,
    state: State<'_, Mutex<ProcessManager>>,
    args: StartAgentArgs,
) -> Result<AgentProcess, String> {
    let mut manager = state.lock().map_err(|e| e.to_string())?;

    // Stop existing process if running. We do this *before* the
    // org_host short-circuit below so that switching an agent from
    // local → org_host cleanly tears down the local subprocess.
    if let Some(mut existing) = manager.agents.remove(&args.agent_id) {
        mark_offline_sync(&existing.api_url, &existing.agent_id, &existing.api_key);
        graceful_kill(&mut existing.child);
    }

    // Org-host runtime: the bridge runs on a registered Linux VM, not
    // here. The backend dispatches messages via the host's WebSocket
    // channel. The desktop has nothing to spawn — return a Remote
    // stub so the UI can show "Hosted on <org host>" instead of
    // tracking a (non-existent) local PID.
    if args.runtime.as_deref() == Some("org_host") {
        return Ok(AgentProcess {
            agent_id: args.agent_id,
            agent_name: args.agent_name,
            status: AgentStatus::Remote,
            uptime_secs: None,
            exit_code: None,
            crash_reason: None,
            crash_kind: None,
        });
    }

    let bridge_path = find_bridge_script(&app)?;

    let bridge_dir = std::path::Path::new(&bridge_path)
        .parent()
        .ok_or("Cannot determine bridge directory")?;
    let python = ensure_venv(bridge_dir)?;
    let mut cmd = hidden_command(&python);
    cmd.arg(&bridge_path);

    // The agentchat SDK is co-located with the bridge script in bridge/.
    // Python adds the script's directory to sys.path[0] automatically,
    // but set PYTHONPATH as a belt-and-suspenders fallback.
    if let Some(bridge_dir) = std::path::Path::new(&bridge_path).parent() {
        let bridge_dir_str = bridge_dir.to_string_lossy().to_string();
        let sep = if cfg!(target_os = "windows") { ";" } else { ":" };
        let pythonpath = match std::env::var("PYTHONPATH") {
            Ok(existing) => format!("{}{}{}", bridge_dir_str, sep, existing),
            Err(_) => bridge_dir_str,
        };
        cmd.env("PYTHONPATH", pythonpath);
    }

    cmd.env("AGENT_ID", &args.agent_id);
    cmd.env("AGENT_API_KEY", &args.api_key);

    // Tell the bridge which machine it's on — it reports this to the
    // backend so every client can show "running on <this machine>".
    let device_name = compute_device_name();
    if !device_name.is_empty() {
        cmd.env("AGENTGRAM_DEVICE_NAME", &device_name);
    }

    if let Some(ref url) = args.api_url {
        cmd.env("AGENTGRAM_API_URL", url);
    }
    if let Some(ref backend) = args.backend {
        cmd.env("MODEL_BACKEND", backend);
    }

    // CLI connection (auth/runtime) for local Claude Code / Codex agents.
    // This is the env that decides whether the `claude` CLI talks to the
    // Anthropic API, a subscription login, AWS Bedrock, or GCP Vertex.
    apply_cli_connection_env(&mut cmd, &args);

    if let Some(ref backend) = args.backend {
        cmd.args(["--backend", backend]);
    }
    if let Some(ref model) = args.model {
        cmd.args(["--model", model]);
    }
    if let Some(ref key) = args.llm_api_key {
        cmd.args(["--api-key", key]);
    }
    if let Some(ref url) = args.base_url {
        cmd.args(["--base-url", url]);
    }
    if let Some(tokens) = args.max_tokens {
        cmd.args(["--max-tokens", &tokens.to_string()]);
    }
    if let Some(limit) = args.history_limit {
        cmd.args(["--history-limit", &limit.to_string()]);
    }
    if let Some(ref mode) = args.execution_mode {
        cmd.args(["--execution-mode", mode]);
    }
    if args.dangerously_skip_permissions.unwrap_or(false) {
        cmd.arg("--dangerously-skip-permissions");
    }
    if args.computer_use_enabled.unwrap_or(false) {
        // The bridge's claude_cli backend reads this env var at construction
        // time to set the BOOT value. Setting `local` makes _build_mcp_config
        // add the computer_use stdio MCP server to Claude CLI's --mcp-config.
        // After boot the bridge resolves computer-use live from each turn's
        // behavioralConfig.computerUse directive (backend = single source of
        // truth), so toggling the setting on a running agent takes effect on
        // its next turn without a restart — this env var is just the seed.
        cmd.env("AGENTGRAM_COMPUTER_USE", "local");
        if let Some(ref apps) = args.computer_use_allowed_apps {
            let cleaned: Vec<&String> = apps.iter().filter(|s| !s.trim().is_empty()).collect();
            if !cleaned.is_empty() {
                // Newline separator — same pattern as CLAUDE_CLI_ADD_DIRS,
                // survives app names with commas/colons. Parsed by the MCP
                // server on startup.
                cmd.env(
                    "AGENTGRAM_COMPUTER_USE_ALLOWED_APPS",
                    cleaned.iter().map(|s| s.as_str()).collect::<Vec<_>>().join("\n"),
                );
            }
        }
    }
    if let Some(ref effort) = args.effort {
        cmd.args(["--effort", effort]);
    }
    if let Some(ref dirs) = args.add_dirs {
        let valid: Vec<&String> = dirs.iter().filter(|d| !d.is_empty()).collect();
        if !valid.is_empty() {
            // Newline separator — survives paths containing `,`, `:`, or `;`.
            // Parsed by parse_add_dirs_env in desktop/bridge/agentchat/backends/_cli_utils.py.
            cmd.env("CLAUDE_CLI_ADD_DIRS", valid.iter().map(|s| s.as_str()).collect::<Vec<_>>().join("\n"));
        }
    }

    cmd.stdout(Stdio::null());
    cmd.stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| {
        format!("Failed to start bridge: {}", e)
    })?;

    let logs = Arc::new(Mutex::new(Vec::new()));

    // Take stderr and spawn a background reader thread (non-blocking for the main Mutex)
    if let Some(stderr) = child.stderr.take() {
        spawn_log_reader(stderr, Arc::clone(&logs));
    }

    let api_url = args
        .api_url
        .clone()
        .unwrap_or_else(|| "https://agentchat-backend.fly.dev".to_string());

    let running = RunningAgent {
        child,
        started_at: Instant::now(),
        agent_name: args.agent_name.clone(),
        logs,
        crash_reason: None,
        crash_kind: None,
        agent_id: args.agent_id.clone(),
        api_key: args.api_key.clone(),
        api_url,
    };

    let agent_id = args.agent_id.clone();
    manager.agents.insert(agent_id.clone(), running);

    Ok(AgentProcess {
        agent_id,
        agent_name: args.agent_name,
        status: AgentStatus::Running,
        uptime_secs: Some(0),
        exit_code: None,
        crash_reason: None,
        crash_kind: None,
    })
}

#[tauri::command]
pub fn stop_agent(
    state: State<'_, Mutex<ProcessManager>>,
    agent_id: String,
) -> Result<AgentProcess, String> {
    let mut manager = state.lock().map_err(|e| e.to_string())?;

    if let Some(mut agent) = manager.agents.remove(&agent_id) {
        mark_offline_sync(&agent.api_url, &agent.agent_id, &agent.api_key);
        graceful_kill(&mut agent.child);

        let name = agent.agent_name.clone();

        Ok(AgentProcess {
            agent_id,
            agent_name: name,
            status: AgentStatus::Stopped,
            uptime_secs: None,
            exit_code: Some(0),
            crash_reason: None,
            crash_kind: None,
        })
    } else {
        Err(format!("Agent {} is not running", agent_id))
    }
}

#[tauri::command]
pub fn get_agent_status(
    state: State<'_, Mutex<ProcessManager>>,
    agent_id: String,
) -> Result<AgentProcess, String> {
    let mut manager = state.lock().map_err(|e| e.to_string())?;
    let (status, exit_code) = manager.check_process_status(&agent_id);

    if let Some(agent) = manager.agents.get(&agent_id) {
        let uptime = if status == AgentStatus::Running {
            Some(agent.started_at.elapsed().as_secs())
        } else {
            None
        };

        Ok(AgentProcess {
            agent_id,
            agent_name: agent.agent_name.clone(),
            status,
            uptime_secs: uptime,
            exit_code,
            crash_reason: agent.crash_reason.clone(),
            crash_kind: agent.crash_kind.clone(),
        })
    } else {
        Ok(AgentProcess {
            agent_id,
            agent_name: String::new(),
            status: AgentStatus::Stopped,
            uptime_secs: None,
            exit_code: None,
            crash_reason: None,
            crash_kind: None,
        })
    }
}

#[tauri::command]
pub fn get_all_statuses(
    state: State<'_, Mutex<ProcessManager>>,
) -> Result<Vec<AgentProcess>, String> {
    let mut manager = state.lock().map_err(|e| e.to_string())?;

    let agent_ids: Vec<String> = manager.agents.keys().cloned().collect();
    let mut results = Vec::new();

    for id in agent_ids {
        let (status, exit_code) = manager.check_process_status(&id);
        if let Some(agent) = manager.agents.get(&id) {
            let uptime = if status == AgentStatus::Running {
                Some(agent.started_at.elapsed().as_secs())
            } else {
                None
            };
            results.push(AgentProcess {
                agent_id: id,
                agent_name: agent.agent_name.clone(),
                status,
                uptime_secs: uptime,
                exit_code,
                crash_reason: agent.crash_reason.clone(),
                crash_kind: agent.crash_kind.clone(),
            });
        }
    }

    Ok(results)
}

#[tauri::command]
pub fn get_agent_logs(
    state: State<'_, Mutex<ProcessManager>>,
    agent_id: String,
    tail: Option<usize>,
) -> Result<Vec<String>, String> {
    let manager = state.lock().map_err(|e| e.to_string())?;

    if let Some(agent) = manager.agents.get(&agent_id) {
        // Read from the shared log buffer (populated by background thread)
        let logs = agent.logs.lock().map_err(|e| e.to_string())?;

        let count = tail.unwrap_or(100).min(logs.len());
        let start = logs.len().saturating_sub(count);
        Ok(logs[start..].to_vec())
    } else {
        Ok(Vec::new())
    }
}

/// Tell the backend the agent is offline before killing the bridge.
///
/// Belt-and-suspenders for the SDK's own SIGTERM-triggered deregister:
/// covers Force Quit, SIGKILL, crashes, or any path where Python doesn't
/// get to run its signal handler. Best-effort — short timeout, errors are
/// swallowed because we're seconds from killing the process anyway.
fn mark_offline_sync(api_url: &str, agent_id: &str, api_key: &str) {
    let url = format!("{}/api/gateway/shutdown", api_url.trim_end_matches('/'));
    let _ = ureq::post(&url)
        .timeout(std::time::Duration::from_millis(1500))
        .send_json(ureq::json!({
            "agent_id": agent_id,
            "api_key": api_key,
        }));
}

fn graceful_kill(child: &mut Child) {
    #[cfg(unix)]
    {
        let pid = child.id();
        unsafe {
            libc::kill(pid as i32, libc::SIGTERM);
        }
        for _ in 0..20 {
            match child.try_wait() {
                Ok(Some(_)) => return,
                _ => std::thread::sleep(std::time::Duration::from_millis(100)),
            }
        }
        let _ = child.kill();
    }

    #[cfg(not(unix))]
    {
        let _ = child.kill();
    }

    let _ = child.wait();
}

fn kill_orphan_bridges() {
    #[cfg(unix)]
    {
        if let Ok(output) = hidden_command("pgrep")
            .args(["-f", "agent_bridge\\.py"])
            .output()
        {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let my_pid = std::process::id();
            for line in stdout.lines() {
                if let Ok(pid) = line.trim().parse::<u32>() {
                    if pid != my_pid {
                        unsafe {
                            libc::kill(pid as i32, libc::SIGTERM);
                        }
                        eprintln!("[ProcessManager] Killed orphan bridge process {}", pid);
                    }
                }
            }
        }
    }
}

/// Apply the agent's chosen CLI connection (auth/runtime) to the bridge's env.
///
/// This is what lets a *local* Claude Code / Codex agent pick how it talks to
/// the model — subscription login vs Anthropic API vs AWS Bedrock vs GCP
/// Vertex — instead of silently inheriting whatever the machine's ambient env
/// happens to dictate.
///
/// CRITICAL: the child inherits this process's full environment, so on a
/// managed machine `CLAUDE_CODE_USE_BEDROCK` (or `_VERTEX`) may already be set
/// in the ambient env. If the user picks "subscription" or "anthropic" we MUST
/// actively `env_remove` those, or the Claude CLI would keep routing through
/// Bedrock and the user's choice would be a no-op. Each connection sets the
/// vars it owns and removes the ones it doesn't.
fn apply_cli_connection_env(cmd: &mut Command, args: &StartAgentArgs) {
    // Only the CLI backends honor these env vars. For API backends
    // (anthropic/openai/etc.) the connection is meaningless — leave the
    // env untouched so we don't disturb anything.
    let is_cli_backend = matches!(
        args.backend.as_deref(),
        Some("claude_cli") | Some("codex_cli")
    );
    if !is_cli_backend {
        return;
    }

    // Default to subscription when unset — the historical behavior, now
    // explicit. Unknown values are treated as subscription (safe fallback).
    let connection = args.cli_connection.as_deref().unwrap_or("subscription");

    // The mutually-exclusive provider switches the Claude CLI reads. We always
    // start by clearing BOTH, then set the one this connection needs. This is
    // the line that fixes the reported bug on managed/Bedrock machines.
    cmd.env_remove("CLAUDE_CODE_USE_BEDROCK");
    cmd.env_remove("CLAUDE_CODE_USE_VERTEX");

    match connection {
        "bedrock" => {
            cmd.env("CLAUDE_CODE_USE_BEDROCK", "1");
            // Claude Code requires AWS_REGION explicitly (it does not read
            // ~/.aws for the region). Fall back to a sane default so a
            // misconfigured agent fails with a clear AWS error rather than a
            // confusing "region unset" one. AWS credentials themselves come
            // from the machine's default chain (~/.aws, SSO, env), unchanged.
            let region = args.aws_region.as_deref().unwrap_or("us-east-1");
            cmd.env("AWS_REGION", region);
        }
        "vertex" => {
            cmd.env("CLAUDE_CODE_USE_VERTEX", "1");
            if let Some(ref region) = args.vertex_region {
                if !region.trim().is_empty() {
                    cmd.env("CLOUD_ML_REGION", region);
                }
            }
            if let Some(ref project) = args.vertex_project {
                if !project.trim().is_empty() {
                    cmd.env("ANTHROPIC_VERTEX_PROJECT_ID", project);
                }
            }
        }
        // "anthropic" (Anthropic-direct API) and "subscription" both leave the
        // provider switches cleared above. For "anthropic" the API key flows
        // through the existing `--api-key` arg / bridge env; for
        // "subscription" the CLI uses the machine's `claude login`. Nothing
        // more to set — the important work was clearing the Bedrock/Vertex
        // switches so an ambient value can't hijack the choice.
        _ => {}
    }
}

/// Ensure a Python virtual environment exists with required packages installed.
/// Creates the venv and runs `pip install -r requirements.txt` on first launch,
/// and re-installs when requirements.txt changes.
/// Returns the path to the venv's python executable.
fn ensure_venv(bridge_dir: &std::path::Path) -> Result<String, String> {
    let venv_dir = bridge_dir.join("venv");

    let (venv_python, venv_pip, system_python) = if cfg!(target_os = "windows") {
        (
            venv_dir.join("Scripts").join("python.exe"),
            venv_dir.join("Scripts").join("pip.exe"),
            "python",
        )
    } else {
        (
            venv_dir.join("bin").join("python3"),
            venv_dir.join("bin").join("pip3"),
            "python3",
        )
    };

    // A venv with python but no pip means a previous creation attempt died
    // partway through (e.g. ensurepip failure) — wipe it and start over.
    if venv_python.exists() && !venv_pip.exists() {
        eprintln!("[ProcessManager] Removing broken venv at {:?}", venv_dir);
        std::fs::remove_dir_all(&venv_dir)
            .map_err(|e| format!("Failed to remove broken venv at {:?}: {}", venv_dir, e))?;
    }

    // Create venv if it doesn't exist
    if !venv_python.exists() {
        eprintln!("[ProcessManager] Creating Python venv at {:?}", venv_dir);
        let output = hidden_command(system_python)
            .args(["-m", "venv", &venv_dir.to_string_lossy()])
            .output()
            .map_err(|e| {
                if e.kind() == std::io::ErrorKind::NotFound {
                    format!(
                        "Python not found. Install Python 3.9+ from https://python.org and ensure '{}' is on your PATH.",
                        system_python
                    )
                } else {
                    format!("Failed to create Python venv: {}", e)
                }
            })?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Failed to create Python venv: {}", stderr));
        }
    }

    // Install/update requirements if needed
    let req_file = bridge_dir.join("requirements.txt");
    let marker = venv_dir.join(".deps_installed");

    if req_file.exists() && needs_dep_install(&req_file, &marker) {
        eprintln!("[ProcessManager] Installing Python dependencies from requirements.txt");
        let output = hidden_command(&venv_python)
            .args(["-m", "pip", "install", "--quiet", "-r", &req_file.to_string_lossy()])
            .output()
            .map_err(|e| format!("Failed to install Python dependencies: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Failed to install Python dependencies: {}", stderr));
        }

        // Touch marker so we skip next time unless requirements.txt changes
        if let Err(e) = std::fs::write(&marker, "") {
            eprintln!("[ProcessManager] Warning: failed to write deps marker: {}", e);
        }
    }

    Ok(venv_python.to_string_lossy().to_string())
}

/// Returns true if pip install should run: either the marker doesn't exist
/// or requirements.txt has been modified since the last install.
fn needs_dep_install(req_file: &std::path::Path, marker: &std::path::Path) -> bool {
    if !marker.exists() {
        return true;
    }
    match (req_file.metadata(), marker.metadata()) {
        (Ok(req_meta), Ok(marker_meta)) => match (req_meta.modified(), marker_meta.modified()) {
            (Ok(req_time), Ok(marker_time)) => req_time > marker_time,
            _ => true,
        },
        _ => true,
    }
}

// --- Optional computer-use dependencies (pyobjc + Pillow) ---
//
// These deps live in a separate requirements-computer-use.txt rather
// than the main requirements.txt to keep them OFF the agent-start hot
// path — installing pyobjc+Pillow synchronously was producing a multi-
// minute "spinning wheel" on agent launch (~50-80MB of wheels with
// occasional Pillow source builds).
//
// The frontend kicks off `install_computer_use_deps` in the background
// when the user enables computer-use; the MCP server soft-imports and
// degrades cleanly while the install runs.

#[derive(Default, Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DepsStatus {
    /// "unknown" | "installed" | "installing" | "failed"
    pub state: String,
    /// Populated when state == "failed". Short message.
    pub error: Option<String>,
    /// Up to ~20 tail lines from pip's stderr — handy for in-UI surfacing
    /// when the install hits a snag (e.g. Pillow source-build failure).
    pub log_tail: Vec<String>,
}

fn deps_status() -> &'static Mutex<DepsStatus> {
    static S: OnceLock<Mutex<DepsStatus>> = OnceLock::new();
    S.get_or_init(|| {
        Mutex::new(DepsStatus {
            state: "unknown".to_string(),
            ..Default::default()
        })
    })
}

fn bridge_venv_python(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let bridge_path = find_bridge_script(app)?;
    let bridge_dir = std::path::Path::new(&bridge_path)
        .parent()
        .ok_or_else(|| "Cannot determine bridge directory".to_string())?
        .to_path_buf();
    let python = if cfg!(target_os = "windows") {
        bridge_dir.join("venv").join("Scripts").join("python.exe")
    } else {
        bridge_dir.join("venv").join("bin").join("python3")
    };
    Ok(python)
}

fn bridge_dir_for(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let bridge_path = find_bridge_script(app)?;
    Ok(std::path::Path::new(&bridge_path)
        .parent()
        .ok_or_else(|| "Cannot determine bridge directory".to_string())?
        .to_path_buf())
}

#[tauri::command]
pub fn check_computer_use_deps(app: tauri::AppHandle) -> bool {
    // Quick import check — runs in-process so it must stay cheap.
    let python = match bridge_venv_python(&app) {
        Ok(p) if p.exists() => p,
        _ => return false,
    };
    // macOS: the optional pyobjc+Pillow extras. Windows: the driver is
    // ctypes (stdlib) + Pillow, which requirements.txt installs into the
    // venv on win32 — so PIL.ImageGrab importing IS "fully equipped".
    let probe = if cfg!(target_os = "macos") {
        "import Quartz; import PIL"
    } else {
        "import PIL.ImageGrab"
    };
    let ok = hidden_command(&python)
        .args(["-c", probe])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);
    if let Ok(mut s) = deps_status().lock() {
        if ok && s.state != "installing" {
            s.state = "installed".to_string();
            s.error = None;
        } else if !ok && s.state == "unknown" {
            // Don't clobber an in-progress install or a known-failed state.
            // "unknown" → "not_installed" so the UI can offer the install
            // button instead of showing an indefinite spinner.
            s.state = "not_installed".to_string();
        }
    }
    ok
}

/// Open a visible system terminal running `claude login`, so the user can
/// fix a `llm_unauthenticated` blocker without leaving the app. On the
/// local machine the CLI owns the whole flow — it opens the browser,
/// catches the localhost OAuth callback, and stores the credential — the
/// terminal exists so its prompts and errors stay visible. The command
/// returns as soon as the terminal is spawned; completion is observed the
/// normal way (the agent's next turn succeeds and health clears).
#[tauri::command]
pub fn open_claude_login() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        // `start`'s first quoted argument is the window title.
        std::process::Command::new("cmd")
            .args(["/c", "start", "Claude sign-in", "cmd", "/k", "claude", "login"])
            .spawn()
            .map_err(|e| format!("could not open a terminal: {e}"))?;
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("osascript")
            .args([
                "-e",
                "tell application \"Terminal\" to activate",
                "-e",
                "tell application \"Terminal\" to do script \"claude login\"",
            ])
            .spawn()
            .map_err(|e| format!("could not open Terminal: {e}"))?;
        Ok(())
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        Err("Claude sign-in from the app is only supported on Windows and macOS".to_string())
    }
}

#[tauri::command]
pub fn get_computer_use_deps_status() -> DepsStatus {
    deps_status()
        .lock()
        .map(|s| s.clone())
        .unwrap_or_default()
}

#[tauri::command]
pub fn install_computer_use_deps(app: tauri::AppHandle) -> Result<(), String> {
    // There is nothing to install outside macOS: the Windows driver is
    // stdlib ctypes + Pillow, and Pillow ships via requirements.txt's
    // win32 marker on the normal agent-start path.
    if !cfg!(target_os = "macos") {
        return Err(
            "Nothing to install: computer-use safety features are built into the Windows driver (Pillow ships with the bridge runtime).".to_string(),
        );
    }

    // Refuse to start a second install if one is already running.
    {
        let mut s = deps_status()
            .lock()
            .map_err(|e| format!("deps_status lock poisoned: {}", e))?;
        if s.state == "installing" {
            return Err("Install already in progress".to_string());
        }
        s.state = "installing".to_string();
        s.error = None;
        s.log_tail.clear();
    }

    let bridge_dir = bridge_dir_for(&app)?;
    let req_file = bridge_dir.join("requirements-computer-use.txt");
    if !req_file.exists() {
        let mut s = deps_status().lock().unwrap();
        s.state = "failed".to_string();
        s.error = Some(format!(
            "requirements-computer-use.txt not found at {}",
            req_file.display()
        ));
        return Err(s.error.clone().unwrap_or_default());
    }

    // Run pip in a background thread so the Tauri command thread (and the
    // UI behind it) doesn't block. Status updates land in `deps_status`
    // and the frontend polls via get_computer_use_deps_status.
    std::thread::spawn(move || {
        // ensure_venv both creates the venv on first use and wipes/recreates
        // a half-built one (python.exe present, pip missing — the ensurepip
        // failure mode). Running `python -m pip` against such a venv is what
        // used to surface as "No module named pip" in the UI.
        let python = match ensure_venv(&bridge_dir) {
            Ok(p) => p,
            Err(e) => {
                if let Ok(mut s) = deps_status().lock() {
                    s.state = "failed".to_string();
                    s.error = Some(e.clone());
                }
                eprintln!("[ProcessManager] venv setup failed: {}", e);
                return;
            }
        };
        eprintln!(
            "[ProcessManager] installing computer-use deps via pip from {}",
            req_file.display()
        );
        let result = hidden_command(&python)
            .args([
                "-m",
                "pip",
                "install",
                "-r",
                &req_file.to_string_lossy(),
            ])
            .output();
        let mut s = match deps_status().lock() {
            Ok(g) => g,
            Err(e) => {
                eprintln!("[ProcessManager] deps_status lock poisoned: {}", e);
                return;
            }
        };
        match result {
            Ok(out) if out.status.success() => {
                s.state = "installed".to_string();
                s.error = None;
                let stderr = String::from_utf8_lossy(&out.stderr);
                s.log_tail = stderr
                    .lines()
                    .rev()
                    .take(20)
                    .map(|l| l.to_string())
                    .collect();
                s.log_tail.reverse();
                eprintln!("[ProcessManager] computer-use deps installed");
            }
            Ok(out) => {
                s.state = "failed".to_string();
                let stderr = String::from_utf8_lossy(&out.stderr).to_string();
                let preview: String = stderr.lines().rev().next().unwrap_or("").to_string();
                s.error = Some(format!("pip exit {}: {}", out.status, preview));
                s.log_tail = stderr
                    .lines()
                    .rev()
                    .take(20)
                    .map(|l| l.to_string())
                    .collect();
                s.log_tail.reverse();
                eprintln!(
                    "[ProcessManager] computer-use deps install FAILED ({}): {}",
                    out.status,
                    s.error.clone().unwrap_or_default()
                );
            }
            Err(e) => {
                s.state = "failed".to_string();
                s.error = Some(format!("could not spawn pip: {}", e));
                eprintln!("[ProcessManager] could not spawn pip: {}", e);
            }
        }
    });

    Ok(())
}

/// Stringify a path, stripping Windows verbatim (`\\?\`) prefixes.
/// Python's venv/ensurepip/pip cannot handle extended-length paths, so every
/// path we hand to a Python subprocess must be a plain drive-letter path.
fn plain_path(p: &std::path::Path) -> String {
    dunce::simplified(p).to_string_lossy().to_string()
}

fn find_bridge_script(app: &tauri::AppHandle) -> Result<String, String> {
    use tauri::Manager;

    // 1. Tauri resource directory (bundled app)
    //    Resources from ../bridge/ resolve to _up_/bridge/ in the bundle
    if let Ok(resource_dir) = app.path().resource_dir() {
        let path = resource_dir
            .join("_up_")
            .join("bridge")
            .join("agent_bridge.py");
        if path.exists() {
            return Ok(plain_path(&path));
        }
    }

    // 2. Walk up from the executable, looking for desktop/bridge/
    if let Ok(exe) = std::env::current_exe().and_then(|e| e.canonicalize()) {
        for ancestor in exe.ancestors().skip(1) {
            let candidate = ancestor.join("bridge").join("agent_bridge.py");
            if candidate.exists() {
                return Ok(plain_path(&candidate));
            }
        }
    }

    // 3. Walk up from cwd (dev mode fallback)
    if let Ok(cwd) = std::env::current_dir() {
        for ancestor in cwd.ancestors() {
            let candidate = ancestor.join("bridge").join("agent_bridge.py");
            if candidate.exists() {
                return Ok(plain_path(&candidate));
            }
        }
    }

    Err("Bridge script not found. Ensure desktop/bridge/agent_bridge.py exists.".to_string())
}
