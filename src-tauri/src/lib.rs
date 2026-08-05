mod commands;
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
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::db_init,
            commands::db_query,
            commands::db_update,
            commands::keychain_set,
            commands::keychain_get,
            commands::keychain_delete,
            commands::fs_read_file,
            commands::fs_write_file,
            commands::fs_list_dir,
            commands::fs_file_info,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Evir");
}
