import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { BookOpenText, FileUp, Plus, ShieldCheck, Trash2, X } from "lucide-react";
import { useSkillStore } from "../features/skills/skill-store";
import type { SkillManifest, SkillRiskLevel } from "../core/skills/types";
import { useConfirmationDialog } from "./useConfirmationDialog";

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
  const { requestConfirmation, confirmationDialog } = useConfirmationDialog();
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

  const enabledCount = skills.filter((skill) => enabledSkillIds.has(skill.manifest.id)).length;
  const customCount = skills.filter((skill) => !skill.builtIn).length;

  return (
    <section className="skill-settings settings-designed-page">
      <div className="skill-overview">
        <div className="skill-overview-copy">
          <span className="settings-page-eyebrow">
            {t("settingsDescriptions.optionalCapabilities")}
          </span>
          <h3>{t("skill.library")}</h3>
          <p>{t("settingsDescriptions.skills")}</p>
        </div>
        <div className="skill-overview-stats" aria-label={t("skill.summary")}>
          <div>
            <strong>{skills.length}</strong>
            <span>{t("skill.installed")}</span>
          </div>
          <div>
            <strong>{enabledCount}</strong>
            <span>{t("skill.active")}</span>
          </div>
          <div>
            <strong>{customCount}</strong>
            <span>{t("skill.custom")}</span>
          </div>
        </div>
        <div className="skill-toolbar">
          <input
            ref={fileInputRef}
            type="file"
            accept=".md,.txt"
            className="hidden"
            onChange={(e) => void handleFileChange(e)}
          />
          <button
            type="button"
            className="secondary-button"
            onClick={() => fileInputRef.current?.click()}
          >
            <FileUp size={14} aria-hidden="true" />
            {t("skill.installFromFile")}
          </button>
          <button
            type="button"
            className={showCreate ? "secondary-button" : "primary-button"}
            onClick={() => setShowCreate(!showCreate)}
          >
            {showCreate ? (
              <X size={14} aria-hidden="true" />
            ) : (
              <Plus size={14} aria-hidden="true" />
            )}
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
          <div className="skill-create-heading">
            <div>
              <strong>{t("skill.createTitle")}</strong>
              <span>{t("skill.createDescription")}</span>
            </div>
            <BookOpenText size={17} aria-hidden="true" />
          </div>
          <div className="skill-create-fields">
            <label>
              <span>{t("skill.name")}</span>
              <input
                placeholder={t("skill.namePlaceholder")}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              <span>{t("skill.description")}</span>
              <input
                placeholder={t("skill.descPlaceholder")}
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
              />
            </label>
            <label className="skill-instructions-field">
              <span>{t("skill.instructions")}</span>
              <textarea
                placeholder={t("skill.contentPlaceholder")}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={7}
              />
            </label>
          </div>
          <div className="skill-create-actions">
            <span>{t("skill.localOnly")}</span>
            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={!name.trim() || !content.trim()}
            >
              {t("skill.save")}
            </button>
          </div>
        </div>
      )}

      {skills.length === 0 ? (
        <div className="settings-empty-state">
          <strong>{t("skill.noSkills")}</strong>
          <span>{t("settingsDescriptions.skillsEmpty")}</span>
        </div>
      ) : (
        <>
          <div className="skill-library-heading">
            <div>
              <h4>{t("skill.installedSkills")}</h4>
              <span>{t("skill.installedDescription")}</span>
            </div>
            <ShieldCheck size={16} aria-hidden="true" />
          </div>
          <ul className="skill-list">
            {skills.map((skill) => {
              const isEnabled = enabledSkillIds.has(skill.manifest.id);
              const riskLevel = skill.manifest.riskLevel;
              const isCustom = !skill.builtIn;

              return (
                <li key={skill.manifest.id} className={`skill-item ${isEnabled ? "enabled" : ""}`}>
                  <span className="skill-glyph" aria-hidden="true">
                    {skill.manifest.name.slice(0, 1).toUpperCase()}
                  </span>
                  <div className="skill-item-copy">
                    <div className="skill-item-title">
                      <strong>{skill.manifest.name}</strong>
                      <span className={`skill-risk ${riskLevel}`}>{t(`skill.${riskLevel}`)}</span>
                      <span className="skill-source">
                        {skill.builtIn ? t("skill.builtin") : t("skill.custom")}
                      </span>
                    </div>
                    <p>{skill.manifest.description}</p>
                    <span className="skill-version">
                      v{skill.manifest.version} ·{" "}
                      {t("skill.capabilityCount", { count: skill.manifest.capabilities.length })}
                    </span>
                  </div>
                  <div className="skill-item-actions">
                    {isCustom && (
                      <button
                        type="button"
                        className="skill-delete-button"
                        aria-label={t("skill.uninstall")}
                        title={t("skill.uninstall")}
                        onClick={() =>
                          requestConfirmation(
                            {
                              title: t("confirmation.deleteTitle"),
                              description: t("confirmation.deleteDescription", {
                                item: skill.manifest.name,
                              }),
                              confirmLabel: t("skill.uninstall"),
                            },
                            () => uninstallSkill(skill.manifest.id),
                          )
                        }
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                    <label className="skill-toggle">
                      <input
                        type="checkbox"
                        checked={isEnabled}
                        aria-label={`${skill.manifest.name}: ${isEnabled ? t("skill.enabled") : t("skill.disabled")}`}
                        onChange={() => void toggleSkill(skill.manifest.id)}
                      />
                      <span aria-hidden="true" />
                    </label>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {confirmationDialog}
    </section>
  );
}
