mod commands;
mod mcp_stdio;
mod mcp_stdio_process;
#[cfg(all(test, unix))]
mod mcp_stdio_process_tests;
mod storage;

#[cfg(test)]
mod storage_tests;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
            let conn = storage::init_db(&app_data_dir).map_err(|error| {
                eprintln!("Failed to init database: {error}");
                error
            })?;
            app.manage(storage::DatabaseState::new(conn));
            app.manage(mcp_stdio::McpStdioState::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::db_init,
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
            commands::fs_create_snapshot,
            commands::fs_seal_snapshot,
            commands::fs_restore_snapshot,
            mcp_stdio::mcp_stdio_start,
            mcp_stdio::mcp_stdio_request,
            mcp_stdio::mcp_stdio_send,
            mcp_stdio::mcp_stdio_status,
            mcp_stdio::mcp_stdio_stop,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Evir");
}
