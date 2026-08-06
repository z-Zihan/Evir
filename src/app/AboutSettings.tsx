import { useTranslation } from "react-i18next";
import { ExternalLink, Github, ShieldCheck } from "lucide-react";
import packageJson from "../../package.json";

export function AboutSettings() {
  const { t } = useTranslation();
  return (
    <section className="about-designed-page">
      <span className="sr-only">{t("about.title")}</span>
      <div className="about-product-lockup">
        <div className="about-product-mark">E</div>
        <div>
          <span>{t("about.productType")}</span>
          <h3>Evir</h3>
          <p>{t("about.description")}</p>
        </div>
      </div>
      <div className="about-detail-grid">
        <div>
          <span>{t("about.version")}</span>
          <strong>{packageJson.version}</strong>
        </div>
        <div>
          <span>{t("about.license")}</span>
          <strong>
            <ShieldCheck size={14} />
            {t("about.mit")}
          </strong>
        </div>
      </div>
      <a
        className="about-link-card"
        href="https://github.com/z-Zihan/Evir"
        target="_blank"
        rel="noopener noreferrer"
      >
        <Github size={17} />
        <span>
          <strong>{t("about.github")}</strong>
          <small>github.com/z-Zihan/Evir</small>
        </span>
        <ExternalLink size={14} />
      </a>
    </section>
  );
}
