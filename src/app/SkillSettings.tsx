import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { BookOpenText, FileUp, Plus, Search, ShieldCheck, Trash2, X } from "lucide-react";
import { Button, Switch } from "../components/ui";
import { useSkillStore } from "../features/skills/skill-store";
import type { SkillManifest, SkillRiskLevel } from "../core/skills/types";
import { useConfirmationDialog } from "./useConfirmationDialog";
import {
  BUILTIN_SKILL_CATEGORIES,
  customCategoryLocalizations,
  normalizeCustomCategory,
} from "../core/skills/skill-categories";

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
  const { t, i18n } = useTranslation();
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
  const [category, setCategory] = useState("other");
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void loadSkills().finally(() => setLoading(false));
  }, [loadSkills]);

  const handleCreate = async () => {
    if (!name.trim() || !content.trim()) return;
    await createSkill(name.trim(), desc.trim() || name.trim(), content.trim(), category);
    setName("");
    setDesc("");
    setContent("");
    setCategory("other");
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

      const {
        name: skillName,
        version,
        description,
        riskLevel,
        category: importedCategory,
      } = frontmatter;
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
      const categoryValue = importedCategory || "other";
      const categoryLocalizations = customCategoryLocalizations(categoryValue);

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
        category: normalizeCustomCategory(categoryValue),
        ...(categoryLocalizations ? { categoryLocalizations } : {}),
      };

      await installSkill(manifest, text);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    }
  };

  if (loading) return <p>{t("common.loading")}</p>;

  const enabledCount = skills.filter((skill) => enabledSkillIds.has(skill.manifest.id)).length;
  const customCount = skills.filter((skill) => !skill.builtIn).length;
  const categories = [...new Set(skills.map((skill) => skill.manifest.category ?? "other"))].sort();
  const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
  const visibleSkills = skills.filter((skill) => {
    if (categoryFilter !== "all" && (skill.manifest.category ?? "other") !== categoryFilter) {
      return false;
    }
    if (!normalizedQuery) return true;
    const locale = i18n.resolvedLanguage === "zh-CN" ? "zh-CN" : "en";
    const localization = skill.manifest.localizations?.[locale];
    return [
      localization?.name ?? skill.manifest.name,
      localization?.description ?? skill.manifest.description,
      skill.manifest.id,
    ].some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
  });

  const categoryLabel = (categoryId: string) => {
    const categorySkill = skills.find((skill) => skill.manifest.category === categoryId);
    const localized =
      categorySkill?.manifest.categoryLocalizations?.[
        i18n.resolvedLanguage === "zh-CN" ? "zh-CN" : "en"
      ];
    const key = `skillCategories.${categoryId}`;
    return localized ?? (i18n.exists(key) ? t(key) : categoryId);
  };

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
          <label className="skill-filter-search">
            <Search size={14} aria-hidden="true" />
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={t("skill.search")}
              aria-label={t("skill.search")}
            />
          </label>
          <select
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
            aria-label={t("skill.filterCategory")}
          >
            <option value="all">{t("skill.allCategories")}</option>
            {categories.map((categoryId) => (
              <option key={categoryId} value={categoryId}>
                {categoryLabel(categoryId)}
              </option>
            ))}
          </select>
          <input
            ref={fileInputRef}
            type="file"
            accept=".md,.txt"
            className="hidden"
            onChange={(e) => void handleFileChange(e)}
          />
          <Button
            variant="secondary"
            size="lg"
            className="secondary-button h-auto"
            onClick={() => fileInputRef.current?.click()}
          >
            <FileUp size={14} aria-hidden="true" />
            {t("skill.installFromFile")}
          </Button>
          <Button
            variant={showCreate ? "secondary" : "primary"}
            size="lg"
            className={`h-auto ${showCreate ? "secondary-button" : "primary-button"}`}
            onClick={() => setShowCreate(!showCreate)}
          >
            {showCreate ? (
              <X size={14} aria-hidden="true" />
            ) : (
              <Plus size={14} aria-hidden="true" />
            )}
            {showCreate ? t("skill.cancel") : t("skill.create")}
          </Button>
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
            <label>
              <span>{t("skill.category")}</span>
              <input
                list="skill-category-options"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                placeholder={t("skill.categoryPlaceholder")}
              />
              <datalist id="skill-category-options">
                {BUILTIN_SKILL_CATEGORIES.map((categoryId) => (
                  <option key={categoryId} value={categoryId}>
                    {t(`skillCategories.${categoryId}`)}
                  </option>
                ))}
              </datalist>
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
              <span>
                {t("skill.filteredCount", { visible: visibleSkills.length, total: skills.length })}
              </span>
            </div>
            <ShieldCheck size={16} aria-hidden="true" />
          </div>
          <ul className="skill-list">
            {visibleSkills.map((skill) => {
              const isEnabled = enabledSkillIds.has(skill.manifest.id);
              const riskLevel = skill.manifest.riskLevel;
              const isCustom = !skill.builtIn;
              const locale = i18n.resolvedLanguage === "zh-CN" ? "zh-CN" : "en";
              const localization = skill.manifest.localizations?.[locale];
              const displayName = localization?.name ?? skill.manifest.name;
              const displayDescription = localization?.description ?? skill.manifest.description;

              return (
                <li key={skill.manifest.id} className={`skill-item ${isEnabled ? "enabled" : ""}`}>
                  <span className="skill-glyph" aria-hidden="true">
                    {displayName.slice(0, 1).toUpperCase()}
                  </span>
                  <div className="skill-item-copy">
                    <div className="skill-item-title">
                      <strong>{displayName}</strong>
                      <span className={`skill-risk ${riskLevel}`}>{t(`skill.${riskLevel}`)}</span>
                      <span className="skill-source">
                        {skill.manifest.attribution
                          ? t("skill.community")
                          : skill.builtIn
                            ? t("skill.builtin")
                            : t("skill.custom")}
                      </span>
                      <span className="skill-source">
                        {categoryLabel(skill.manifest.category ?? "other")}
                      </span>
                      {skill.manifest.platforms?.length === 1 &&
                        skill.manifest.platforms[0] === "desktop" && (
                          <span className="skill-source">{t("skill.desktopOnly")}</span>
                        )}
                    </div>
                    <p>{displayDescription}</p>
                    <span className="skill-version">
                      v{skill.manifest.version} ·{" "}
                      {t("skill.capabilityCount", { count: skill.manifest.capabilities.length })}
                    </span>
                    {skill.manifest.attribution && (
                      <span className="skill-version">
                        {skill.manifest.attribution.author} · {skill.manifest.attribution.license}
                        {skill.manifest.attribution.adapted ? ` · ${t("skill.adapted")}` : ""}
                      </span>
                    )}
                  </div>
                  <div className="skill-item-actions">
                    {isCustom && (
                      <button
                        type="button"
                        className="skill-delete-button"
                        aria-label={t("skill.uninstall")}
                        data-tip={t("skill.uninstall")}
                        onClick={() =>
                          requestConfirmation(
                            {
                              title: t("confirmation.deleteTitle"),
                              description: t("confirmation.deleteDescription", {
                                item: displayName,
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
                      <Switch
                        checked={isEnabled}
                        onCheckedChange={() => void toggleSkill(skill.manifest.id)}
                        aria-label={`${displayName}: ${isEnabled ? t("skill.enabled") : t("skill.disabled")}`}
                      />
                    </label>
                  </div>
                </li>
              );
            })}
            {visibleSkills.length === 0 && (
              <li className="settings-empty-state">{t("skill.noSearchResults")}</li>
            )}
          </ul>
        </>
      )}
      {confirmationDialog}
    </section>
  );
}
