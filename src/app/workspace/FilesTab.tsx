import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileCode2, FolderSearch, RefreshCw, Search } from "lucide-react";
import { Button, Input, Tip } from "../../components/ui";
import { useFilesTabStore } from "../../features/workspace/files-tab-store";
import { useRunWorkspaceStore } from "../../features/workspace/workspace-run-store";
import { useWorkspacePanelStore } from "../../features/workspace/workspace-panel-store";
import { useActiveWorkspaceRoot } from "../../features/workspace/workspace-bridge";
import { relativeToRoot, resolveWorkspacePath } from "../../features/workspace/workspace-services";
import { subscribeWorkspaceToolEvents } from "../../features/workspace/workspace-events";
import { FileTree } from "./FileTree";

/**
 * Files tab: the project file tree. The tree is lazy, searchable, and
 * refreshes itself when agent mutations land (§12). Task deliverables live
 * in the dedicated Outputs tab.
 */
export function FilesTab() {
  const { t } = useTranslation();
  const root = useActiveWorkspaceRoot();
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
      <div className="workspace-empty flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-muted">
        <FolderSearch size={20} aria-hidden="true" />
        <p className="m-0 text-[12px]">{t("workspace.filesNoProject")}</p>
      </div>
    );
  }

  const openFile = (path: string) => {
    // Canvas documents open in the canvas view, not as raw text.
    if (path.toLowerCase().endsWith(".evir-canvas")) {
      openResource({ kind: "canvas", path });
      return;
    }
    openResource({ kind: "file", path });
  };

  return (
    <div className="workspace-tab-scroll flex min-h-0 flex-1 flex-col overflow-y-auto p-2">
      <section
        className="workspace-project-files flex min-h-0 flex-1 flex-col gap-2"
        aria-label={t("workspace.projectFiles")}
      >
        <header className="workspace-section-header flex items-center gap-2 px-1">
          <h2 className="m-0 text-[12px] font-semibold text-foreground">
            {t("workspace.projectFiles")}
          </h2>
          <span className="workspace-changes-summary text-[11px] text-muted">
            {isRepo ? (gitBranch ?? "") : ""}
          </span>
          <Tip content={t("workspace.refresh")} side="bottom">
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => {
                void reloadDir(root);
                void refreshGitStatus(root);
                setTreeVersion((version) => version + 1);
              }}
              aria-label={t("workspace.refresh")}
            >
              <RefreshCw size={13} aria-hidden="true" />
            </Button>
          </Tip>
        </header>
        <div className="workspace-file-search relative flex h-8 items-center">
          <Search
            size={13}
            aria-hidden="true"
            className="pointer-events-none absolute left-2.5 text-muted"
          />
          <Input
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
            className="h-8 pl-8"
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
                <Tip content={path}>
                  <button
                    type="button"
                    className={`file-tree-row file-tree-file${activePath === path ? " active" : ""}`}
                    onClick={() => openFile(path)}
                  >
                    <span className="file-tree-icon" aria-hidden="true">
                      <FileCode2 size={14} />
                    </span>
                    <span className="file-tree-name">{relativeToRoot(path, root)}</span>
                    {changedThisRun.has(path) && (
                      <span className="file-tree-status status-added">A</span>
                    )}
                  </button>
                </Tip>
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
