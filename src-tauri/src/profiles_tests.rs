//! Profile registry tests (§49-61): legacy migration is copy-based and
//! idempotent, the registry never boots without a valid active profile, and
//! the last profile cannot be deleted.

use std::fs;
use std::path::PathBuf;

use crate::profiles::{
    active_profile, create_profile, delete_profile, ensure_registry, load_registry,
    profile_db_path, profile_vault_path, update_profile, valid_profile_id, DEFAULT_PROFILE_ID,
};

fn temp_dir(tag: &str) -> PathBuf {
    let dir =
        std::env::temp_dir().join(format!("evir-profiles-test-{}-{}", tag, std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn first_run_creates_default_profile_with_legacy_migration() {
    let dir = temp_dir("legacy");
    // Legacy single-user artifacts exactly where old builds kept them.
    fs::write(dir.join("evir.db"), b"legacy-db").unwrap();
    fs::write(dir.join("secret-vault.json"), b"legacy-vault").unwrap();

    let registry = ensure_registry(&dir).unwrap();
    assert_eq!(registry.profiles.len(), 1);
    assert_eq!(registry.active_profile_id, DEFAULT_PROFILE_ID);

    // Data copied INTO the profile namespace; originals remain untouched as
    // an implicit backup (§55: migration must be recoverable).
    assert_eq!(
        fs::read(profile_db_path(&dir, DEFAULT_PROFILE_ID)).unwrap(),
        b"legacy-db"
    );
    assert_eq!(
        fs::read(profile_vault_path(&dir, DEFAULT_PROFILE_ID)).unwrap(),
        b"legacy-vault"
    );
    assert!(dir.join("evir.db").exists());
    assert!(dir.join("secret-vault.json").exists());

    // Idempotent: re-running never overwrites or duplicates.
    let again = ensure_registry(&dir).unwrap();
    assert_eq!(again.profiles.len(), 1);
    assert_eq!(
        fs::read(profile_db_path(&dir, DEFAULT_PROFILE_ID)).unwrap(),
        b"legacy-db"
    );
}

#[test]
fn corrupt_active_pointer_falls_back_to_first_profile() {
    let dir = temp_dir("corrupt");
    let mut registry = ensure_registry(&dir).unwrap();
    let second = create_profile(&dir, &mut registry, "Second", None).unwrap();
    registry.active_profile_id = "ghost".to_string();
    fs::write(
        dir.join("profiles.json"),
        serde_json::to_string(&registry).unwrap(),
    )
    .unwrap();

    let recovered = ensure_registry(&dir).unwrap();
    assert!(recovered.profiles.iter().any(|p| p.id == second.id));
    assert!(recovered
        .profiles
        .iter()
        .any(|p| p.id == recovered.active_profile_id));
    active_profile(&recovered).unwrap();
}

#[test]
fn delete_protects_last_profile_and_cannot_target_active() {
    let dir = temp_dir("delete");
    let mut registry = ensure_registry(&dir).unwrap();
    // Only one profile: deletion refused.
    assert!(delete_profile(&dir, &mut registry, DEFAULT_PROFILE_ID).is_err());

    let second = create_profile(&dir, &mut registry, "Second", None).unwrap();
    // Active default remains active; the other profile deletes cleanly.
    assert!(delete_profile(&dir, &mut registry, &second.id).is_ok());
    assert_eq!(registry.profiles.len(), 1);
    assert!(!crate::profiles::profile_root(&dir, &second.id).exists());
    let persisted = load_registry(&dir).unwrap();
    assert_eq!(persisted.profiles.len(), 1);
}

#[test]
fn update_validates_names_and_clears_avatar() {
    let dir = temp_dir("update");
    let mut registry = ensure_registry(&dir).unwrap();
    let updated = update_profile(
        &mut registry,
        DEFAULT_PROFILE_ID,
        Some("Zihan"),
        Some(Some("data:image/png;base64,x")),
    )
    .unwrap();
    assert_eq!(updated.display_name, "Zihan");
    assert_eq!(updated.avatar.as_deref(), Some("data:image/png;base64,x"));

    assert!(update_profile(&mut registry, DEFAULT_PROFILE_ID, Some("  "), None).is_err());
    assert!(update_profile(
        &mut registry,
        DEFAULT_PROFILE_ID,
        Some(&"x".repeat(41)),
        None
    )
    .is_err());

    let cleared = update_profile(&mut registry, DEFAULT_PROFILE_ID, None, Some(None)).unwrap();
    assert!(cleared.avatar.is_none());
}

#[test]
fn generated_profile_ids_are_directory_safe() {
    assert!(valid_profile_id("default"));
    assert!(valid_profile_id("u1a2b3c4"));
    assert!(!valid_profile_id("../escape"));
    assert!(!valid_profile_id("has space"));
    assert!(!valid_profile_id("UPPER"));
    assert!(!valid_profile_id(""));
    assert!(!valid_profile_id("-leading"));
}
