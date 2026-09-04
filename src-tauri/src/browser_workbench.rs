//! Browser surfaces: Evir-managed browsing views.
//!
//! Two surfaces share this module:
//! - the *workbench window* (`browser-workbench`): standalone window whose
//!   chrome webview loads the Evir frontend (`#browser` route);
//! - the *workspace panel*: content webviews parented to the main window,
//!   positioned over the workspace Browser tab area and hidden whenever the
//!   panel is closed, another tab is active, or an overlay would be covered.
//!
//! Layout mirrors the required separation everywhere:
//! - *content* webviews (`browser-content-<n>` / `browser-panel-content-<n>`)
//!   load remote URLs and are listed in **no** capability, so they hold zero
//!   Tauri permissions;
//! - each content webview gets its own data directory, so site cookies never
//!   mix with the main WebView storage;
//! - popups opened by pages are denied by default;
//! - the workbench chrome webview only gets the minimal `browser-chrome`
//!   capability — never the main window's set.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::Serialize;
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder,
};

use crate::native_log;

#[derive(Debug, Clone, Serialize)]
pub struct BrowserTab {
    pub id: u32,
    pub url: String,
    pub title: String,
    pub active: bool,
}

/// Which browsing surface a tab belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Surface {
    Workbench,
    Panel,
}

impl Surface {
    pub fn prefix(self) -> &'static str {
        match self {
            Surface::Workbench => "browser-content-",
            Surface::Panel => "browser-panel-content-",
        }
    }

    pub fn window_label(self) -> &'static str {
        match self {
            Surface::Workbench => "browser-workbench",
            Surface::Panel => "main",
        }
    }
}

#[derive(Default)]
pub struct BrowserWorkbenchState {
    next_tab_id: Mutex<u32>,
    /// Tab titles keyed by content-webview label (both surfaces).
    tab_titles: Mutex<HashMap<String, String>>,
    /// Active tab per surface.
    active_tabs: Mutex<HashMap<&'static str, u32>>,
    /// Whether panel content webviews may be visible at all.
    panel_visible: Mutex<bool>,
}

