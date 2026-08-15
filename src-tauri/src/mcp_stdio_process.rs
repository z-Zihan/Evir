use serde_json::Value;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};

const MAX_STDERR_BYTES: usize = 50_000;
const MAX_STDOUT_LINE_BYTES: usize = 5 * 1024 * 1024;

pub(crate) struct McpProcessSpec {
    pub command: String,
    pub args: Vec<String>,
    pub cwd: Option<String>,
    pub env: HashMap<String, String>,
}

pub(crate) struct McpProcessStatus {
    pub running: bool,
    pub pid: u32,
    pub exit_code: Option<i32>,
    #[cfg(test)]
    pub stderr: String,
}

pub(crate) struct McpProcessHandle {
    cancelled: AtomicBool,
    inner: Mutex<McpProcess>,
}

struct McpProcess {
    child: Child,
    stdin: ChildStdin,
    responses: mpsc::Receiver<Result<Value, String>>,
    _stderr: Arc<Mutex<String>>,
}

fn baseline_env() -> HashMap<String, String> {
    let mut env = HashMap::new();
    for key in [
        "PATH",
        "HOME",
        "USERPROFILE",
        "SystemRoot",
        "WINDIR",
        "PATHEXT",
        "TMPDIR",
        "TMP",
        "TEMP",
        "LANG",
        "LC_ALL",
    ] {
        if let Ok(value) = std::env::var(key) {
            env.insert(key.to_owned(), value);
        }
    }
    env
}

fn append_bounded(target: &mut String, text: &str) {
    target.push_str(text);
    if target.len() <= MAX_STDERR_BYTES {
        return;
    }
    let mut start = target.len() - MAX_STDERR_BYTES;
    while !target.is_char_boundary(start) {
        start += 1;
    }
    target.drain(..start);
}

fn read_stderr(mut stderr: impl Read, buffer: Arc<Mutex<String>>) {
    let mut bytes = [0_u8; 4096];
    loop {
        let count = match stderr.read(&mut bytes) {
            Ok(0) | Err(_) => return,
            Ok(count) => count,
        };
        if let Ok(mut target) = buffer.lock() {
            append_bounded(&mut target, &String::from_utf8_lossy(&bytes[..count]));
        }
    }
}

fn read_bounded_line(reader: &mut impl BufRead) -> Result<Option<Vec<u8>>, String> {
    let mut line = Vec::new();
    loop {
        let available = reader.fill_buf().map_err(|error| error.to_string())?;
        if available.is_empty() {
            return Ok((!line.is_empty()).then_some(line));
        }
        let count = available
            .iter()
            .position(|byte| *byte == b'\n')
            .map_or(available.len(), |index| index + 1);
        if line.len() + count > MAX_STDOUT_LINE_BYTES {
            return Err("MCP stdout message exceeds the size limit".to_owned());
        }
        line.extend_from_slice(&available[..count]);
        reader.consume(count);
        if line.ends_with(b"\n") {
            return Ok(Some(line));
        }
    }
}

fn read_stdout(
    stdout: impl Read,
    notify: Arc<dyn Fn(Value) + Send + Sync>,
    tx: mpsc::Sender<Result<Value, String>>,
) {
    let mut reader = BufReader::new(stdout);
    loop {
        let line = match read_bounded_line(&mut reader) {
            Ok(Some(line)) => line,
            Ok(None) => break,
            Err(error) => {
                let _ = tx.send(Err(error));
                break;
            }
        };
        let line = String::from_utf8_lossy(&line);
        if line.trim().is_empty() {
            continue;
        }
        let message = match serde_json::from_str::<Value>(line.trim_end()) {
            Ok(message) => message,
            Err(_) => {
                let _ = tx.send(Err("MCP server emitted invalid JSON on stdout".to_owned()));
                break;
            }
        };
        if message.get("id").is_some() {
            if tx.send(Ok(message)).is_err() {
                return;
            }
        } else if message.get("method").is_some() {
            notify(message);
        } else {
            let _ = tx.send(Err(
                "MCP server emitted an invalid JSON-RPC message".to_owned()
            ));
            break;
        }
    }
    drop(tx);
    notify(serde_json::json!({
        "jsonrpc": "2.0",
        "method": "evir/process_exited"
    }));
}

fn write_message(process: &mut McpProcess, message: &Value) -> Result<(), String> {
    let mut encoded = serde_json::to_vec(message).map_err(|error| error.to_string())?;
    encoded.push(b'\n');
    process
        .stdin
        .write_all(&encoded)
        .map_err(|error| error.to_string())?;
    process.stdin.flush().map_err(|error| error.to_string())
}

fn terminate(process: &mut McpProcess) {
    #[cfg(unix)]
    unsafe {
        libc::kill(-(process.child.id() as i32), libc::SIGTERM);
    }
    #[cfg(windows)]
    let _ = Command::new("taskkill")
        .args(["/PID", &process.child.id().to_string(), "/T", "/F"])
        .status();
    #[cfg(not(any(unix, windows)))]
    let _ = process.child.kill();

    let deadline = Instant::now() + Duration::from_secs(2);
    while Instant::now() < deadline {
        if process.child.try_wait().ok().flatten().is_some() {
            return;
        }
        std::thread::sleep(Duration::from_millis(25));
    }
    #[cfg(unix)]
    unsafe {
        libc::kill(-(process.child.id() as i32), libc::SIGKILL);
    }
    #[cfg(windows)]
    let _ = Command::new("taskkill")
        .args(["/PID", &process.child.id().to_string(), "/T", "/F"])
        .status();
    #[cfg(not(any(unix, windows)))]
    let _ = process.child.kill();
    let _ = process.child.wait();
}

