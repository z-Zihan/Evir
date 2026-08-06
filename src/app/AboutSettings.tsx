import { useTranslation } from "react-i18next";

import packageJson from "../../package.json";

const EVIR_VERSION = packageJson.version;

export function AboutSettings() {
  const { t } = useTranslation();
  return (
    <section className="text-center p-6 px-4 flex flex-col gap-3">
      <h3>{t("about.title")}</h3>
      <div className="text-2xl font-extrabold tracking-tight mb-2">
        <div className="grid place-items-center w-7 h-7 rounded-lg bg-primary text-primary-fg font-bold text-sm large">
          E
        </div>
        <strong>Evir</strong>
      </div>
      <p className="about-description">{t("about.description")}</p>
      <dl className="about-info">
        <dt>{t("about.version")}</dt>
        <dd>{EVIR_VERSION}</dd>
        <dt>{t("about.license")}</dt>
        <dd>{t("about.mit")}</dd>
        <dt>{t("about.github")}</dt>
        <dd>
          <a href="https://github.com/z-Zihan/Evir" target="_blank" rel="noopener noreferrer">
            github.com/z-Zihan/Evir
          </a>
        </dd>
      </dl>
    </section>
  );
}
