import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ShieldCheck, X } from "lucide-react";
import { Button } from "../../components/ui";
import { useProjectStore } from "../../features/projects/project-store";
import { getStructuredStorage } from "../../runtime/structured-storage";
import type { ProjectRecord } from "../../core/storage/db";

const ONBOARDING_SETTING_NAME = "permission_onboarding_done";

async function loadOnboardedProjectIds(): Promise<Set<string>> {
  const record = await getStructuredStorage()
    .read<{ name: string; value: unknown }>("settings", ONBOARDING_SETTING_NAME)
    .catch(() => null);
  const value = record?.value;
  return Array.isArray(value) && value.every((entry) => typeof entry === "string")
    ? new Set(value)
    : new Set<string>();
}

async function markOnboarded(projectId: string, done: Set<string>): Promise<void> {
  const next = new Set(done);
  next.add(projectId);
  await getStructuredStorage()
    .write("settings", ONBOARDING_SETTING_NAME, {
      name: ONBOARDING_SETTING_NAME,
      value: [...next],
    })
    .catch(() => undefined);
}

/**
 * §37 permission onboarding: the FIRST time a project thread opens, the user
 * explicitly chooses how much Evir may do in this project. Rendered as a
 * lightweight banner above the composer — never inside the message list, so
 * it cannot compete with plan confirmations, goal checklists, approvals, or
 * tool results for the main visual.
 *
 * Only an explicit choice (Workspace access / Ask every time) writes the
 * permission profile and marks onboarding done. Dismissing with X merely
 * postpones: nothing is written, and the banner returns on the next visit.
 */
export function PermissionOnboardingBanner({ project }: { project: ProjectRecord }) {
  const { t } = useTranslation();
  const setPermissionProfile = useProjectStore((state) => state.setPermissionProfile);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadOnboardedProjectIds().then((done) => {
      if (!cancelled) setVisible(!done.has(project.id));
    });
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  if (!visible) return null;

  const settle = (profile: "workspace" | "ask") => {
    setVisible(false);
    void (async () => {
      await setPermissionProfile(project.id, profile);
      await markOnboarded(project.id, await loadOnboardedProjectIds());
    })();
  };

  return (
    <section
      className="permission-onboarding mx-auto mb-2 flex w-full min-w-0 max-w-[760px] flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border bg-surface-subtle px-3 py-2"
      aria-label={t("permission.onboardingTitle")}
    >
      <ShieldCheck size={15} aria-hidden="true" className="shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <h2 className="m-0 text-[12.5px] font-semibold text-foreground">
          {t("permission.onboardingTitle")}
        </h2>
        <p className="m-0 truncate text-[11.5px] text-muted">
          {t("permission.onboardingDescription")}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Button variant="primary" size="sm" onClick={() => settle("workspace")}>
          {t("permission.onboardingWorkspace")}
          <span className="ml-1 font-normal opacity-80">
            {t("permission.onboardingRecommended")}
          </span>
        </Button>
        <Button variant="secondary" size="sm" onClick={() => settle("ask")}>
          {t("permission.onboardingAsk")}
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={t("permission.onboardingDismiss")}
          onClick={() => setVisible(false)}
        >
          <X size={13} />
        </Button>
      </div>
    </section>
  );
}
