//! Minimal Chrome DevTools Protocol client over WebSocket (CDP JSON-RPC).
//!
//! One background task owns the socket: it routes responses to per-request
//! oneshot channels and surfaces a small set of events (page load, target
//! destruction) to waiting callers. Commands are bounded by timeouts so a
//! hung page can never wedge an agent run.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use tokio::sync::oneshot;
use tokio_tungstenite::tungstenite::Message;

pub type CdpResult<T> = Result<T, String>;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum CdpEventKind {
    LoadFired(String),
    TargetDestroyed(String),
}

struct CdpInner {
    writer: Mutex<Option<tokio::sync::mpsc::UnboundedSender<String>>>,
    pending: Mutex<HashMap<u64, oneshot::Sender<serde_json::Value>>>,
    event_waiters: Mutex<HashMap<CdpEventKind, Vec<oneshot::Sender<serde_json::Value>>>>,
    next_id: AtomicU64,
    closed: Mutex<bool>,
}

impl CdpInner {
    fn fail_all(&self, reason: &str) {
        let failure = serde_json::Value::String(reason.to_string());
        let mut pending = self.pending.lock().expect("cdp pending lock");
        for (_, sender) in pending.drain() {
            let _ = sender.send(failure.clone());
        }
        let mut waiters = self.event_waiters.lock().expect("cdp waiters lock");
        for (_, list) in waiters.drain() {
            for waiter in list {
                let _ = waiter.send(failure.clone());
            }
        }
    }
}

#[derive(Clone)]
pub struct CdpClient {
    inner: Arc<CdpInner>,
}

impl CdpClient {
    /// Connects to a browser-level `ws://127.0.0.1:<port>/devtools/browser/…`
    /// endpoint, spawns the reader task and wires the writer channel.
    pub async fn connect(url: &str) -> CdpResult<Self> {
        // A bounded handshake: a wedged or ghost endpoint must fail fast so
        // callers surface an honest error instead of hanging the run.
        let (ws, _response) = tokio::time::timeout(
            Duration::from_secs(10),
            tokio_tungstenite::connect_async(url),
        )
        .await
        .map_err(|_| "cdp connect handshake timed out".to_string())?
        .map_err(|error| format!("cdp connect failed: {error}"))?;
        let (mut sink, mut stream) = ws.split();
        let inner = Arc::new(CdpInner {
            writer: Mutex::new(None),
            pending: Mutex::new(HashMap::new()),
            event_waiters: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(0),
            closed: Mutex::new(false),
        });
        let (command_tx, mut command_rx) = tokio::sync::mpsc::unbounded_channel::<String>();
        *inner.writer.lock().expect("cdp writer lock") = Some(command_tx.clone());

        let reader_inner = Arc::clone(&inner);
        tokio::spawn(async move {
            while let Some(message) = stream.next().await {
                let payload = match message {
                    Ok(Message::Text(text)) => text.to_string(),
                    Ok(_) => continue,
                    Err(_) => break,
                };
                let Ok(value) = serde_json::from_str::<serde_json::Value>(&payload) else {
                    continue;
                };
                if let Some(id) = value.get("id").and_then(|id| id.as_u64()) {
                    let sender = reader_inner
                        .pending
                        .lock()
                        .expect("cdp pending lock")
                        .remove(&id);
                    if let Some(sender) = sender {
                        let _ = sender.send(value);
                    }
                    continue;
                }
                let method = value.get("method").and_then(|m| m.as_str()).unwrap_or("");
                let session = value
                    .get("sessionId")
                    .and_then(|id| id.as_str())
                    .map(str::to_string);
                let kind = match (method, session) {
                    ("Page.loadEventFired", Some(session)) => {
                        Some(CdpEventKind::LoadFired(session))
                    }
                    ("Target.targetDestroyed", _) => value
                        .get("params")
                        .and_then(|params| params.get("targetId"))
                        .and_then(|id| id.as_str())
                        .map(|id| CdpEventKind::TargetDestroyed(id.to_string())),
                    _ => None,
                };
                if let Some(kind) = kind {
                    let waiters = reader_inner
                        .event_waiters
                        .lock()
                        .expect("cdp waiters lock")
                        .remove(&kind);
                    if let Some(waiters) = waiters {
                        for waiter in waiters {
                            let _ = waiter.send(value.clone());
                        }
                    }
                }
            }
            *reader_inner.closed.lock().expect("cdp closed lock") = true;
            reader_inner.fail_all("cdp connection closed");
        });

        tokio::spawn(async move {
            while let Some(command) = command_rx.recv().await {
                if sink.send(Message::Text(command.into())).await.is_err() {
                    break;
                }
            }
            let _ = sink.close().await;
        });

        Ok(Self { inner })
    }

