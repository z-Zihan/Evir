//! Git commands: porcelain status and diff, plus `git worktree`
//! create/merge/remove for isolated parallel write execution.

use std::process::Command as StdCommand;

use serde::Serialize;

use super::infra::{
    truncate_string, validate_component_id, validate_path, validate_path_in_workspace,
};

#[derive(Serialize)]
pub struct GitStatusEntry {
    status: String,
    file: String,
}

#[derive(Serialize)]
pub struct GitStatusResult {
    is_repo: bool,
    entries: Vec<GitStatusEntry>,
    branch: Option<String>,
}

/// Get git status for a directory.
#[tauri::command(async)]
pub(crate) fn git_status(path: String, workspace_root: String) -> Result<GitStatusResult, String> {
    let dir = validate_path_in_workspace(&path, &workspace_root)?;
    let git_dir = dir.join(".git");
    if !git_dir.exists() {
        return Ok(GitStatusResult {
            is_repo: false,
            entries: vec![],
            branch: None,
        });
    }

    let output = StdCommand::new("git")
        .args(["status", "--porcelain=v1", "-b"])
        .current_dir(&dir)
        .output()
        .map_err(|error| error.to_string())?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut entries = Vec::new();
    let mut branch = None;

    for line in stdout.lines() {
        if let Some(rest) = line.strip_prefix("## ") {
            // Branch line: "## main...origin/main"
            if let Some(dotdot) = rest.find("...") {
                branch = Some(rest[..dotdot].to_string());
            } else {
                branch = Some(rest.to_string());
            }
        } else if line.len() >= 3 {
            let status = line[..2].trim().to_string();
            let file = line[3..].to_string();
            entries.push(GitStatusEntry { status, file });
        }
    }

    Ok(GitStatusResult {
        is_repo: true,
        entries,
        branch,
    })
}

/// Get git diff for a directory.
#[tauri::command(async)]
pub(crate) fn git_diff(
    path: String,
    staged: bool,
    workspace_root: String,
) -> Result<String, String> {
    let dir = validate_path_in_workspace(&path, &workspace_root)?;
    let mut cmd = StdCommand::new("git");
    cmd.args(["diff"]);
    if staged {
        cmd.arg("--staged");
    }
    cmd.current_dir(&dir);
    cmd.stdout(std::process::Stdio::piped());

    let output = cmd.output().map_err(|error| error.to_string())?;
    let diff = String::from_utf8_lossy(&output.stdout);
    Ok(truncate_string(&diff, 100_000))
}

