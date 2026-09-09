//! Command environment resolution (§16-§25): GUI-launched apps inherit a
//! minimal PATH (`/usr/bin:/bin:...`), so `pnpm`/`node`/`git` installed via
//! Homebrew/nvm/volta are invisible to `run_command` and App Preview. This
//! module resolves a login-shell-equivalent command environment ONCE,
//! sanitizes it to a whitelist, caches it, and hands it to every tool
//! subprocess — without changing approval boundaries or risk levels.
//!
//! Security notes:
//! - the login-shell probe runs `$SHELL -l -c '/usr/bin/printenv'` — a fixed
//!   command string; it executes the user's own login profile exactly like
//!   their normal terminal would, with a hard timeout, and only the
//!   whitelisted variables (PATH/HOME/LANG/LC_*) are read back;
//! - resolution never bypasses approvals, never widens the workspace
//!   boundary, and never changes command risk classification — it only fixes
//!   command DISCOVERY.

use std::sync::OnceLock;

use serde::Serialize;

/// Fallback PATH entries kept even when the login probe fails (unix).
const SAFE_BASE_PATH_UNIX: [&str; 6] = [
    "/usr/local/bin",
    "/opt/homebrew/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
];

/// Hard cap on the login-shell probe so a hanging profile cannot stall startup.
const LOGIN_PROBE_TIMEOUT_MS: u64 = 5_000;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum CommandEnvSource {
    /// Resolved from the user's login shell ($SHELL -l).
    LoginShell,
    /// The inherited process environment was already complete.
    Inherited,
    /// Inherited env + safe base merge (probe unavailable/failed).
    Fallback,
}

#[derive(Debug, Clone, Serialize)]
pub struct CommandEnv {
    pub shell: String,
    pub path: String,
    pub home: Option<String>,
    pub lang: Option<String>,
    pub source: CommandEnvSource,
}

impl PartialEq for CommandEnv {
    fn eq(&self, other: &Self) -> bool {
        self.shell == other.shell
            && self.path == other.path
            && self.home == other.home
            && self.lang == other.lang
            && self.source == other.source
    }
}

static CACHED_ENV: OnceLock<CommandEnv> = OnceLock::new();

pub(crate) fn path_separator() -> char {
    if cfg!(windows) {
        ';'
    } else {
        ':'
    }
}

/// Split a PATH string into directories (empty segments dropped).
pub(crate) fn split_path(path: &str) -> Vec<String> {
    path.split(path_separator())
        .map(str::trim)
        .filter(|segment| !segment.is_empty())
        .map(str::to_owned)
        .collect()
}

/// Merge PATH lists first-wins, deduplicated (case-insensitive on Windows).
/// Empty segments are dropped — they mean "current directory" in PATH
/// semantics and must not leak into tool subprocesses.
pub(crate) fn merge_paths(lists: &[&[String]]) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut merged: Vec<String> = Vec::new();
    for list in lists {
        for dir in list.iter() {
            if dir.is_empty() {
                continue;
            }
            let key = if cfg!(windows) {
                dir.to_lowercase()
            } else {
                dir.clone()
            };
            if seen.insert(key) {
                merged.push(dir.clone());
            }
        }
    }
    merged
}

/// Whitelisted variables parsed from `printenv` output.
pub(crate) struct LoginEnv {
    pub path: Option<String>,
    pub home: Option<String>,
    pub lang: Option<String>,
}

/// Parse the output of `printenv`, keeping ONLY whitelisted variables
/// (first occurrence wins — a repeated key means someone printed it twice).
pub(crate) fn parse_login_env(output: &str) -> LoginEnv {
    let mut env = LoginEnv {
        path: None,
        home: None,
        lang: None,
    };
    for line in output.lines() {
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        match key {
            "PATH" => env.path.get_or_insert_with(|| value.to_owned()),
            "HOME" => env.home.get_or_insert_with(|| value.to_owned()),
            "LANG" => env.lang.get_or_insert_with(|| value.to_owned()),
            // LC_* vars ride along under LANG semantics for subprocesses; the
            // exact list is not needed for command discovery.
            _ if key.starts_with("LC_") => continue,
            _ => continue,
        };
    }
    env
}

/// Does the PATH already contain the usual system tool directories? Used to
/// decide whether the login-shell probe is worth running at all.
pub(crate) fn path_looks_complete(path: &[String]) -> bool {
    let has_usr_bin = path
        .iter()
        .any(|dir| dir == "/usr/bin" || dir == "C:\\Windows\\System32");
    let has_local = path.iter().any(|dir| {
        dir == "/usr/local/bin" || dir == "/opt/homebrew/bin" || dir.ends_with("\\scoop\\shims")
    });
    has_usr_bin && has_local
}

