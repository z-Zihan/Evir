//! Child-process commands: spawn a command inside the workspace with
//! argument-array safety, capped output capture, timeout, user cancellation
//! (`cancel_command` over the shared cancellation registry), and
//! process-group kill on both Unix and Windows.

use std::process::{Child, Command as StdCommand};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

use serde::Serialize;

use super::infra::{
    command_cancellations, truncate_string, validate_path_in_workspace, CommandRegistration,
};

#[derive(Serialize)]
pub struct CommandResult {
    stdout: String,
    stderr: String,
    exit_code: Option<i32>,
    success: bool,
}

/// Execute a shell command in the workspace directory.
/// Uses argument array (no shell interpolation) for safety.
#[tauri::command(async)]
pub(crate) async fn run_command(
    command_id: String,
    cwd: String,
    program: String,
    args: Vec<String>,
    timeout_ms: Option<u64>,
    env: Option<std::collections::HashMap<String, String>>,
    workspace_root: String,
) -> Result<CommandResult, String> {
    // Sync commands run on the app main thread; this one polls for the whole
    // command lifetime, so it must stay off the main thread or the UI (and
    // cancel_command itself, which also arrives via IPC) freezes.
    tauri::async_runtime::spawn_blocking(move || {
        run_command_blocking(
            command_id,
            cwd,
            program,
            args,
            timeout_ms,
            env,
            workspace_root,
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

fn run_command_blocking(
    command_id: String,
    cwd: String,
    program: String,
    args: Vec<String>,
    timeout_ms: Option<u64>,
    env: Option<std::collections::HashMap<String, String>>,
    workspace_root: String,
) -> Result<CommandResult, String> {
    const MAX_COMMAND_TIMEOUT_MS: u64 = 600_000;
    let cwd = validate_path_in_workspace(&cwd, &workspace_root)?;
    let cancellation = Arc::new(AtomicBool::new(false));
    command_cancellations()
        .lock()
        .map_err(|_| "command cancellation registry is poisoned".to_owned())?
        .insert(command_id.clone(), Arc::clone(&cancellation));
    let _registration = CommandRegistration(command_id);

    let mut cmd = StdCommand::new(&program);
    cmd.args(&args);
    cmd.current_dir(&cwd);
    if let Some(env_vars) = env {
        cmd.envs(env_vars);
    }
    cmd.stdin(std::process::Stdio::null());
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }

    let timeout =
        std::time::Duration::from_millis(timeout_ms.unwrap_or(30_000).min(MAX_COMMAND_TIMEOUT_MS));
    let start = std::time::Instant::now();

    let mut child = cmd.spawn().map_err(|error| error.to_string())?;
    let stdout_reader = child.stdout.take().map(read_pipe);
    let stderr_reader = child.stderr.take().map(read_pipe);

    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let stdout_str = join_pipe(stdout_reader);
                let stderr_str = join_pipe(stderr_reader);
                return Ok(CommandResult {
                    stdout: stdout_str,
                    stderr: stderr_str,
                    exit_code: status.code(),
                    success: status.success(),
                });
            }
            Ok(None) => {
                if cancellation.load(Ordering::SeqCst) {
                    kill_process_tree(&mut child);
                    let _ = child.wait();
                    return Ok(CommandResult {
                        stdout: join_pipe(stdout_reader),
                        stderr: "Command cancelled by user".to_owned(),
                        exit_code: None,
                        success: false,
                    });
                }
                if start.elapsed() > timeout {
                    kill_process_tree(&mut child);
                    let _ = child.wait();
                    return Ok(CommandResult {
                        stdout: join_pipe(stdout_reader),
                        stderr: format!("Command timed out after {}ms", timeout.as_millis()),
                        exit_code: None,
                        success: false,
                    });
                }
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            Err(error) => return Err(error.to_string()),
        }
    }
}

#[tauri::command(async)]
pub(crate) fn cancel_command(command_id: String) -> Result<bool, String> {
    let cancellations = command_cancellations()
        .lock()
        .map_err(|_| "command cancellation registry is poisoned".to_owned())?;
    let Some(cancellation) = cancellations.get(&command_id) else {
        return Ok(false);
    };
    cancellation.store(true, Ordering::SeqCst);
    Ok(true)
}

fn read_pipe<R>(mut pipe: R) -> std::thread::JoinHandle<String>
where
    R: std::io::Read + Send + 'static,
{
    // Cap retained output so `cat huge-file` cannot OOM the app, but keep
    // draining the pipe. Closing it at the cap can send the child SIGPIPE and
    // turn an otherwise successful command into a false failure.
    const MAX_PIPE_BYTES: usize = 200_000;
    std::thread::spawn(move || {
        let mut bytes = Vec::with_capacity(8192);
        let mut chunk = [0u8; 8192];
        loop {
            match pipe.read(&mut chunk) {
                Ok(0) => break,
                Ok(read) => {
                    let remaining = MAX_PIPE_BYTES.saturating_sub(bytes.len());
                    bytes.extend_from_slice(&chunk[..read.min(remaining)]);
                }
                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(_) => break,
            }
        }
        truncate_string(&String::from_utf8_lossy(&bytes), 50_000)
    })
}

fn join_pipe(reader: Option<std::thread::JoinHandle<String>>) -> String {
    reader
        .and_then(|handle| handle.join().ok())
        .unwrap_or_default()
}

#[cfg(unix)]
fn kill_process_tree(child: &mut Child) {
    let process_group = i32::try_from(child.id()).unwrap_or(i32::MAX);
    // The child is spawned into its own process group above, so this terminates descendants too.
    unsafe {
        libc::killpg(process_group, libc::SIGKILL);
    }
    let _ = child.kill();
}

#[cfg(windows)]
fn kill_process_tree(child: &mut Child) {
    let _ = StdCommand::new("taskkill")
        .args(["/PID", &child.id().to_string(), "/T", "/F"])
        .status();
    let _ = child.kill();
}

#[cfg(test)]
mod tests {
    use super::{cancel_command, read_pipe, run_command_blocking};

    struct CountingReader {
        remaining: usize,
        consumed: std::sync::Arc<std::sync::atomic::AtomicUsize>,
    }

    struct InterruptedOnceReader {
        interrupted: bool,
        inner: CountingReader,
    }

    impl std::io::Read for InterruptedOnceReader {
        fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
            if !self.interrupted {
                self.interrupted = true;
                return Err(std::io::Error::from(std::io::ErrorKind::Interrupted));
            }
            self.inner.read(buffer)
        }
    }

    impl std::io::Read for CountingReader {
        fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
            let read = self.remaining.min(buffer.len());
            buffer[..read].fill(b'x');
            self.remaining -= read;
            self.consumed
                .fetch_add(read, std::sync::atomic::Ordering::SeqCst);
            Ok(read)
        }
    }

    #[test]
    fn command_pipe_is_fully_drained_after_output_capture_limit() {
        use std::sync::atomic::Ordering;

        let consumed = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let output = read_pipe(CountingReader {
            remaining: 300_000,
            consumed: std::sync::Arc::clone(&consumed),
        })
        .join()
        .expect("pipe reader should finish");

        assert_eq!(consumed.load(Ordering::SeqCst), 300_000);
        assert!(output.len() <= 50_100);
        assert!(output.contains("truncated"));
    }

    #[test]
    fn command_pipe_retries_interrupted_reads() {
        use std::sync::atomic::Ordering;

        let consumed = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let output = read_pipe(InterruptedOnceReader {
            interrupted: false,
            inner: CountingReader {
                remaining: 16,
                consumed: std::sync::Arc::clone(&consumed),
            },
        })
        .join()
        .expect("pipe reader should finish");

        assert_eq!(consumed.load(Ordering::SeqCst), 16);
        assert_eq!(output, "xxxxxxxxxxxxxxxx");
    }

    #[cfg(unix)]
    #[test]
    fn running_command_can_be_cancelled() {
        let workspace =
            std::env::temp_dir().join(format!("evir-command-cancel-{}", std::process::id()));
        std::fs::create_dir_all(&workspace).expect("workspace should be created");
        let cwd = workspace.to_string_lossy().into_owned();
        let workspace_root = cwd.clone();
        let command_id = "cancel-test-command".to_owned();
        let worker_id = command_id.clone();
        let worker = std::thread::spawn(move || {
            run_command_blocking(
                worker_id,
                cwd,
                "sh".to_owned(),
                vec!["-c".to_owned(), "sleep 10 & wait".to_owned()],
                Some(15_000),
                None,
                workspace_root,
            )
        });

        let started = std::time::Instant::now();
        loop {
            if cancel_command(command_id.clone()).expect("cancel command should succeed") {
                break;
            }
            assert!(
                started.elapsed() < std::time::Duration::from_secs(2),
                "command did not register for cancellation"
            );
            std::thread::sleep(std::time::Duration::from_millis(10));
        }

        let result = worker
            .join()
            .expect("command thread should join")
            .expect("command should return a result");
        assert!(!result.success);
        assert_eq!(result.stderr, "Command cancelled by user");
        assert!(started.elapsed() < std::time::Duration::from_secs(3));
        let _ = std::fs::remove_dir_all(workspace);
    }

    #[test]
    fn read_pipe_caps_output_size() {
        let huge = vec![b'x'; 500_000];
        let joined = read_pipe(std::io::Cursor::new(huge))
            .join()
            .expect("pipe reader should finish");
        assert!(joined.contains("... truncated (200000 bytes total)"));
        assert!(joined.len() < 60_000);
    }
}
