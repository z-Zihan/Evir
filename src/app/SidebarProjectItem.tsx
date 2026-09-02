import { memo, useState } from "react";
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
import { Button, Tip } from "../components/ui";
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

export const SidebarProjectItem = memo(function SidebarProjectItem({
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
      className={`project-item group${active ? " active" : ""}${project.pinned ? " pinned" : ""}${folderMissing ? " folder-missing" : ""}`}
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
          <Tip content={`${project.displayName}\n${project.rootPath}`}>
            <span className="project-name">{project.displayName}</span>
          </Tip>
        )}
        {folderMissing && !renaming && (
          <span className="project-folder-missing">{t("sidebar.folderMissing")}</span>
        )}
        {!renaming && (
          <div
            className="conversation-actions project-actions"
            onClick={(event) => event.stopPropagation()}
          >
            {folderMissing && (
              <Tip content={t("sidebar.locateFolder")}>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t("sidebar.locateFolder")}
                  onClick={onLocate}
                >
                  <FolderSearch size={13} />
                </Button>
              </Tip>
            )}
            <Tip content={t("sidebar.newTask")}>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={t("sidebar.newTask")}
                onClick={onNewTask}
              >
                <Plus size={13} />
              </Button>
            </Tip>
            <Tip content={t("sidebar.permission")}>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={t("sidebar.permission")}
                onClick={onPermission}
              >
                <ShieldCheck size={13} />
              </Button>
            </Tip>
            <Tip content={project.pinned ? t("sidebar.unpin") : t("sidebar.pin")}>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={project.pinned ? t("sidebar.unpin") : t("sidebar.pin")}
                onClick={onTogglePin}
              >
                <Pin size={13} />
              </Button>
            </Tip>
            <Tip content={t("sidebar.rename")}>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={t("sidebar.rename")}
                onClick={() => {
                  setRenaming(true);
                  setValue(project.displayName);
                }}
              >
                <Pencil size={13} />
              </Button>
            </Tip>
            <Tip content={t("sidebar.removeProject")}>
              <Button
                variant="ghost"
                size="icon-xs"
                className="conversation-delete"
                aria-label={t("sidebar.removeProject")}
                onClick={onRemove}
              >
                <Trash2 size={14} />
              </Button>
            </Tip>
          </div>
        )}
      </div>
    </div>
  );
});
