//! Dev-server lifecycle: spawn a project's dev command, detect readiness
//! from stdout URLs plus a TCP probe, expose status transitions as events,
//! and kill the whole process group on stop/app exit (§43–48).
//!
//! Security notes:
//! - the working directory must validate against the caller-provided
//!   workspace root (same validator as run_command);
//! - the frontend enforces the Evir permission flow before invoking
//!   `dev_server_start` (detect → show command → confirm → start).

use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum DevStatus {
    Starting,
    Ready,
    Running,
    Stopped,
    Crashed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevServerRecord {
    pub project_id: String,
    pub cwd: String,
    pub program: String,
    pub args: Vec<String>,
    pub pid: u32,
    pub status: DevStatus,
    pub port: Option<u16>,
    pub url: Option<String>,
    pub started_at: u64,
    /// Exit code when the process has ended (None while running or when
    /// terminated by a signal); drives the App Preview failure UI.
    pub exit_code: Option<i32>,
    /// Rolling tail of recent output lines for diagnostics.
    pub last_output: Vec<String>,
}

struct ManagedProcess {
    child: Child,
    pgid: i32,
}

#[derive(Default)]
pub struct DevServerState {
    servers: Mutex<HashMap<String, DevServerRecord>>,
    processes: Mutex<HashMap<String, Arc<Mutex<ManagedProcess>>>>,
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

/// Extract the first localhost-ish port mentioned in a log line, e.g.
/// "Local: http://localhost:5173/" or "running at 127.0.0.1:3000".
pub fn parse_port_from_line(line: &str) -> Option<u16> {
    for (index, _) in line.match_indices(':') {
        let tail: String = line[index + 1..]
            .chars()
            .take_while(|c| c.is_ascii_digit())
            .collect();
        if tail.len() < 2 || tail.len() > 5 {
            continue;
        }
        let port: u32 = tail.parse().ok()?;
        if (1024..=65535).contains(&port) {
            // Only accept ports advertised for a loopback host.
            let head = &line[..index];
            if head.ends_with("localhost")
                || head.ends_with("127.0.0.1")
                || head.ends_with("[::1]")
                || head.ends_with("0.0.0.0")
            {
                return Some(port as u16);
            }
        }
    }
    None
}

fn probe_port(port: u16) -> bool {
    std::net::TcpStream::connect_timeout(
        &format!("127.0.0.1:{port}")
            .parse()
            .expect("valid socket addr"),
        Duration::from_millis(500),
    )
    .is_ok()
}

fn emit_status(app: &AppHandle, record: &DevServerRecord) {
    eprintln!(
        "[dev-server] project={} status={:?} port={:?}",
        record.project_id, record.status, record.port
    );
    let _ = app.emit("dev-server-status", record);
}

fn kill_process_group(managed: &ManagedProcess) {
    #[cfg(unix)]
    unsafe {
        // Negative pid signals the whole process group: `npm run dev` spawns
        // node/vite children that a bare child.kill() would orphan.
        libc::kill(-managed.pgid, libc::SIGTERM);
    }
    #[cfg(not(unix))]
    {
        let _ = managed.child.kill();
    }
}

fn spawn_watchers(app: AppHandle, project_id: String, child: Child, pgid: i32) {
    let shared = Arc::new(Mutex::new(ManagedProcess { child, pgid }));
    app.state::<DevServerState>()
        .processes
        .lock()
        .expect("dev server lock")
        .insert(project_id.clone(), shared.clone());

    let stdout = shared.lock().expect("dev server lock").child.stdout.take();
    let stderr = shared.lock().expect("dev server lock").child.stderr.take();

    // A long-running command may never print a URL. Do not leave the UI in
    // "Starting" forever: after the readiness window, report that the process
    // is running without a confirmed port. A later URL line can still promote
    // this state to Ready.
    {
        let app = app.clone();
        let project_id = project_id.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_secs(60)).await;
            let state = app.state::<DevServerState>();
            let mut servers = state.servers.lock().expect("dev server lock");
            if let Some(record) = servers.get_mut(&project_id) {
                if matches!(record.status, DevStatus::Starting) {
                    record.status = DevStatus::Running;
                    let updated = record.clone();
                    drop(servers);
                    emit_status(&app, &updated);
                }
            }
        });
    }

    // Exit watcher: marks the server crashed/stopped when the process dies.
    {
        let app = app.clone();
        let project_id = project_id.clone();
        let shared = shared.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_millis(500)).await;
                let status = {
                    let mut guard = shared.lock().expect("dev server lock");
                    match guard.child.try_wait() {
                        Ok(status) => status,
                        Err(_) => return,
                    }
                };
                let Some(status) = status else { continue };
                let state = app.state::<DevServerState>();
                let updated = {
                    let servers = state.servers.lock().expect("dev server lock");
                    let Some(record) = servers.get(&project_id) else {
                        state
                            .processes
                            .lock()
                            .expect("dev server lock")
                            .remove(&project_id);
                        return;
                    };
                    if matches!(record.status, DevStatus::Stopped) {
                        None
                    } else {
                        let mut updated = record.clone();
                        updated.status = if status.success() {
                            DevStatus::Stopped
                        } else {
                            DevStatus::Crashed
                        };
                        updated.exit_code = status.code();
                        Some(updated)
                    }
                };
                if let Some(updated) = updated {
                    state
                        .servers
                        .lock()
                        .expect("dev server lock")
                        .insert(project_id.clone(), updated.clone());
                    emit_status(&app, &updated);
                }
                state
                    .processes
                    .lock()
                    .expect("dev server lock")
                    .remove(&project_id);
                return;
            }
        });
    }

    let spawn_reader = |stream: Option<Box<dyn std::io::Read + Send>>, is_stdout: bool| {
        let Some(stream) = stream else { return };
        let app = app.clone();
        let project_id = project_id.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stream);
            for line in reader.lines().map_while(Result::ok) {
                let state = app.state::<DevServerState>();
                {
                    let mut servers = state.servers.lock().expect("dev server lock");
                    let Some(record) = servers.get_mut(&project_id) else {
                        return;
                    };
                    record.last_output.push(format!(
                        "{}: {}",
                        if is_stdout { "out" } else { "err" },
                        line
                    ));
                    let overflow = record.last_output.len().saturating_sub(20);
                    if overflow > 0 {
                        record.last_output.drain(0..overflow);
                    }
                }
                let Some(port) = parse_port_from_line(&line) else {
                    continue;
                };
                let should_probe = {
                    let servers = state.servers.lock().expect("dev server lock");
                    servers
                        .get(&project_id)
                        .map(|record| {
                            matches!(record.status, DevStatus::Starting | DevStatus::Running)
                                && record.port.is_none()
                        })
                        .unwrap_or(false)
                };
                if !should_probe {
                    continue;
                }
                let app = app.clone();
                let project_id = project_id.clone();
                std::thread::spawn(move || {
                    for _ in 0..120 {
                        if probe_port(port) {
                            let state = app.state::<DevServerState>();
                            let mut servers = state.servers.lock().expect("dev server lock");
                            if let Some(record) = servers.get_mut(&project_id) {
                                if matches!(record.status, DevStatus::Starting | DevStatus::Running)
                                {
                                    record.status = DevStatus::Ready;
                                    record.port = Some(port);
                                    record.url = Some(format!("http://localhost:{port}"));
                                    let updated = record.clone();
                                    drop(servers);
                                    emit_status(&app, &updated);
                                }
                            }
                            return;
                        }
                        std::thread::sleep(Duration::from_millis(500));
                    }
                    // No probe success within 60s: surface as running without
                    // a confirmed URL rather than lying about readiness.
                    let state = app.state::<DevServerState>();
                    let mut servers = state.servers.lock().expect("dev server lock");
                    if let Some(record) = servers.get_mut(&project_id) {
                        if matches!(record.status, DevStatus::Starting) {
                            record.status = DevStatus::Running;
                            let updated = record.clone();
                            drop(servers);
                            emit_status(&app, &updated);
                        }
                    }
                });
            }
        });
    };
    spawn_reader(
        stdout.map(|s| Box::new(s) as Box<dyn std::io::Read + Send>),
        true,
    );
    spawn_reader(
        stderr.map(|s| Box::new(s) as Box<dyn std::io::Read + Send>),
        false,
    );
}

