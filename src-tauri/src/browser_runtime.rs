//! Agent browser runtime: detection, launch and lifecycle of a
//! CDP-controllable Chromium instance.
//!
//! - Reuses a system Chrome/Edge/Brave/Chromium when present; never bundles
//!   Chromium into the installer (hundreds of MB stay out of the app).
//! - Runs under a dedicated Evir profile directory (`browser-agent-profile`)
//!   so the user's real profile, cookies and history are never touched.
//! - The runtime is visible (not headless): users must be able to watch agent
//!   browsing. Process exit tears the browser down; no orphans.

use std::path::PathBuf;
use std::time::Duration;

use serde::Serialize;
use tokio::process::{Child, Command};

use crate::cdp::CdpClient;

#[derive(Debug, Clone, Serialize)]
pub struct BrowserRuntimeStatus {
    pub available: bool,
    pub engine: String,
    pub path: String,
    pub running: bool,
    pub version: Option<String>,
}

pub struct BrowserAgentRuntime {
    child: Child,
    pub client: CdpClient,
    pub profile_dir: PathBuf,
    engine: String,
    path: String,
}

fn candidate_paths() -> Vec<(String, PathBuf)> {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
    let mut candidates: Vec<(String, PathBuf)> = Vec::new();
    // Evir-managed Chrome for Testing runtime takes priority when installed.
    let managed = browser_runtime_install_dir()
        .join("chrome")
        .join("Google Chrome for Testing.app")
        .join("Contents")
        .join("MacOS")
        .join("Google Chrome for Testing");
    candidates.push(("chrome-for-testing".into(), managed));
    if cfg!(target_os = "macos") {
        candidates.extend([
            (
                "chrome".into(),
                PathBuf::from("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
            ),
            (
                "edge".into(),
                PathBuf::from("/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"),
            ),
            (
                "brave".into(),
                PathBuf::from("/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"),
            ),
            (
                "chromium".into(),
                PathBuf::from("/Applications/Chromium.app/Contents/MacOS/Chromium"),
            ),
        ]);
    } else if cfg!(target_os = "windows") {
        let program_files =
            std::env::var("ProgramFiles").unwrap_or_else(|_| "C:\\Program Files".into());
        let program_files_x86 =
            std::env::var("ProgramFiles(x86)").unwrap_or_else(|_| "C:\\Program Files (x86)".into());
        let local_app_data = std::env::var("LOCALAPPDATA").unwrap_or_default();
        candidates.extend([
            (
                "chrome".into(),
                PathBuf::from(&program_files).join("Google/Chrome/Application/chrome.exe"),
            ),
            (
                "chrome".into(),
                PathBuf::from(&program_files_x86).join("Google/Chrome/Application/chrome.exe"),
            ),
            (
                "edge".into(),
                PathBuf::from(&program_files_x86).join("Microsoft/Edge/Application/msedge.exe"),
            ),
            (
                "edge".into(),
                PathBuf::from(&program_files).join("Microsoft/Edge/Application/msedge.exe"),
            ),
            (
                "chrome".into(),
                PathBuf::from(&local_app_data).join("Google/Chrome/Application/chrome.exe"),
            ),
        ]);
    } else {
        candidates.extend([
            ("chrome".into(), PathBuf::from("/usr/bin/google-chrome")),
            (
                "chrome".into(),
                PathBuf::from("/usr/bin/google-chrome-stable"),
            ),
            ("chromium".into(), PathBuf::from("/usr/bin/chromium")),
            (
                "chromium".into(),
                PathBuf::from("/usr/bin/chromium-browser"),
            ),
            ("brave".into(), PathBuf::from("/usr/bin/brave-browser")),
            ("edge".into(), PathBuf::from("/usr/bin/microsoft-edge")),
        ]);
    }
    let _ = home;
    candidates
}

pub fn detect_browser() -> Option<(String, PathBuf)> {
    candidate_paths()
        .into_iter()
        .find(|(_, path): &(String, PathBuf)| path.is_file())
}

pub fn browser_runtime_install_dir() -> PathBuf {
    // App cache dir is only available from the AppHandle; the shared install
    // location used by detection and install flows lives under the user's
    // app-data home and is overridden by tests via env var.
    if let Ok(custom) = std::env::var("EVIR_BROWSER_RUNTIME_DIR") {
        return PathBuf::from(custom);
    }
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
    let base = if cfg!(target_os = "macos") {
        format!("{home}/Library/Application Support/com.zihan.evir")
    } else if cfg!(target_os = "windows") {
        std::env::var("LOCALAPPDATA").unwrap_or_else(|_| format!("{home}\\AppData\\Local"))
    } else {
        format!("{home}/.local/share/evir")
    };
    PathBuf::from(base).join("browser-runtime")
}

fn agent_profile_dir() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
    let base = if cfg!(target_os = "macos") {
        format!("{home}/Library/Application Support/com.zihan.evir")
    } else if cfg!(target_os = "windows") {
        std::env::var("LOCALAPPDATA").unwrap_or_else(|_| format!("{home}\\AppData\\Local"))
    } else {
        format!("{home}/.local/share/evir")
    };
    PathBuf::from(base).join("browser-agent-profile")
}

