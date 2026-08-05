import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSkillStore } from "../features/skills/skill-store";

export function SkillSettings() {
  const { t } = useTranslation();
  const skills = useSkillStore((s) => s.skills);
  const enabledSkillIds = useSkillStore((s) => s.enabledSkillIds);
  const loadSkills = useSkillStore((s) => s.loadSkills);
  const toggleSkill = useSkillStore((s) => s.toggleSkill);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void loadSkills().finally(() => setLoading(false));
  }, [loadSkills]);

  if (loading) return <p>{t("common.loading")}</p>;

  return (
    <section className="skill-settings">
      <h3>{t("skill.title")}</h3>
      {skills.length === 0 ? (
        <p className="empty-list">{t("skill.noSkills")}</p>
      ) : (
        <ul className="skill-list">
          {skills.map((skill) => {
            const isEnabled = enabledSkillIds.has(skill.manifest.id);
            const riskLevel = skill.manifest.riskLevel;

            return (
              <li key={skill.manifest.id} className="skill-item">
                <div className="skill-item-header">
                  <span className="skill-item-name">{skill.manifest.name}</span>
                  <span className={`skill-risk-badge ${riskLevel}`}>{t(`skill.${riskLevel}`)}</span>
                </div>
                <p className="skill-item-description">{skill.manifest.description}</p>
                <div className="skill-item-footer">
                  <span className="skill-source">
                    {skill.builtIn ? t("skill.builtin") : skill.manifest.source}
                  </span>
                  <label className="skill-toggle">
                    <input
                      type="checkbox"
                      checked={isEnabled}
                      onChange={() => void toggleSkill(skill.manifest.id)}
                    />
                    <span>{isEnabled ? t("skill.enabled") : t("skill.disabled")}</span>
                  </label>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
