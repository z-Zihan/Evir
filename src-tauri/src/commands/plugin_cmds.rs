//! Plugin install surface (§43-44): the ONLY host file access plugins get in
//! v1 is a validated read of `<folder>/manifest.json` at install time — plus,
//! for `contributes.skillsFrom: "skills/"` (PLUG-2), a validated read of
//! `<folder>/skills/<id>/SKILL.md` (+ optional `<id>/manifest.json`).
//! Nothing from the folder is read afterwards (skill bodies are copied into
//! the plugin record at install), so there is no runtime traversal surface.

use std::path::{Component, Path, PathBuf};

use serde::Serialize;

const MANIFEST_MAX_BYTES: u64 = 128 * 1024;
/// Mirrors the inline-skill content bound in plugin-types.ts.
const SKILL_MD_MAX_BYTES: usize = 60_000;
const SKILLS_MAX_COUNT: usize = 20;

/// Reject traversal/relative shapes before touching the filesystem.
fn valid_absolute_folder(folder: &str) -> Result<PathBuf, String> {
    let path = Path::new(folder);
    if !path.is_absolute() {
        return Err("plugin folder must be an absolute path".to_string());
    }
    let mut components = path.components();
    let normal = components.by_ref().all(|component| {
        matches!(
            component,
            Component::Normal(_) | Component::Prefix(_) | Component::RootDir
        )
    }) && !folder.contains("..");
    if !normal {
        return Err("plugin folder must not contain traversal segments".to_string());
    }
    Ok(path.to_path_buf())
}

/// Resolve `base` and require the candidate file to live DIRECTLY inside it
/// (symlink defense shared by manifest and skill reads).
fn file_directly_in(base: &Path, file_name: &str) -> Result<PathBuf, String> {
    let path = base.join(file_name);
    let canonical = path
        .canonicalize()
        .map_err(|error| format!("resolve {file_name}: {error}"))?;
    if canonical.parent() != Some(base) {
        return Err(format!("{file_name} must live directly in its folder"));
    }
    Ok(canonical)
}

