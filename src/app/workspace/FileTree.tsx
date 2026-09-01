import { memo } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, File, Folder } from "lucide-react";
import type { FileInfo } from "../../runtime/desktop-storage-adapter";
import { useFilesTabStore } from "../../features/workspace/files-tab-store";
import { relativeToRoot } from "../../features/workspace/workspace-services";

const MAX_ENTRIES_PER_DIR = 400;

interface FileTreeProps {
  root: string;
  onOpenFile: (path: string) => void;
  activePath: string | null;
}

function statusLetterClass(letter: string | undefined): string {
  if (!letter) return "";
  if (letter.includes("A")) return "status-added";
  if (letter.includes("D")) return "status-deleted";
  if (letter.includes("R")) return "status-renamed";
  if (letter.includes("?")) return "status-untracked";
  if (letter.includes("M")) return "status-modified";
  return "";
}

/** One directory level; children recurse lazily through the store cache. */
const DirectoryNode = memo(function DirectoryNode({
  entry,
  root,
  onOpenFile,
  activePath,
  depth,
}: {
  entry: FileInfo;
  root: string;
  onOpenFile: (path: string) => void;
  activePath: string | null;
  depth: number;
}) {
  const { t } = useTranslation();
  const expanded = useFilesTabStore((state) => state.expandedDirs[entry.path] === true);
  const cached = useFilesTabStore((state) => state.dirCache[entry.path]);
  const loading = useFilesTabStore((state) => state.loadingDirs[entry.path] === true);
  const toggleDir = useFilesTabStore((state) => state.toggleDir);
  const gitStatus = useFilesTabStore((state) => state.gitStatus);

  const children = (cached?.entries ?? []).filter((child) => !child.name.startsWith("."));
  const visible = children.slice(0, MAX_ENTRIES_PER_DIR);
  const hiddenCount = children.length - visible.length;

  return (
    <li className="file-tree-node" role="none">
      <button
        type="button"
        className="file-tree-row file-tree-dir"
        role="treeitem"
        aria-expanded={expanded}
        style={{ "--tree-depth": depth } as React.CSSProperties}
        onClick={() => toggleDir(entry.path)}
        data-tip={entry.path}
      >
        <span className="file-tree-chevron" aria-hidden="true">
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </span>
        <span className="file-tree-icon" aria-hidden="true">
          <Folder size={14} />
        </span>
        <span className="file-tree-name">{entry.name}</span>
      </button>
      {expanded && (
        <ul className="file-tree-children" role="group">
          {loading && !cached && <li className="file-tree-hint">{t("workspace.loading")}</li>}
          {visible.map((child) =>
            child.is_dir ? (
              <DirectoryNode
                key={child.path}
                entry={child}
                root={root}
                onOpenFile={onOpenFile}
                activePath={activePath}
                depth={depth + 1}
              />
            ) : (
              <li key={child.path} className="file-tree-node" role="none">
                <button
                  type="button"
                  className={`file-tree-row file-tree-file${activePath === child.path ? " active" : ""}`}
                  role="treeitem"
                  aria-selected={activePath === child.path}
                  style={{ "--tree-depth": depth + 1 } as React.CSSProperties}
                  onClick={() => onOpenFile(child.path)}
                  data-tip={child.path}
                >
                  <span className="file-tree-chevron invisible" aria-hidden="true" />
                  <span className="file-tree-icon" aria-hidden="true">
                    <File size={14} />
                  </span>
                  <span className="file-tree-name">{child.name}</span>
                  {gitStatus[relativeToRoot(child.path, root)] && (
                    <span
                      className={`file-tree-status ${statusLetterClass(gitStatus[relativeToRoot(child.path, root)])}`}
                    >
                      {gitStatus[relativeToRoot(child.path, root)]}
                    </span>
                  )}
                </button>
              </li>
            ),
          )}
          {hiddenCount > 0 && (
            <li className="file-tree-hint">{t("workspace.moreEntries", { count: hiddenCount })}</li>
          )}
        </ul>
      )}
    </li>
  );
});

export function FileTree({ root, onOpenFile, activePath }: FileTreeProps) {
  const rootEntries = useFilesTabStore((state) => state.dirCache[root]?.entries);
  const loading = useFilesTabStore((state) => state.loadingDirs[root] === true);
  const { t } = useTranslation();
  const visible = (rootEntries ?? []).filter((entry) => !entry.name.startsWith("."));

  return (
    <ul className="file-tree" role="tree" aria-label={t("workspace.projectFiles")}>
      {loading && !rootEntries && <li className="file-tree-hint">{t("workspace.loading")}</li>}
      {visible.map((entry) =>
        entry.is_dir ? (
          <DirectoryNode
            key={entry.path}
            entry={entry}
            root={root}
            onOpenFile={onOpenFile}
            activePath={activePath}
            depth={0}
          />
        ) : (
          <li key={entry.path} className="file-tree-node" role="none">
            <button
              type="button"
              className={`file-tree-row file-tree-file${activePath === entry.path ? " active" : ""}`}
              role="treeitem"
              aria-selected={activePath === entry.path}
              style={{ "--tree-depth": 0 } as React.CSSProperties}
              onClick={() => onOpenFile(entry.path)}
              data-tip={entry.path}
            >
              <span className="file-tree-chevron invisible" aria-hidden="true" />
              <span className="file-tree-icon" aria-hidden="true">
                <File size={14} />
              </span>
              <span className="file-tree-name">{entry.name}</span>
            </button>
          </li>
        ),
      )}
    </ul>
  );
}