    pub fn is_closed(&self) -> bool {
        *self.inner.closed.lock().expect("cdp closed lock")
    }

    pub async fn send(
        &self,
        method: &str,
        params: serde_json::Value,
        session_id: Option<&str>,
        timeout: Duration,
    ) -> CdpResult<serde_json::Value> {
        if self.is_closed() {
            return Err("cdp connection closed".into());
        }
        let id = self.inner.next_id.fetch_add(1, Ordering::Relaxed);
        let mut payload = serde_json::json!({ "id": id, "method": method, "params": params });
        if let Some(session) = session_id {
            payload["sessionId"] = serde_json::Value::String(session.to_string());
        }
        let (tx, rx) = oneshot::channel();
        self.inner
            .pending
            .lock()
            .expect("cdp pending lock")
            .insert(id, tx);
        {
            let writer = self.inner.writer.lock().expect("cdp writer lock");
            match writer.as_ref() {
                Some(writer) => writer
                    .send(serde_json::to_string(&payload).map_err(|error| error.to_string())?)
                    .map_err(|_| "cdp writer closed".to_string())?,
                None => return Err("cdp writer closed".into()),
            }
        }
        match tokio::time::timeout(timeout, rx).await {
            Ok(Ok(response)) => {
                if let Some(error) = response.get("error") {
                    return Err(format!(
                        "cdp {method} error: {}",
                        error
                            .get("message")
                            .and_then(|m| m.as_str())
                            .unwrap_or("unknown")
                    ));
                }
                Ok(response
                    .get("result")
                    .cloned()
                    .unwrap_or(serde_json::Value::Null))
            }
            Ok(Err(_)) => Err("cdp response channel dropped".into()),
            Err(_) => {
                self.inner
                    .pending
                    .lock()
                    .expect("cdp pending lock")
                    .remove(&id);
                Err(format!("cdp {method} timed out"))
            }
        }
    }

    /// Waits (bounded) for the next event of a kind, e.g. page load on a session.
    pub async fn wait_for(&self, kind: CdpEventKind, timeout: Duration) -> CdpResult<()> {
        let (tx, rx) = oneshot::channel();
        self.inner
            .event_waiters
            .lock()
            .expect("cdp waiters lock")
            .entry(kind)
            .or_default()
            .push(tx);
        match tokio::time::timeout(timeout, rx).await {
            Ok(_) => Ok(()),
            Err(_) => Err("cdp event wait timed out".into()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn event_kinds_hash_and_compare() {
        use std::collections::HashSet;
        let mut set = HashSet::new();
        assert!(set.insert(CdpEventKind::LoadFired("s1".into())));
        assert!(!set.insert(CdpEventKind::LoadFired("s1".into())));
        assert!(set.insert(CdpEventKind::LoadFired("s2".into())));
        assert!(set.insert(CdpEventKind::TargetDestroyed("t1".into())));
    }
}

#[cfg(test)]
mod live_tests {
    use super::*;

    /// Live check against a running agent browser (started via Settings or a
    /// browser_open run): reads the recorded port and performs a real
    /// Target.getTargets round trip. Ignored in normal CI runs.
    // Plain #[test] + explicit multi-thread runtime: the libtest-captured
    // #[tokio::test] environment exhibited hung socket reads on this machine.
    #[test]
    #[ignore]
    fn connects_and_lists_targets() {
        let rt = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .expect("runtime");
        rt.block_on(connects_and_lists_targets_inner());
    }

    async fn connects_and_lists_targets_inner() {
        let home = std::env::var("HOME").unwrap();
        let port_file = std::path::Path::new(&home).join(
            "Library/Application Support/com.zihan.evir/browser-agent-profile/DevToolsActivePort",
        );
        let content = std::fs::read_to_string(port_file).expect("DevToolsActivePort present");
        let port: u16 = content.lines().next().unwrap().trim().parse().unwrap();
        let version_body = crate::browser_runtime::browser_runtime_probe_version(port)
            .await
            .expect("http version");
        let info: serde_json::Value = serde_json::from_str(&version_body).unwrap();
        let ws = info
            .get("webSocketDebuggerUrl")
            .and_then(|v| v.as_str())
            .unwrap();
        eprintln!("[live] http ok, connecting ws");
        let client = CdpClient::connect(ws).await.expect("ws connect");
        eprintln!("[live] ws connected, sending getTargets");
        let targets = client
            .send(
                "Target.getTargets",
                serde_json::Value::Null,
                None,
                Duration::from_secs(5),
            )
            .await
            .expect("getTargets response");
        assert!(targets.get("targetInfos").is_some());
    }
}
