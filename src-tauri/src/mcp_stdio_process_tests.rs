use crate::mcp_stdio_process::{McpProcessHandle, McpProcessSpec};
use serde_json::json;
use std::collections::HashMap;
use std::sync::{mpsc, Arc};
use std::time::Duration;

fn shell(script: &str, notify: Arc<dyn Fn(serde_json::Value) + Send + Sync>) -> McpProcessHandle {
    shell_with_env(script, HashMap::new(), notify)
}

fn shell_with_env(
    script: &str,
    env: HashMap<String, String>,
    notify: Arc<dyn Fn(serde_json::Value) + Send + Sync>,
) -> McpProcessHandle {
    McpProcessHandle::spawn(
        McpProcessSpec {
            command: "sh".to_owned(),
            args: vec!["-c".to_owned(), script.to_owned()],
            cwd: None,
            env,
        },
        notify,
    )
    .expect("fixture process should start")
}

#[test]
fn one_process_serves_multiple_requests_and_notifications() {
    let (tx, rx) = mpsc::channel();
    let process = shell(
        r#"i=0; while IFS= read -r line; do i=$((i+1)); if [ "$i" = 1 ]; then echo '{"jsonrpc":"2.0","method":"notifications/tools/list_changed"}'; echo '{"jsonrpc":"2.0","id":1,"result":{"step":1}}'; else echo '{"jsonrpc":"2.0","id":2,"result":{"step":2}}'; fi; done"#,
        Arc::new(move |value| tx.send(value).expect("notification should send")),
    );
    let pid = process.pid().expect("pid should be available");
    assert_eq!(
        process
            .request(json!({"jsonrpc":"2.0","id":1,"method":"first"}), 1_000)
            .unwrap()["result"]["step"],
        1
    );
    assert_eq!(
        rx.recv_timeout(Duration::from_secs(1)).unwrap()["method"],
        "notifications/tools/list_changed"
    );
    assert_eq!(
        process
            .request(json!({"jsonrpc":"2.0","id":2,"method":"second"}), 1_000)
            .unwrap()["result"]["step"],
        2
    );
    assert_eq!(process.pid().unwrap(), pid);
    assert!(process.status().unwrap().running);
    process.stop().unwrap();
    assert!(!process.status().unwrap().running);
}

#[test]
fn stopping_a_server_terminates_its_process_group() {
    let process = shell(
        r#"sleep 30 & child=$!; while IFS= read -r line; do printf '{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"childPid\":%s}}\n' "$child"; done"#,
        Arc::new(|_| {}),
    );
    let response = process
        .request(json!({"jsonrpc":"2.0","id":1,"method":"child"}), 1_000)
        .unwrap();
    let child_pid = response["result"]["childPid"]
        .as_u64()
        .expect("fixture should report its child pid") as i32;

    process.stop().unwrap();

    let deadline = std::time::Instant::now() + Duration::from_secs(1);
    loop {
        let result = unsafe { libc::kill(child_pid, 0) };
        if result == -1 && std::io::Error::last_os_error().raw_os_error() == Some(libc::ESRCH) {
            break;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "MCP child process remained alive after process-group termination"
        );
        std::thread::sleep(Duration::from_millis(10));
    }
}

#[test]
fn request_timeout_is_bounded() {
    let process = shell(
        "while IFS= read -r line; do sleep 2; done",
        Arc::new(|_| {}),
    );
    let error = process
        .request(json!({"jsonrpc":"2.0","id":1,"method":"slow"}), 25)
        .expect_err("request should time out");
    assert!(error.contains("timed out after 25ms"));
}

#[test]
fn malformed_stdout_fails_without_waiting_for_timeout() {
    let process = shell(
        "while IFS= read -r line; do echo 'not-json'; done",
        Arc::new(|_| {}),
    );
    let error = process
        .request(json!({"jsonrpc":"2.0","id":1,"method":"bad"}), 1_000)
        .expect_err("malformed output should fail the request");
    assert_eq!(error, "MCP server emitted invalid JSON on stdout");
}

#[test]
fn response_ids_cannot_cross_request_ownership() {
    let process = shell(
        r#"while IFS= read -r line; do echo '{"jsonrpc":"2.0","id":2,"result":{}}'; done"#,
        Arc::new(|_| {}),
    );
    let error = process
        .request(json!({"jsonrpc":"2.0","id":1,"method":"wrong-id"}), 1_000)
        .expect_err("mismatched ids should fail closed");
    assert_eq!(error, "MCP response id mismatch");
}

#[test]
fn child_environment_is_allowlisted_and_explicit() {
    let process = shell_with_env(
        r#"while IFS= read -r line; do printf '{"jsonrpc":"2.0","id":1,"result":{"allowed":"%s","blocked":"%s"}}\n' "$EVIR_MCP_TEST_ALLOWED" "$CARGO_HOME"; done"#,
        HashMap::from([("EVIR_MCP_TEST_ALLOWED".to_owned(), "present".to_owned())]),
        Arc::new(|_| {}),
    );
    let response = process
        .request(json!({"jsonrpc":"2.0","id":1,"method":"env"}), 1_000)
        .unwrap();
    assert_eq!(response["result"]["allowed"], "present");
    assert_eq!(response["result"]["blocked"], "");
}

#[test]
fn stderr_is_retained_with_a_hard_bound() {
    let process = shell(
        r#"head -c 60000 /dev/zero | tr '\0' x >&2; while IFS= read -r line; do echo '{"jsonrpc":"2.0","id":1,"result":{}}'; done"#,
        Arc::new(|_| {}),
    );
    process
        .request(json!({"jsonrpc":"2.0","id":1,"method":"stderr"}), 1_000)
        .unwrap();
    let deadline = std::time::Instant::now() + Duration::from_secs(1);
    let stderr = loop {
        let stderr = process.status().unwrap().stderr;
        if !stderr.is_empty() || std::time::Instant::now() >= deadline {
            break stderr;
        }
        std::thread::sleep(Duration::from_millis(10));
    };
    assert!(!stderr.is_empty());
    assert!(stderr.len() <= 50_000);
}