fn content_label(surface: Surface, id: u32) -> String {
    format!("{}{}", surface.prefix(), id)
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

pub fn list_surface_tabs(app: &AppHandle, surface: Surface) -> Vec<BrowserTab> {
    let state = app.state::<BrowserWorkbenchState>();
    let titles = state.tab_titles.lock().expect("tab title lock");
    let active_tabs = state.active_tabs.lock().expect("active tab lock");
    let active_id = active_tabs.get(surface.window_label()).copied();
    let mut tabs: Vec<BrowserTab> = Vec::new();
    for (label, webview) in app.webviews() {
        let Some(id_part) = label.strip_prefix(surface.prefix()) else {
            continue;
        };
        let Ok(id) = id_part.parse::<u32>() else {
            continue;
        };
        tabs.push(BrowserTab {
            id,
            url: webview.url().map(|url| url.to_string()).unwrap_or_default(),
            title: titles.get(&label).cloned().unwrap_or_default(),
            active: Some(id) == active_id,
        });
    }
    tabs.sort_by_key(|tab| tab.id);
    // Workbench compat: callers treat the first tab as active when none was
    // ever explicitly activated.
    if active_id.is_none() {
        if let Some(first) = tabs.first_mut() {
            first.active = true;
        }
    }
    tabs
}

fn emit_tabs(app: &AppHandle, surface: Surface) {
    let event = match surface {
        Surface::Workbench => "browser-workbench-tabs",
        Surface::Panel => "browser-panel-tabs",
    };
    let _ = app.emit(event, list_surface_tabs(app, surface));
}

fn content_data_dir(app: &AppHandle, surface: Surface, id: u32) -> Option<PathBuf> {
    let base = app.path().app_cache_dir().ok()?;
    Some(base.join("browser-profiles").join(format!(
        "{}-{id}",
        if surface == Surface::Panel {
            "panel"
        } else {
            "content"
        }
    )))
}

fn set_active_tab(app: &AppHandle, surface: Surface, active_id: u32) {
    let state = app.state::<BrowserWorkbenchState>();
    state
        .active_tabs
        .lock()
        .expect("active tab lock")
        .insert(surface.window_label(), active_id);
    let panel_visible =
        surface == Surface::Panel && *state.panel_visible.lock().expect("panel visible lock");
    let mut shown = 0u32;
    let mut hidden = 0u32;
    let mut failures: Vec<String> = Vec::new();
    for (label, webview) in app.webviews() {
        let Some(id_part) = label.strip_prefix(surface.prefix()) else {
            continue;
        };
        let Ok(id) = id_part.parse::<u32>() else {
            continue;
        };
        let show = id == active_id && (surface == Surface::Workbench || panel_visible);
        let outcome = if show { webview.show() } else { webview.hide() };
        match outcome {
            Ok(()) => {
                if show {
                    shown += 1;
                } else {
                    hidden += 1;
                }
            }
            Err(error) => failures.push(format!("{label}: {error}")),
        }
    }
    native_log::log(
        "browser.set-active-tab",
        serde_json::json!({
            "surface": surface.window_label(),
            "activeId": active_id,
            "panelVisible": panel_visible,
            "shown": shown,
            "hidden": hidden,
            "failures": failures,
        }),
    );
}

/// Create a content webview for `surface` and make it the active tab.
fn add_content_tab(
    app: &AppHandle,
    surface: Surface,
    id: u32,
    target: &str,
) -> Result<BrowserTab, String> {
    let start = std::time::Instant::now();
    // Log the origin only: full URLs can carry query tokens.
    let origin = tauri::Url::parse(target)
        .ok()
        .and_then(|url| {
            url.host_str().map(|host| {
                format!(
                    "{}://{}{}",
                    url.scheme(),
                    host,
                    url.port().map(|p| format!(":{p}")).unwrap_or_default()
                )
            })
        })
        .unwrap_or_else(|| "<unparsable>".into());
    let result = add_content_tab_inner(app, surface, id, target);
    native_log::log(
        "browser.tab-added",
        serde_json::json!({
            "surface": surface.window_label(),
            "id": id,
            "origin": origin,
            "ok": result.is_ok(),
            "durationMs": start.elapsed().as_millis() as u64,
        }),
    );
    result
}

fn add_content_tab_inner(
    app: &AppHandle,
    surface: Surface,
    id: u32,
    target: &str,
) -> Result<BrowserTab, String> {
    let window_label = surface.window_label();
    let window = if surface == Surface::Workbench {
        ensure_workbench_window(app)
            .map_err(|error| error.to_string())?
            .as_ref()
            .window()
            .clone()
    } else {
        app.get_webview_window(window_label)
            .ok_or("main window not available")?
            .as_ref()
            .window()
            .clone()
    };
    let parsed = tauri::Url::parse(target).map_err(|error| error.to_string())?;
    let mut builder = tauri::webview::WebviewBuilder::new(
        content_label(surface, id),
        WebviewUrl::External(parsed),
    );
    if let Some(data_dir) = content_data_dir(app, surface, id) {
        builder = builder.data_directory(data_dir);
    }
    builder = builder
        .on_document_title_changed(move |webview, title| {
            let handle = webview.app_handle().clone();
            let label = webview.label().to_string();
            let surface = if label.starts_with(Surface::Panel.prefix()) {
                Surface::Panel
            } else {
                Surface::Workbench
            };
            // Annotation transport (§36–38): the injected picker reports the
            // clicked element through the title channel we already watch.
            // Those titles must never leak into the tab-title state.
            if let Some(payload) = annotation_payload_from_title(&title) {
                let _ = handle.emit("browser-panel-annotation", payload);
                return;
            }
            if let Some(state) = handle.try_state::<BrowserWorkbenchState>() {
                state
                    .tab_titles
                    .lock()
                    .expect("tab title lock")
                    .insert(label, title);
            }
            emit_tabs(&handle, surface);
        })
        .on_new_window(|_url, _features| tauri::webview::NewWindowResponse::Deny);
    // Panel webviews start offscreen until the frontend reports a visible
    // content rect; workbench webviews show immediately at a sane default.
    let initial_position = if surface == Surface::Panel {
        PhysicalPosition::new(-10_000, -10_000)
    } else {
        PhysicalPosition::new(0, 96)
    };
    let webview = window
        .add_child(
            builder,
            initial_position,
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
            .unwrap_or_else(|_| target.to_string()),
        title: String::new(),
        active: true,
    };
    set_active_tab(app, surface, id);
    emit_tabs(app, surface);
    Ok(tab)
}

fn next_tab_id(app: &AppHandle) -> u32 {
    let state = app.state::<BrowserWorkbenchState>();
    let mut next = state.next_tab_id.lock().expect("browser tab lock");
    *next += 1;
    *next
}

fn find_webview(app: &AppHandle, surface: Surface, id: u32) -> Option<tauri::Webview> {
    app.get_webview(&content_label(surface, id))
}

fn close_tab(app: &AppHandle, surface: Surface, id: u32) {
    native_log::log(
        "browser.tab-closed",
        serde_json::json!({ "surface": surface.window_label(), "id": id }),
    );
    if let Some(webview) = find_webview(app, surface, id) {
        let _ = webview.close();
    }
    if let Some(state) = app.try_state::<BrowserWorkbenchState>() {
        state
            .tab_titles
            .lock()
            .expect("tab title lock")
            .remove(&content_label(surface, id));
    }
    let remaining: Vec<u32> = app
        .webviews()
        .keys()
        .filter_map(|label| label.strip_prefix(surface.prefix())?.parse::<u32>().ok())
        .filter(|tab_id| *tab_id != id)
        .collect();
    if let Some(last) = remaining.iter().max() {
        set_active_tab(app, surface, *last);
    } else if let Some(state) = app.try_state::<BrowserWorkbenchState>() {
        state
            .active_tabs
            .lock()
            .expect("active tab lock")
            .remove(surface.window_label());
    }
    emit_tabs(app, surface);
}

// ---------------------------------------------------------------------------
// Workbench-window commands (pre-existing surface)
// ---------------------------------------------------------------------------

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
pub async fn browser_tab_new(app: AppHandle, url: String) -> Result<BrowserTab, String> {
    let target = normalize_input_url(&url)?;
    let id = next_tab_id(&app);
    tauri::async_runtime::spawn_blocking(move || {
        add_content_tab(&app, Surface::Workbench, id, &target)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn browser_tab_activate(app: AppHandle, id: u32) -> Result<(), String> {
    if find_webview(&app, Surface::Workbench, id).is_none() {
        return Err("tab not found".into());
    }
    set_active_tab(&app, Surface::Workbench, id);
    emit_tabs(&app, Surface::Workbench);
    Ok(())
}

#[tauri::command]
pub fn browser_tab_close(app: AppHandle, id: u32) -> Result<(), String> {
    if find_webview(&app, Surface::Workbench, id).is_none() {
        return Ok(());
    }
    close_tab(&app, Surface::Workbench, id);
    Ok(())
}

#[tauri::command]
pub fn browser_tab_navigate(app: AppHandle, id: u32, url: String) -> Result<(), String> {
    let Some(webview) = find_webview(&app, Surface::Workbench, id) else {
        return Err("tab not found".into());
    };
    let target = normalize_input_url(&url)?;
    let parsed = tauri::Url::parse(&target).map_err(|error| error.to_string())?;
    webview
        .navigate(parsed)
        .map_err(|error| error.to_string())?;
    emit_tabs(&app, Surface::Workbench);
    Ok(())
}

#[tauri::command]
pub fn browser_tab_history(app: AppHandle, id: u32, direction: String) -> Result<(), String> {
    history(&app, Surface::Workbench, id, &direction)
}

fn history(app: &AppHandle, surface: Surface, id: u32, direction: &str) -> Result<(), String> {
    let Some(webview) = find_webview(app, surface, id) else {
        return Err("tab not found".into());
    };
    let script = match direction {
        "back" => "history.back()",
        "forward" => "history.forward()",
        "reload" => "location.reload()",
        _ => return Err("unknown direction".into()),
    };
    webview.eval(script).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn browser_tab_list(app: AppHandle) -> Vec<BrowserTab> {
    list_surface_tabs(&app, Surface::Workbench)
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
    apply_workbench_layout(&app, x, y, width, height)
}

fn apply_workbench_layout(
    app: &AppHandle,
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
        if label.starts_with(Surface::Workbench.prefix()) {
            let _ = webview.set_position(position);
            let _ = webview.set_size(size);
        }
    }
    Ok(())
}

#[tauri::command]
pub fn browser_clear_site_data(app: AppHandle) -> Result<(), String> {
    for (label, webview) in app.webviews() {
        if label.starts_with(Surface::Workbench.prefix()) {
            let _ = webview.clear_all_browsing_data();
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Workspace-panel commands (main-window surface)
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn browser_panel_tab_new(app: AppHandle, url: String) -> Result<BrowserTab, String> {
    let target = normalize_input_url(&url)?;
    let id = next_tab_id(&app);
    tauri::async_runtime::spawn_blocking(move || add_content_tab(&app, Surface::Panel, id, &target))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn browser_panel_tab_activate(app: AppHandle, id: u32) -> Result<(), String> {
    if find_webview(&app, Surface::Panel, id).is_none() {
        return Err("tab not found".into());
    }
    set_active_tab(&app, Surface::Panel, id);
    emit_tabs(&app, Surface::Panel);
    Ok(())
}

#[tauri::command]
pub fn browser_panel_tab_close(app: AppHandle, id: u32) -> Result<(), String> {
    if find_webview(&app, Surface::Panel, id).is_none() {
        return Ok(());
    }
    close_tab(&app, Surface::Panel, id);
    Ok(())
}

#[tauri::command]
pub fn browser_panel_tab_navigate(app: AppHandle, id: u32, url: String) -> Result<(), String> {
    let Some(webview) = find_webview(&app, Surface::Panel, id) else {
        return Err("tab not found".into());
    };
    let target = normalize_input_url(&url)?;
    let parsed = tauri::Url::parse(&target).map_err(|error| error.to_string())?;
    webview
        .navigate(parsed)
        .map_err(|error| error.to_string())?;
    emit_tabs(&app, Surface::Panel);
    Ok(())
}

#[tauri::command]
pub fn browser_panel_tab_history(app: AppHandle, id: u32, direction: String) -> Result<(), String> {
    history(&app, Surface::Panel, id, &direction)
}

#[tauri::command]
pub fn browser_panel_tab_list(app: AppHandle) -> Vec<BrowserTab> {
    list_surface_tabs(&app, Surface::Panel)
}

/// The workspace panel reports its browser content rect (CSS px relative to
/// the main window). `visible` is false whenever the panel is closed,
/// another tab is active, or a full-screen overlay is open — the native
/// webviews would otherwise render above the DOM.
#[tauri::command]
pub fn browser_panel_layout_update(
    app: AppHandle,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    visible: bool,
) -> Result<(), String> {
    let start = std::time::Instant::now();
    native_log::log(
        "browser.panel-layout-update-started",
        serde_json::json!({ "visible": visible }),
    );
    {
        let state = app.state::<BrowserWorkbenchState>();
        *state.panel_visible.lock().expect("panel visible lock") = visible;
    }
    let scale = app
        .get_webview_window("main")
        .and_then(|window| window.scale_factor().ok())
        .unwrap_or(1.0);
    let position = PhysicalPosition::new((x * scale) as i32, (y * scale) as i32);
    let size = PhysicalSize::new(
        (width * scale).max(1.0) as u32,
        (height * scale).max(1.0) as u32,
    );
    for (label, webview) in app.webviews() {
        if !label.starts_with(Surface::Panel.prefix()) {
            continue;
        }
        let outcome = if visible {
            webview
                .set_position(position)
                .and_then(|()| webview.set_size(size))
                .and_then(|()| webview.show())
        } else {
            // Hidden state must be explicit: the native layer renders above
            // every DOM element, so "keep the old rect" would leave a ghost
            // page floating over whatever moved underneath it.
            webview.hide()
        };
        if let Err(error) = outcome {
            native_log::log(
                "browser.panel-webview-op-failed",
                serde_json::json!({ "label": label, "visible": visible, "error": error.to_string() }),
            );
        }
    }
    let active = app
        .state::<BrowserWorkbenchState>()
        .active_tabs
        .lock()
        .expect("active tab lock")
        .get(Surface::Panel.window_label())
        .copied();
    // The value is bound to a local BEFORE the if-let: a MutexGuard temporary
    // in an if-let scrutinee lives through the whole block (edition 2021), and
    // set_active_tab re-locks active_tabs on this thread — that re-entrancy
    // deadlocked the main thread for the whole session (2026-09-04 hang report:
    // startURLSchemeTask → browser_panel_layout_update → set_active_tab).
    if let Some(active) = active {
        set_active_tab(&app, Surface::Panel, active);
    } else {
        for (label, webview) in app.webviews() {
            if label.starts_with(Surface::Panel.prefix()) {
                let _ = webview.hide();
            }
        }
    }
    native_log::log(
        "browser.panel-layout-updated",
        serde_json::json!({
            "visible": visible,
            "x": x.round() as i64,
            "y": y.round() as i64,
            "w": width.round() as i64,
            "h": height.round() as i64,
            "activeTab": active,
            "durationMs": start.elapsed().as_millis() as u64,
        }),
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Browser Annotation (§36–38)
// ---------------------------------------------------------------------------

pub const ANNOTATION_TITLE_PREFIX: &str = "EVIR_ANNOTATE:";

/// Extract and decode an annotation payload from a document-title transport
/// value. Returns None for ordinary titles.
pub fn annotation_payload_from_title(title: &str) -> Option<serde_json::Value> {
    let encoded = title.strip_prefix(ANNOTATION_TITLE_PREFIX)?;
    let decoded = percent_encoding::percent_decode_str(encoded)
        .decode_utf8()
        .ok()?;
    serde_json::from_str(&decoded).ok()
}

/// Picker injected into the active panel content webview. It never touches
/// Tauri APIs (the webview holds zero capabilities) — the only outbound
/// channel is `document.title`, which the title watcher above already
/// observes. Click → payload; Escape → cancel; a second injection replaces
/// the previous picker.
const ANNOTATE_PICKER_SCRIPT: &str = r#"
(function () {
  if (window.__evirAnnotateCleanup) { window.__evirAnnotateCleanup(); }
  var box = document.createElement('div');
  box.setAttribute('data-evir-annotate', 'hover');
  box.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;border:2px solid #8b5cf6;background:rgba(139,92,246,.12);border-radius:4px;transition:all 40ms linear;';
  var tip = document.createElement('div');
  tip.style.cssText = 'position:absolute;left:0;top:-22px;font:11px -apple-system,sans-serif;background:#8b5cf6;color:#fff;padding:1px 6px;border-radius:3px;white-space:nowrap;';
  box.appendChild(tip);
  function place(el, r) {
    box.style.left = r.x + 'px'; box.style.top = r.y + 'px';
    box.style.width = r.width + 'px'; box.style.height = r.height + 'px';
    tip.textContent = el.tagName.toLowerCase() + (el.id ? '#' + el.id : '');
  }
  function selectorFor(el) {
    var parts = [], node = el, depth = 0;
    while (node && node.nodeType === 1 && depth < 4) {
      var s = node.tagName.toLowerCase();
      if (node.id) { parts.unshift(s + '#' + node.id); break; }
      if (node.classList && node.classList.length) {
        s += '.' + Array.prototype.slice.call(node.classList, 0, 2).join('.');
      }
      var parent = node.parentElement;
      if (parent) {
        var same = Array.prototype.indexOf.call(parent.children, node) + 1;
        s += ':nth-child(' + same + ')';
      }
      parts.unshift(s);
      node = parent; depth++;
    }
    return parts.join(' > ');
  }
  function onMove(e) {
    var el = e.target;
    if (!el || el === box || box.contains(el)) { return; }
    var r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) { return; }
    place(el, r);
  }
  function done() {
    remove();
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKey, true);
    window.__evirAnnotateCleanup = null;
  }
  function remove() { if (box.parentNode) { box.parentNode.removeChild(box); } }
  function onClick(e) {
    var el = e.target;
    if (!el || el === box || box.contains(el)) { return; }
    e.preventDefault();
    e.stopPropagation();
    var r = el.getBoundingClientRect();
    var cls = (typeof el.className === 'string') ? el.className : '';
    var payload = {
      url: location.href,
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      classes: cls || null,
      role: el.getAttribute('role'),
      ariaLabel: el.getAttribute('aria-label'),
      name: el.getAttribute('name'),
      text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 80),
      box: {
        x: Math.round(r.x), y: Math.round(r.y),
        width: Math.round(r.width), height: Math.round(r.height)
      },
      selector: selectorFor(el)
    };
    document.title = 'EVIR_ANNOTATE:' + encodeURIComponent(JSON.stringify(payload));
    done();
  }
  function onKey(e) { if (e.key === 'Escape') { done(); } }
  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKey, true);
  (document.body || document.documentElement).appendChild(box);
  window.__evirAnnotateCleanup = done;
})();
"#;

const ANNOTATE_STOP_SCRIPT: &str =
    "window.__evirAnnotateCleanup ? window.__evirAnnotateCleanup() : undefined;";

/// Toggle the element picker on the active panel browser tab.
#[tauri::command]
pub fn browser_panel_annotate(app: AppHandle, enable: bool) -> Result<(), String> {
    let active = app
        .state::<BrowserWorkbenchState>()
        .active_tabs
        .lock()
        .expect("active tab lock")
        .get(Surface::Panel.window_label())
        .copied();
    let Some(id) = active else {
        return Err("no active browser tab".into());
    };
    let Some(webview) = find_webview(&app, Surface::Panel, id) else {
        return Err("tab not found".into());
    };
    webview
        .eval(if enable {
            ANNOTATE_PICKER_SCRIPT
        } else {
            ANNOTATE_STOP_SCRIPT
        })
        .map_err(|error| error.to_string())
}
