//! Background task registry tests with real short-lived processes (`sh`,
//! `sleep`). Unix-only: the registry answers `unsupported_platform` elsewhere.

use std::path::PathBuf;
use std::time::{Duration, Instant};

use crate::background_tasks::{
    BackgroundTaskErrorKind, BackgroundTaskRegistry, BackgroundTaskStartRequest,
    BackgroundTaskStatus, OutputBuffer, OutputFrom, OutputStream, MAX_CONCURRENT_TASKS,
    MAX_OUTPUT_BYTES_PER_STREAM, MAX_OUTPUT_READ_BYTES, MAX_TASK_TIMEOUT_MS, MAX_WAIT_TIMEOUT_MS,
};

fn workspace(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("evir-bg-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("workspace should be created");
    dir
}

fn shell(
    dir: &std::path::Path,
    script: &str,
    timeout_ms: Option<u64>,
) -> BackgroundTaskStartRequest {
    let path = dir.to_string_lossy().into_owned();
    BackgroundTaskStartRequest {
        cwd: path.clone(),
        program: "sh".into(),
        args: vec!["-c".into(), script.into()],
        timeout_ms,
        workspace_root: path,
        conversation_id: Some("conversation-1".into()),
        run_id: None,
        tool_call_id: Some("call-1".into()),
    }
}

fn process_alive(pid: i32) -> bool {
    unsafe { libc::kill(pid, 0) == 0 }
}

/// Killed grandchildren are reparented and reaped by init; allow a moment.
fn assert_process_gone(pid: i32) {
    let started = Instant::now();
    while process_alive(pid) {
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "process {pid} survived its process group kill"
        );
        std::thread::sleep(Duration::from_millis(20));
    }
}

/// The script writes its background child's pid to `child.pid`.
fn read_child_pid(dir: &std::path::Path) -> i32 {
    let path = dir.join("child.pid");
    let started = Instant::now();
    loop {
        if let Ok(text) = std::fs::read_to_string(&path) {
            if let Ok(pid) = text.trim().parse() {
                return pid;
            }
        }
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "child pid file was not written"
        );
        std::thread::sleep(Duration::from_millis(10));
    }
}

const SLEEP_WITH_CHILD: &str = "sleep 100 & echo $! > child.pid; wait";

#[test]
fn ring_buffer_keeps_the_most_recent_bytes_within_capacity() {
    let mut buffer = OutputBuffer::new(8);
    buffer.push(b"abcd");
    assert_eq!(buffer.retained_bytes(), 4);
    assert_eq!(buffer.dropped_bytes(), 0);

    buffer.push(b"efghij");
    assert_eq!(buffer.retained_bytes(), 8);
    assert_eq!(buffer.total_bytes(), 10);
    assert_eq!(buffer.dropped_bytes(), 2);
    assert_eq!(buffer.read(OutputFrom::Head, 100).text, "cdefghij");

    // A single chunk larger than the capacity keeps only its tail.
    buffer.push(b"0123456789xyz");
    assert_eq!(buffer.read(OutputFrom::Head, 100).text, "56789xyz");
    assert_eq!(buffer.total_bytes(), 23);
    assert_eq!(buffer.dropped_bytes(), 15);
}

#[test]
fn ring_buffer_reads_respect_head_tail_and_byte_bounds() {
    let mut buffer = OutputBuffer::new(64);
    assert_eq!(buffer.read(OutputFrom::Tail, 10).text, "");
    buffer.push(b"line-1\nline-2\n");

    assert_eq!(buffer.read(OutputFrom::Head, 6).text, "line-1");
    assert_eq!(buffer.read(OutputFrom::Tail, 7).text, "line-2\n");
    let all = buffer.read(OutputFrom::Tail, 1_000);
    assert_eq!(all.text, "line-1\nline-2\n");
    assert_eq!(all.returned_bytes, 14);
    assert_eq!(buffer.read(OutputFrom::Head, 0).returned_bytes, 0);
}

