//! Secrets and shared Provider profiles: the `keychain_*` commands backed by
//! the local encrypted vault (`secret_vault.rs`), plus the `providers.json`
//! shared Provider document (path, validation, merge, read/write commands).

use std::{collections::HashMap, fs::OpenOptions, io::Write, path::PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::secret_vault;

use super::infra::{app_data_dir, replace_file_atomically, validate_key};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SharedProviderProfile {
    id: String,
    name: String,
    protocol_id: String,
    base_url: String,
    model_id: String,
    tool_calling: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_context_tokens: Option<u64>,
    enabled: bool,
    is_default: bool,
    created_at: u64,
    updated_at: u64,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct SharedProviderDocument {
    version: u8,
    providers: Vec<SharedProviderProfile>,
}

/// Backed by the local encrypted vault (`secret_vault.rs`), never the OS
/// keychain: ad-hoc-signed rebuilds kept re-triggering the macOS keychain ACL
/// prompt, which could silently lose the key. The command names stay stable
/// for the TS storage bridge. The vault file is per-profile (§52): provider
/// secrets must never cross users.
fn active_vault_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app_data_dir(app)?;
    let registry = crate::profiles::ensure_registry(&dir).map_err(|error| error.to_string())?;
    let active = crate::profiles::active_profile(&registry).map_err(|error| error.to_string())?;
    Ok(crate::profiles::profile_vault_path(&dir, &active.id))
}

#[tauri::command(async)]
pub(crate) fn keychain_set(app: AppHandle, key: String, value: String) -> Result<(), String> {
    validate_key(&key)?;
    let path = active_vault_path(&app)?;
    secret_vault::set(&path, &key, &value)
}

#[tauri::command(async)]
pub(crate) fn keychain_get(app: AppHandle, key: String) -> Result<Option<String>, String> {
    validate_key(&key)?;
    let path = active_vault_path(&app)?;
    secret_vault::get(&path, &key)
}

#[tauri::command(async)]
pub(crate) fn keychain_delete(app: AppHandle, key: String) -> Result<(), String> {
    validate_key(&key)?;
    let path = active_vault_path(&app)?;
    secret_vault::delete(&path, &key)
}

fn shared_provider_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .config_dir()
        .map_err(|error| error.to_string())?
        .join("evir")
        .join("providers.json"))
}

fn validate_shared_provider(profile: &SharedProviderProfile) -> Result<(), String> {
    const PROTOCOLS: &[&str] = &[
        "openai-chat-completions",
        "openai-compatible-chat",
        "openai-responses",
        "anthropic-messages",
        "gemini-generate-content",
        "ollama-native",
    ];
    if profile.id.trim().is_empty() || profile.id.len() > 200 {
        return Err("provider id must contain 1 to 200 characters".to_owned());
    }
    if profile.name.trim().is_empty() || profile.name.len() > 100 {
        return Err("provider name must contain 1 to 100 characters".to_owned());
    }
    if !PROTOCOLS.contains(&profile.protocol_id.as_str()) {
        return Err("unsupported provider protocol".to_owned());
    }
    if !(profile.base_url.starts_with("http://") || profile.base_url.starts_with("https://")) {
        return Err("provider base URL must use http or https".to_owned());
    }
    if profile.model_id.trim().is_empty() || profile.model_id.len() > 200 {
        return Err("model id must contain 1 to 200 characters".to_owned());
    }
    Ok(())
}

fn merge_shared_provider_profiles(
    current: Vec<SharedProviderProfile>,
    incoming: Vec<SharedProviderProfile>,
    deleted_ids: Vec<String>,
) -> Result<Vec<SharedProviderProfile>, String> {
    let deleted: std::collections::HashSet<_> = deleted_ids.into_iter().collect();
    let mut merged: HashMap<String, SharedProviderProfile> = current
        .into_iter()
        .filter(|profile| !deleted.contains(&profile.id))
        .map(|profile| (profile.id.clone(), profile))
        .collect();
    for profile in incoming {
        if deleted.contains(&profile.id) {
            continue;
        }
        let replace = merged
            .get(&profile.id)
            .is_none_or(|current| profile.updated_at >= current.updated_at);
        if replace {
            merged.insert(profile.id.clone(), profile);
        }
    }
    if merged.len() > 100 {
        return Err("at most 100 shared Providers are allowed".to_owned());
    }
    let selected_default = merged
        .values()
        .filter(|profile| profile.enabled && profile.is_default)
        .max_by_key(|profile| profile.updated_at)
        .map(|profile| profile.id.clone());
    let mut merged: Vec<_> = merged
        .into_values()
        .map(|mut profile| {
            profile.is_default = selected_default.as_deref() == Some(profile.id.as_str());
            profile
        })
        .collect();
    merged.sort_by(|left, right| {
        right
            .updated_at
            .cmp(&left.updated_at)
            .then_with(|| left.id.cmp(&right.id))
    });
    Ok(merged)
}

