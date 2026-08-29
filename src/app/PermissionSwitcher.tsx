import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ShieldCheck } from "lucide-react";
import type { PermissionProfile, ProjectRecord } from "../core/storage/db";
import { useProjectStore } from "../features/projects/project-store";
import { useConfirmationDialog } from "./useConfirmationDialog";

const PROFILES: Array<{ id: PermissionProfile; labelKey: string; hintKey: string }> = [
  { id: "ask", labelKey: "project.permission.ask", hintKey: "project.permission.askHint" },
  {
    id: "workspace",
    labelKey: "project.permission.workspace",
    hintKey: "project.permission.workspaceHint",
  },
  { id: "full", labelKey: "project.permission.full", hintKey: "project.permission.fullHint" },
];

interface PermissionSwitcherProps {
  project: ProjectRecord;
}

/** In-composer permission control for project threads. Same profile semantics
 * as the sidebar permission panel, including the full-access confirmation. */
export function PermissionSwitcher({ project }: PermissionSwitcherProps) {
  const { t } = useTranslation();
  const setPermissionProfile = useProjectStore((state) => state.setPermissionProfile);
  const { requestConfirmation, confirmationDialog } = useConfirmationDialog();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const chooseProfile = (profile: PermissionProfile) => {
    setOpen(false);
    if (profile === project.permissionProfile) return;
    if (profile === "full") {
      requestConfirmation(
        {
          title: t("project.fullAccessTitle"),
          description: t("project.fullAccessDescription"),
          confirmLabel: t("project.fullAccessConfirm"),
          tone: "warning",
        },
        () => void setPermissionProfile(project.id, "full"),
      );
      return;
    }
    void setPermissionProfile(project.id, profile);
  };

  return (
    <div className="permission-switcher" ref={containerRef}>
      <button
        ref={triggerRef}
        type="button"
        className="permission-switcher-button"
        aria-haspopup="listbox"
        aria-label={t("chat.permissionPickerTitle")}
        aria-expanded={open}
        data-tip={t("chat.permissionPickerTitle")}
        onClick={() => setOpen((value) => !value)}
      >
        <ShieldCheck size={13} aria-hidden="true" />
        <span>{t(`project.permission.${project.permissionProfile}`)}</span>
        <ChevronDown size={11} className={`model-switcher-chevron${open ? " open" : ""}`} />
      </button>
      {open && (
        <div
          className="model-switcher-dropdown permission-switcher-dropdown"
          role="listbox"
          aria-label={t("chat.permissionPickerTitle")}
        >
          {PROFILES.map((profile) => {
            const selected = profile.id === project.permissionProfile;
            return (
              <button
                key={profile.id}
                type="button"
                role="option"
                aria-selected={selected}
                className={`model-switcher-item${selected ? " active" : ""}`}
                onClick={() => chooseProfile(profile.id)}
              >
                <span className="permission-switcher-copy">
                  <span className="model-switcher-item-name">{t(profile.labelKey)}</span>
                  <span className="permission-switcher-hint">{t(profile.hintKey)}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
      {confirmationDialog}
    </div>
  );
}