#[tauri::command(async)]
pub(crate) fn plugin_read_manifest(folder: String) -> Result<String, String> {
    let base = valid_absolute_folder(&folder)?;
    if !base.is_dir() {
        return Err("plugin folder does not exist".to_string());
    }
    // Canonicalize the folder, then read exactly <folder>/manifest.json and
    // verify the resolved file really lives in that folder (symlink defense).
    let canonical_base = base
        .canonicalize()
        .map_err(|error| format!("resolve plugin folder: {error}"))?;
    let canonical_manifest = file_directly_in(&canonical_base, "manifest.json")?;
    let metadata = std::fs::metadata(&canonical_manifest)
        .map_err(|error| format!("read manifest.json: {error}"))?;
    if !metadata.is_file() {
        return Err("manifest.json is not a file".to_string());
    }
    if metadata.len() > MANIFEST_MAX_BYTES {
        return Err("manifest.json exceeds 128 KiB".to_string());
    }
    std::fs::read_to_string(&canonical_manifest)
        .map_err(|error| format!("read manifest.json: {error}"))
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PluginSkillFile {
    /// Directory name under skills/ — becomes the contributed skill id.
    pub id: String,
    /// SKILL.md body, truncated at SKILL_MD_MAX_BYTES with a marker.
    pub skill_md: String,
    /// Optional per-skill manifest.json (metadata only), raw JSON text.
    pub manifest_json: Option<String>,
    /// True when skill_md was cut at the content bound.
    pub truncated: bool,
}

/// Read `<folder>/skills/<id>/SKILL.md` (+ optional `<id>/manifest.json`)
/// for every DIRECT subdirectory of skills/ (PLUG-2). Single level, no
/// recursion, no other file names; bodies are bounded and truncated with an
/// explicit marker. A missing skills/ folder is an empty list, not an error.
#[tauri::command(async)]
pub(crate) fn plugin_read_skills(folder: String) -> Result<Vec<PluginSkillFile>, String> {
    let base = valid_absolute_folder(&folder)?;
    if !base.is_dir() {
        return Err("plugin folder does not exist".to_string());
    }
    let canonical_base = base
        .canonicalize()
        .map_err(|error| format!("resolve plugin folder: {error}"))?;
    let skills_dir = canonical_base.join("skills");
    if !skills_dir.is_dir() {
        return Ok(Vec::new());
    }
    let mut entries: Vec<PathBuf> = std::fs::read_dir(&skills_dir)
        .map_err(|error| format!("list skills/: {error}"))?
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| path.is_dir())
        .collect();
    // Deterministic install records regardless of filesystem order.
    entries.sort();
    if entries.len() > SKILLS_MAX_COUNT {
        return Err(format!("skills/ exceeds {SKILLS_MAX_COUNT} entries"));
    }
    let mut skills = Vec::with_capacity(entries.len());
    for dir in entries {
        let Some(id_os) = dir.file_name() else {
            continue;
        };
        let id = id_os.to_string_lossy().into_owned();
        let canonical_dir = dir.canonicalize().map_err(|error| format!("resolve skills/{id}: {error}"))?;
        let skill_path = file_directly_in(&canonical_dir, "SKILL.md")?;
        let bytes = std::fs::read(&skill_path).map_err(|error| format!("read skills/{id}/SKILL.md: {error}"))?;
        let (skill_md, truncated) = if bytes.len() > SKILL_MD_MAX_BYTES {
            let mut cut = bytes[..SKILL_MD_MAX_BYTES].to_vec();
            // Land on a char boundary before appending the marker.
            while !cut.is_empty() && std::str::from_utf8(&cut).is_err() {
                cut.pop();
            }
            let mut text = String::from_utf8_lossy(&cut).into_owned();
            text.push_str("\n\n[truncated at 60000 bytes by Evir]");
            (text, true)
        } else {
            (String::from_utf8_lossy(&bytes).into_owned(), false)
        };
        let manifest_json = match file_directly_in(&canonical_dir, "manifest.json") {
            Ok(path) => {
                let metadata =
                    std::fs::metadata(&path).map_err(|error| format!("read skills/{id}/manifest.json: {error}"))?;
                if metadata.len() > MANIFEST_MAX_BYTES {
                    return Err(format!("skills/{id}/manifest.json exceeds 128 KiB"));
                }
                Some(
                    std::fs::read_to_string(&path)
                        .map_err(|error| format!("read skills/{id}/manifest.json: {error}"))?,
                )
            }
            // Optional metadata: a missing manifest.json is fine.
            Err(_) => None,
        };
        skills.push(PluginSkillFile {
            id,
            skill_md,
            manifest_json,
            truncated,
        });
    }
    Ok(skills)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(path: &Path, content: &str) {
        std::fs::write(path, content).expect("write fixture");
    }

    #[test]
    fn skills_from_folder_reads_skill_md_and_optional_manifest() {
        let root = std::env::temp_dir().join(format!("evir-plug2-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let greet = root.join("skills").join("greet");
        std::fs::create_dir_all(&greet).expect("mkdir");
        write(&greet.join("SKILL.md"), "# Greet\nSay hi politely.");
        write(&greet.join("manifest.json"), r#"{"name":"Greet"}"#);
        let plain = root.join("skills").join("plain");
        std::fs::create_dir_all(&plain).expect("mkdir");
        write(&plain.join("SKILL.md"), "Plain body");

        let skills =
            plugin_read_skills(root.to_string_lossy().into_owned()).expect("read skills");
        // Sorted deterministically.
        assert_eq!(skills.len(), 2);
        assert_eq!(skills[0].id, "greet");
        assert_eq!(skills[0].skill_md, "# Greet\nSay hi politely.");
        assert_eq!(skills[0].manifest_json.as_deref(), Some(r#"{"name":"Greet"}"#));
        assert!(!skills[0].truncated);
        assert_eq!(skills[1].id, "plain");
        assert_eq!(skills[1].manifest_json, None);

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn missing_skills_folder_is_empty_and_traversal_is_rejected() {
        let root = std::env::temp_dir().join(format!("evir-plug2-empty-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).expect("mkdir");
        let skills = plugin_read_skills(root.to_string_lossy().into_owned()).expect("empty ok");
        assert!(skills.is_empty());
        let _ = std::fs::remove_dir_all(&root);

        assert!(plugin_read_skills("../escape".into()).is_err());
        assert!(plugin_read_skills("relative/path".into()).is_err());
    }

    #[test]
    fn oversized_skill_md_is_truncated_with_marker() {
        let root = std::env::temp_dir().join(format!("evir-plug2-trunc-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let big = root.join("skills").join("big");
        std::fs::create_dir_all(&big).expect("mkdir");
        write(&big.join("SKILL.md"), &"x".repeat(70_000));

        let skills = plugin_read_skills(root.to_string_lossy().into_owned()).expect("read");
        assert_eq!(skills.len(), 1);
        assert!(skills[0].truncated);
        assert!(skills[0].skill_md.ends_with("[truncated at 60000 bytes by Evir]"));
        assert!(skills[0].skill_md.len() < 60_040);

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn symlinked_skill_md_outside_the_folder_is_rejected() {
        // Only meaningful with symlink support; keep it robust when unavailable.
        let root = std::env::temp_dir().join(format!("evir-plug2-sym-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let secret = std::env::temp_dir().join(format!("evir-plug2-secret-{}.md", std::process::id()));
        write(&secret, "host secret");
        let evil = root.join("skills").join("evil");
        std::fs::create_dir_all(&evil).expect("mkdir");
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&secret, evil.join("SKILL.md")).expect("symlink");
            let result = plugin_read_skills(root.to_string_lossy().into_owned());
            assert!(result.is_err(), "symlinked SKILL.md must be rejected");
        }
        #[cfg(not(unix))]
        {
            write(&evil.join("SKILL.md"), "placeholder");
            assert!(plugin_read_skills(root.to_string_lossy().into_owned()).is_ok());
        }
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_file(&secret);
    }
}