fn run_git(root: &std::path::Path, args: &[&str]) -> Result<String, String> {
    let output = std::process::Command::new("git")
        .arg("-C")
        .arg(root)
        .args(args)
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(format!(
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// Create an isolated git worktree for parallel write execution. Returns the
/// worktree path. Fails cleanly when the root is not a git repository.
#[tauri::command(async)]
pub(crate) fn git_worktree_create(root: String, id: String) -> Result<String, String> {
    validate_component_id("worktree id", &id)?;
    let root_path = validate_path(&root)?;
    if !root_path.join(".git").exists() {
        run_git(&root_path, &["rev-parse", "--git-dir"])?;
    }
    let worktrees = root_path.join(".evir-worktrees");
    std::fs::create_dir_all(&worktrees).map_err(|error| error.to_string())?;
    let branch = format!("evir/{}", id);
    let path = worktrees.join(&id);
    run_git(
        &root_path,
        &[
            "worktree",
            "add",
            "-b",
            &branch,
            path.to_string_lossy().as_ref(),
        ],
    )?;
    Ok(path.to_string_lossy().into_owned())
}

/// Stage everything inside the worktree and apply the resulting patch back to
/// the main working tree with a three-way merge. Any conflict fails the merge.
#[tauri::command(async)]
pub(crate) fn git_worktree_merge(root: String, id: String) -> Result<(), String> {
    validate_component_id("worktree id", &id)?;
    let root_path = validate_path(&root)?;
    let worktree = root_path.join(".evir-worktrees").join(&id);
    run_git(&worktree, &["add", "-A"])?;
    let patch = run_git(&worktree, &["diff", "--cached", "--binary"])?;
    if patch.trim().is_empty() {
        return Ok(());
    }
    let patch_path = worktree.join(".evir-merge.patch");
    std::fs::write(&patch_path, &patch).map_err(|error| error.to_string())?;
    // NB: the flag is `--3way` (no second hyphen); `--3-way` is an unknown
    // option, which made every real worktree merge fail until this test.
    let applied = std::process::Command::new("git")
        .arg("-C")
        .arg(&root_path)
        .args(["apply", "--3way"])
        .arg(&patch_path)
        .output()
        .map_err(|error| error.to_string())?;
    let _ = std::fs::remove_file(&patch_path);
    if !applied.status.success() {
        return Err(format!(
            "worktree merge conflict: {}",
            String::from_utf8_lossy(&applied.stderr).trim()
        ));
    }
    Ok(())
}

#[tauri::command(async)]
pub(crate) fn git_worktree_remove(root: String, id: String) -> Result<(), String> {
    validate_component_id("worktree id", &id)?;
    let root_path = validate_path(&root)?;
    let worktree = root_path.join(".evir-worktrees").join(&id);
    let _ = run_git(
        &root_path,
        &[
            "worktree",
            "remove",
            "--force",
            worktree.to_string_lossy().as_ref(),
        ],
    );
    let _ = run_git(&root_path, &["branch", "-D", &format!("evir/{}", id)]);
    Ok(())
}

#[cfg(test)]
mod worktree_tests {
    use super::{git_worktree_create, git_worktree_merge, git_worktree_remove};

    fn git_available() -> bool {
        std::process::Command::new("git")
            .arg("--version")
            .output()
            .map(|output| output.status.success())
            .unwrap_or(false)
    }

    fn init_repo(root: &std::path::Path) {
        let run = |args: &[&str]| {
            let output = std::process::Command::new("git")
                .arg("-C")
                .arg(root)
                .args(args)
                .output()
                .expect("git must spawn");
            assert!(
                output.status.success(),
                "git {:?} failed: {}",
                args,
                String::from_utf8_lossy(&output.stderr)
            );
        };
        run(&["init", "--initial-branch=main"]);
        run(&["config", "user.email", "test@evir.local"]);
        run(&["config", "user.name", "Evir Test"]);
        std::fs::write(root.join("README.md"), "base\n").expect("seed file");
        run(&["add", "-A"]);
        run(&["commit", "-m", "init"]);
    }

    #[test]
    fn worktree_create_merge_remove_round_trip() {
        if !git_available() {
            eprintln!("skipping: git binary not available");
            return;
        }
        let suffix = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let root =
            std::env::temp_dir().join(format!("evir-worktree-{}-{suffix}", std::process::id()));
        std::fs::create_dir_all(&root).expect("repo dir");
        init_repo(&root);
        let root_str = root.to_string_lossy().into_owned();

        // Create → isolated checkout exists with the committed file.
        let worktree = git_worktree_create(root_str.clone(), "wt-test-1".to_owned())
            .expect("worktree must be created");
        assert!(std::path::Path::new(&worktree).join("README.md").exists());
        assert!(worktree.contains(".evir-worktrees"));

        // Merge → writes made inside the worktree land in the main tree.
        std::fs::write(
            std::path::Path::new(&worktree).join("feature.txt"),
            "isolated write\n",
        )
        .expect("worktree write");
        git_worktree_merge(root_str.clone(), "wt-test-1".to_owned())
            .expect("merge must apply the patch");
        assert!(root.join("feature.txt").exists());

        // Remove → the worktree directory and its branch are cleaned up.
        git_worktree_remove(root_str, "wt-test-1".to_owned()).expect("worktree must be removed");
        assert!(!std::path::Path::new(&worktree).exists());

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn worktree_create_fails_outside_a_git_repository() {
        let suffix = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("evir-nowt-{}-{suffix}", std::process::id()));
        std::fs::create_dir_all(&root).expect("plain dir");
        let error = git_worktree_create(root.to_string_lossy().into_owned(), "wt-plain".to_owned())
            .expect_err("non-repo must fail");
        assert!(error.contains("failed"), "unexpected error: {error}");
        let _ = std::fs::remove_dir_all(&root);
    }
}
