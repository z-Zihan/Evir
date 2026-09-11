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

/// Executables that must resolve before the inherited environment counts as
/// complete. Deciding the probe by whether required executables ACTUALLY
/// resolve — not by directory names "looking complete" — is what catches
/// nvm/fnm/volta/rustup layouts: `/usr/local/bin` can be present while the
/// dev tools actually live in a user dir the GUI never inherited.
const PROBE_REQUIRED_TOOLS: [&str; 3] = ["node", "npm", "git"];

pub(crate) fn required_tools_resolve(path: &[String]) -> bool {
    PROBE_REQUIRED_TOOLS
        .iter()
        .all(|tool| lookup_on_path(tool, path).is_some())
}

/// Probe the user's login shell for its environment. Fixed command string,
/// hard timeout, whitelisted read-back; any failure returns None.
/// `interactive` adds `-i` so zsh/bash also load their rc files (.zshrc /
/// .bashrc) — many users export dev-tool PATHs there (nvm, rustup, volta),
/// and the user's real terminal is an interactive login shell, so tool
/// discovery must match it (§17/§25). The rc file runs exactly as it would
/// in the user's own terminal; output pollution is handled by the
/// whitelist parser (first valid KEY=VALUE wins).
fn probe_login_shell(shell: &str, interactive: bool) -> Option<LoginEnv> {
    use std::process::{Command, Stdio};
    let mut command = Command::new(shell);
    if interactive {
        command.args(["-i", "-l", "-c", "/usr/bin/printenv"]);
    } else {
        command.args(["-l", "-c", "/usr/bin/printenv"]);
    }
    let mut child = command
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

/// Resolution core over injected inputs: the OnceLock path feeds it the real
/// process environment and the real login probe; the regression tests inject
/// a GUI-like minimal inherited PATH and fake probe outputs.
fn resolve_env_from(
    shell: &str,
    inherited_path: &str,
    inherited_home: Option<String>,
    inherited_lang: Option<String>,
    probe: &(dyn Fn(&str, bool) -> Option<LoginEnv> + '_),
) -> CommandEnv {
    let inherited = split_path(inherited_path);
    let mut source = CommandEnvSource::Inherited;
    let mut path_lists: Vec<Vec<String>> = vec![inherited.clone()];
    let mut home = inherited_home;
    let mut lang = inherited_lang;

    if !required_tools_resolve(&inherited) && !shell.is_empty() {
        if let Some(login) = probe(shell, false) {
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
            // Second pass: interactive rc files (.zshrc etc.) often add
            // MORE tool directories (rustup, volta); union them in so
            // anything the user's real terminal can find, we find too.
            if let Some(interactive_env) = probe(shell, true) {
                if let Some(interactive_path) = &interactive_env.path {
                    path_lists.push(split_path(interactive_path));
                }
                if home.is_none() {
                    home = interactive_env.home;
                }
                if lang.is_none() {
                    lang = interactive_env.lang;
                }
            }
        }
    }
    if source == CommandEnvSource::Inherited && !required_tools_resolve(&inherited) {
        source = CommandEnvSource::Fallback;
    }

    if source != CommandEnvSource::Inherited {
        let base: Vec<String> = SAFE_BASE_PATH_UNIX.iter().map(|s| s.to_string()).collect();
        path_lists.push(base);
    }

    let refs: Vec<&[String]> = path_lists.iter().map(|list| list.as_slice()).collect();
    let merged = merge_paths(&refs);
    CommandEnv {
    shell: shell.to_owned(),
    path: merged.join(path_separator().to_string().as_str()),
    home,
    lang,
    source,
    }
}

/// Resolve and cache the command environment. Warmed up at app startup and
/// resolved lazily on first use; the OnceLock keeps it stable for the run.
pub fn resolve_command_environment() -> &'static CommandEnv {
    CACHED_ENV.get_or_init(|| {
    resolve_env_from(
        &std::env::var("SHELL").unwrap_or_default(),
        &std::env::var("PATH").unwrap_or_default(),
        std::env::var_os("HOME").map(|v| v.to_string_lossy().into_owned()),
        std::env::var_os("LANG").map(|v| v.to_string_lossy().into_owned()),
        &probe_login_shell,
    )
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

/// Resolve an executable for a working directory through the shared
/// environment: the project's `node_modules/.bin` first, then the cached
/// resolved PATH. Every subprocess entry point (run_command, App Preview,
/// verification commands) resolves executables through THIS function, so
/// "can Evir find pnpm" has exactly one answer.
pub fn resolve_executable(program: &str, cwd: &std::path::Path) -> Option<std::path::PathBuf> {
    let env = command_environment();
    resolve_executable_in(env, cwd, program)
}

/// Testable core of [`resolve_executable`] over an injected environment.
pub(crate) fn resolve_executable_in(
    env: &CommandEnv,
    cwd: &std::path::Path,
    program: &str,
) -> Option<std::path::PathBuf> {
    if program.contains('/') || program.contains('\\') {
        let candidate = std::path::PathBuf::from(program);
        return candidate.is_file().then_some(candidate);
    }
    let mut dirs: Vec<Vec<String>> = Vec::new();
    let local_bin = cwd.join("node_modules").join(".bin");
    if local_bin.is_dir() {
        dirs.push(vec![local_bin.to_string_lossy().into_owned()]);
    }
    dirs.push(split_path(&env.path));
    let refs: Vec<&[String]> = dirs.iter().map(|list| list.as_slice()).collect();
    lookup_on_path(program, &merge_paths(&refs))
}

/// Structured subprocess failure (§9): every entry point reports a missing
/// executable as `command_not_found` with the program, cwd, and the
/// environment source that was searched — never a bare `os error 2`.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CommandExecutionError {
    pub kind: CommandExecutionErrorKind,
    pub program: String,
    pub cwd: Option<String>,
    pub environment_source: Option<CommandEnvSource>,
    pub message: String,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum CommandExecutionErrorKind {
    CommandNotFound,
    SpawnFailed,
    /// The cwd failed workspace validation — a permission boundary refusal,
    /// not an environment problem.
    OutsideWorkspace,
}

impl std::fmt::Display for CommandExecutionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.kind_str(), self.program)?;
        if let Some(cwd) = &self.cwd {
            write!(f, " (cwd: {cwd}")?;
            if let Some(source) = &self.environment_source {
                write!(f, "; environment: {}", source_str(source))?;
            }
            write!(f, ")")?;
        }
        Ok(())
    }
}

impl CommandExecutionError {
    pub fn command_not_found(program: &str, cwd: &std::path::Path) -> Self {
        let env = command_environment();
        Self {
            kind: CommandExecutionErrorKind::CommandNotFound,
            program: program.to_owned(),
            cwd: Some(cwd.to_string_lossy().into_owned()),
            environment_source: Some(env.source.clone()),
            message: format!(
                "command not found: {program} — not on the resolved command PATH (source: {})",
                source_str(&env.source)
            ),
        }
    }

    pub fn spawn_failed(
        program: &str,
        cwd: &std::path::Path,
        error: &std::io::Error,
    ) -> Self {
        let env = command_environment();
        Self {
            kind: CommandExecutionErrorKind::SpawnFailed,
            program: program.to_owned(),
            cwd: Some(cwd.to_string_lossy().into_owned()),
            environment_source: Some(env.source.clone()),
            message: format!("failed to start {program}: {error}"),
        }
    }

    pub fn outside_workspace(program: &str, reason: String) -> Self {
        Self {
            kind: CommandExecutionErrorKind::OutsideWorkspace,
            program: program.to_owned(),
            cwd: None,
            environment_source: None,
            message: reason,
        }
    }

    fn kind_str(&self) -> &'static str {
        match self.kind {
            CommandExecutionErrorKind::CommandNotFound => "command_not_found",
            CommandExecutionErrorKind::SpawnFailed => "spawn_failed",
            CommandExecutionErrorKind::OutsideWorkspace => "outside_workspace",
        }
    }
}