#[tauri::command(async)]
pub(crate) fn shared_provider_profiles_read(
    app: AppHandle,
) -> Result<Vec<SharedProviderProfile>, String> {
    let path = shared_provider_path(&app)?;
    let raw = match std::fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error.to_string()),
    };
    let document: SharedProviderDocument = serde_json::from_str(&raw)
        .map_err(|error| format!("invalid shared Provider file: {error}"))?;
    if document.version != 1 || document.providers.len() > 100 {
        return Err("unsupported shared Provider document".to_owned());
    }
    for profile in &document.providers {
        validate_shared_provider(profile)?;
    }
    Ok(document.providers)
}

#[tauri::command(async)]
pub(crate) fn shared_provider_profiles_write(
    app: AppHandle,
    profiles: Vec<SharedProviderProfile>,
    deleted_ids: Vec<String>,
) -> Result<(), String> {
    if profiles.len() > 100 {
        return Err("at most 100 shared Providers are allowed".to_owned());
    }
    if deleted_ids.len() > 100 {
        return Err("at most 100 shared Provider deletions are allowed".to_owned());
    }
    for profile in &profiles {
        validate_shared_provider(profile)?;
    }
    let path = shared_provider_path(&app)?;
    let parent = path
        .parent()
        .ok_or_else(|| "shared Provider path has no parent".to_owned())?;
    std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let temporary = parent.join(format!("providers.json.{}.tmp", std::process::id()));
    let current = match std::fs::read_to_string(&path) {
        Ok(raw) => {
            let document: SharedProviderDocument = serde_json::from_str(&raw)
                .map_err(|error| format!("invalid shared Provider file: {error}"))?;
            if document.version != 1 {
                return Err("unsupported shared Provider document".to_owned());
            }
            if document.providers.len() > 100 {
                return Err("unsupported shared Provider document".to_owned());
            }
            for profile in &document.providers {
                validate_shared_provider(profile)?;
            }
            document.providers
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Vec::new(),
        Err(error) => return Err(error.to_string()),
    };
    let merged = merge_shared_provider_profiles(current, profiles, deleted_ids)?;
    let encoded = serde_json::to_vec_pretty(&SharedProviderDocument {
        version: 1,
        providers: merged,
    })
    .map_err(|error| error.to_string())?;
    let mut options = OpenOptions::new();
    options.create(true).truncate(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&temporary)
        .map_err(|error| error.to_string())?;
    file.write_all(&encoded)
        .map_err(|error| error.to_string())?;
    file.write_all(b"\n").map_err(|error| error.to_string())?;
    file.sync_all().map_err(|error| error.to_string())?;
    replace_file_atomically(&temporary, &path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{merge_shared_provider_profiles, validate_shared_provider, SharedProviderProfile};

    #[test]
    fn shared_provider_validation_rejects_secrets_and_unsupported_protocols() {
        let profile = SharedProviderProfile {
            id: "provider-1".to_owned(),
            name: "Provider".to_owned(),
            protocol_id: "openai-compatible-chat".to_owned(),
            base_url: "https://example.com/v1".to_owned(),
            model_id: "model".to_owned(),
            tool_calling: true,
            max_context_tokens: Some(32_768),
            enabled: true,
            is_default: true,
            created_at: 1,
            updated_at: 2,
        };
        assert!(validate_shared_provider(&profile).is_ok());
        let encoded = serde_json::to_string(&profile).expect("profile should serialize");
        assert!(!encoded.contains("apiKey"));
        assert!(encoded.contains("maxContextTokens"));
        let with_secret = encoded.trim_end_matches('}').to_owned() + ",\"apiKey\":\"secret\"}";
        assert!(serde_json::from_str::<SharedProviderProfile>(&with_secret).is_err());

        let mut unsupported = profile;
        unsupported.protocol_id = "unknown".to_owned();
        assert_eq!(
            validate_shared_provider(&unsupported),
            Err("unsupported provider protocol".to_owned())
        );

        let without_context = SharedProviderProfile {
            max_context_tokens: None,
            ..unsupported
        };
        let encoded = serde_json::to_string(&without_context).expect("profile should serialize");
        assert!(!encoded.contains("maxContextTokens"));
    }

    #[test]
    fn shared_provider_merge_preserves_newer_disk_values_and_explicit_deletions() {
        let profile = |id: &str, updated_at: u64, is_default: bool| SharedProviderProfile {
            id: id.to_owned(),
            name: format!("Provider {id}"),
            protocol_id: "openai-compatible-chat".to_owned(),
            base_url: "https://example.com/v1".to_owned(),
            model_id: format!("model-{updated_at}"),
            tool_calling: true,
            max_context_tokens: None,
            enabled: true,
            is_default,
            created_at: 1,
            updated_at,
        };
        let merged = merge_shared_provider_profiles(
            vec![
                profile("newer-on-disk", 20, true),
                profile("deleted", 5, false),
            ],
            vec![
                profile("newer-on-disk", 10, false),
                profile("incoming", 30, true),
            ],
            vec!["deleted".to_owned()],
        )
        .expect("profiles should merge");

        assert_eq!(merged.len(), 2);
        assert_eq!(merged[0].id, "incoming");
        assert!(merged[0].is_default);
        assert_eq!(merged[1].model_id, "model-20");
        assert!(!merged[1].is_default);
    }
}
