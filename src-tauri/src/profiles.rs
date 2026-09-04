//! Device-global user profile registry (§51-55). The registry itself is the
//! only profile data that lives outside a profile directory; every other
//! per-user artifact (SQLite DB, secret vault, logs) resolves under
//! `<app-data>/profiles/<profileId>/`.
//!
//! Legacy single-user migration: the first run without a registry creates the
//! default profile and COPIES (never moves) the legacy `evir.db` (+ WAL/SHM)
//! and `secret-vault.json` into the default profile's directory, so the
//! original files stay on disk as an implicit backup and the migration is
//! idempotent (a profile DB that already exists is never overwritten).

use std::{
    fs, io,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};

pub const DEFAULT_PROFILE_ID: &str = "default";
const REGISTRY_FILE: &str = "profiles.json";
const LEGACY_DB_FILE: &str = "evir.db";
const LEGACY_VAULT_FILE: &str = "secret-vault.json";

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UserProfile {
    pub id: String,
    pub display_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub avatar: Option<String>,
    pub created_at: i64,
    pub last_active_at: i64,
}

#[derive(Serialize, Deserialize, Debug, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProfileRegistry {
    pub profiles: Vec<UserProfile>,
    #[serde(default)]
    pub active_profile_id: String,
}

#[derive(Debug)]
pub enum ProfileError {
    Io(io::Error),
    Serde(serde_json::Error),
    NotFound(String),
    LastProfile(String),
    InvalidName(String),
    InvalidId(String),
}

impl std::fmt::Display for ProfileError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ProfileError::Io(error) => write!(formatter, "profile io error: {error}"),
            ProfileError::Serde(error) => write!(formatter, "profile registry corrupt: {error}"),
            ProfileError::NotFound(id) => write!(formatter, "profile not found: {id}"),
            ProfileError::LastProfile(id) => {
                write!(formatter, "cannot remove the last profile: {id}")
            }
            ProfileError::InvalidName(name) => write!(formatter, "invalid profile name: {name}"),
            ProfileError::InvalidId(id) => write!(formatter, "invalid profile id: {id}"),
        }
    }
}

impl From<io::Error> for ProfileError {
    fn from(error: io::Error) -> Self {
        ProfileError::Io(error)
    }
}

impl From<serde_json::Error> for ProfileError {
    fn from(error: serde_json::Error) -> Self {
        ProfileError::Serde(error)
    }
}

pub type ProfileResult<T> = Result<T, ProfileError>;

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis() as i64)
        .unwrap_or(0)
}

/// Profile ids become directory names: lowercase [a-z0-9-] only.
pub fn valid_profile_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id.chars().all(|character| {
            character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
        })
        && !id.starts_with('-')
        && !id.ends_with('-')
}

pub fn registry_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(REGISTRY_FILE)
}

pub fn profile_root(app_data_dir: &Path, profile_id: &str) -> PathBuf {
    app_data_dir.join("profiles").join(profile_id)
}

pub fn profile_db_path(app_data_dir: &Path, profile_id: &str) -> PathBuf {
    profile_root(app_data_dir, profile_id)
        .join("db")
        .join(LEGACY_DB_FILE)
}

pub fn profile_vault_path(app_data_dir: &Path, profile_id: &str) -> PathBuf {
    profile_root(app_data_dir, profile_id).join(LEGACY_VAULT_FILE)
}

pub fn profile_logs_dir(app_data_dir: &Path, profile_id: &str) -> PathBuf {
    profile_root(app_data_dir, profile_id).join("logs")
}

pub fn load_registry(app_data_dir: &Path) -> ProfileResult<ProfileRegistry> {
    let path = registry_path(app_data_dir);
    if !path.exists() {
        return Ok(ProfileRegistry::default());
    }
    let raw = fs::read_to_string(&path)?;
    Ok(serde_json::from_str(&raw)?)
}

pub fn save_registry(app_data_dir: &Path, registry: &ProfileRegistry) -> ProfileResult<()> {
    let path = registry_path(app_data_dir);
    let temp = path.with_extension("json.tmp");
    fs::write(&temp, serde_json::to_vec_pretty(registry)?)?;
    set_private_permissions(&temp);
    fs::rename(&temp, &path)?;
    Ok(())
}

#[cfg(unix)]
fn set_private_permissions(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    if let Ok(metadata) = fs::metadata(path) {
        let mut permissions = metadata.permissions();
        permissions.set_mode(0o600);
        let _ = fs::set_permissions(path, permissions);
    }
}

#[cfg(not(unix))]
fn set_private_permissions(_path: &Path) {}

/// Copy a file only when the destination does not exist yet (idempotent).
fn copy_if_absent(source: &Path, destination: &Path) -> ProfileResult<()> {
    if destination.exists() || !source.exists() {
        return Ok(());
    }
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::copy(source, destination)?;
    Ok(())
}

fn migrate_legacy_profile_data(app_data_dir: &Path, profile_id: &str) -> ProfileResult<()> {
    // Copy, never move: the originals remain as an implicit rollback backup
    // and a re-run never overwrites migrated data.
    let legacy_db = app_data_dir.join(LEGACY_DB_FILE);
    let target_db = profile_db_path(app_data_dir, profile_id);
    copy_if_absent(&legacy_db, &target_db)?;
    for sidecar in ["evir.db-wal", "evir.db-shm"] {
        let legacy_sidecar = app_data_dir.join(sidecar);
        let target_sidecar = target_db.with_file_name(sidecar);
        copy_if_absent(&legacy_sidecar, &target_sidecar)?;
    }
    let legacy_vault = app_data_dir.join(LEGACY_VAULT_FILE);
    let target_vault = profile_vault_path(app_data_dir, profile_id);
    copy_if_absent(&legacy_vault, &target_vault)?;
    Ok(())
}

