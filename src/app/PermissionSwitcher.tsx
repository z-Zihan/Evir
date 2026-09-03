import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ShieldCheck } from "lucide-react";
import type { PermissionProfile, ProjectRecord } from "../core/storage/db";
import { Popover, PopoverContent, PopoverTrigger, Tip } from "../components/ui";
import { cn } from "../components/ui/utils";
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
        {/* Tip wraps the popover trigger (Base UI trigger-in-trigger
            composition) so the tooltip opens on the same button. */}
        <Tip content={t("chat.permissionPickerTitle")}>
          <PopoverTrigger
            render={
              <button
                type="button"
                className="permission-switcher-button inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 text-[11.5px] transition-colors select-none hover:border-border-strong focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
                aria-label={t("chat.permissionPickerTitle")}
              />
            }
          >
            <ShieldCheck size={12} aria-hidden="true" className="text-muted" />
            <span>{t(`project.permission.${project.permissionProfile}`)}</span>
            <ChevronDown
              size={11}
              className={cn("text-muted transition-transform", open && "rotate-180")}
            />
          </PopoverTrigger>
        </Tip>
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
            className="permission-switcher-dropdown w-64 rounded-xl border border-border bg-surface-elevated py-1 shadow-popover"
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
                  className={cn(
                    "flex w-full cursor-pointer flex-col gap-px px-3 py-1.5 text-left transition-colors select-none hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:outline-none",
                    selected && "bg-primary/[0.06]",
                  )}
                  onClick={() => chooseProfile(profile.id)}
                >
                  <span className="permission-switcher-copy flex flex-col">
                    <span className={cn("text-[12px] font-medium", selected && "text-primary")}>
                      {t(profile.labelKey)}
                    </span>
                    <span className="permission-switcher-hint text-[10.5px] text-muted">
                      {t(profile.hintKey)}
                    </span>
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
