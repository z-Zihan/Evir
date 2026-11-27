//! Background tasks: workspace processes whose lifetime is independent of a
//! single tool call (start → status/output/wait → stop).
//!
//! Lifecycle rules:
//! - every task runs in its own process group (Unix `setsid`-style group via
//!   `process_group(0)`); stop, timeout, and app exit kill the whole group so
//!   `pnpm test` → node → worker trees never survive as orphans;
//! - every task has a hard deadline (`timeout_ms`, default/upper bound below);
//!   an over-limit request is rejected, never silently clamped;
//! - nothing is persisted: Evir exit kills every task (`kill_all` from
//!   `RunEvent::Exit`) and a lookup after restart answers `not_found`
//!   instead of inventing a state;
//! - status changes are event-driven (a blocking waiter thread per task and a
//!   condvar), never polled.
//!
//! Windows answers `unsupported_platform` for now — the same honest-error
//! stance as computer use v1 — because it has no process groups to kill.
//!
//! Logging: lifecycle events go to the native JSONL log with ids, program,
//! cwd, pid, and exit facts only. Argument values and environment variable
//! values are never recorded.

// Spawning is Unix-only for now; on other targets the buffer/record plumbing
// is compiled but unreachable.
#![cfg_attr(not(unix), allow(dead_code))]

use std::collections::{HashMap, VecDeque};
use std::sync::atomic::AtomicU64;
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::command_env::{CommandExecutionError, CommandExecutionErrorKind};