fn source_str(source: &CommandEnvSource) -> &'static str {
    match source {
        CommandEnvSource::LoginShell => "login_shell",
        CommandEnvSource::Inherited => "inherited",
        CommandEnvSource::Fallback => "fallback",
    }
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
            let probe_env = {
                let mut map = std::collections::HashMap::new();
                map.insert("PATH".to_owned(), env.path.clone());
                if let Some(home) = &env.home {
                    map.insert("HOME".to_owned(), home.clone());
                }
                map
            };
            let output = Command::new(path)
                .arg("--version")
                .envs(probe_env)
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

    /// Create a temp bin dir containing executable stubs with the given names.
    fn stub_bin(tag: &str, names: &[&str]) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("evir-cmdenv-stub-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("create stub bin dir");
        for name in names {
            let stub = dir.join(name);
            std::fs::write(&stub, "#!/bin/sh\n").expect("write stub");
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let mut perms = std::fs::metadata(&stub).unwrap().permissions();
                perms.set_mode(0o755);
                std::fs::set_permissions(&stub, perms).unwrap();
            }
        }
        dir
    }

    /// §C2 regression gate: a GUI-launched app inherits a minimal PATH
    /// (/usr/bin:/bin) while the user's shell knows a dev-tool bin dir
    /// (nvm/volta/cargo…). Resolution must union the probe outputs so a
    /// program the user's terminal can find, the synthesized PATH finds too.
    #[test]
    fn gui_like_path_finds_pnpm_via_login_and_interactive_probes() {
        // A real executable named `pnpm` in a fake user bin dir.
        let user_bin = std::env::temp_dir().join("evir-c2-gate-pnpm-bin");
        let _ = std::fs::remove_dir_all(&user_bin);
        std::fs::create_dir_all(&user_bin).expect("create temp bin");
        let pnpm = user_bin.join("pnpm");
        std::fs::write(&pnpm, "#!/bin/sh\n").expect("write stub");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = std::fs::metadata(&pnpm).unwrap().permissions();
            perms.set_mode(0o755);
            std::fs::set_permissions(&pnpm, perms).unwrap();
        }
        let user_bin_str = user_bin.to_string_lossy().into_owned();

        let login_path = format!("/usr/bin:/bin:{user_bin_str}");
        let probes = std::cell::Cell::new(0u32);
        let probe = move |_shell: &str, interactive: bool| {
            probes.set(probes.get() + 1);
            Some(LoginEnv {
                path: Some(if interactive {
                    login_path.clone()
                } else {
                    "/usr/bin:/bin".to_owned()
                }),
                home: Some("/Users/gate".to_owned()),
                lang: None,
            })
        };

        let env = resolve_env_from(
            "/bin/zsh",
            "/usr/bin:/bin",
            None,
            None,
            &probe,
        );
        assert_eq!(env.source, CommandEnvSource::LoginShell);
        let resolved = split_path(&env.path);
        assert!(
            resolved.iter().any(|dir| dir == &user_bin_str),
            "interactive rc PATH must be unioned in: {}",
            env.path
        );
        assert!(resolved.iter().any(|dir| dir == "/usr/local/bin"));
        // The actual discovery the user cares about: pnpm resolves.
        let found = lookup_on_path("pnpm", &resolved);
        assert!(found.is_some(), "pnpm must resolve on the synthesized PATH");
        // §15 hard gate, dev-server half: a package manager that exists ONLY
        // in the resolved user PATH (not the GUI-inherited one) must also be
        // found by the shared executable resolver that dev_server_start uses.
        let cwd = std::path::Path::new("/tmp");
        assert!(
            resolve_executable_in(&env, cwd, "pnpm").is_some(),
            "dev_server lookup must find pnpm through the shared environment"
        );
        let _ = std::fs::remove_dir_all(&user_bin);
    }

    /// Probe unavailable (broken shell / timeout): honest fallback — safe
    /// base only, dev tools NOT silently claimed as findable.
    #[test]
    fn probe_failure_falls_back_without_inventing_tools() {
    let env = resolve_env_from(
        "/nonexistent/shell",
        "/usr/bin:/bin",
        None,
        None,
        &|_shell, _interactive| None,
    );
    assert_eq!(env.source, CommandEnvSource::Fallback);
    let resolved = split_path(&env.path);
    assert!(resolved.iter().any(|dir| dir == "/usr/bin"));
    assert!(lookup_on_path("definitely-not-a-real-tool-xyz", &resolved).is_none());
    }

    /// §12: a PATH only skips the login-shell probe when the REQUIRED
    /// executables actually resolve on it — not when the directory list
    /// "looks complete". /usr/local/bin + /usr/bin with no node/npm/git in
    /// them must still probe (the nvm/volta case).
    #[test]
    fn directory_names_alone_do_not_skip_the_probe() {
        let calls = std::cell::Cell::new(0u32);
        let probe = |_shell: &str, _interactive: bool| {
            calls.set(calls.get() + 1);
            None
        };
        let env = resolve_env_from(
            "/bin/zsh",
            "/usr/local/bin:/usr/bin:/bin",
            None,
            None,
            &probe,
        );
        assert_eq!(env.source, CommandEnvSource::Fallback);
        assert!(calls.get() > 0, "must probe when required tools do not resolve");
    }

    /// §12: a PATH where node/npm/git genuinely resolve (e.g. inherited from
    /// a real terminal) skips the probe entirely — no rc side effects when
    /// they are not needed.
    #[test]
    fn required_tools_resolving_skips_probe() {
        let bin = stub_bin("complete", &["node", "npm", "git"]);
        let bin_str = bin.to_string_lossy().into_owned();
        let calls = std::cell::Cell::new(0u32);
        let probe = |_shell: &str, _interactive: bool| {
            calls.set(calls.get() + 1);
            None
        };
        let env = resolve_env_from("/bin/zsh", &bin_str, None, None, &probe);
        assert_eq!(env.source, CommandEnvSource::Inherited);
        assert_eq!(calls.get(), 0, "probe must not run when required tools resolve");
        let _ = std::fs::remove_dir_all(&bin);
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
    fn required_tools_resolution_ignores_directory_names() {
        // Real stubs decide; the names of the directories are irrelevant.
        let with_tools = stub_bin("req-yes", &["node", "npm", "git"]);
        let without_tools = stub_bin("req-no", &["ls"]);
        assert!(required_tools_resolve(&[
            with_tools.to_string_lossy().into_owned()
        ]));
        assert!(!required_tools_resolve(&[
            without_tools.to_string_lossy().into_owned()
        ]));
        let _ = std::fs::remove_dir_all(&with_tools);
        let _ = std::fs::remove_dir_all(&without_tools);
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

    /// §15: unicode + spaces in the project path must survive PATH building.
    #[test]
    fn subprocess_env_survives_unicode_and_spaces_in_cwd() {
        let workspace = std::env::temp_dir().join(format!(
            "evir-cmdenv-uni-{}-项目 名字",
            std::process::id()
        ));
        let bin = workspace.join("node_modules").join(".bin");
        std::fs::create_dir_all(&bin).expect("create unicode fixture bin");
        let env = subprocess_env_for_cwd(&workspace);
        let path = env.get("PATH").expect("PATH set");
        let first = split_path(path).into_iter().next().expect("non-empty PATH");
        assert!(first.contains("项目 名字"), "unicode cwd kept: {first}");
        assert!(first.ends_with("node_modules/.bin"));
        let _ = std::fs::remove_dir_all(workspace);
    }

    /// §15 cache behavior: the OnceLock hands every caller the same
    /// resolution — run_command, preview, and verification cannot disagree.
    #[test]
    fn command_environment_is_cached_for_the_process_lifetime() {
        let first = command_environment();
        let second = command_environment();
        assert!(std::ptr::eq(first, second));
    }

    /// §8: project-local node_modules/.bin wins over the resolved PATH, so
    /// `vite`/`vitest` from the project resolve before any global ones.
    #[test]
    fn resolve_executable_prefers_project_local_bin() {
        let env = CommandEnv {
            shell: "/bin/zsh".to_owned(),
            path: "/usr/bin:/bin".to_owned(),
            home: None,
            lang: None,
            source: CommandEnvSource::Inherited,
        };
        let workspace = std::env::temp_dir().join(format!("evir-resolve-{}", std::process::id()));
        let bin = workspace.join("node_modules").join(".bin");
        std::fs::create_dir_all(&bin).expect("create local bin");
        let local = bin.join("vitest");
        std::fs::write(&local, "#!/bin/sh\n").expect("write stub");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = std::fs::metadata(&local).unwrap().permissions();
            perms.set_mode(0o755);
            std::fs::set_permissions(&local, perms).unwrap();
        }
        let resolved = resolve_executable_in(&env, &workspace, "vitest")
            .expect("local vitest must resolve");
        assert!(resolved.starts_with(&workspace), "local bin first: {resolved:?}");
        assert!(
            resolve_executable_in(&env, &workspace, "definitely-missing-xyz").is_none()
        );
        let _ = std::fs::remove_dir_all(workspace);
    }

    #[test]
    fn command_execution_error_serializes_camel_case_fields() {
        let error = CommandExecutionError {
            kind: CommandExecutionErrorKind::CommandNotFound,
            program: "pnpm".to_owned(),
            cwd: Some("/tmp/project".to_owned()),
            environment_source: Some(CommandEnvSource::LoginShell),
            message: "command not found: pnpm".to_owned(),
        };
        let value = serde_json::to_value(&error).expect("serialize error");
        assert_eq!(value["kind"], "command_not_found");
        assert_eq!(value["program"], "pnpm");
        assert_eq!(value["cwd"], "/tmp/project");
        assert_eq!(value["environmentSource"], "login_shell");
        assert_eq!(value["message"], "command not found: pnpm");
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
