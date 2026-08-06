import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSkillStore } from "../features/skills/skill-store";
import type { SkillManifest, SkillRiskLevel } from "../core/skills/types";

const VALID_RISK_LEVELS: SkillRiskLevel[] = ["low", "medium", "high"];

function parseFrontmatter(text: string): Record<string, string> | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const body = match?.[1];
  if (body === undefined) return null;
  const fields: Record<string, string> = {};
  for (const line of body.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line
      .slice(idx + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    if (key) fields[key] = value;
  }
  return fields;
}

export function SkillSettings() {
  const { t } = useTranslation();
  const skills = useSkillStore((s) => s.skills);
  const enabledSkillIds = useSkillStore((s) => s.enabledSkillIds);
  const loadSkills = useSkillStore((s) => s.loadSkills);
  const toggleSkill = useSkillStore((s) => s.toggleSkill);
  const createSkill = useSkillStore((s) => s.createSkill);
  const installSkill = useSkillStore((s) => s.installSkill);
  const uninstallSkill = useSkillStore((s) => s.uninstallSkill);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [content, setContent] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setImportError(null);
    try {
      const text = await file.text();
      const frontmatter = parseFrontmatter(text);
      if (!frontmatter) {
        throw new Error(t("skill.missingFrontmatter"));
      }

      const { name: skillName, version, description, riskLevel } = frontmatter;
      if (!skillName || !version || !description || !riskLevel) {
        throw new Error(t("skill.missingFrontmatterFields"));
      }
      if (!VALID_RISK_LEVELS.includes(riskLevel as SkillRiskLevel)) {
        throw new Error(t("skill.invalidRiskLevel", { riskLevel }));
      }

      const id = skillName
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");

      const manifest: SkillManifest = {
        schemaVersion: 1,
        id,
        name: skillName,
        version,
        description,
        entry: "SKILL.md",
        source: "imported",
        capabilities: [],
        optionalCapabilities: [],
        optionalMcpServers: [],
        riskLevel: riskLevel as SkillRiskLevel,
      };

      await installSkill(manifest, text);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    }
  };

  if (loading) return <p>{t("common.loading")}</p>;

  return (
    <section className="skill-settings settings-designed-page">
      <div className="settings-page-intro compact">
        <div>
          <span className="settings-page-eyebrow">
            {t("settingsDescriptions.optionalCapabilities")}
          </span>
          <p>{t("settingsDescriptions.skills")}</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".md,.txt"
            className="hidden"
            onChange={(e) => void handleFileChange(e)}
          />
          <button
            type="button"
            className="px-3 py-1 border border-border rounded-lg bg-surface hover:border-primary hover:text-primary cursor-pointer text-sm transition"
            onClick={() => fileInputRef.current?.click()}
          >
            {t("skill.installFromFile")}
          </button>
          <button
            type="button"
            className="px-3 py-1 border border-border rounded-lg bg-surface hover:border-primary hover:text-primary cursor-pointer text-sm transition"
            onClick={() => setShowCreate(!showCreate)}
          >
            {showCreate ? t("skill.cancel") : t("skill.create")}
          </button>
        </div>
      </div>

      {importError && (
        <p className="m-0 p-2 text-sm text-danger bg-danger/8 border border-danger/20 rounded-lg">
          {importError}
        </p>
      )}

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
        <div className="settings-empty-state">
          <strong>{t("skill.noSkills")}</strong>
          <span>{t("settingsDescriptions.skillsEmpty")}</span>
        </div>
      ) : (
        <ul className="skill-list">
          {skills.map((skill) => {
            const isEnabled = enabledSkillIds.has(skill.manifest.id);
            const riskLevel = skill.manifest.riskLevel;
            const isCustom = !skill.builtIn;

            return (
              <li key={skill.manifest.id} className="skill-item">
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
                        className="px-2 py-0.5 border border-border rounded-lg bg-transparent hover:border-danger hover:text-danger cursor-pointer text-xs transition"
                        onClick={() => void uninstallSkill(skill.manifest.id)}
                      >
                        {t("skill.uninstall")}
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
