import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useOverlayBrowserGuard } from "./workspace/use-overlay-browser-guard";
import { FolderPlus, ShieldCheck, X } from "lucide-react";
import { Button, Dialog, DialogContent, DialogTitle } from "../components/ui";
import { SettingsDescription, SettingsOptionCard, SettingsSection } from "../components/settings";
import { InlineError, notify } from "../components/feedback";
import type { PermissionProfile, ProjectRecord } from "../core/storage/db";
import { useProjectStore } from "../features/projects/project-store";
import { getRuntime } from "../runtime/use-runtime";
import { useConfirmationDialog } from "./useConfirmationDialog";

interface ProjectPermissionPanelProps {
  project: ProjectRecord;
  onClose: () => void;
}

const PROFILES: Array<{ id: PermissionProfile; labelKey: string; hintKey: string }> = [
  {
    id: "ask",
    labelKey: "project.permission.ask",
    hintKey: "project.permission.askHint",
  },
  {
    id: "workspace",
    labelKey: "project.permission.workspace",
    hintKey: "project.permission.workspaceHint",
  },
  {
    id: "full",
    labelKey: "project.permission.full",
    hintKey: "project.permission.fullHint",
  },
];

export function ProjectPermissionPanel({ project, onClose }: ProjectPermissionPanelProps) {
  const { t } = useTranslation();
  useOverlayBrowserGuard("project-permission", true);
  const { requestConfirmation, confirmationDialog } = useConfirmationDialog();
  const setPermissionProfile = useProjectStore((state) => state.setPermissionProfile);
  const addAccessRoot = useProjectStore((state) => state.addAccessRoot);
  const removeAccessRoot = useProjectStore((state) => state.removeAccessRoot);
  const [accessRootError, setAccessRootError] = useState<string | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const chooseProfile = (profile: PermissionProfile) => {
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

  const addRoot = async () => {
    const runtime = getRuntime();
    const selected = await runtime.selectWorkspaceDirectory?.();
    if (!selected) return;
    const ok = await addAccessRoot(project.id, selected);
    if (ok) {
      notify.success(t("project.accessRootAdded"));
    } else {
      setAccessRootError(t("project.accessRootInvalid"));
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent
        className="project-permission-panel max-w-none p-0"
        showCloseButton={false}
        initialFocus={closeButtonRef}
      >
        <header className="project-permission-header">
          <div>
            <ShieldCheck size={15} aria-hidden="true" />
            <DialogTitle render={<h3 />}>
              {t("project.permissionTitle", { name: project.displayName })}
            </DialogTitle>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="settings-close"
            onClick={onClose}
            aria-label={t("settings.close")}
          >
            <X size={15} />
          </button>
        </header>
        <div className="project-permission-body">
          <div className="flex flex-col gap-2">
            {PROFILES.map(({ id, labelKey, hintKey }) => (
              <SettingsOptionCard
                key={id}
                title={t(labelKey)}
                description={t(hintKey)}
                selected={project.permissionProfile === id}
                onClick={() => chooseProfile(id)}
              />
            ))}
          </div>

          <SettingsSection
            title={t("project.accessRoots")}
            description={t("project.accessRootsHint")}
            action={
              <Button variant="secondary" size="lg" onClick={() => void addRoot()}>
                <FolderPlus size={13} aria-hidden="true" />
                {t("project.addAccessRoot")}
              </Button>
            }
          >
            {project.additionalAccessRoots.length === 0 ? (
              <SettingsDescription>{t("project.noAccessRoots")}</SettingsDescription>
            ) : (
              <ul className="project-access-root-list">
                {project.additionalAccessRoots.map((root) => (
                  <li key={root}>
                    <code>{root}</code>
                    <button
                      type="button"
                      aria-label={t("project.removeAccessRoot")}
                      onClick={() => void removeAccessRoot(project.id, root)}
                    >
                      <X size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {accessRootError && <InlineError message={accessRootError} />}
          </SettingsSection>
        </div>
        {confirmationDialog}
      </DialogContent>
    </Dialog>
  );
}
