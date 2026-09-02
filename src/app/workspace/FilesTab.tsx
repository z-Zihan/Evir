import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileCode2, FolderSearch, ImageIcon, RefreshCw, Search } from "lucide-react";
import { useFilesTabStore } from "../../features/workspace/files-tab-store";
import { useRunWorkspaceStore } from "../../features/workspace/workspace-run-store";
import { useWorkspacePanelStore } from "../../features/workspace/workspace-panel-store";
import { useActiveWorkspaceRoot } from "../../features/workspace/workspace-bridge";
import { relativeToRoot, resolveWorkspacePath } from "../../features/workspace/workspace-services";
import { subscribeWorkspaceToolEvents } from "../../features/workspace/workspace-events";
import { FileTree } from "./FileTree";
import type { TaskOutput } from "../../features/workspace/task-output-model";

function outputIcon(output: TaskOutput) {
  if (
    output.kind === "screenshot" ||
    output.type === "png" ||
    output.type === "jpg" ||
    output.type === "jpeg"
  ) {
    return <ImageIcon size={14} aria-hidden="true" />;
  }
  return <FileCode2 size={14} aria-hidden="true" />;
}

function openOutputResource(output: TaskOutput, root: string | null) {
  const { openResource } = useWorkspacePanelStore.getState();
  if (output.kind === "screenshot") {
    const label = output.path.split("/").pop();
    openResource({ kind: "screenshot", path: output.path, ...(label ? { label } : {}) });
    return;
  }
  const path = resolveWorkspacePath(output.path, root);
  if (!path) return;
  openResource({
    kind: "file",
    path,
    ...(output.mimeType ? { mimeType: output.mimeType } : {}),
  });
}

/**
 * Files tab: Task Outputs (this run's final artifacts) above the project
 * file tree. The tree is lazy, searchable, and refreshes itself when agent
 * mutations land (§12).
 */
export function FilesTab() {
  const { t } = useTranslation();
  const root = useActiveWorkspaceRoot();
  const outputs = useRunWorkspaceStore((state) => state.outputs);
  const changes = useRunWorkspaceStore((state) => state.changes);
  const activeResource = useWorkspacePanelStore((state) => state.activeResource);
  const openResource = useWorkspacePanelStore((state) => state.openResource);
  const bindRoot = useFilesTabStore((state) => state.bindRoot);
  const search = useFilesTabStore((state) => state.search);
  const setSearch = useFilesTabStore((state) => state.setSearch);
  const runSearch = useFilesTabStore((state) => state.runSearch);
  const searchResults = useFilesTabStore((state) => state.searchResults);
  const searching = useFilesTabStore((state) => state.searching);
  const refreshGitStatus = useFilesTabStore((state) => state.refreshGitStatus);
  const gitBranch = useFilesTabStore((state) => state.gitBranch);
  const isRepo = useFilesTabStore((state) => state.isRepo);
  const reloadDir = useFilesTabStore((state) => state.reloadDir);
  const [treeVersion, setTreeVersion] = useState(0);

  useEffect(() => {
    bindRoot(root);
  }, [bindRoot, root]);

  // Agent file mutations invalidate the containing directory and git state
  // so new files appear without any manual refresh.
  useEffect(() => {
    return subscribeWorkspaceToolEvents((event) => {
      if (!event.result.success) return;
      if (!["write_file", "apply_patch", "create_directory"].includes(event.toolCall.toolName))
        return;
      if (!root) return;
      const store = useFilesTabStore.getState();
      const pathArgument = event.toolCall.arguments["path"];
      const filePathArgument = event.toolCall.arguments["file_path"];
      const path =
        typeof pathArgument === "string"
          ? pathArgument
          : typeof filePathArgument === "string"
            ? filePathArgument
            : null;
      if (path && path.startsWith(root)) store.invalidatePath(path);
      void store.refreshGitStatus(root);
    });
  }, [root]);

  const activePath = useMemo(
    () =>
      activeResource && (activeResource.kind === "file" || activeResource.kind === "diff")
        ? activeResource.path
        : null,
    [activeResource],
  );

  const changedThisRun = useMemo(
    () =>
      new Set(
        changes.flatMap((change) => {
          const path = resolveWorkspacePath(change.path, root);
          return path ? [path] : [];
        }),
      ),
    [changes, root],
  );

  if (!root) {
    return (
      <div className="workspace-empty">
        <FolderSearch size={20} aria-hidden="true" />
        <p>{t("workspace.filesNoProject")}</p>
      </div>
    );
  }

  const openFile = (path: string) => {
    openResource({ kind: "file", path });
  };

  return (
    <div className="workspace-tab-scroll">
      {outputs.length > 0 && (
        <section className="workspace-outputs" aria-label={t("workspace.outputsTitle")}>
          <header className="workspace-section-header">
            <h2>{t("workspace.outputsTitle")}</h2>
            <span className="workspace-changes-summary">
              {t("workspace.outputsCount", { count: outputs.length })}
            </span>
          </header>
          <ul className="workspace-output-list">
            {outputs.map((output) => (
              <li key={output.id}>
                <button
                  type="button"
                  className="workspace-output-row"
                  onClick={() => openOutputResource(output, root)}
                  data-tip={output.path}
                >
                  <span className="workspace-change-icon">{outputIcon(output)}</span>
                  <span className="workspace-change-path">{relativeToRoot(output.path, root)}</span>
                  <span className="workspace-output-type">{output.type}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="workspace-project-files" aria-label={t("workspace.projectFiles")}>
        <header className="workspace-section-header">
          <h2>{t("workspace.projectFiles")}</h2>
          <span className="workspace-changes-summary">{isRepo ? (gitBranch ?? "") : ""}</span>
          <button
            type="button"
            className="workspace-icon-button"
            onClick={() => {
              void reloadDir(root);
              void refreshGitStatus(root);
              setTreeVersion((version) => version + 1);
            }}
            aria-label={t("workspace.refresh")}
            data-tip={t("workspace.refresh")}
          >
            <RefreshCw size={13} aria-hidden="true" />
          </button>
        </header>
        <div className="workspace-file-search">
          <Search size={13} aria-hidden="true" />
          <input
            type="search"
            value={search}
            placeholder={t("workspace.searchFiles")}
            aria-label={t("workspace.searchFiles")}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void runSearch(root);
              }
            }}
          />
        </div>
        {search.trim() !== "" && searchResults !== null ? (
          <ul className="workspace-search-results" aria-label={t("workspace.searchResults")}>
            {searching && <li className="file-tree-hint">{t("workspace.loading")}</li>}
            {!searching && searchResults.length === 0 && (
              <li className="file-tree-hint">{t("workspace.searchEmpty")}</li>
            )}
            {searchResults.map((path) => (
              <li key={path}>
                <button
                  type="button"
                  className={`file-tree-row file-tree-file${activePath === path ? " active" : ""}`}
                  onClick={() => openFile(path)}
                  data-tip={path}
                >
                  <span className="file-tree-icon" aria-hidden="true">
                    <FileCode2 size={14} />
                  </span>
                  <span className="file-tree-name">{relativeToRoot(path, root)}</span>
                  {changedThisRun.has(path) && (
                    <span className="file-tree-status status-added">A</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <FileTree
            key={`${root}:${treeVersion}`}
            root={root}
            onOpenFile={openFile}
            activePath={activePath}
          />
        )}
      </section>
    </div>
  );
}
