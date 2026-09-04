//! User profile commands (§51-61): the device-global registry lives at
//! `<app-data>/profiles.json`; each profile's DB / vault / logs resolve under
//! `<app-data>/profiles/<id>/`. Switching profiles swaps the managed DB
//! connection in place — the frontend then reloads, so no half-switched state
//! survives (v1: switching stops the current profile's active work first).

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::profiles::{self, ProfileRegistry, UserProfile};
use crate::storage::DatabaseState;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProfilesSnapshot {
    pub profiles: Vec<UserProfile>,
    pub active_profile_id: String,
}

fn load(app: &AppHandle) -> Result<ProfileRegistry, String> {
    let dir = crate::commands::infra::app_data_dir(app)?;
    profiles::ensure_registry(&dir).map_err(|error| error.to_string())
}

fn save(app: &AppHandle, registry: &ProfileRegistry) -> Result<(), String> {
    let dir = crate::commands::infra::app_data_dir(app)?;
    profiles::save_registry(&dir, registry).map_err(|error| error.to_string())
}

#[tauri::command(async)]
pub(crate) fn profiles_list(app: AppHandle) -> Result<ProfilesSnapshot, String> {
    let registry = load(&app)?;
    Ok(ProfilesSnapshot {
        profiles: registry.profiles,
        active_profile_id: registry.active_profile_id,
    })
}

#[tauri::command(async)]
pub(crate) fn profiles_create(
    app: AppHandle,
    display_name: String,
    avatar: Option<String>,
) -> Result<UserProfile, String> {
    let dir = crate::commands::infra::app_data_dir(&app)?;
    let mut registry = load(&app)?;
    profiles::create_profile(&dir, &mut registry, &display_name, avatar.as_deref())
        .map_err(|error| error.to_string())
}

#[tauri::command(async)]
// avatar semantics: None = keep; Some(None) = clear; Some(Some(url)) = set.
pub(crate) fn profiles_update(
    app: AppHandle,
    profile_id: String,
    display_name: Option<String>,
    avatar: Option<Option<String>>,
) -> Result<UserProfile, String> {
    let mut registry = load(&app)?;
    let updated = profiles::update_profile(
        &mut registry,
        &profile_id,
        display_name.as_deref(),
        avatar.as_ref().map(|value| value.as_deref()),
    )
    .map_err(|error| error.to_string())?;
    save(&app, &registry)?;
    Ok(updated)
}

/// Activate a profile: persist the registry, swap the managed DB connection
/// to the target profile's database. The frontend reloads afterwards.
#[tauri::command(async)]
pub(crate) fn profiles_set_active(app: AppHandle, profile_id: String) -> Result<String, String> {
    let dir = crate::commands::infra::app_data_dir(&app)?;
    let mut registry = load(&app)?;
    let profile_exists = registry
        .profiles
        .iter()
        .any(|profile| profile.id == profile_id);
    if !profile_exists {
        return Err(format!("profile not found: {profile_id}"));
    }
    if registry.active_profile_id == profile_id {
        return Ok(profile_id);
    }
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis() as i64)
        .unwrap_or(0);
    registry.active_profile_id = profile_id.clone();
    if let Some(entry) = registry
        .profiles
        .iter_mut()
        .find(|entry| entry.id == profile_id)
    {
        entry.last_active_at = now;
    }
    save(&app, &registry)?;
    // Swap the live connection: after this point every entity/db command
    // serves the new profile. The webview reloads into a clean frontend.
    let db_path = profiles::profile_db_path(&dir, &profile_id);
    let new_conn = crate::storage::init_db_at(&db_path).map_err(|error| error.to_string())?;
    let state = app.state::<DatabaseState>();
    {
        let mut conn = state
            .conn
            .lock()
            .map_err(|_| "database lock is poisoned".to_owned())?;
        *conn = new_conn;
    }
    Ok(profile_id)
}

#[tauri::command(async)]
pub(crate) fn profiles_delete(app: AppHandle, profile_id: String) -> Result<(), String> {
    let dir = crate::commands::infra::app_data_dir(&app)?;
    let mut registry = load(&app)?;
    if registry.active_profile_id == profile_id {
        return Err("switch to another profile before deleting this one".to_string());
    }
    profiles::delete_profile(&dir, &mut registry, &profile_id).map_err(|error| error.to_string())
}

/// Paths for the frontend (log sink, diagnostics) — explicit rather than
/// guessed so per-profile layout changes stay in one place.
#[tauri::command(async)]
pub(crate) fn profile_paths(app: AppHandle) -> Result<ProfilePaths, String> {
    let dir = crate::commands::infra::app_data_dir(&app)?;
    let registry = load(&app)?;
    let profile = registry
        .profiles
        .iter()
        .find(|profile| profile.id == registry.active_profile_id)
        .ok_or_else(|| "no active profile".to_string())?;
    Ok(ProfilePaths {
        profile_id: profile.id.clone(),
        logs_dir: profiles::profile_logs_dir(&dir, &profile.id)
            .to_string_lossy()
            .into_owned(),
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProfilePaths {
    pub profile_id: String,
    pub logs_dir: String,
}