/// Probe the user's login shell for its environment. Fixed command string,
/// hard timeout, whitelisted read-back; any failure returns None.
fn probe_login_shell(shell: &str) -> Option<LoginEnv> {
    use std::process::{Command, Stdio};
    let mut child = Command::new(shell)
        .args(["-l", "-c", "/usr/bin/printenv"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let deadline =
        std::time::Instant::now() + std::time::Duration::from_millis(LOGIN_PROBE_TIMEOUT_MS);
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                if !status.success() {
                    return None;
                }
                let mut output = String::new();
                use std::io::Read;
                child.stdout.take()?.read_to_string(&mut output).ok()?;
                let env = parse_login_env(&output);
                // A login PATH that parsed to nothing is not usable.
                if env.path.as_deref().map(|p| split_path(p).is_empty()) != Some(false) {
                    return None;
                }
                return Some(env);
            }
            Ok(None) => {
                if std::time::Instant::now() > deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    return None;
                }
                std::thread::sleep(std::time::Duration::from_millis(25));
            }
            Err(_) => return None,
        }
    }
}

/// Resolve and cache the command environment. Warmed up at app startup and
/// resolved lazily on first use; the OnceLock keeps it stable for the run.
pub fn resolve_command_environment() -> &'static CommandEnv {
    CACHED_ENV.get_or_init(|| {
        let shell = std::env::var("SHELL").unwrap_or_default();
        let inherited = split_path(&std::env::var("PATH").unwrap_or_default());
        let inherited_home = std::env::var_os("HOME").map(|v| v.to_string_lossy().into_owned());
        let inherited_lang = std::env::var_os("LANG").map(|v| v.to_string_lossy().into_owned());

        let mut source = CommandEnvSource::Inherited;
        let mut path_lists: Vec<Vec<String>> = vec![inherited.clone()];
        let mut home = inherited_home;
        let mut lang = inherited_lang;

        if !path_looks_complete(&inherited) && !shell.is_empty() {
            if let Some(login) = probe_login_shell(&shell) {
                if let Some(login_path) = &login.path {
                    path_lists.push(split_path(login_path));
                }
                // The login shell knows HOME/LANG best in GUI runs.
                if home.is_none() {
                    home = login.home;
                }
                if lang.is_none() {
                    lang = login.lang;
                }
                source = CommandEnvSource::LoginShell;
            }
        }
        if source == CommandEnvSource::Inherited && !path_looks_complete(&inherited) {
            source = CommandEnvSource::Fallback;
        }

        if source != CommandEnvSource::Inherited {
            let base: Vec<String> = SAFE_BASE_PATH_UNIX.iter().map(|s| s.to_string()).collect();
            path_lists.push(base);
        }

        let refs: Vec<&[String]> = path_lists.iter().map(|list| list.as_slice()).collect();
        let merged = merge_paths(&refs);
        CommandEnv {
            shell,
            path: merged.join(path_separator().to_string().as_str()),
            home,
            lang,
            source,
        }
    })
}

/** The cached environment, resolving on first use. */
pub fn command_environment() -> &'static CommandEnv {
    resolve_command_environment()
}

/**
 * Full subprocess environment for a working directory: cached resolved PATH
 * with the project's `node_modules/.bin` prepended when it exists, plus the
 * whitelisted login variables. Explicit user/model-provided env always wins
 * at the call site (applied after this map).
 */
pub fn subprocess_env_for_cwd(cwd: &std::path::Path) -> std::collections::HashMap<String, String> {
    let env = command_environment();
    let mut dirs: Vec<Vec<String>> = Vec::new();
    let local_bin = cwd.join("node_modules").join(".bin");
    if local_bin.is_dir() {
        dirs.push(vec![local_bin.to_string_lossy().into_owned()]);
    }
    dirs.push(split_path(&env.path));
    let refs: Vec<&[String]> = dirs.iter().map(|list| list.as_slice()).collect();
    let mut map = std::collections::HashMap::new();
    map.insert(
        "PATH".to_owned(),
        merge_paths(&refs).join(path_separator().to_string().as_str()),
    );
    if let Some(home) = &env.home {
        map.insert("HOME".to_owned(), home.clone());
    }
    if let Some(lang) = &env.lang {
        map.insert("LANG".to_owned(), lang.clone());
    }
    map
}

/// Find an executable on a PATH list (explicit paths pass through as files).
pub fn lookup_on_path(program: &str, path: &[String]) -> Option<std::path::PathBuf> {
    if program.contains('/') || program.contains('\\') {
        let candidate = std::path::PathBuf::from(program);
        return candidate.is_file().then_some(candidate);
    }
    for dir in path {
        let candidate = std::path::PathBuf::from(dir).join(program);
        if is_executable(&candidate) {
            return Some(candidate);
        }
    }
    None
}

