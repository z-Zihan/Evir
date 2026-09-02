import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Search, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "../components/ui";
import type { InteractionMode } from "../core/providers/tool-registry";
import type { InstalledSkill } from "../core/skills/types";
import { useChatStore } from "../features/chat/chat-store";
import { useSkillStore } from "../features/skills/skill-store";

interface SkillPickerProps {
  mode: InteractionMode;
  disabled: boolean;
}

function localizedSkill(skill: InstalledSkill, language: string) {
  const locale = language === "zh-CN" ? "zh-CN" : "en";
  const localization = skill.manifest.localizations?.[locale];
  return {
    name: localization?.name ?? skill.manifest.name,
    description: localization?.description ?? skill.manifest.description,
  };
}

export function SkillPicker({ mode, disabled }: SkillPickerProps) {
  const { t, i18n } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const skills = useSkillStore((state) => state.skills);
  const loadSkills = useSkillStore((state) => state.loadSkills);
  const selectedSkillIds = useChatStore((state) => state.selectedSkillIds);
  const toggleSelectedSkill = useChatStore((state) => state.toggleSelectedSkill);

  useEffect(() => {
    void loadSkills();
  }, [loadSkills]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", closeWithEscape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", closeWithEscape);
    };
  }, [open]);

  const grouped = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const filtered = skills.filter((skill) => {
      if (!normalizedQuery) return true;
      const localized = localizedSkill(skill, i18n.resolvedLanguage ?? "en");
      return [localized.name, localized.description, skill.manifest.id, skill.manifest.category]
        .filter(Boolean)
        .some((value) => value!.toLocaleLowerCase().includes(normalizedQuery));
    });
    const groups = new Map<string, InstalledSkill[]>();
    for (const skill of filtered) {
      const category = skill.manifest.category ?? "other";
      groups.set(category, [...(groups.get(category) ?? []), skill]);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [i18n.resolvedLanguage, query, skills]);

  const categoryLabel = (category: string, entries: InstalledSkill[]) => {
    const customLabel = entries
      .map((skill) =>
        i18n.resolvedLanguage === "zh-CN"
          ? skill.manifest.categoryLocalizations?.["zh-CN"]
          : skill.manifest.categoryLocalizations?.en,
      )
      .find(Boolean);
    const key = `skillCategories.${category}`;
    return customLabel ?? (i18n.exists(key) ? t(key) : category);
  };

  return (
    <div className="composer-skill-picker" ref={rootRef}>
      <Button
        ref={triggerRef}
        type="button"
        variant="ghost"
        className={`composer-tool-button size-[30px] rounded-[7px] font-normal${selectedSkillIds.size > 0 ? " active" : ""}`}
        onClick={() => setOpen((value) => !value)}
        disabled={disabled}
        aria-label={t("skill.chooseForMessage")}
        data-tip={t("skill.chooseForMessage")}
        aria-expanded={open}
      >
        <Sparkles size={16} aria-hidden="true" />
        {selectedSkillIds.size > 0 && (
          <span className="composer-skill-count">{selectedSkillIds.size}</span>
        )}
      </Button>
      {open && (
        <div className="composer-skill-menu" role="dialog" aria-label={t("skill.chooseForMessage")}>
          <label className="composer-skill-search">
            <Search size={14} aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("skill.search")}
              aria-label={t("skill.search")}
              autoFocus
            />
          </label>
          <div className="composer-skill-results">
            {grouped.length === 0 ? (
              <span className="composer-skill-empty">{t("skill.noSearchResults")}</span>
            ) : (
              grouped.map(([category, entries]) => (
                <section key={category} className="composer-skill-group">
                  <h4>{categoryLabel(category, entries)}</h4>
                  {entries.map((skill) => {
                    const localized = localizedSkill(skill, i18n.resolvedLanguage ?? "en");
                    const incompatible = mode === "ask" && skill.manifest.capabilities.length > 0;
                    const selected = selectedSkillIds.has(skill.manifest.id);
                    return (
                      <button
                        key={skill.manifest.id}
                        type="button"
                        className={selected ? "selected" : ""}
                        disabled={incompatible}
                        onClick={() => toggleSelectedSkill(skill.manifest.id)}
                        data-tip={incompatible ? t("skill.requiresAgentMode") : undefined}
                        aria-pressed={selected}
                      >
                        <span>
                          <strong>{localized.name}</strong>
                          <small>{localized.description}</small>
                        </span>
                        {selected && <Check size={14} aria-hidden="true" />}
                      </button>
                    );
                  })}
                </section>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
