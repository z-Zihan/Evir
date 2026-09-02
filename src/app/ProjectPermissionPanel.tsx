import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useOverlayBrowserGuard } from "./workspace/use-overlay-browser-guard";
import { FolderPlus, ShieldCheck, X } from "lucide-react";
import { Button, Dialog, DialogContent, DialogTitle } from "../components/ui";
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
  const [status, setStatus] = useState<string | null>(null);
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
    setStatus(ok ? t("project.accessRootAdded") : t("project.accessRootInvalid"));
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
          {PROFILES.map(({ id, labelKey, hintKey }) => (
            <label
              key={id}
              className={`project-permission-option${project.permissionProfile === id ? " selected" : ""}`}
            >
              <input
                type="radio"
                name={`permission-${project.id}`}
                checked={project.permissionProfile === id}
                onChange={() => chooseProfile(id)}
              />
              <span className="project-permission-copy">
                <strong>{t(labelKey)}</strong>
                <small>{t(hintKey)}</small>
              </span>
            </label>
          ))}

          <div className="project-access-roots">
            <div className="project-access-roots-header">
              <strong>{t("project.accessRoots")}</strong>
              <Button variant="secondary" size="lg" onClick={() => void addRoot()}>
                <FolderPlus size={13} aria-hidden="true" />
                {t("project.addAccessRoot")}
              </Button>
            </div>
            <p className="project-access-roots-hint">{t("project.accessRootsHint")}</p>
            {project.additionalAccessRoots.length === 0 ? (
              <p className="text-xs text-muted">{t("project.noAccessRoots")}</p>
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
            {status && (
              <p className="text-xs text-muted" role="status">
                {status}
              </p>
            )}
          </div>
        </div>
        {confirmationDialog}
      </DialogContent>
    </Dialog>
  );
}
