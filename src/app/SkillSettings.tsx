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
    <section className="flex flex-col gap-3">
      <div className="flex justify-between items-center mb-3">
        <h3>{t("skill.title")}</h3>
        <button
          type="button"
          className="px-3 py-1 border border-border rounded-lg bg-surface hover:border-primary hover:text-primary cursor-pointer text-sm transition"
          onClick={() => setShowCreate(!showCreate)}
        >
          {showCreate ? t("skill.cancel") : t("skill.create")}
        </button>
      </div>

      {showCreate && (
        <div className="flex flex-col gap-2 mb-4 p-3 border border-border rounded-lg bg-surface">
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
        <p className="text-muted text-sm px-2 py-4 text-center">{t("skill.noSkills")}</p>
      ) : (
        <ul className="list-none p-0 m-0 flex flex-col gap-2">
          {skills.map((skill) => {
            const isEnabled = enabledSkillIds.has(skill.manifest.id);
            const riskLevel = skill.manifest.riskLevel;
            const isCustom = !skill.builtIn;

            return (
              <li
                key={skill.manifest.id}
                className="p-3 border border-border rounded-lg bg-surface"
              >
                <div className="flex justify-between items-center mb-1">
                  <span className="text-sm font-semibold">{skill.manifest.name}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${riskLevel}`}>
                    {t(`skill.${riskLevel}`)}
                  </span>
                </div>
                <p className="m-0 mb-2 text-sm text-muted">{skill.manifest.description}</p>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-muted">
                    {skill.builtIn ? t("skill.builtin") : skill.manifest.source}
                  </span>
                  <div className="flex items-center gap-2">
                    {isCustom && (
                      <button
                        type="button"
                        className="bg-transparent border-0 cursor-pointer text-base p-0.5"
                        onClick={() => void deleteSkill(skill.manifest.id)}
                      >
                        🗑️
                      </button>
                    )}
                    <label className="flex items-center gap-1 text-sm cursor-pointer">
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
