import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ShieldCheck } from "lucide-react";
import type { PermissionProfile, ProjectRecord } from "../core/storage/db";
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui";
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
 * as the sidebar permission panel, including the full-access confirmation.
 * Outside click, Escape, and focus return are Base UI popover behavior. */
export function PermissionSwitcher({ project }: PermissionSwitcherProps) {
  const { t } = useTranslation();
  const setPermissionProfile = useProjectStore((state) => state.setPermissionProfile);
  const { requestConfirmation, confirmationDialog } = useConfirmationDialog();
  const [open, setOpen] = useState(false);

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
    <div className="permission-switcher">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <button
              type="button"
              className="permission-switcher-button"
              aria-label={t("chat.permissionPickerTitle")}
              data-tip={t("chat.permissionPickerTitle")}
            />
          }
        >
          <ShieldCheck size={13} aria-hidden="true" />
          <span>{t(`project.permission.${project.permissionProfile}`)}</span>
          <ChevronDown size={11} className={`model-switcher-chevron${open ? " open" : ""}`} />
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="end"
          sideOffset={8}
          className="rounded-none border-0 bg-transparent p-0 shadow-none!"
        >
          {/* Base UI popups render in a portal and hard-wire role="dialog" on
              their own popup, so the listbox stays on this inner element to
              keep option ownership intact. position:static neutralizes the
              legacy absolute-position offsets in .model-switcher-dropdown —
              placement now comes from the popover positioner. */}
          <div
            className="model-switcher-dropdown permission-switcher-dropdown"
            role="listbox"
            aria-label={t("chat.permissionPickerTitle")}
            style={{ position: "static" }}
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
        </PopoverContent>
      </Popover>
      {confirmationDialog}
    </div>
  );
}
