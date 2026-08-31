//! Browser Workbench: an Evir-managed browsing window.
//!
//! Layout mirrors the required separation:
//! - the *chrome* webview (label `browser-workbench`) loads the Evir frontend
//!   (`#browser` route) and renders toolbar/tabs. It only gets the minimal
//!   `browser-chrome` capability — never the main window's set.
//! - *content* webviews (labels `browser-content-<n>`) load remote URLs and
//!   are listed in **no** capability, so they hold zero Tauri permissions.
//! - each content webview gets its own data directory, so site cookies never
//!   mix with the main WebView storage.
//! - popups opened by pages are denied by default.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::Serialize;
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder,
};

#[derive(Debug, Clone, Serialize)]
pub struct BrowserTab {
    pub id: u32,
    pub url: String,
    pub title: String,
    pub active: bool,
}

#[derive(Default)]
pub struct BrowserWorkbenchState {
    next_tab_id: Mutex<u32>,
    tab_titles: Mutex<HashMap<u32, String>>,
}

fn content_label(id: u32) -> String {
    format!("browser-content-{id}")
}

/// Bare hostnames go to https; localhost dev servers go to http.
pub fn normalize_input_url(input: &str) -> Result<String, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("empty url".into());
    }
    if trimmed.starts_with("http://")
        || trimmed.starts_with("https://")
        || trimmed.starts_with("about:")
    {
        return Ok(trimmed.to_string());
    }
    let is_local = trimmed.starts_with("localhost")
        || trimmed.starts_with("127.0.0.1")
        || trimmed.starts_with("[::1]");
    Ok(if is_local {
        format!("http://{trimmed}")
    } else {
        format!("https://{trimmed}")
    })
}

fn ensure_workbench_window(app: &AppHandle) -> tauri::Result<tauri::WebviewWindow> {
    if let Some(window) = app.get_webview_window("browser-workbench") {
        let _ = window.set_focus();
        return Ok(window);
    }
    let main_url = app
        .get_webview_window("main")
        .and_then(|window| window.url().ok())
        .ok_or(tauri::Error::WindowNotFound)?;
    let mut chrome_url = main_url;
    chrome_url.set_fragment(Some("browser"));
    WebviewWindowBuilder::new(app, "browser-workbench", WebviewUrl::External(chrome_url))
        .title("Evir Browser")
        .inner_size(1200.0, 800.0)
        .min_inner_size(700.0, 480.0)
        .build()
}

pub fn list_tabs(app: &AppHandle) -> Vec<BrowserTab> {
    let state = app.state::<BrowserWorkbenchState>();
    let titles = state.tab_titles.lock().expect("tab title lock");
    let mut tabs: Vec<BrowserTab> = Vec::new();
    for (label, webview) in app.webviews() {
        let Some(id_part) = label.strip_prefix("browser-content-") else {
            continue;
        };
        let Ok(id) = id_part.parse::<u32>() else {
            continue;
        };
        tabs.push(BrowserTab {
            id,
            url: webview.url().map(|url| url.to_string()).unwrap_or_default(),
            title: titles.get(&id).cloned().unwrap_or_default(),
            active: false,
        });
    }
    tabs.sort_by_key(|tab| tab.id);
    if let Some(first) = tabs.first_mut() {
        first.active = true;
    }
    tabs
}

fn emit_tabs(app: &AppHandle) {
    let _ = app.emit("browser-workbench-tabs", list_tabs(app));
}

fn content_data_dir(app: &AppHandle, id: u32) -> Option<PathBuf> {
    let base = app.path().app_cache_dir().ok()?;
    Some(base.join("browser-profiles").join(format!("content-{id}")))
}

fn activate_tab(app: &AppHandle, active_id: u32) {
    for (label, webview) in app.webviews() {
        let Some(id_part) = label.strip_prefix("browser-content-") else {
            continue;
        };
        let Ok(id) = id_part.parse::<u32>() else {
            continue;
        };
        let _ = if id == active_id {
            webview.show()
        } else {
            webview.hide()
        };
    }
}