fn is_executable(path: &std::path::Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        match std::fs::metadata(path) {
            Ok(meta) => meta.is_file() && meta.permissions().mode() & 0o111 != 0,
            Err(_) => false,
        }
    }
    #[cfg(windows)]
    {
        path.is_file()
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolProbe {
    pub name: String,
    pub found: bool,
    pub path: Option<String>,
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandEnvironmentInfo {
    pub shell: String,
    pub resolved_path: String,
    pub source: CommandEnvSource,
    pub tools: Vec<ToolProbe>,
}

const DIAGNOSTIC_TOOLS: [&str; 8] = [
    "node", "npm", "pnpm", "npx", "git", "python3", "cargo", "rustc",
];

/// Diagnostics surface (§23): shell, resolved PATH, and per-tool
/// found/path/version for real-user troubleshooting.
#[tauri::command]
pub fn command_environment_info() -> CommandEnvironmentInfo {
    let env = command_environment();
    let dirs = split_path(&env.path);
    let tools = DIAGNOSTIC_TOOLS
        .iter()
        .map(|name| {
            let found = lookup_on_path(name, &dirs);
            let version = found.as_ref().and_then(|path| {
                use std::process::{Command, Stdio};
                let output = Command::new(path)
                    .arg("--version")
                    .stdin(Stdio::null())
                    .stdout(Stdio::piped())
                    .stderr(Stdio::piped())
                    .output()
                    .ok()?;
                let stdout = String::from_utf8_lossy(&output.stdout);
                let stderr = String::from_utf8_lossy(&output.stderr);
                // python3 prints its version on stderr on some builds.
                stdout
                    .lines()
                    .chain(stderr.lines())
                    .map(str::trim)
                    .find(|line| !line.is_empty())
                    .map(|line| line.chars().take(80).collect())
            });
            ToolProbe {
                name: name.to_string(),
                found: found.is_some(),
                path: found.map(|p| p.to_string_lossy().into_owned()),
                version,
            }
        })
        .collect();
    CommandEnvironmentInfo {
        shell: env.shell.clone(),
        resolved_path: env.path.clone(),
        source: env.source.clone(),
        tools,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dirs(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn merge_paths_dedupes_first_wins() {
        let a = dirs(&["/usr/local/bin", "/usr/bin"]);
        let b = dirs(&["/usr/bin", "/opt/homebrew/bin", ""]);
        let merged = merge_paths(&[&a, &b]);
        assert_eq!(
            merged,
            vec!["/usr/local/bin", "/usr/bin", "/opt/homebrew/bin"]
        );
    }

    #[test]
    fn merge_paths_survives_spaces_and_unicode() {
        let a = dirs(&["/Users/名 前/bin", "/opt/with space/bin"]);
        let merged = merge_paths(&[&a]);
        assert_eq!(merged, a);
    }

    #[test]
    fn parse_login_env_reads_whitelist_only_and_first_value() {
        let env = parse_login_env(
            "PATH=/u/a:/u/b\nHOME=/Users/zz\nLANG=zh_CN.UTF-8\nSECRET=x\nPATH=/ignored\nLC_CTYPE=zh_CN\n",
        );
        assert_eq!(env.path.as_deref(), Some("/u/a:/u/b"));
        assert_eq!(env.home.as_deref(), Some("/Users/zz"));
        assert_eq!(env.lang.as_deref(), Some("zh_CN.UTF-8"));
    }

    #[test]
    fn parse_login_env_with_no_path_yields_none() {
        assert!(parse_login_env("HOME=/x").path.is_none());
        assert!(parse_login_env("").path.is_none());
    }

    #[test]
    fn minimal_gui_path_is_detected_incomplete() {
        assert!(!path_looks_complete(&dirs(&["/usr/bin", "/bin"])));
        assert!(path_looks_complete(&dirs(&[
            "/usr/local/bin",
            "/usr/bin",
            "/bin"
        ])));
        assert!(path_looks_complete(&dirs(&[
            "/opt/homebrew/bin",
            "/usr/bin"
        ])));
    }

    #[test]
    fn lookup_finds_program_on_path() {
        let sh = lookup_on_path("sh", &dirs(&["/usr/bin", "/bin"])).expect("sh exists on unix");
        assert!(sh.is_absolute());
        assert!(lookup_on_path("definitely-not-a-real-tool-xyz", &dirs(&["/usr/bin"])).is_none());
        // An explicit path is returned as-is when it is a file.
        let explicit = lookup_on_path("/bin/sh", &[]);
        assert_eq!(
            explicit.map(|p| p.display().to_string()),
            Some("/bin/sh".to_string())
        );
    }

    #[test]
    fn subprocess_env_prepends_node_modules_bin_when_present() {
        let workspace = std::env::temp_dir().join(format!("evir-cmdenv-{}", std::process::id()));
        let bin = workspace.join("node_modules").join(".bin");
        std::fs::create_dir_all(&bin).expect("create fixture bin");
        let env = subprocess_env_for_cwd(&workspace);
        let path = env.get("PATH").expect("PATH set");
        let first = split_path(path).into_iter().next().expect("non-empty PATH");
        assert!(first.ends_with("node_modules/.bin"));
        assert!(path.contains("/usr/bin"));
        let _ = std::fs::remove_dir_all(workspace);
    }

    #[test]
    fn subprocess_env_without_local_bin_still_has_resolved_path() {
        let env = subprocess_env_for_cwd(std::path::Path::new("/tmp"));
        assert!(env.get("PATH").map(|p| !p.is_empty()).unwrap_or(false));
    }

    #[test]
    fn resolved_environment_contains_system_bins() {
        let env = command_environment();
        let dirs = split_path(&env.path);
        assert!(
            dirs.iter().any(|dir| dir == "/usr/bin" || dir == "/bin"),
            "resolved PATH must include system bin dirs, got: {dirs:?}"
        );
    }
}
