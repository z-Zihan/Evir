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
import { Button, Input, Tip } from "../components/ui";
import { cn } from "../components/ui/utils";
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
      className={cn(
        "project-item group",
        active && "active",
        project.pinned && "pinned",
        folderMissing && "folder-missing",
      )}
    >
      <div
        className="project-row flex min-w-0 cursor-pointer items-center gap-1 rounded-lg py-[5px] pr-1 pl-1 text-[12.5px] font-medium transition-colors select-none hover:bg-surface-hover/70"
        onClick={onSelect}
        onDoubleClick={() => {
          setRenaming(true);
          setValue(project.displayName);
        }}
      >
        <button
          className="project-chevron grid size-5 shrink-0 cursor-pointer place-items-center rounded-md text-muted transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
          type="button"
          aria-label={expanded ? t("sidebar.collapseProject") : t("sidebar.expandProject")}
          aria-expanded={expanded}
          onClick={(event) => {
            event.stopPropagation();
            onToggleExpand();
          }}
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        {project.pinned ? (
          <Pin size={11} className="pin-indicator shrink-0 text-primary/70" aria-hidden="true" />
        ) : null}
        {renaming ? (
          <Input
            className="rename-input mx-0.5 h-6 px-1.5 text-[12px]"
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
            <span
              className={cn(
                "project-name min-w-0 flex-1 truncate text-foreground",
                active && "font-semibold",
              )}
            >
              {project.displayName}
            </span>
          </Tip>
        )}
        {folderMissing && !renaming && (
          <span className="project-folder-missing shrink-0 rounded-full bg-warning/12 px-1.5 py-px text-[10px] font-medium text-warning">
            {t("sidebar.folderMissing")}
          </span>
        )}
        {!renaming && (
          <div
            className="conversation-actions project-actions flex shrink-0 items-center gap-0.5 opacity-0 pointer-events-none transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100"
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
                  <FolderSearch size={12} />
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
                <Plus size={12} />
              </Button>
            </Tip>
            <Tip content={t("sidebar.permission")}>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={t("sidebar.permission")}
                onClick={onPermission}
              >
                <ShieldCheck size={12} />
              </Button>
            </Tip>
            <Tip content={project.pinned ? t("sidebar.unpin") : t("sidebar.pin")}>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={project.pinned ? t("sidebar.unpin") : t("sidebar.pin")}
                onClick={onTogglePin}
              >
                <Pin size={12} />
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
                <Pencil size={12} />
              </Button>
            </Tip>
            <Tip content={t("sidebar.removeProject")}>
              <Button
                variant="ghost"
                size="icon-xs"
                className="conversation-delete hover:text-danger"
                aria-label={t("sidebar.removeProject")}
                onClick={onRemove}
              >
                <Trash2 size={13} />
              </Button>
            </Tip>
          </div>
        )}
      </div>
    </div>
  );
});
