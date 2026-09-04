//! Tauri IPC command surface, split by domain.
//!
//! This file only declares the domain submodules and re-exports their public
//! surface, so `commands::<command>` paths in `lib.rs` and
//! `crate::commands::validate_path_in_workspace` in `dev_server.rs` keep
//! resolving unchanged.
//!
//! Domains:
//! - `infra`: shared plumbing (app data dir, DB connection wrapper,
//!   path/entity/key/component validation, cancellation registry, atomic
//!   file replacement, misc utilities)
//! - `entities`: SQLite-backed structured entity storage
//! - `secrets`: encrypted vault access and shared Provider profiles
//! - `filesystem`: file/directory access inside the workspace
//! - `processes`: child process execution and cancellation
//! - `git`: status, diff, and worktree commands
//! - `snapshots`: file snapshot/seal/restore
//!
//! The public result structs (`FileInfo`, `FileStat`, `CommandResult`,
//! `GitStatusEntry`, `GitStatusResult`, `SharedProviderProfile`,
//! `SnapshotResult`) stay `pub` in their domain modules and are not
//! re-exported here: nothing referenced them via `commands::`, and unused
//! re-exports fail the `-D warnings` gate.

mod entities;
mod filesystem;
mod git;
mod infra;
mod plugin_cmds;
mod processes;
mod profile_cmds;
mod secrets;
mod snapshots;

// Workspace containment is enforced by several domains and also used
// directly by `dev_server.rs`.
pub(crate) use infra::validate_path_in_workspace;

// Entity storage: functions plus the hidden `#[tauri::command]` helper
// macros, so `generate_handler!` keeps resolving them under `commands::*`.
pub(crate) use entities::{
    __cmd__db_init, __cmd__db_query, __cmd__db_update, __cmd__entity_apply, __cmd__entity_clear,
    __cmd__entity_delete, __cmd__entity_delete_many, __cmd__entity_get, __cmd__entity_list,
    __cmd__entity_put, __cmd__entity_put_many, __tauri_command_name_db_init,
    __tauri_command_name_db_query, __tauri_command_name_db_update,
    __tauri_command_name_entity_apply, __tauri_command_name_entity_clear,
    __tauri_command_name_entity_delete, __tauri_command_name_entity_delete_many,
    __tauri_command_name_entity_get, __tauri_command_name_entity_list,
    __tauri_command_name_entity_put, __tauri_command_name_entity_put_many, db_init, db_query,
    db_update, entity_apply, entity_clear, entity_delete, entity_delete_many, entity_get,
    entity_list, entity_put, entity_put_many,
};

// Secrets and shared Provider profiles.
// Functions plus the hidden `#[tauri::command]` helper macros, so
// `generate_handler!` keeps resolving them under `commands::*`.
// Plugins: safe install-time manifest read (no other host file access).
pub(crate) use plugin_cmds::{
    __cmd__plugin_read_manifest, __tauri_command_name_plugin_read_manifest, plugin_read_manifest,
};

// User profiles (registry + per-profile DB/vault/logs paths).
pub(crate) use profile_cmds::{
    __cmd__profile_paths, __cmd__profiles_create, __cmd__profiles_delete, __cmd__profiles_list,
    __cmd__profiles_set_active, __cmd__profiles_update, __tauri_command_name_profile_paths,
    __tauri_command_name_profiles_create, __tauri_command_name_profiles_delete,
    __tauri_command_name_profiles_list, __tauri_command_name_profiles_set_active,
    __tauri_command_name_profiles_update, profile_paths, profiles_create, profiles_delete,
    profiles_list, profiles_set_active, profiles_update,
};

pub(crate) use secrets::{
    __cmd__keychain_delete, __cmd__keychain_get, __cmd__keychain_set,
    __cmd__shared_provider_profiles_read, __cmd__shared_provider_profiles_write,
    __tauri_command_name_keychain_delete, __tauri_command_name_keychain_get,
    __tauri_command_name_keychain_set, __tauri_command_name_shared_provider_profiles_read,
    __tauri_command_name_shared_provider_profiles_write, keychain_delete, keychain_get,
    keychain_set, shared_provider_profiles_read, shared_provider_profiles_write,
};

// Filesystem.
// Functions plus the hidden `#[tauri::command]` helper macros, so
// `generate_handler!` keeps resolving them under `commands::*`.
pub(crate) use filesystem::{
    __cmd__fs_apply_patch, __cmd__fs_create_directory, __cmd__fs_file_info, __cmd__fs_file_stat,
    __cmd__fs_list_dir, __cmd__fs_read_file, __cmd__fs_read_file_base64, __cmd__fs_real_path,
    __cmd__fs_search_files, __cmd__fs_write_file, __tauri_command_name_fs_apply_patch,
    __tauri_command_name_fs_create_directory, __tauri_command_name_fs_file_info,
    __tauri_command_name_fs_file_stat, __tauri_command_name_fs_list_dir,
    __tauri_command_name_fs_read_file, __tauri_command_name_fs_read_file_base64,
    __tauri_command_name_fs_real_path, __tauri_command_name_fs_search_files,
    __tauri_command_name_fs_write_file, fs_apply_patch, fs_create_directory, fs_file_info,
    fs_file_stat, fs_list_dir, fs_read_file, fs_read_file_base64, fs_real_path, fs_search_files,
    fs_write_file,
};

// Child processes.
// Functions plus the hidden `#[tauri::command]` helper macros, so
// `generate_handler!` keeps resolving them under `commands::*`.
pub(crate) use processes::{
    __cmd__cancel_command, __cmd__run_command, __tauri_command_name_cancel_command,
    __tauri_command_name_run_command, cancel_command, run_command,
};

// Git.
// Functions plus the hidden `#[tauri::command]` helper macros, so
// `generate_handler!` keeps resolving them under `commands::*`.
pub(crate) use git::{
    __cmd__git_diff, __cmd__git_status, __cmd__git_worktree_create, __cmd__git_worktree_merge,
    __cmd__git_worktree_remove, __tauri_command_name_git_diff, __tauri_command_name_git_status,
    __tauri_command_name_git_worktree_create, __tauri_command_name_git_worktree_merge,
    __tauri_command_name_git_worktree_remove, git_diff, git_status, git_worktree_create,
    git_worktree_merge, git_worktree_remove,
};

// Snapshots.
// Functions plus the hidden `#[tauri::command]` helper macros, so
// `generate_handler!` keeps resolving them under `commands::*`.
pub(crate) use snapshots::{
    __cmd__fs_create_snapshot, __cmd__fs_restore_snapshot, __cmd__fs_seal_snapshot,
    __tauri_command_name_fs_create_snapshot, __tauri_command_name_fs_restore_snapshot,
    __tauri_command_name_fs_seal_snapshot, fs_create_snapshot, fs_restore_snapshot,
    fs_seal_snapshot,
};