/// Deadline applied when the caller does not pass `timeout_ms` (1 hour).
pub const DEFAULT_TASK_TIMEOUT_MS: u64 = 3_600_000;
/// Hard upper bound for `timeout_ms` (24 hours); larger values are rejected.
pub const MAX_TASK_TIMEOUT_MS: u64 = 86_400_000;
/// Wait window applied when `background_task_wait` gets no `timeout_ms`.
pub const DEFAULT_WAIT_TIMEOUT_MS: u64 = 30_000;
/// Hard upper bound for one `background_task_wait` call.
pub const MAX_WAIT_TIMEOUT_MS: u64 = 60_000;
/// Running tasks allowed at once (matches the scheduler's 1–4 parallelism).
pub const MAX_CONCURRENT_TASKS: usize = 4;
/// Finished task records kept for status/output queries; oldest go first.
pub const MAX_RETAINED_TASKS: usize = 32;
/// Ring-buffer capacity per stream (stdout and stderr each); older bytes are
/// dropped and counted, the pipe keeps draining (same cap as run_command).
pub const MAX_OUTPUT_BYTES_PER_STREAM: usize = 200_000;
/// Bytes returned by one output read when `max_bytes` is omitted.
pub const DEFAULT_OUTPUT_READ_BYTES: usize = 16_000;
/// Hard upper bound for one output read.
pub const MAX_OUTPUT_READ_BYTES: usize = 64_000;
/// How long stop/kill_all wait for a killed group to be reaped.
const KILL_SETTLE_TIMEOUT: Duration = Duration::from_secs(5);
/// How long the waiter waits for pipe readers after the group is gone (a
/// descendant that escaped the group may hold the pipe open forever).
const READER_DRAIN_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BackgroundTaskStatus {
    Running,
    /// The process exited on its own; `exit_code` holds its code.
    Exited,
    /// Killed by Evir because `timeout_ms` elapsed.
    Timeout,
    /// Ended without an exit code (external signal) or could not be awaited.
    Failed,
    /// Killed by `background_task_stop` or app exit.
    Killed,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundTaskSnapshot {
    pub task_id: String,
    pub program: String,
    pub args: Vec<String>,
    pub cwd: String,
    pub pid: u32,
    pub status: BackgroundTaskStatus,
    pub exit_code: Option<i32>,
    pub started_at: u64,
    pub ended_at: Option<u64>,
    pub timeout_ms: u64,
    pub conversation_id: Option<String>,
    pub run_id: Option<String>,
    pub tool_call_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundTaskStartRequest {
    pub cwd: String,
    pub program: String,
    #[serde(default)]
    pub args: Vec<String>,
    pub timeout_ms: Option<u64>,
    pub workspace_root: String,
    /// Trace correlation from the tool call context (optional).
    pub conversation_id: Option<String>,
    pub run_id: Option<String>,
    pub tool_call_id: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum OutputStream {
    Stdout,
    Stderr,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum OutputFrom {
    /// Oldest retained bytes first.
    Head,
    /// Most recent bytes.
    Tail,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundTaskOutput {
    pub task_id: String,
    pub stream: OutputStream,
    pub from: OutputFrom,
    pub text: String,
    pub returned_bytes: usize,
    pub retained_bytes: usize,
    pub total_bytes: u64,
    /// Bytes evicted from the ring buffer (oldest output).
    pub dropped_bytes: u64,
    /// True when `text` is not the complete output the task produced.
    pub truncated: bool,
    pub status: BackgroundTaskStatus,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundTaskWaitResult {
    /// False when the wait window elapsed with the task still running.
    pub completed: bool,
    pub task: BackgroundTaskSnapshot,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BackgroundTaskErrorKind {
    NotFound,
    InvalidArgs,
    OutsideWorkspace,
    CommandNotFound,
    SpawnFailed,
    LimitReached,
    #[cfg_attr(unix, allow(dead_code))]
    UnsupportedPlatform,
    Internal,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundTaskError {
    pub kind: BackgroundTaskErrorKind,
    pub message: String,
    pub task_id: Option<String>,
    pub program: Option<String>,
    pub cwd: Option<String>,
}

impl BackgroundTaskError {
    fn new(kind: BackgroundTaskErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
            task_id: None,
            program: None,
            cwd: None,
        }
    }

    pub fn not_found(task_id: &str) -> Self {
        Self {
            task_id: Some(task_id.to_owned()),
            ..Self::new(
                BackgroundTaskErrorKind::NotFound,
                format!(
                    "background task '{task_id}' not found; background tasks do not survive an Evir restart"
                ),
            )
        }
    }

    fn invalid_args(message: impl Into<String>) -> Self {
        Self::new(BackgroundTaskErrorKind::InvalidArgs, message)
    }
}

impl From<CommandExecutionError> for BackgroundTaskError {
    fn from(error: CommandExecutionError) -> Self {
        let kind = match error.kind {
            CommandExecutionErrorKind::CommandNotFound => BackgroundTaskErrorKind::CommandNotFound,
            CommandExecutionErrorKind::SpawnFailed => BackgroundTaskErrorKind::SpawnFailed,
            CommandExecutionErrorKind::OutsideWorkspace => {
                BackgroundTaskErrorKind::OutsideWorkspace
            }
        };
        Self {
            kind,
            message: error.message,
            task_id: None,
            program: Some(error.program),
            cwd: error.cwd,
        }
    }
}

impl std::fmt::Display for BackgroundTaskError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:?}: {}", self.kind, self.message)
    }
}

/// Bounded byte ring buffer: keeps the most recent `capacity` bytes and
/// counts everything that was ever pushed.
pub(crate) struct OutputBuffer {
    bytes: VecDeque<u8>,
    total_bytes: u64,
    capacity: usize,
}

pub(crate) struct OutputSlice {
    pub text: String,
    pub returned_bytes: usize,
}

impl OutputBuffer {
    pub(crate) fn new(capacity: usize) -> Self {
        Self {
            bytes: VecDeque::new(),
            total_bytes: 0,
            capacity,
        }
    }

    pub(crate) fn push(&mut self, chunk: &[u8]) {
        self.total_bytes += chunk.len() as u64;
        let chunk = &chunk[chunk.len().saturating_sub(self.capacity)..];
        let overflow = (self.bytes.len() + chunk.len()).saturating_sub(self.capacity);
        self.bytes.drain(..overflow);
        self.bytes.extend(chunk);
    }

    pub(crate) fn retained_bytes(&self) -> usize {
        self.bytes.len()
    }

    pub(crate) fn total_bytes(&self) -> u64 {
        self.total_bytes
    }

    pub(crate) fn dropped_bytes(&self) -> u64 {
        self.total_bytes - self.bytes.len() as u64
    }

    /// Read up to `max_bytes` from the head or tail of the retained bytes,
    /// trimmed to UTF-8 character boundaries so CJK output never splits.
    pub(crate) fn read(&self, from: OutputFrom, max_bytes: usize) -> OutputSlice {
        let take = max_bytes.min(self.bytes.len());
        let mut bytes: Vec<u8> = match from {
            OutputFrom::Head => self.bytes.iter().take(take).copied().collect(),
            OutputFrom::Tail => self
                .bytes
                .iter()
                .skip(self.bytes.len() - take)
                .copied()
                .collect(),
        };
        match from {
            OutputFrom::Head => {
                // Drop an incomplete trailing sequence cut by the byte budget.
                if let Err(error) = std::str::from_utf8(&bytes) {
                    if error.error_len().is_none() {
                        bytes.truncate(error.valid_up_to());
                    }
                }
            }
            OutputFrom::Tail => {
                // Skip continuation bytes of a sequence that started earlier.
                let skip = bytes
                    .iter()
                    .take(3)
                    .take_while(|byte| (**byte & 0xC0) == 0x80)
                    .count();
                bytes.drain(..skip);
            }
        }
        OutputSlice {
            returned_bytes: bytes.len(),
            text: String::from_utf8_lossy(&bytes).into_owned(),
        }
    }
}

struct TaskEntry {
    snapshot: BackgroundTaskSnapshot,
    pgid: i32,
    started: Instant,
    seq: u64,
    /// Why Evir killed the group (stop/timeout/exit); None = not killed.
    termination: Option<BackgroundTaskStatus>,
    /// The group leader has exited and is being reaped: never signal the
    /// pgid again (it could be reused once the leader is reaped).
    leader_exited: bool,
    stdout: OutputBuffer,
    stderr: OutputBuffer,
}

impl TaskEntry {
    fn is_running(&self) -> bool {
        self.snapshot.status == BackgroundTaskStatus::Running
    }

    /// Kill the process group once; returns whether a signal was sent.
    fn terminate(&mut self, reason: BackgroundTaskStatus) -> bool {
        if !self.is_running() || self.leader_exited || self.termination.is_some() {
            return false;
        }
        self.termination = Some(reason);
        kill_process_group(self.pgid);
        true
    }
}

#[derive(Default)]
struct Shared {
    tasks: Mutex<HashMap<String, TaskEntry>>,
    /// Notified whenever a task reaches a terminal status (or kill_all clears).
    changed: Condvar,
    next_seq: AtomicU64,
}

/// Tauri-managed registry of background tasks. Cloning shares the registry.
#[derive(Clone, Default)]
pub struct BackgroundTaskRegistry {
    shared: Arc<Shared>,
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

impl BackgroundTaskRegistry {
    fn lock(&self) -> MutexGuard<'_, HashMap<String, TaskEntry>> {
        // A panicking reader thread must not brick the registry.
        self.shared
            .tasks
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn start(
        &self,
        request: BackgroundTaskStartRequest,
    ) -> Result<BackgroundTaskSnapshot, BackgroundTaskError> {
        let timeout_ms = request.timeout_ms.unwrap_or(DEFAULT_TASK_TIMEOUT_MS);
        if timeout_ms == 0 || timeout_ms > MAX_TASK_TIMEOUT_MS {
            return Err(BackgroundTaskError::invalid_args(format!(
                "timeout_ms must be between 1 and {MAX_TASK_TIMEOUT_MS}"
            )));
        }
        if request.program.trim().is_empty() {
            return Err(BackgroundTaskError::invalid_args("program is required"));
        }
        self.spawn_task(request, timeout_ms)
    }

    #[cfg(not(unix))]
    fn spawn_task(
        &self,
        request: BackgroundTaskStartRequest,
        _timeout_ms: u64,
    ) -> Result<BackgroundTaskSnapshot, BackgroundTaskError> {
        Err(BackgroundTaskError {
            program: Some(request.program),
            ..BackgroundTaskError::new(
                BackgroundTaskErrorKind::UnsupportedPlatform,
                "background tasks are not supported on this platform yet",
            )
        })
    }

    #[cfg(unix)]
    fn spawn_task(
        &self,
        request: BackgroundTaskStartRequest,
        timeout_ms: u64,
    ) -> Result<BackgroundTaskSnapshot, BackgroundTaskError> {
        use std::os::unix::process::CommandExt as _;
        use std::process::{Command, Stdio};

        // Same containment and environment rules as run_command/dev_server.
        let cwd =
            crate::commands::validate_path_in_workspace(&request.cwd, &request.workspace_root)
                .map_err(|reason| {
                    CommandExecutionError::outside_workspace(&request.program, reason)
                })?;
        let program_path = crate::command_env::resolve_executable(&request.program, &cwd)
            .ok_or_else(|| CommandExecutionError::command_not_found(&request.program, &cwd))?;

        let mut tasks = self.lock();
        let running = tasks.values().filter(|entry| entry.is_running()).count();
        if running >= MAX_CONCURRENT_TASKS {
            return Err(BackgroundTaskError::new(
                BackgroundTaskErrorKind::LimitReached,
                format!("at most {MAX_CONCURRENT_TASKS} background tasks can run at once"),
            ));
        }

        let mut command = Command::new(program_path);
        command
            .args(&request.args)
            .current_dir(&cwd)
            .envs(crate::command_env::subprocess_env_for_cwd(&cwd))
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .process_group(0);
        let mut child = command.spawn().map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                CommandExecutionError::command_not_found(&request.program, &cwd)
            } else {
                CommandExecutionError::spawn_failed(&request.program, &cwd, &error)
            }
        })?;
        let pid = child.id();
        let pgid = i32::try_from(pid).unwrap_or(i32::MAX);
        let seq = self
            .shared
            .next_seq
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let task_id = format!("bg-{}-{seq}", now_millis());
        let snapshot = BackgroundTaskSnapshot {
            task_id: task_id.clone(),
            program: request.program,
            args: request.args,
            cwd: cwd.display().to_string(),
            pid,
            status: BackgroundTaskStatus::Running,
            exit_code: None,
            started_at: now_millis(),
            ended_at: None,
            timeout_ms,
            conversation_id: request.conversation_id,
            run_id: request.run_id,
            tool_call_id: request.tool_call_id,
        };
        evict_finished(&mut tasks);
        tasks.insert(
            task_id.clone(),
            TaskEntry {
                snapshot: snapshot.clone(),
                pgid,
                started: Instant::now(),
                seq,
                termination: None,
                leader_exited: false,
                stdout: OutputBuffer::new(MAX_OUTPUT_BYTES_PER_STREAM),
                stderr: OutputBuffer::new(MAX_OUTPUT_BYTES_PER_STREAM),
            },
        );
        drop(tasks);

        crate::native_log::log(
            "background-task.started",
            json!({
                "taskId": task_id,
                "program": snapshot.program,
                "argCount": snapshot.args.len(),
                "cwd": snapshot.cwd,
                "pid": pid,
                "timeoutMs": timeout_ms,
                "conversationId": snapshot.conversation_id,
                "runId": snapshot.run_id,
                "toolCallId": snapshot.tool_call_id,
            }),
        );

        let (done_tx, done_rx) = std::sync::mpsc::channel();
        if let Some(stdout) = child.stdout.take() {
            self.spawn_reader(&task_id, stdout, OutputStream::Stdout, done_tx.clone());
        }
        if let Some(stderr) = child.stderr.take() {
            self.spawn_reader(&task_id, stderr, OutputStream::Stderr, done_tx);
        }
        self.spawn_waiter(task_id.clone(), child, done_rx);
        self.spawn_deadline(task_id, Duration::from_millis(timeout_ms));
        Ok(snapshot)
    }

    #[cfg(unix)]
    fn spawn_reader<R>(
        &self,
        task_id: &str,
        mut pipe: R,
        stream: OutputStream,
        done: std::sync::mpsc::Sender<()>,
    ) where
        R: std::io::Read + Send + 'static,
    {
        let registry = self.clone();
        let task_id = task_id.to_owned();
        std::thread::spawn(move || {
            let mut chunk = [0u8; 8192];
            loop {
                match pipe.read(&mut chunk) {
                    Ok(0) => break,
                    Ok(read) => {
                        // Keep draining even when the record is gone: closing
                        // the pipe early would SIGPIPE the child.
                        if let Some(entry) = registry.lock().get_mut(&task_id) {
                            match stream {
                                OutputStream::Stdout => entry.stdout.push(&chunk[..read]),
                                OutputStream::Stderr => entry.stderr.push(&chunk[..read]),
                            }
                        }
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                    Err(_) => break,
                }
            }
            let _ = done.send(());
        });
    }

    /// Blocks on the child (no polling); finalizes the record once the
    /// leader exits and the pipes are drained.
    #[cfg(unix)]
    fn spawn_waiter(
        &self,
        task_id: String,
        mut child: std::process::Child,
        done: std::sync::mpsc::Receiver<()>,
    ) {
        let registry = self.clone();
        std::thread::spawn(move || {
            if !wait_for_exit_without_reaping(child.id()) {
                // Cannot observe the exit without reaping: reap first and skip
                // the group sweep rather than signal a pgid that may be reused.
                let exit = child.wait();
                if let Some(entry) = registry.lock().get_mut(&task_id) {
                    entry.leader_exited = true;
                }
                registry.finalize(&task_id, exit);
                return;
            }
            let exit = {
                let mut tasks = registry.lock();
                if let Some(entry) = tasks.get_mut(&task_id) {
                    // The leader is a zombie, so its pgid cannot be reused
                    // yet: sweep stragglers (`cmd &` children) so nothing
                    // outlives the task, then reap.
                    kill_process_group(entry.pgid);
                    entry.leader_exited = true;
                } else {
                    kill_process_group(i32::try_from(child.id()).unwrap_or(i32::MAX));
                }
                child.wait()
            };
            // Readers end at EOF; bound the wait in case an escaped
            // descendant still holds a pipe.
            let deadline = Instant::now() + READER_DRAIN_TIMEOUT;
            for _ in 0..2 {
                let remaining = deadline.saturating_duration_since(Instant::now());
                if done.recv_timeout(remaining).is_err() {
                    break;
                }
            }
            registry.finalize(&task_id, exit);
        });
    }

    /// Sleeps on the condvar until the task ends or its deadline passes.
    #[cfg(unix)]
    fn spawn_deadline(&self, task_id: String, timeout: Duration) {
        let registry = self.clone();
        std::thread::spawn(move || {
            let tasks = registry.lock();
            let (mut tasks, result) = registry
                .shared
                .changed
                .wait_timeout_while(tasks, timeout, |tasks| {
                    tasks.get(&task_id).is_some_and(TaskEntry::is_running)
                })
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            if !result.timed_out() {
                return;
            }
            let killed = tasks
                .get_mut(&task_id)
                .is_some_and(|entry| entry.terminate(BackgroundTaskStatus::Timeout));
            drop(tasks);
            if killed {
                crate::native_log::log(
                    "background-task.timed-out",
                    json!({ "taskId": task_id, "timeoutMs": timeout.as_millis() as u64 }),
                );
            }
        });
    }

    #[cfg(unix)]
    fn finalize(&self, task_id: &str, exit: std::io::Result<std::process::ExitStatus>) {
        let mut tasks = self.lock();
        let Some(entry) = tasks.get_mut(task_id) else {
            return;
        };
        let exit_code = exit.as_ref().ok().and_then(std::process::ExitStatus::code);
        entry.snapshot.status = match (entry.termination, exit_code) {
            (Some(reason), _) => reason,
            (None, Some(_)) => BackgroundTaskStatus::Exited,
            (None, None) => BackgroundTaskStatus::Failed,
        };
        entry.snapshot.exit_code = exit_code;
        entry.snapshot.ended_at = Some(now_millis());
        let fields = json!({
            "taskId": task_id,
            "pid": entry.snapshot.pid,
            "status": entry.snapshot.status,
            "exitCode": exit_code,
            "durationMs": entry.started.elapsed().as_millis() as u64,
            "stdoutBytes": entry.stdout.total_bytes(),
            "stderrBytes": entry.stderr.total_bytes(),
            "outputTruncated": entry.stdout.dropped_bytes() > 0 || entry.stderr.dropped_bytes() > 0,
        });
        drop(tasks);
        self.shared.changed.notify_all();
        crate::native_log::log("background-task.exited", fields);
    }

    pub fn status(&self, task_id: &str) -> Result<BackgroundTaskSnapshot, BackgroundTaskError> {
        self.lock()
            .get(task_id)
            .map(|entry| entry.snapshot.clone())
            .ok_or_else(|| BackgroundTaskError::not_found(task_id))
    }

    pub fn output(
        &self,
        task_id: &str,
        stream: OutputStream,
        from: OutputFrom,
        max_bytes: Option<usize>,
    ) -> Result<BackgroundTaskOutput, BackgroundTaskError> {
        let max_bytes = max_bytes.unwrap_or(DEFAULT_OUTPUT_READ_BYTES);
        if max_bytes == 0 || max_bytes > MAX_OUTPUT_READ_BYTES {
            return Err(BackgroundTaskError::invalid_args(format!(
                "max_bytes must be between 1 and {MAX_OUTPUT_READ_BYTES}"
            )));
        }
        let tasks = self.lock();
        let entry = tasks
            .get(task_id)
            .ok_or_else(|| BackgroundTaskError::not_found(task_id))?;
        let buffer = match stream {
            OutputStream::Stdout => &entry.stdout,
            OutputStream::Stderr => &entry.stderr,
        };
        let slice = buffer.read(from, max_bytes);
        Ok(BackgroundTaskOutput {
            task_id: task_id.to_owned(),
            stream,
            from,
            truncated: (slice.returned_bytes as u64) < buffer.total_bytes(),
            text: slice.text,
            returned_bytes: slice.returned_bytes,
            retained_bytes: buffer.retained_bytes(),
            total_bytes: buffer.total_bytes(),
            dropped_bytes: buffer.dropped_bytes(),
            status: entry.snapshot.status,
        })
    }

    /// Bounded wait: returns `completed: false` with the current state when
    /// the window elapses, never hangs past `MAX_WAIT_TIMEOUT_MS`.
    pub fn wait(
        &self,
        task_id: &str,
        timeout_ms: Option<u64>,
    ) -> Result<BackgroundTaskWaitResult, BackgroundTaskError> {
        let timeout_ms = timeout_ms.unwrap_or(DEFAULT_WAIT_TIMEOUT_MS);
        if timeout_ms > MAX_WAIT_TIMEOUT_MS {
            return Err(BackgroundTaskError::invalid_args(format!(
                "timeout_ms must be at most {MAX_WAIT_TIMEOUT_MS}"
            )));
        }
        let tasks = self.lock();
        if !tasks.contains_key(task_id) {
            return Err(BackgroundTaskError::not_found(task_id));
        }
        let tasks = self.wait_while_running(tasks, Duration::from_millis(timeout_ms), |tasks| {
            tasks.get(task_id).is_some_and(TaskEntry::is_running)
        });
        let entry = tasks
            .get(task_id)
            .ok_or_else(|| BackgroundTaskError::not_found(task_id))?;
        Ok(BackgroundTaskWaitResult {
            completed: !entry.is_running(),
            task: entry.snapshot.clone(),
        })
    }

    /// Kill the task's process group and wait (bounded) for it to be reaped.
    /// Stopping a finished task is a no-op that returns its final state.
    pub fn stop(&self, task_id: &str) -> Result<BackgroundTaskSnapshot, BackgroundTaskError> {
        let mut tasks = self.lock();
        let entry = tasks
            .get_mut(task_id)
            .ok_or_else(|| BackgroundTaskError::not_found(task_id))?;
        if entry.terminate(BackgroundTaskStatus::Killed) {
            crate::native_log::log("background-task.stopped", json!({ "taskId": task_id }));
        }
        let tasks = self.wait_while_running(tasks, KILL_SETTLE_TIMEOUT, |tasks| {
            tasks.get(task_id).is_some_and(TaskEntry::is_running)
        });
        tasks
            .get(task_id)
            .map(|entry| entry.snapshot.clone())
            .ok_or_else(|| BackgroundTaskError::not_found(task_id))
    }

    /// Kill every running task and clear the registry (app exit). Returns
    /// how many process groups were signalled.
    pub fn kill_all(&self) -> usize {
        let mut tasks = self.lock();
        let killed = tasks
            .values_mut()
            .map(|entry| entry.terminate(BackgroundTaskStatus::Killed))
            .filter(|signalled| *signalled)
            .count();
        let mut tasks = self.wait_while_running(tasks, KILL_SETTLE_TIMEOUT, |tasks| {
            tasks.values().any(TaskEntry::is_running)
        });
        tasks.clear();
        drop(tasks);
        self.shared.changed.notify_all();
        if killed > 0 {
            crate::native_log::log("background-task.kill-all", json!({ "killed": killed }));
        }
        killed
    }

    fn wait_while_running<'a>(
        &'a self,
        tasks: MutexGuard<'a, HashMap<String, TaskEntry>>,
        timeout: Duration,
        condition: impl FnMut(&mut HashMap<String, TaskEntry>) -> bool,
    ) -> MutexGuard<'a, HashMap<String, TaskEntry>> {
        self.shared
            .changed
            .wait_timeout_while(tasks, timeout, condition)
            .map(|(tasks, _)| tasks)
            .unwrap_or_else(|poisoned| poisoned.into_inner().0)
    }
}

/// Keep at most `MAX_RETAINED_TASKS - 1` records before inserting a new one,
/// evicting the oldest finished tasks first (running ones are never evicted).
#[cfg(unix)]
fn evict_finished(tasks: &mut HashMap<String, TaskEntry>) {
    while tasks.len() >= MAX_RETAINED_TASKS {
        let oldest = tasks
            .iter()
            .filter(|(_, entry)| !entry.is_running())
            .min_by_key(|(_, entry)| entry.seq)
            .map(|(id, _)| id.clone());
        let Some(oldest) = oldest else { return };
        tasks.remove(&oldest);
    }
}

#[cfg(unix)]
fn kill_process_group(pgid: i32) {
    // Negative-pid semantics: the whole group, not just the leader.
    unsafe {
        libc::killpg(pgid, libc::SIGKILL);
    }
}

#[cfg(not(unix))]
fn kill_process_group(_pgid: i32) {}

/// Block until the child exits but leave it unreaped (`WNOWAIT`), so its pid
/// (= pgid) stays reserved while the group is swept. Returns false when
/// the exit could not be observed this way.
#[cfg(unix)]
fn wait_for_exit_without_reaping(pid: u32) -> bool {
    loop {
        let mut info: libc::siginfo_t = unsafe { std::mem::zeroed() };
        let result = unsafe {
            libc::waitid(
                libc::P_PID,
                pid as libc::id_t,
                &mut info,
                libc::WEXITED | libc::WNOWAIT,
            )
        };
        if result == 0 {
            return true;
        }
        if std::io::Error::last_os_error().kind() != std::io::ErrorKind::Interrupted {
            return false;
        }
    }
}

#[tauri::command(async)]
pub(crate) fn background_task_start(
    state: tauri::State<'_, BackgroundTaskRegistry>,
    request: BackgroundTaskStartRequest,
) -> Result<BackgroundTaskSnapshot, BackgroundTaskError> {
    state.start(request)
}

#[tauri::command(async)]
pub(crate) fn background_task_status(
    state: tauri::State<'_, BackgroundTaskRegistry>,
    task_id: String,
) -> Result<BackgroundTaskSnapshot, BackgroundTaskError> {
    state.status(&task_id)
}

#[tauri::command(async)]
pub(crate) fn background_task_output(
    state: tauri::State<'_, BackgroundTaskRegistry>,
    task_id: String,
    stream: OutputStream,
    from: Option<OutputFrom>,
    max_bytes: Option<usize>,
) -> Result<BackgroundTaskOutput, BackgroundTaskError> {
    state.output(
        &task_id,
        stream,
        from.unwrap_or(OutputFrom::Tail),
        max_bytes,
    )
}

#[tauri::command]
pub(crate) async fn background_task_wait(
    state: tauri::State<'_, BackgroundTaskRegistry>,
    task_id: String,
    timeout_ms: Option<u64>,
) -> Result<BackgroundTaskWaitResult, BackgroundTaskError> {
    // Up to a minute of blocking: keep it off the async runtime workers.
    let registry = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || registry.wait(&task_id, timeout_ms))
        .await
        .map_err(|error| {
            BackgroundTaskError::new(
                BackgroundTaskErrorKind::Internal,
                format!("background task wait worker failed: {error}"),
            )
        })?
}

#[tauri::command]
pub(crate) async fn background_task_stop(
    state: tauri::State<'_, BackgroundTaskRegistry>,
    task_id: String,
) -> Result<BackgroundTaskSnapshot, BackgroundTaskError> {
    let registry = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || registry.stop(&task_id))
        .await
        .map_err(|error| {
            BackgroundTaskError::new(
                BackgroundTaskErrorKind::Internal,
                format!("background task stop worker failed: {error}"),
            )
        })?
}

/// Kill every background task. Called on app exit so no task outlives Evir.
pub fn kill_all(app: &tauri::AppHandle) {
    use tauri::Manager as _;
    if let Some(registry) = app.try_state::<BackgroundTaskRegistry>() {
        registry.kill_all();
    }
}
