import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { BookOpenText, FileUp, Plus, Search, ShieldCheck, Trash2, X } from "lucide-react";
import { Badge, Button, Input, Switch, Textarea, Tip } from "../components/ui";
import { EmptyState, InlineError, LoadingState } from "../components/feedback";
import {
  SettingsGroup,
  SettingsPage,
  SettingsPageIntro,
  SettingsRow,
  SettingsSection,
} from "../components/settings";
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

  if (loading) return <LoadingState label={t("common.loading")} />;

  const enabledCount = skills.filter((skill) => enabledSkillIds.has(skill.manifest.id)).length;
  const customCount = skills.filter((skill) => !skill.builtIn).length;
  const coreCount = skills.filter((skill) => skill.manifest.tier === "core").length;
  const categories = [...new Set(skills.map((skill) => skill.manifest.category ?? "other"))].sort();
  const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
  const matchesFilters = (skill: (typeof skills)[number]) => {
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
  };
  // Core coding skills surface first; general/office skills remain usable but
  // are explicitly second-tier (Skill Audit 2026-09-04).
  const coreSkills = skills.filter((skill) => skill.manifest.tier === "core");
  const generalSkills = skills.filter((skill) => skill.manifest.tier !== "core");
  const visibleCore = coreSkills.filter(matchesFilters);
  const visibleGeneral = generalSkills.filter(matchesFilters);

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
    <SettingsPage>
      <SettingsPageIntro
        eyebrow={t("settingsDescriptions.optionalCapabilities")}
        description={t("settingsDescriptions.skills")}
        action={
          <div className="flex items-center gap-5" aria-label={t("skill.summary")}>
            <div className="flex flex-col items-center">
              <strong className="text-[15px] font-semibold text-foreground">{coreCount}</strong>
              <span className="text-[10px] text-muted">{t("skill.coreCount")}</span>
            </div>
            <div className="flex flex-col items-center">
              <strong className="text-[15px] font-semibold text-foreground">{skills.length}</strong>
              <span className="text-[10px] text-muted">{t("skill.installed")}</span>
            </div>
            <div className="flex flex-col items-center">
              <strong className="text-[15px] font-semibold text-foreground">{enabledCount}</strong>
              <span className="text-[10px] text-muted">{t("skill.active")}</span>
            </div>
            <div className="flex flex-col items-center">
              <strong className="text-[15px] font-semibold text-foreground">{customCount}</strong>
              <span className="text-[10px] text-muted">{t("skill.custom")}</span>
            </div>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <label className="relative flex min-w-52 flex-1 items-center">
          <Search
            size={14}
            aria-hidden="true"
            className="pointer-events-none absolute left-2.5 text-muted"
          />
          <Input
            className="pl-7.5"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={t("skill.search")}
            aria-label={t("skill.search")}
          />
        </label>
        <select
          className="form-select h-8 rounded-lg border border-border bg-surface px-2.5 text-[12.5px] focus-visible:border-primary focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
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
        <Button variant="secondary" onClick={() => fileInputRef.current?.click()}>
          <FileUp size={14} aria-hidden="true" />
          {t("skill.installFromFile")}
        </Button>
        <Button
          variant={showCreate ? "secondary" : "primary"}
          onClick={() => setShowCreate(!showCreate)}
        >
          {showCreate ? <X size={14} aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />}
          {showCreate ? t("skill.cancel") : t("skill.create")}
        </Button>
      </div>

      {importError && <InlineError message={importError} />}

      {showCreate && (
        <SettingsSection
          title={
            <span className="flex items-center gap-2">
              <BookOpenText size={17} aria-hidden="true" className="text-primary" />
              {t("skill.createTitle")}
            </span>
          }
          description={t("skill.createDescription")}
        >
          <SettingsGroup>
            <SettingsRow
              label={t("skill.name")}
              htmlFor="skill-create-name"
              control={
                <Input
                  id="skill-create-name"
                  className="sm:w-64"
                  placeholder={t("skill.namePlaceholder")}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              }
            />
            <SettingsRow
              label={t("skill.description")}
              htmlFor="skill-create-description"
              control={
                <Input
                  id="skill-create-description"
                  className="sm:w-64"
                  placeholder={t("skill.descPlaceholder")}
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                />
              }
            />
            <SettingsRow
              label={t("skill.category")}
              htmlFor="skill-create-category"
              control={
                <>
                  <Input
                    id="skill-create-category"
                    className="sm:w-64"
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
                </>
              }
            />
          </SettingsGroup>
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="skill-create-instructions"
              className="block text-[12.5px] font-medium text-foreground"
            >
              {t("skill.instructions")}
            </label>
            <Textarea
              id="skill-create-instructions"
              placeholder={t("skill.contentPlaceholder")}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={7}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-[11px] text-muted">{t("skill.localOnly")}</span>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void handleCreate()}
              disabled={!name.trim() || !content.trim()}
            >
              {t("skill.save")}
            </Button>
          </div>
        </SettingsSection>
      )}

      {skills.length === 0 ? (
        <EmptyState
          title={t("skill.noSkills")}
          description={t("settingsDescriptions.skillsEmpty")}
        />
      ) : (
        <>
          <SettingsSection
            title={t("skill.coreSection")}
            description={t("skill.coreSectionDescription")}
            action={<ShieldCheck size={16} aria-hidden="true" className="text-muted" />}
          >
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface-subtle">
              {visibleCore.map((skill) => renderSkillRow(skill))}
              {visibleCore.length === 0 && (
                <li className="flex items-center justify-center px-4 py-6 text-[12px] text-muted">
                  {t("skill.noSearchResults")}
                </li>
              )}
            </ul>
          </SettingsSection>
          <SettingsSection
            title={t("skill.generalSection")}
            description={t("skill.filteredCount", {
              visible: visibleGeneral.length,
              total: generalSkills.length,
            })}
          >
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface-subtle">
              {visibleGeneral.map((skill) => renderSkillRow(skill))}
              {visibleGeneral.length === 0 && (
                <li className="flex items-center justify-center px-4 py-6 text-[12px] text-muted">
                  {t("skill.noSearchResults")}
                </li>
              )}
            </ul>
          </SettingsSection>
        </>
      )}
      {confirmationDialog}
    </SettingsPage>
  );

  function renderSkillRow(skill: (typeof skills)[number]) {
    const isEnabled = enabledSkillIds.has(skill.manifest.id);
    const riskLevel = skill.manifest.riskLevel;
    const isCustom = !skill.builtIn;
    const locale = i18n.resolvedLanguage === "zh-CN" ? "zh-CN" : "en";
    const localization = skill.manifest.localizations?.[locale];
    const displayName = localization?.name ?? skill.manifest.name;
    const displayDescription = localization?.description ?? skill.manifest.description;
    const riskVariant =
      riskLevel === "high" ? "danger" : riskLevel === "medium" ? "warning" : "success";

    return (
      <li key={skill.manifest.id} className="skill-item flex items-start gap-3 px-4 py-3.5">
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-[12px] font-semibold text-muted"
        >
          {displayName.slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <strong className="text-[12.5px] text-foreground">{displayName}</strong>
            <Badge variant={riskVariant}>{t(`skill.${riskLevel}`)}</Badge>
            <Badge variant="secondary">
              {skill.manifest.attribution
                ? t("skill.community")
                : skill.builtIn
                  ? t("skill.builtin")
                  : t("skill.custom")}
            </Badge>
            <Badge variant="secondary">{categoryLabel(skill.manifest.category ?? "other")}</Badge>
            {skill.manifest.platforms?.length === 1 &&
              skill.manifest.platforms[0] === "desktop" && (
                <Badge variant="secondary">{t("skill.desktopOnly")}</Badge>
              )}
          </div>
          <p className="mt-1 text-[11.5px] leading-relaxed text-muted">{displayDescription}</p>
          <span className="mt-1 block text-[10.5px] text-muted">
            v{skill.manifest.version} ·{" "}
            {t("skill.capabilityCount", { count: skill.manifest.capabilities.length })}
          </span>
          {skill.manifest.attribution && (
            <span className="block text-[10.5px] text-muted">
              {skill.manifest.attribution.author} · {skill.manifest.attribution.license}
              {skill.manifest.attribution.adapted ? ` · ${t("skill.adapted")}` : ""}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {isCustom && (
            <Tip content={t("skill.uninstall")}>
              <Button
                variant="ghost-destructive"
                size="icon-xs"
                aria-label={t("skill.uninstall")}
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
              </Button>
            </Tip>
          )}
          <label className="skill-toggle flex cursor-pointer items-center">
            <Switch
              checked={isEnabled}
              onCheckedChange={() => void toggleSkill(skill.manifest.id)}
              aria-label={`${displayName}: ${isEnabled ? t("skill.enabled") : t("skill.disabled")}`}
            />
          </label>
        </div>
      </li>
    );
  }
}
