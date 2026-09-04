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
 * explicitly chooses how much Evir may do in this project — Workspace access
 * (recommended) or Ask every time. The choice is remembered per project;
 * dismissing the card keeps the safe ask default and counts as a choice.
 */
export function PermissionOnboardingCard({ project }: { project: ProjectRecord }) {
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
    void (async () => {
      await setPermissionProfile(project.id, profile);
      await markOnboarded(project.id, await loadOnboardedProjectIds());
      setVisible(false);
    })();
  };

  return (
    <section
      className="permission-onboarding mx-auto mb-4 w-full max-w-[560px] rounded-xl border border-border bg-surface-subtle p-4"
      aria-label={t("permission.onboardingTitle")}
    >
      <header className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <ShieldCheck size={16} aria-hidden="true" className="text-primary" />
          <h2 className="m-0 text-[13px] font-semibold text-foreground">
            {t("permission.onboardingTitle")}
          </h2>
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={t("permission.onboardingDismiss")}
          onClick={() => settle("ask")}
        >
          <X size={13} />
        </Button>
      </header>
      <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
        {t("permission.onboardingDescription")}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="primary" size="sm" onClick={() => settle("workspace")}>
          {t("permission.onboardingWorkspace")}
          <span className="ml-1 font-normal opacity-80">
            {t("permission.onboardingRecommended")}
          </span>
        </Button>
        <Button variant="secondary" size="sm" onClick={() => settle("ask")}>
          {t("permission.onboardingAsk")}
        </Button>
      </div>
    </section>
  );
}
