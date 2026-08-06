import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSkillStore } from "../features/skills/skill-store";

export function SkillSettings() {
  const { t } = useTranslation();
  const skills = useSkillStore((s) => s.skills);
  const enabledSkillIds = useSkillStore((s) => s.enabledSkillIds);
  const loadSkills = useSkillStore((s) => s.loadSkills);
  const toggleSkill = useSkillStore((s) => s.toggleSkill);
  const createSkill = useSkillStore((s) => s.createSkill);
  const deleteSkill = useSkillStore((s) => s.deleteSkill);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [content, setContent] = useState("");

  useEffect(() => {
    void loadSkills().finally(() => setLoading(false));
  }, [loadSkills]);

  const handleCreate = async () => {
    if (!name.trim() || !content.trim()) return;
    await createSkill(name.trim(), desc.trim() || name.trim(), content.trim());
    setName("");
    setDesc("");
    setContent("");
    setShowCreate(false);
  };

  if (loading) return <p>{t("common.loading")}</p>;

  return (
    <section className="skill-settings">
      <div className="skill-header-row">
        <h3>{t("skill.title")}</h3>
        <button
          type="button"
          className="skill-create-btn"
          onClick={() => setShowCreate(!showCreate)}
        >
          {showCreate ? t("skill.cancel") : t("skill.create")}
        </button>
      </div>

      {showCreate && (
        <div className="skill-create-form">
          <input
            placeholder={t("skill.namePlaceholder")}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            placeholder={t("skill.descPlaceholder")}
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
          />
          <textarea
            placeholder={t("skill.contentPlaceholder")}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={6}
          />
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={!name.trim() || !content.trim()}
          >
            {t("skill.save")}
          </button>
        </div>
      )}

      {skills.length === 0 ? (
        <p className="empty-list">{t("skill.noSkills")}</p>
      ) : (
        <ul className="skill-list">
          {skills.map((skill) => {
            const isEnabled = enabledSkillIds.has(skill.manifest.id);
            const riskLevel = skill.manifest.riskLevel;
            const isCustom = !skill.builtIn;

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
                  <div className="skill-item-actions">
                    {isCustom && (
                      <button
                        type="button"
                        className="skill-delete-btn"
                        onClick={() => void deleteSkill(skill.manifest.id)}
                      >
                        🗑️
                      </button>
                    )}
                    <label className="skill-toggle">
                      <input
                        type="checkbox"
                        checked={isEnabled}
                        onChange={() => void toggleSkill(skill.manifest.id)}
                      />
                      <span>{isEnabled ? t("skill.enabled") : t("skill.disabled")}</span>
                    </label>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