#[test]
fn ring_buffer_reads_never_split_utf8_characters() {
    let mut buffer = OutputBuffer::new(64);
    buffer.push("构建完成".as_bytes()); // 4 chars × 3 bytes

    let head = buffer.read(OutputFrom::Head, 4);
    assert_eq!(head.text, "构");
    assert_eq!(head.returned_bytes, 3);

    let tail = buffer.read(OutputFrom::Tail, 5);
    assert_eq!(tail.text, "成");
    assert_eq!(tail.returned_bytes, 3);

    // Eviction mid-character: the oldest partial character is skipped on tail reads.
    let mut small = OutputBuffer::new(5);
    small.push("构建".as_bytes());
    assert_eq!(small.read(OutputFrom::Tail, 5).text, "建");
}

#[test]
fn exited_task_reports_exit_code_and_captures_both_streams() {
    let dir = workspace("exit");
    let registry = BackgroundTaskRegistry::default();
    let started = registry
        .start(shell(
            &dir,
            "echo hello; echo oops >&2; exit 3",
            Some(10_000),
        ))
        .expect("task should start");
    assert_eq!(started.status, BackgroundTaskStatus::Running);
    assert!(started.task_id.starts_with("bg-"));
    assert_eq!(started.conversation_id.as_deref(), Some("conversation-1"));

    let waited = registry
        .wait(&started.task_id, Some(10_000))
        .expect("wait should succeed");
    assert!(waited.completed);
    assert_eq!(waited.task.status, BackgroundTaskStatus::Exited);
    assert_eq!(waited.task.exit_code, Some(3));
    assert!(waited.task.ended_at.is_some());

    let stdout = registry
        .output(
            &started.task_id,
            OutputStream::Stdout,
            OutputFrom::Head,
            None,
        )
        .expect("stdout should be readable");
    assert_eq!(stdout.text, "hello\n");
    assert!(!stdout.truncated);
    let stderr = registry
        .output(
            &started.task_id,
            OutputStream::Stderr,
            OutputFrom::Tail,
            None,
        )
        .expect("stderr should be readable");
    assert_eq!(stderr.text, "oops\n");
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn registry_tracks_records_from_start_through_stop_and_removal() {
    let dir = workspace("crud");
    let registry = BackgroundTaskRegistry::default();
    let task = registry
        .start(shell(&dir, "sleep 30", None))
        .expect("task should start");

    let read = registry
        .status(&task.task_id)
        .expect("status should succeed");
    assert_eq!(read, task);
    assert_eq!(
        read.timeout_ms,
        crate::background_tasks::DEFAULT_TASK_TIMEOUT_MS
    );

    let stopped = registry.stop(&task.task_id).expect("stop should succeed");
    assert_eq!(stopped.status, BackgroundTaskStatus::Killed);
    assert_eq!(stopped.exit_code, None);
    // Stop is idempotent on a finished task.
    assert_eq!(registry.stop(&task.task_id).expect("second stop"), stopped);

    registry.kill_all();
    let missing = registry
        .status(&task.task_id)
        .expect_err("record should be gone");
    assert_eq!(missing.kind, BackgroundTaskErrorKind::NotFound);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn timeout_kills_the_whole_process_group() {
    let dir = workspace("timeout");
    let registry = BackgroundTaskRegistry::default();
    let task = registry
        .start(shell(&dir, SLEEP_WITH_CHILD, Some(300)))
        .expect("task should start");
    let child_pid = read_child_pid(&dir);

    let waited = registry
        .wait(&task.task_id, Some(10_000))
        .expect("wait should succeed");
    assert!(waited.completed);
    assert_eq!(waited.task.status, BackgroundTaskStatus::Timeout);
    assert_eq!(waited.task.exit_code, None);
    assert_process_gone(child_pid);
    assert_process_gone(i32::try_from(task.pid).expect("pid fits i32"));
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn stop_kills_the_whole_process_group() {
    let dir = workspace("stop");
    let registry = BackgroundTaskRegistry::default();
    let task = registry
        .start(shell(&dir, SLEEP_WITH_CHILD, Some(60_000)))
        .expect("task should start");
    let child_pid = read_child_pid(&dir);

    let started = Instant::now();
    let stopped = registry.stop(&task.task_id).expect("stop should succeed");
    assert_eq!(stopped.status, BackgroundTaskStatus::Killed);
    assert!(started.elapsed() < Duration::from_secs(5));
    assert_process_gone(child_pid);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn leftover_children_are_swept_when_the_leader_exits() {
    let dir = workspace("sweep");
    let registry = BackgroundTaskRegistry::default();
    let task = registry
        .start(shell(
            &dir,
            "sleep 100 & echo $! > child.pid; exit 0",
            Some(60_000),
        ))
        .expect("task should start");
    let waited = registry
        .wait(&task.task_id, Some(10_000))
        .expect("wait should succeed");
    assert!(waited.completed);
    assert_eq!(waited.task.status, BackgroundTaskStatus::Exited);
    assert_eq!(waited.task.exit_code, Some(0));
    assert_process_gone(read_child_pid(&dir));
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn wait_returns_incomplete_instead_of_hanging() {
    let dir = workspace("wait");
    let registry = BackgroundTaskRegistry::default();
    let task = registry
        .start(shell(&dir, "sleep 30", Some(60_000)))
        .expect("task should start");

    let started = Instant::now();
    let waited = registry
        .wait(&task.task_id, Some(200))
        .expect("wait should succeed");
    assert!(!waited.completed);
    assert_eq!(waited.task.status, BackgroundTaskStatus::Running);
    assert!(started.elapsed() >= Duration::from_millis(200));
    assert!(started.elapsed() < Duration::from_secs(2));

    let over = registry
        .wait(&task.task_id, Some(MAX_WAIT_TIMEOUT_MS + 1))
        .expect_err("over-limit wait should be rejected");
    assert_eq!(over.kind, BackgroundTaskErrorKind::InvalidArgs);
    registry.kill_all();
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn unknown_task_ids_answer_not_found_everywhere() {
    let registry = BackgroundTaskRegistry::default();
    let id = "bg-from-a-previous-launch";
    let errors = [
        registry.status(id).expect_err("status"),
        registry
            .output(id, OutputStream::Stdout, OutputFrom::Tail, None)
            .expect_err("output"),
        registry.wait(id, Some(10)).expect_err("wait"),
        registry.stop(id).expect_err("stop"),
    ];
    for error in errors {
        assert_eq!(error.kind, BackgroundTaskErrorKind::NotFound);
        assert_eq!(error.task_id.as_deref(), Some(id));
        assert!(error.message.contains("restart"));
    }
    let value = serde_json::to_value(registry.status(id).expect_err("status"))
        .expect("error should serialize");
    assert_eq!(value["kind"], "not_found");
    assert_eq!(value["taskId"], id);
}

#[test]
fn kill_all_terminates_every_task_and_clears_the_registry() {
    let dir = workspace("kill-all");
    let registry = BackgroundTaskRegistry::default();
    let first = registry
        .start(shell(&dir, SLEEP_WITH_CHILD, Some(60_000)))
        .expect("first task should start");
    let child_pid = read_child_pid(&dir);
    let second = registry
        .start(shell(&dir, "sleep 30", Some(60_000)))
        .expect("second task should start");
    let finished = registry
        .start(shell(&dir, "exit 0", Some(60_000)))
        .expect("third task should start");
    registry
        .wait(&finished.task_id, Some(5_000))
        .expect("finished task should complete");

    assert_eq!(registry.kill_all(), 2);
    for task in [&first, &second, &finished] {
        let error = registry
            .status(&task.task_id)
            .expect_err("registry cleared");
        assert_eq!(error.kind, BackgroundTaskErrorKind::NotFound);
    }
    assert_process_gone(child_pid);
    assert_process_gone(i32::try_from(second.pid).expect("pid fits i32"));
    assert_eq!(registry.kill_all(), 0);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn process_output_is_bounded_by_the_ring_buffer() {
    let dir = workspace("output-cap");
    let registry = BackgroundTaskRegistry::default();
    let task = registry
        .start(shell(
            &dir,
            "head -c 300000 /dev/zero | tr '\\0' x",
            Some(10_000),
        ))
        .expect("task should start");
    let waited = registry
        .wait(&task.task_id, Some(10_000))
        .expect("wait should succeed");
    assert_eq!(waited.task.exit_code, Some(0));

    let tail = registry
        .output(
            &task.task_id,
            OutputStream::Stdout,
            OutputFrom::Tail,
            Some(MAX_OUTPUT_READ_BYTES),
        )
        .expect("output should be readable");
    assert_eq!(tail.total_bytes, 300_000);
    assert_eq!(tail.retained_bytes, MAX_OUTPUT_BYTES_PER_STREAM);
    assert_eq!(
        tail.dropped_bytes,
        300_000 - MAX_OUTPUT_BYTES_PER_STREAM as u64
    );
    assert_eq!(tail.returned_bytes, MAX_OUTPUT_READ_BYTES);
    assert!(tail.truncated);
    assert!(tail.text.bytes().all(|byte| byte == b'x'));

    for max_bytes in [0, MAX_OUTPUT_READ_BYTES + 1] {
        let error = registry
            .output(
                &task.task_id,
                OutputStream::Stdout,
                OutputFrom::Head,
                Some(max_bytes),
            )
            .expect_err("out-of-range max_bytes should be rejected");
        assert_eq!(error.kind, BackgroundTaskErrorKind::InvalidArgs);
    }
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn start_rejects_invalid_requests_before_spawning() {
    let dir = workspace("invalid");
    let outside = workspace("invalid-outside");
    let registry = BackgroundTaskRegistry::default();

    for timeout_ms in [0, MAX_TASK_TIMEOUT_MS + 1] {
        let error = registry
            .start(shell(&dir, "true", Some(timeout_ms)))
            .expect_err("out-of-range timeout should be rejected");
        assert_eq!(error.kind, BackgroundTaskErrorKind::InvalidArgs);
    }

    let mut escaped = shell(&dir, "true", None);
    escaped.cwd = outside.to_string_lossy().into_owned();
    let error = registry.start(escaped).expect_err("cwd outside workspace");
    assert_eq!(error.kind, BackgroundTaskErrorKind::OutsideWorkspace);

    let mut missing = shell(&dir, "true", None);
    missing.program = "evir-definitely-missing-binary".into();
    missing.args.clear();
    let error = registry.start(missing).expect_err("missing program");
    assert_eq!(error.kind, BackgroundTaskErrorKind::CommandNotFound);
    let _ = std::fs::remove_dir_all(dir);
    let _ = std::fs::remove_dir_all(outside);
}

#[test]
fn concurrent_running_tasks_are_capped() {
    let dir = workspace("limit");
    let registry = BackgroundTaskRegistry::default();
    for _ in 0..MAX_CONCURRENT_TASKS {
        registry
            .start(shell(&dir, "sleep 30", Some(60_000)))
            .expect("task under the cap should start");
    }
    let error = registry
        .start(shell(&dir, "sleep 30", Some(60_000)))
        .expect_err("task over the cap should be rejected");
    assert_eq!(error.kind, BackgroundTaskErrorKind::LimitReached);
    assert_eq!(registry.kill_all(), MAX_CONCURRENT_TASKS);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn snapshots_serialize_in_camel_case_with_snake_case_status() {
    let dir = workspace("serde");
    let registry = BackgroundTaskRegistry::default();
    let task = registry
        .start(shell(&dir, "exit 0", Some(5_000)))
        .expect("task should start");
    let waited = registry
        .wait(&task.task_id, Some(5_000))
        .expect("wait should succeed");
    let value = serde_json::to_value(&waited).expect("serialize wait result");
    assert_eq!(value["completed"], true);
    assert_eq!(value["task"]["status"], "exited");
    assert_eq!(value["task"]["exitCode"], 0);
    assert_eq!(value["task"]["toolCallId"], "call-1");
    assert!(value["task"].get("task_id").is_none());
    let _ = std::fs::remove_dir_all(dir);
}