#[tauri::command]
pub async fn dev_server_start(
    app: AppHandle,
    state: tauri::State<'_, DevServerState>,
    project_id: String,
    cwd: String,
    program: String,
    args: Vec<String>,
    workspace_root: String,
) -> Result<DevServerRecord, String> {
    // Same containment rule as run_command: the server runs inside the
    // project's validated workspace root.
    let validated = crate::commands::validate_path_in_workspace(&cwd, &workspace_root)?;
    let program_path = lookup_program(&program)?;

    let mut command = Command::new(program_path);
    command
        .args(&args)
        .current_dir(&validated)
        .env(
            // pnpm >=10 runs a dependency-status check (verify-deps-before-run)
            // before executing scripts; in Evir's non-TTY child environment that
            // check can trigger an implicit `pnpm install` which fails (e.g. on
            // un-approved build scripts) and kills the dev server before it
            // ever binds. Starting a preview must never mutate the user's
            // node_modules — disable the pre-run check.
            "npm_config_verify_deps_before_run",
            "false",
        )
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt as _;
        command.process_group(0);
    }
    let child = command.spawn().map_err(|error| error.to_string())?;
    let pid = child.id();
    #[cfg(unix)]
    let pgid = pid as i32;
    #[cfg(not(unix))]
    let pgid = 0;

    let record = DevServerRecord {
        project_id: project_id.clone(),
        cwd: cwd.clone(),
        program: program.clone(),
        args: args.clone(),
        pid,
        status: DevStatus::Starting,
        port: None,
        url: None,
        started_at: now_millis(),
        exit_code: None,
        last_output: Vec::new(),
    };
    {
        let mut servers = state.servers.lock().expect("dev server lock");
        servers.insert(project_id.clone(), record.clone());
    }
    emit_status(&app, &record);
    spawn_watchers(app, project_id, child, pgid);
    Ok(record)
}

