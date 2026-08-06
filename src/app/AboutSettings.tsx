import { useTranslation } from "react-i18next";

import packageJson from "../../package.json";

const EVIR_VERSION = packageJson.version;

export function AboutSettings() {
  const { t } = useTranslation();
  return (
    <section className="about-settings">
      <h3>{t("about.title")}</h3>
      <div className="about-logo">
        <div className="brand-mark large">E</div>
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