/// Plain-HTTP GET on the local CDP endpoint (no heavyweight HTTP client).
async fn cdp_http_get(port: u16, path: &str) -> Result<String, String> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let mut stream = tokio::net::TcpStream::connect(("127.0.0.1", port))
        .await
        .map_err(|error| format!("cdp tcp connect failed: {error}"))?;
    let request =
        format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");
    stream
        .write_all(request.as_bytes())
        .await
        .map_err(|error| error.to_string())?;
    let mut body = String::new();
    stream
        .read_to_string(&mut body)
        .await
        .map_err(|error| error.to_string())?;
    let split = body.find("\r\n\r\n").ok_or("malformed cdp http response")?;
    Ok(body[split + 4..].to_string())
}

impl BrowserAgentRuntime {
    pub async fn launch() -> Result<Self, String> {
        let Some((engine, path)) = detect_browser() else {
            return Err("no compatible browser found (Chrome, Edge, Brave or Chromium)".into());
        };
        let profile = agent_profile_dir();
        std::fs::create_dir_all(&profile).map_err(|error| format!("profile dir: {error}"))?;
        let child = Command::new(&path)
            .args([
                format!("--user-data-dir={}", profile.display()),
                "--remote-debugging-port=0".to_string(),
                "--no-first-run".to_string(),
                "--no-default-browser-check".to_string(),
                "--disable-background-timer-throttling".to_string(),
                "--disable-features=TranslateUI".to_string(),
                "about:blank".to_string(),
            ])
            .spawn()
            .map_err(|error| format!("browser launch failed: {error}"))?;

        // Chrome writes the chosen port into DevToolsActivePort.
        let port_file = profile.join("DevToolsActivePort");
        let mut port: Option<u16> = None;
        for _ in 0..100 {
            if let Ok(content) = std::fs::read_to_string(&port_file) {
                if let Some(first) = content.lines().next() {
                    if let Ok(parsed) = first.trim().parse::<u16>() {
                        port = Some(parsed);
                        break;
                    }
                }
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        let port = port.ok_or_else(|| "browser did not expose a debugging port".to_string())?;

        let version_body = cdp_http_get(port, "/json/version").await?;
        let version: serde_json::Value = serde_json::from_str(&version_body)
            .map_err(|error| format!("cdp version parse: {error}"))?;
        let browser_ws = version
            .get("webSocketDebuggerUrl")
            .and_then(|url| url.as_str())
            .ok_or("cdp websocket url missing")?
            .to_string();
        let client = CdpClient::connect(&browser_ws).await?;
        Ok(Self {
            child,
            client,
            profile_dir: profile,
            engine,
            path: path.display().to_string(),
        })
    }

    pub fn status(&self) -> BrowserRuntimeStatus {
        BrowserRuntimeStatus {
            available: true,
            engine: self.engine.clone(),
            path: format!("{} (profile: {})", self.path, self.profile_dir.display()),
            running: !self.client.is_closed(),
            version: None,
        }
    }

    pub fn engine_name(&self) -> &str {
        &self.engine
    }

    pub async fn shutdown(&mut self) {
        let closed = self
            .client
            .send(
                "Browser.close",
                serde_json::Value::Null,
                None,
                Duration::from_secs(5),
            )
            .await
            .is_ok();
        if !closed {
            self.kill();
        }
        let _ = self.child.wait().await;
    }

    pub fn kill(&mut self) {
        let _ = self.child.start_kill();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn managed_runtime_dir_respects_env_override() {
        // SAFETY: single-threaded test toggling a process-wide override.
        std::env::set_var("EVIR_BROWSER_RUNTIME_DIR", "/tmp/evir-test-runtime");
        assert_eq!(
            browser_runtime_install_dir(),
            PathBuf::from("/tmp/evir-test-runtime")
        );
        std::env::remove_var("EVIR_BROWSER_RUNTIME_DIR");
    }

    #[test]
    fn agent_profile_dir_is_not_the_user_home() {
        let profile = agent_profile_dir();
        let home = std::env::var("HOME").unwrap_or_default();
        assert!(profile.display().to_string().starts_with(&home));
        assert!(profile
            .display()
            .to_string()
            .contains("browser-agent-profile"));
    }
}