fn lookup_program(program: &str) -> Result<PathBuf, String> {
    if program.contains('/') || program.contains('\\') {
        return Ok(PathBuf::from(program));
    }
    // Resolve through PATH to avoid shell interpretation entirely.
    let path = std::env::var("PATH").unwrap_or_default();
    for dir in path.split(':') {
        if dir.is_empty() {
            continue;
        }
        let candidate = PathBuf::from(dir).join(program);
        if candidate.is_file() {
            return Ok(candidate);
        }
    }
    Err(format!("program not found on PATH: {program}"))
}

#[tauri::command]
pub async fn dev_server_stop(
    app: AppHandle,
    state: tauri::State<'_, DevServerState>,
    project_id: String,
) -> Result<(), String> {
    stop_server(&app, &state, &project_id)
}

fn stop_server(
    app: &AppHandle,
    state: &tauri::State<'_, DevServerState>,
    project_id: &str,
) -> Result<(), String> {
    let process = state
        .processes
        .lock()
        .expect("dev server lock")
        .get(project_id)
        .cloned();
    if let Some(process) = process {
        let guard = process.lock().expect("dev server lock");
        kill_process_group(&guard);
    }
    let mut servers = state.servers.lock().expect("dev server lock");
    if let Some(record) = servers.get_mut(project_id) {
        record.status = DevStatus::Stopped;
        let updated = record.clone();
        drop(servers);
        state
            .processes
            .lock()
            .expect("dev server lock")
            .remove(project_id);
        emit_status(app, &updated);
    }
    Ok(())
}

#[tauri::command]
pub fn dev_server_list(state: tauri::State<'_, DevServerState>) -> Vec<DevServerRecord> {
    state
        .servers
        .lock()
        .expect("dev server lock")
        .values()
        .cloned()
        .collect()
}

/// Kill every managed dev server. Called on app exit so no orphan dev
/// processes survive Evir (§48).
pub fn kill_all(app: &AppHandle) {
    let state = app.state::<DevServerState>();
    let ids: Vec<String> = state
        .servers
        .lock()
        .expect("dev server lock")
        .keys()
        .cloned()
        .collect();
    for id in ids {
        let _ = stop_server(app, &state, &id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_vite_style_urls() {
        assert_eq!(
            parse_port_from_line("  ➜  Local:   http://localhost:5173/"),
            Some(5173)
        );
        assert_eq!(
            parse_port_from_line("running at http://127.0.0.1:3000"),
            Some(3000)
        );
        assert_eq!(
            parse_port_from_line("Network: http://192.168.1.4:5173/"),
            None
        );
    }

    #[test]
    fn rejects_non_loopback_and_rubbish() {
        assert_eq!(
            parse_port_from_line("proxy target host.example.com:5173"),
            None
        );
        assert_eq!(parse_port_from_line("nothing here"), None);
        assert_eq!(parse_port_from_line("timing: 12345"), None);
    }

    #[test]
    fn accepts_zero_0_0_0_0_hosts() {
        assert_eq!(
            parse_port_from_line("listening on 0.0.0.0:8080"),
            Some(8080)
        );
    }

    #[test]
    fn serializes_records_for_the_frontend_in_camel_case() {
        let record = DevServerRecord {
            project_id: "project-1".into(),
            cwd: "/tmp/project".into(),
            program: "pnpm".into(),
            args: vec!["run".into(), "dev:web".into()],
            pid: 42,
            status: DevStatus::Starting,
            port: None,
            url: None,
            started_at: 123,
            exit_code: None,
            last_output: vec!["out: starting".into()],
        };
        let value = serde_json::to_value(record).expect("serialize dev server record");

        assert_eq!(value["projectId"], "project-1");
        assert_eq!(value["startedAt"], 123);
        assert_eq!(value["lastOutput"][0], "out: starting");
        assert!(value.get("project_id").is_none());
    }
}