#[tauri::command]
pub async fn browser_workbench_open(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        ensure_workbench_window(&app)
            .map(|_| ())
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn browser_tab_new(
    app: AppHandle,
    state: tauri::State<'_, BrowserWorkbenchState>,
    url: String,
) -> Result<BrowserTab, String> {
    let target = normalize_input_url(&url)?;
    let id = {
        let mut next = state.next_tab_id.lock().expect("browser tab lock");
        *next += 1;
        *next
    };
    tauri::async_runtime::spawn_blocking(move || {
        let workbench = ensure_workbench_window(&app).map_err(|error| error.to_string())?;
        let window = workbench.as_ref().window();
        let parsed = tauri::Url::parse(&target).map_err(|error| error.to_string())?;
        let mut builder =
            tauri::webview::WebviewBuilder::new(content_label(id), WebviewUrl::External(parsed));
        if let Some(data_dir) = content_data_dir(&app, id) {
            builder = builder.data_directory(data_dir);
        }
        let title_app = app.clone();
        builder = builder
            .on_document_title_changed(move |webview, title| {
                let handle = webview.app_handle().clone();
                let tab_id = webview
                    .label()
                    .strip_prefix("browser-content-")
                    .and_then(|part| part.parse::<u32>().ok())
                    .unwrap_or(0);
                if let Some(state) = handle.try_state::<BrowserWorkbenchState>() {
                    state
                        .tab_titles
                        .lock()
                        .expect("tab title lock")
                        .insert(tab_id, title);
                }
                emit_tabs(&handle);
            })
            .on_new_window(|_url, _features| tauri::webview::NewWindowResponse::Deny);
        let _ = title_app;
        let webview = window
            .add_child(
                builder,
                PhysicalPosition::new(0, 96),
                PhysicalSize::new(
                    window.inner_size().map(|size| size.width).unwrap_or(1200),
                    600,
                ),
            )
            .map_err(|error| error.to_string())?;
        let tab = BrowserTab {
            id,
            url: webview
                .url()
                .map(|url| url.to_string())
                .unwrap_or(target.clone()),
            title: String::new(),
            active: true,
        };
        activate_tab(&app, id);
        emit_tabs(&app);
        Ok(tab)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn browser_tab_activate(app: AppHandle, id: u32) -> Result<(), String> {
    if app.get_webview(&content_label(id)).is_none() {
        return Err("tab not found".into());
    }
    activate_tab(&app, id);
    emit_tabs(&app);
    Ok(())
}

#[tauri::command]
pub fn browser_tab_close(app: AppHandle, id: u32) -> Result<(), String> {
    let Some(webview) = app.get_webview(&content_label(id)) else {
        return Ok(());
    };
    let _ = webview.close();
    if let Some(state) = app.try_state::<BrowserWorkbenchState>() {
        state.tab_titles.lock().expect("tab title lock").remove(&id);
    }
    let remaining: Vec<u32> = app
        .webviews()
        .keys()
        .filter_map(|label| label.strip_prefix("browser-content-")?.parse::<u32>().ok())
        .filter(|tab_id| *tab_id != id)
        .collect();
    if let Some(last) = remaining.iter().max() {
        activate_tab(&app, *last);
    }
    emit_tabs(&app);
    Ok(())
}

#[tauri::command]
pub fn browser_tab_navigate(app: AppHandle, id: u32, url: String) -> Result<(), String> {
    let Some(webview) = app.get_webview(&content_label(id)) else {
        return Err("tab not found".into());
    };
    let target = normalize_input_url(&url)?;
    let parsed = tauri::Url::parse(&target).map_err(|error| error.to_string())?;
    webview
        .navigate(parsed)
        .map_err(|error| error.to_string())?;
    emit_tabs(&app);
    Ok(())
}

#[tauri::command]
pub fn browser_tab_history(app: AppHandle, id: u32, direction: String) -> Result<(), String> {
    let Some(webview) = app.get_webview(&content_label(id)) else {
        return Err("tab not found".into());
    };
    let script = match direction.as_str() {
        "back" => "history.back()",
        "forward" => "history.forward()",
        "reload" => "location.reload()",
        _ => return Err("unknown direction".into()),
    };
    webview.eval(script).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn browser_tab_list(app: AppHandle) -> Vec<BrowserTab> {
    list_tabs(&app)
}

/// The chrome webview reports its content-area rect so child webviews can
/// follow window resizes (CSS px from the frontend → physical units here).
#[tauri::command]
pub fn browser_layout_update(
    app: AppHandle,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let scale = app
        .get_webview_window("browser-workbench")
        .and_then(|window| window.scale_factor().ok())
        .unwrap_or(1.0);
    let position = PhysicalPosition::new((x * scale) as i32, (y * scale) as i32);
    let size = PhysicalSize::new(
        (width * scale).max(1.0) as u32,
        (height * scale).max(1.0) as u32,
    );
    for (label, webview) in app.webviews() {
        if label.starts_with("browser-content-") {
            let _ = webview.set_position(position);
            let _ = webview.set_size(size);
        }
    }
    Ok(())
}

#[tauri::command]
pub fn browser_clear_site_data(app: AppHandle) -> Result<(), String> {
    for (label, webview) in app.webviews() {
        if label.starts_with("browser-content-") {
            let _ = webview.clear_all_browsing_data();
        }
    }
    Ok(())
}