/// Load the registry, creating the default profile (with legacy migration)
/// on first run. Always returns a registry with at least one profile and a
/// valid active id.
pub fn ensure_registry(app_data_dir: &Path) -> ProfileResult<ProfileRegistry> {
    let mut registry = load_registry(app_data_dir)?;
    if registry.profiles.is_empty() {
        let now = now_ms();
        registry.profiles.push(UserProfile {
            id: DEFAULT_PROFILE_ID.to_string(),
            display_name: "User".to_string(),
            avatar: None,
            created_at: now,
            last_active_at: now,
        });
        registry.active_profile_id = DEFAULT_PROFILE_ID.to_string();
        // Migrate before persisting: a failure leaves no half-state (the
        // registry is simply not saved and the next launch retries).
        migrate_legacy_profile_data(app_data_dir, DEFAULT_PROFILE_ID)?;
        save_registry(app_data_dir, &registry)?;
        return Ok(registry);
    }
    if registry
        .profiles
        .iter()
        .all(|profile| profile.id != registry.active_profile_id)
    {
        // Corrupt active pointer: fall back to the first profile rather than
        // refusing to boot.
        registry.active_profile_id = registry.profiles[0].id.clone();
        save_registry(app_data_dir, &registry)?;
    }
    Ok(registry)
}

pub fn active_profile(registry: &ProfileRegistry) -> ProfileResult<&UserProfile> {
    registry
        .profiles
        .iter()
        .find(|profile| profile.id == registry.active_profile_id)
        .ok_or_else(|| ProfileError::NotFound(registry.active_profile_id.clone()))
}

fn new_profile_id() -> String {
    // Time-based + random suffix, id charset restricted to directory-safe.
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    now_ms().hash(&mut hasher);
    std::process::id().hash(&mut hasher);
    hasher.finish().hash(&mut hasher);
    format!("u{:x}", hasher.finish())
}

pub fn create_profile(
    app_data_dir: &Path,
    registry: &mut ProfileRegistry,
    display_name: &str,
    avatar: Option<&str>,
) -> ProfileResult<UserProfile> {
    let name = display_name.trim();
    if name.is_empty() || name.chars().count() > 40 {
        return Err(ProfileError::InvalidName(display_name.to_string()));
    }
    let now = now_ms();
    let mut id = new_profile_id();
    while registry.profiles.iter().any(|profile| profile.id == id) {
        id = new_profile_id();
    }
    debug_assert!(
        valid_profile_id(&id),
        "generated profile id must be directory-safe"
    );
    let profile = UserProfile {
        id: id.clone(),
        display_name: name.to_string(),
        avatar: avatar.map(str::to_string),
        created_at: now,
        last_active_at: now,
    };
    // Fresh profile directory tree; no legacy migration applies.
    fs::create_dir_all(
        profile_db_path(app_data_dir, &id)
            .parent()
            .ok_or_else(|| ProfileError::InvalidId(id.clone()))?,
    )?;
    fs::create_dir_all(profile_logs_dir(app_data_dir, &id))?;
    registry.profiles.push(profile.clone());
    save_registry(app_data_dir, registry)?;
    Ok(profile)
}

pub fn update_profile(
    registry: &mut ProfileRegistry,
    profile_id: &str,
    display_name: Option<&str>,
    avatar: Option<Option<&str>>,
) -> ProfileResult<UserProfile> {
    let profile = registry
        .profiles
        .iter_mut()
        .find(|profile| profile.id == profile_id)
        .ok_or_else(|| ProfileError::NotFound(profile_id.to_string()))?;
    if let Some(name) = display_name {
        let trimmed = name.trim();
        if trimmed.is_empty() || trimmed.chars().count() > 40 {
            return Err(ProfileError::InvalidName(name.to_string()));
        }
        profile.display_name = trimmed.to_string();
    }
    if let Some(avatar_value) = avatar {
        profile.avatar = avatar_value.map(str::to_string);
    }
    let updated = profile.clone();
    Ok(updated)
}

/// Delete a profile's data directory. The active profile cannot be deleted
/// while it is the only one; deleting the ACTIVE profile when others exist is
/// allowed but callers must switch first (enforced at the command layer).
pub fn delete_profile(
    app_data_dir: &Path,
    registry: &mut ProfileRegistry,
    profile_id: &str,
) -> ProfileResult<()> {
    if registry.profiles.len() <= 1 {
        return Err(ProfileError::LastProfile(profile_id.to_string()));
    }
    let index = registry
        .profiles
        .iter()
        .position(|profile| profile.id == profile_id)
        .ok_or_else(|| ProfileError::NotFound(profile_id.to_string()))?;
    registry.profiles.remove(index);
    if registry.active_profile_id == profile_id {
        registry.active_profile_id = registry.profiles[0].id.clone();
    }
    save_registry(app_data_dir, registry)?;
    // Data removal is best-effort after the registry is consistent: a failure
    // leaves an orphaned directory, never a broken registry.
    let _ = fs::remove_dir_all(profile_root(app_data_dir, profile_id));
    Ok(())
}