impl McpProcessHandle {
    pub fn spawn(
        spec: McpProcessSpec,
        notify: Arc<dyn Fn(Value) + Send + Sync>,
    ) -> Result<Self, String> {
        if spec.command.trim().is_empty() {
            return Err("MCP command is required".to_owned());
        }
        let mut command = Command::new(&spec.command);
        command.args(&spec.args);
        if let Some(cwd) = spec.cwd.as_deref().filter(|cwd| !cwd.is_empty()) {
            let path = std::path::Path::new(cwd);
            if !path.is_dir() {
                return Err("MCP working directory does not exist".to_owned());
            }
            command.current_dir(path);
        }
        let mut env = baseline_env();
        env.extend(spec.env);
        command.env_clear().envs(env);
        command.stdin(Stdio::piped());
        command.stdout(Stdio::piped());
        command.stderr(Stdio::piped());
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            command.process_group(0);
        }
        let mut child = command.spawn().map_err(|error| error.to_string())?;
        let stdin = child.stdin.take().ok_or("MCP process has no stdin")?;
        let stdout = child.stdout.take().ok_or("MCP process has no stdout")?;
        let stderr_pipe = child.stderr.take().ok_or("MCP process has no stderr")?;
        let stderr = Arc::new(Mutex::new(String::new()));
        let stderr_target = Arc::clone(&stderr);
        std::thread::spawn(move || read_stderr(stderr_pipe, stderr_target));
        let (response_tx, response_rx) = mpsc::channel();
        std::thread::spawn(move || read_stdout(stdout, notify, response_tx));
        Ok(Self {
            cancelled: AtomicBool::new(false),
            inner: Mutex::new(McpProcess {
                child,
                stdin,
                responses: response_rx,
                _stderr: stderr,
            }),
        })
    }

    pub fn pid(&self) -> Result<u32, String> {
        self.inner
            .lock()
            .map(|process| process.child.id())
            .map_err(|_| "MCP process is poisoned".to_owned())
    }

    pub fn request(&self, request: Value, timeout_ms: u64) -> Result<Value, String> {
        if request.get("jsonrpc").and_then(Value::as_str) != Some("2.0")
            || request.get("method").and_then(Value::as_str).is_none()
        {
            return Err("MCP request must be a JSON-RPC 2.0 method call".to_owned());
        }
        let expected_id = request
            .get("id")
            .cloned()
            .ok_or("MCP request id is required")?;
        let mut process = self
            .inner
            .lock()
            .map_err(|_| "MCP process is poisoned".to_owned())?;
        if process
            .child
            .try_wait()
            .map_err(|error| error.to_string())?
            .is_some()
        {
            return Err("MCP server exited".to_owned());
        }
        write_message(&mut process, &request)?;
        let timeout = Duration::from_millis(timeout_ms);
        let deadline = Instant::now() + timeout;
        loop {
            if self.cancelled.load(Ordering::SeqCst) {
                return Err("MCP request cancelled".to_owned());
            }
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(format!("MCP request timed out after {timeout_ms}ms"));
            }
            match process
                .responses
                .recv_timeout(remaining.min(Duration::from_millis(50)))
            {
                Ok(Ok(response)) if response.get("id") == Some(&expected_id) => {
                    return Ok(response)
                }
                Ok(Ok(_)) => return Err("MCP response id mismatch".to_owned()),
                Ok(Err(error)) => return Err(error),
                Err(mpsc::RecvTimeoutError::Timeout) => continue,
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    return Err("MCP server closed stdout".to_owned())
                }
            }
        }
    }

    pub fn send(&self, message: Value) -> Result<(), String> {
        if message.get("jsonrpc").and_then(Value::as_str) != Some("2.0")
            || message.get("method").and_then(Value::as_str).is_none()
            || message.get("id").is_some()
        {
            return Err("MCP notification must have a method and no id".to_owned());
        }
        let mut process = self
            .inner
            .lock()
            .map_err(|_| "MCP process is poisoned".to_owned())?;
        write_message(&mut process, &message)
    }

    pub fn status(&self) -> Result<McpProcessStatus, String> {
        let mut process = self
            .inner
            .lock()
            .map_err(|_| "MCP process is poisoned".to_owned())?;
        let status = process
            .child
            .try_wait()
            .map_err(|error| error.to_string())?;
        #[cfg(test)]
        let stderr = process
            ._stderr
            .lock()
            .map(|value| value.clone())
            .unwrap_or_default();
        Ok(McpProcessStatus {
            running: status.is_none(),
            pid: process.child.id(),
            exit_code: status.and_then(|value| value.code()),
            #[cfg(test)]
            stderr,
        })
    }

    pub fn stop(&self) -> Result<(), String> {
        self.cancelled.store(true, Ordering::SeqCst);
        let mut process = self
            .inner
            .lock()
            .map_err(|_| "MCP process is poisoned".to_owned())?;
        terminate(&mut process);
        Ok(())
    }
}

impl Drop for McpProcessHandle {
    fn drop(&mut self) {
        self.cancelled.store(true, Ordering::SeqCst);
        if let Ok(process) = self.inner.get_mut() {
            terminate(process);
        }
    }
}
