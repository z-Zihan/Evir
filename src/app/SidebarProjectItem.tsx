import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  ChevronRight,
  FolderSearch,
  Pencil,
  Pin,
  Plus,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import type { ProjectRecord } from "../core/storage/db";

interface SidebarProjectItemProps {
  project: ProjectRecord;
  expanded: boolean;
  active: boolean;
  folderMissing: boolean;
  onToggleExpand: () => void;
  onSelect: () => void;
  onNewTask: () => void;
  onTogglePin: () => void;
  onRename: (displayName: string) => void;
  onLocate: () => void;
  onPermission: () => void;
  onRemove: () => void;
}

export function SidebarProjectItem({
  project,
  expanded,
  active,
  folderMissing,
  onToggleExpand,
  onSelect,
  onNewTask,
  onTogglePin,
  onRename,
  onLocate,
  onPermission,
  onRemove,
}: SidebarProjectItemProps) {
  const { t } = useTranslation();
  const [renaming, setRenaming] = useState(false);
  const [value, setValue] = useState(project.displayName);

  const commitRename = () => {
    setRenaming(false);
    if (value.trim() && value !== project.displayName) onRename(value.trim());
    setValue(project.displayName);
  };

  return (
    <div
      className={`project-item group${active ? " active" : ""}${project.pinned ? " pinned" : ""}`}
    >
      <div
        className="project-row"
        onClick={onSelect}
        onDoubleClick={() => {
          setRenaming(true);
          setValue(project.displayName);
        }}
      >
        <button
          className="project-chevron"
          type="button"
          aria-label={expanded ? t("sidebar.collapseProject") : t("sidebar.expandProject")}
          aria-expanded={expanded}
          onClick={(event) => {
            event.stopPropagation();
            onToggleExpand();
          }}
        >
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
        {project.pinned ? <Pin size={11} className="pin-indicator" aria-hidden="true" /> : null}
        {renaming ? (
          <input
            className="rename-input"
            type="text"
            value={value}
            autoFocus
            maxLength={100}
            onChange={(event) => setValue(event.target.value)}
            onBlur={commitRename}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitRename();
              if (event.key === "Escape") {
                setRenaming(false);
                setValue(project.displayName);
              }
            }}
            onClick={(event) => event.stopPropagation()}
          />
        ) : (
          <span className="project-name" title={project.rootPath}>
            {project.displayName}
          </span>
        )}
        {folderMissing && !renaming && (
          <span className="project-folder-missing">{t("sidebar.folderMissing")}</span>
        )}
        {!renaming && (
          <div className="conversation-actions" onClick={(event) => event.stopPropagation()}>
            {folderMissing && (
              <button
                className="conversation-action-btn"
                type="button"
                aria-label={t("sidebar.locateFolder")}
                title={t("sidebar.locateFolder")}
                onClick={onLocate}
              >
                <FolderSearch size={13} />
              </button>
            )}
            <button
              className="conversation-action-btn"
              type="button"
              aria-label={t("sidebar.newTask")}
              title={t("sidebar.newTask")}
              onClick={onNewTask}
            >
              <Plus size={13} />
            </button>
            <button
              className="conversation-action-btn"
              type="button"
              aria-label={t("sidebar.permission")}
              title={t("sidebar.permission")}
              onClick={onPermission}
            >
              <ShieldCheck size={13} />
            </button>
            <button
              className="conversation-action-btn"
              type="button"
              aria-label={project.pinned ? t("sidebar.unpin") : t("sidebar.pin")}
              title={project.pinned ? t("sidebar.unpin") : t("sidebar.pin")}
              onClick={onTogglePin}
            >
              <Pin size={13} />
            </button>
            <button
              className="conversation-action-btn"
              type="button"
              aria-label={t("sidebar.rename")}
              title={t("sidebar.rename")}
              onClick={() => {
                setRenaming(true);
                setValue(project.displayName);
              }}
            >
              <Pencil size={13} />
            </button>
            <button
              className="conversation-action-btn conversation-delete"
              type="button"
              aria-label={t("sidebar.removeProject")}
              title={t("sidebar.removeProject")}
              onClick={onRemove}
            >
              <Trash2 size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
