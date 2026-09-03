import { useTranslation } from "react-i18next";
import { ExternalLink, Github, ShieldCheck } from "lucide-react";
import packageJson from "../../package.json";
import { SettingsGroup, SettingsPage, SettingsRow } from "../components/settings";

export function AboutSettings() {
  const { t } = useTranslation();
  return (
    <SettingsPage className="gap-3.5">
      <span className="sr-only">{t("about.title")}</span>
      <div className="flex items-center gap-[18px] rounded-[10px] border border-border bg-[color-mix(in_srgb,var(--background)_32%,var(--surface))] p-[22px] max-sm:items-start">
        <div className="grid size-[54px] flex-none place-items-center overflow-hidden rounded-[13px] shadow-[0_5px_16px_color-mix(in_srgb,black_13%,transparent)]">
          <img src="/evir-mark.svg" alt="" className="block size-full" />
        </div>
        <div className="min-w-0">
          <span className="block text-[9px] font-bold tracking-[0.09em] text-primary uppercase">
            {t("about.productType")}
          </span>
          <h3 className="m-0 mt-1 text-[22px] tracking-[-0.04em]">Evir</h3>
          <p className="m-0 mt-[5px] text-[11px] text-muted">{t("about.description")}</p>
        </div>
      </div>
      <SettingsGroup>
        <SettingsRow
          label={t("about.version")}
          control={<strong className="text-[11px]">{packageJson.version}</strong>}
        />
        <SettingsRow
          label={t("about.license")}
          control={
            <strong className="flex items-center gap-[5px] text-[11px]">
              <ShieldCheck size={14} />
              {t("about.notDeclared")}
            </strong>
          }
        />
      </SettingsGroup>
      <a
        className="grid min-h-[58px] grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-[9px] border border-border px-[13px] text-foreground no-underline transition-colors hover:border-border-strong hover:bg-surface-hover"
        href="https://github.com/z-Zihan/Evir"
        target="_blank"
        rel="noopener noreferrer"
      >
        <Github size={17} />
        <span className="min-w-0">
          <strong className="block text-[11px]">{t("about.github")}</strong>
          <small className="mt-[3px] block text-[9.5px] text-muted">github.com/z-Zihan/Evir</small>
        </span>
        <ExternalLink size={14} />
      </a>
    </SettingsPage>
  );
}
