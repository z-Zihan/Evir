//! In-memory artifact store backing the `preview://` custom scheme.
//!
//! Model-generated HTML is served from an isolated origin (its own CSP, no
//! IPC, sandboxed frame on the frontend) instead of `srcdoc`/blob injection,
//! so the app CSP is never widened and the artifact document cannot inherit
//! the main window's policy.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Instant;

use tauri::http::{Response, StatusCode};
use tauri::{Manager, State};

const MAX_ARTIFACTS: usize = 24;
const MAX_ARTIFACT_BYTES: usize = 4 * 1024 * 1024;

/// Restrictive CSP applied to every served artifact document: inline scripts
/// and styles only, data/blob media, no network, no origins, no forms.
const ARTIFACT_CSP: &str = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' data:; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'";

#[derive(Default)]
pub struct PreviewArtifactState {
    artifacts: Mutex<HashMap<String, (String, Instant)>>,
    counter: AtomicU64,
}

impl PreviewArtifactState {
    fn insert(&self, id: String, source: String) {
        let mut artifacts = self.artifacts.lock().expect("preview artifact lock");
        while artifacts.len() >= MAX_ARTIFACTS {
            let oldest = artifacts
                .iter()
                .min_by_key(|(_, (_, created))| *created)
                .map(|(id, _)| id.clone());
            match oldest {
                Some(id) => {
                    artifacts.remove(&id);
                }
                None => break,
            }
        }
        artifacts.insert(id, (source, Instant::now()));
    }
}

fn artifact_id(counter: u64) -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    format!("{nanos:x}-{counter:x}")
}

/// Registers one untrusted artifact and returns its id.
#[tauri::command]
pub fn preview_artifact_register(
    state: State<PreviewArtifactState>,
    source: String,
) -> Result<String, String> {
    if source.len() > MAX_ARTIFACT_BYTES {
        return Err("artifact too large".into());
    }
    let id = artifact_id(state.counter.fetch_add(1, Ordering::Relaxed));
    state.insert(id.clone(), source);
    Ok(id)
}

/// Drops a previously registered artifact (frame unmounted).
#[tauri::command]
pub fn preview_artifact_revoke(
    state: State<PreviewArtifactState>,
    id: String,
) -> Result<(), String> {
    state
        .artifacts
        .lock()
        .expect("preview artifact lock")
        .remove(&id);
    Ok(())
}

pub fn register_preview_scheme(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    builder.register_uri_scheme_protocol("preview", |ctx, request| {
        let path = request.uri().path();
        let Some(id) = path.strip_prefix("/artifact/") else {
            return Response::builder()
                .status(StatusCode::NOT_FOUND)
                .body(std::borrow::Cow::Borrowed("not found".as_bytes()))
                .unwrap();
        };
        let id = percent_encoding::percent_decode_str(id)
            .decode_utf8_lossy()
            .to_string();
        let state = ctx.app_handle().state::<PreviewArtifactState>();
        let artifact = state
            .artifacts
            .lock()
            .expect("preview artifact lock")
            .get(&id)
            .map(|(source, _)| source.clone());
        match artifact {
            Some(body) => Response::builder()
                .status(StatusCode::OK)
                .header("Content-Type", "text/html; charset=utf-8")
                .header("Content-Security-Policy", ARTIFACT_CSP)
                .header("Cache-Control", "no-store")
                .header("X-Content-Type-Options", "nosniff")
                .body(std::borrow::Cow::Owned(body.into_bytes()))
                .unwrap(),
            None => Response::builder()
                .status(StatusCode::NOT_FOUND)
                .body(std::borrow::Cow::Borrowed("artifact expired".as_bytes()))
                .unwrap(),
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state() -> PreviewArtifactState {
        PreviewArtifactState::default()
    }

    #[test]
    fn ids_are_unique_and_monotonic() {
        let state = state();
        let first = artifact_id(state.counter.fetch_add(1, Ordering::Relaxed));
        let second = artifact_id(state.counter.fetch_add(1, Ordering::Relaxed));
        assert_ne!(first, second);
    }

    #[test]
    fn insert_evicts_beyond_cap() {
        let state = state();
        for index in 0..(MAX_ARTIFACTS + 4) {
            state.insert(format!("id{index}"), format!("<p>{index}</p>"));
        }
        let artifacts = state.artifacts.lock().unwrap();
        assert_eq!(artifacts.len(), MAX_ARTIFACTS);
        assert!(!artifacts.contains_key("id0"));
        assert!(artifacts.contains_key(&format!("id{}", MAX_ARTIFACTS + 3)));
    }

    #[test]
    fn oversized_artifacts_are_rejected() {
        let state = state();
        let big = "x".repeat(MAX_ARTIFACT_BYTES + 1);
        assert!(preview_artifact_register_inner(&state, big).is_err());
        let ok = "x".repeat(1024);
        assert!(preview_artifact_register_inner(&state, ok).is_ok());
    }

    fn preview_artifact_register_inner(
        state: &PreviewArtifactState,
        source: String,
    ) -> Result<String, String> {
        if source.len() > MAX_ARTIFACT_BYTES {
            return Err("artifact too large".into());
        }
        let id = artifact_id(state.counter.fetch_add(1, Ordering::Relaxed));
        state.insert(id.clone(), source);
        Ok(id)
    }
}
