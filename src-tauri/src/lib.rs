mod ax_snapshot;
mod browser_commands;
mod browser_runtime;
mod browser_workbench;
#[cfg(test)]
mod browser_workbench_tests;
mod cdp;
mod commands;
mod dev_server;
mod diagnostics;
#[cfg(test)]
mod diagnostics_tests;
mod ego_runtime;
mod mcp_stdio;
mod mcp_stdio_process;
#[cfg(all(test, unix))]
mod mcp_stdio_process_tests;
mod native_log;
mod preview_sandbox;
mod profiles;
#[cfg(test)]
mod profiles_tests;
mod secret_vault;
#[cfg(test)]
mod secret_vault_tests;
mod storage;

#[cfg(test)]
mod storage_tests;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    // Single instance must be the first registered plugin: a second launch
    // focuses the existing window instead of racing on the SQLite database and
    // the secret vault file.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    }));
    let builder = preview_sandbox::register_preview_scheme(builder);
    builder
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir().map_err(|error| {
                eprintln!("Failed to get app data dir: {error}");
                error
            })?;
            std::fs::create_dir_all(&app_data_dir).map_err(|error| {
                eprintln!("Failed to create app data dir: {error}");
                error
            })?;
            // Profiles first (§51-55): the registry decides which profile's
            // DB / vault / logs this session serves; the first run migrates
            // the legacy single-user files into the default profile.
            let registry = profiles::ensure_registry(&app_data_dir).map_err(|error| {
                let message = error.to_string();
                eprintln!("Failed to init profile registry: {message}");
                std::convert::Into::<Box<dyn std::error::Error>>::into(message)
            })?;
            let active_profile = profiles::active_profile(&registry).map_err(|error| {
                let message = error.to_string();
                eprintln!("No active profile: {message}");
                std::convert::Into::<Box<dyn std::error::Error>>::into(message)
            })?;
            native_log::init(&profiles::profile_logs_dir(
                &app_data_dir,
                &active_profile.id,
            ));
            native_log::log(
                "app.started",
                serde_json::json!({
                    "version": app.package_info().version.to_string(),
                    "profileId": active_profile.id,
                }),
            );
            let db_path = profiles::profile_db_path(&app_data_dir, &active_profile.id);
            let conn = storage::init_db_at(&db_path).map_err(|error| {
                eprintln!("Failed to init database: {error}");
                error
            })?;
            app.manage(storage::DatabaseState::new(conn));
            app.manage(mcp_stdio::McpStdioState::default());
            app.manage(preview_sandbox::PreviewArtifactState::default());
            app.manage(browser_workbench::BrowserWorkbenchState::default());
            app.manage(browser_commands::BrowserAgentState::default());
            app.manage(dev_server::DevServerState::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::db_init,
            commands::profiles_list,
            commands::profiles_create,
            commands::profiles_update,
            commands::profiles_set_active,
            commands::profiles_delete,
            commands::profile_paths,
            commands::plugin_read_manifest,
            commands::db_query,
            commands::db_update,
            commands::entity_get,
            commands::entity_list,
            commands::entity_put,
            commands::entity_put_many,
            commands::entity_delete,
            commands::entity_delete_many,
            commands::entity_clear,
            commands::entity_apply,
            commands::keychain_set,
            commands::keychain_get,
            commands::keychain_delete,
            commands::shared_provider_profiles_read,
            commands::shared_provider_profiles_write,
            commands::fs_read_file,
            commands::fs_read_file_base64,
            commands::fs_write_file,
            commands::fs_list_dir,
            commands::fs_file_info,
            commands::fs_real_path,
            commands::git_worktree_create,
            commands::git_worktree_merge,
            commands::git_worktree_remove,
            commands::fs_apply_patch,
            commands::fs_search_files,
            commands::run_command,
            commands::cancel_command,
            commands::git_status,
            commands::git_diff,
            commands::fs_create_directory,
            commands::fs_file_stat,
            commands::fs_reveal_in_file_manager,
            commands::fs_create_snapshot,
            commands::fs_seal_snapshot,
            commands::fs_restore_snapshot,
            mcp_stdio::mcp_stdio_start,
            mcp_stdio::mcp_stdio_request,
            mcp_stdio::mcp_stdio_send,
            mcp_stdio::mcp_stdio_status,
            mcp_stdio::mcp_stdio_stop,
            diagnostics::diagnostics_logs_overview,
            diagnostics::diagnostics_export_zip,
            preview_sandbox::preview_artifact_register,
            preview_sandbox::preview_artifact_revoke,
            browser_workbench::browser_workbench_open,
            browser_workbench::browser_tab_new,
            browser_workbench::browser_tab_activate,
            browser_workbench::browser_tab_close,
            browser_workbench::browser_tab_navigate,
            browser_workbench::browser_tab_history,
            browser_workbench::browser_tab_list,
            browser_workbench::browser_layout_update,
            browser_workbench::browser_clear_site_data,
            browser_workbench::browser_panel_tab_new,
            browser_workbench::browser_panel_tab_activate,
            browser_workbench::browser_panel_tab_close,
            browser_workbench::browser_panel_tab_navigate,
            browser_workbench::browser_panel_tab_history,
            browser_workbench::browser_panel_tab_list,
            browser_workbench::browser_panel_layout_update,
            browser_workbench::browser_panel_annotate,
            browser_commands::browser_screenshot_read,
            dev_server::dev_server_start,
            dev_server::dev_server_stop,
            dev_server::dev_server_list,
            browser_commands::browser_agent_status,
            browser_commands::browser_agent_start,
            browser_commands::browser_agent_stop,
            browser_commands::browser_open,
            browser_commands::browser_navigate,
            browser_commands::browser_history,
            browser_commands::browser_snapshot,
            browser_commands::browser_click,
            browser_commands::browser_fill,
            browser_commands::browser_select,
            browser_commands::browser_press,
            browser_commands::browser_scroll,
            browser_commands::browser_get_text,
            browser_commands::browser_url,
            browser_commands::browser_screenshot,
            browser_commands::browser_tabs,
            browser_commands::browser_switch_tab,
            browser_commands::browser_close_tab,
            browser_commands::browser_wait,
            browser_commands::browser_wait_for_load,
            ego_runtime::ego_browser_status,
            ego_runtime::ego_browser_run,
            ego_runtime::ego_browser_stop,
        ])
        .on_window_event(|window, event| {
            // §86: crossing displays changes the window scale factor; child
            // WKWebViews keep stale geometry until their bounds are re-sent.
            if matches!(event, tauri::WindowEvent::ScaleFactorChanged { .. })
                && matches!(window.label(), "main" | "browser-workbench")
            {
                browser_workbench::schedule_layout_reconciliation(window.app_handle());
            }
            if matches!(event, tauri::WindowEvent::Destroyed) {
                let app = window.app_handle();
                if window.label() == "browser-workbench" {
                    // Content webviews belong to the workbench window; close
                    // them all so no orphan remote webview survives.
                    let labels: Vec<String> = app
                        .webviews()
                        .keys()
                        .filter(|label| label.starts_with("browser-content-"))
                        .cloned()
                        .collect();
                    for label in labels {
                        if let Some(webview) = app.get_webview(&label) {
                            let _ = webview.close();
                        }
                    }
                }
                if window.label() == "main" {
                    // Panel content webviews are children of the main window.
                    let labels: Vec<String> = app
                        .webviews()
                        .keys()
                        .filter(|label| label.starts_with("browser-panel-content-"))
                        .cloned()
                        .collect();
                    for label in labels {
                        if let Some(webview) = app.get_webview(&label) {
                            let _ = webview.close();
                        }
                    }
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building Evir")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                // Dev servers are child process groups: Evir must not leave
                // orphan `npm run dev` processes behind (§48).
                dev_server::kill_all(app);
            }
        });
}
