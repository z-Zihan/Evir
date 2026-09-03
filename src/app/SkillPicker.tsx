import { useEffect, useMemo, useState } from "react";
import { Check, Search, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button, Input, Popover, PopoverContent, PopoverTrigger, Tip } from "../components/ui";
import { cn } from "../components/ui/utils";
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
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const skills = useSkillStore((state) => state.skills);
  const loadSkills = useSkillStore((state) => state.loadSkills);
  const selectedSkillIds = useChatStore((state) => state.selectedSkillIds);
  const toggleSelectedSkill = useChatStore((state) => state.toggleSelectedSkill);

  useEffect(() => {
    void loadSkills();
  }, [loadSkills]);

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
    <div className="composer-skill-picker relative">
      <Popover open={open} onOpenChange={setOpen}>
        {/* Tip wraps the popover trigger (Base UI trigger-in-trigger
            composition) so the tooltip opens on the same button. */}
        <Tip content={t("skill.chooseForMessage")}>
          <PopoverTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className={cn(
                  "text-muted hover:text-foreground",
                  selectedSkillIds.size > 0 && "bg-primary/[0.09] text-primary hover:text-primary",
                )}
                disabled={disabled}
                aria-label={t("skill.chooseForMessage")}
              />
            }
          >
            <Sparkles size={16} aria-hidden="true" />
            {selectedSkillIds.size > 0 && (
              <span className="composer-skill-count absolute -top-1 -right-1 grid size-3.5 place-items-center rounded-full bg-primary text-[9px] font-bold text-primary-fg">
                {selectedSkillIds.size}
              </span>
            )}
          </PopoverTrigger>
        </Tip>
        <PopoverContent
          side="top"
          align="start"
          sideOffset={6}
          className="rounded-none border-0 bg-transparent p-0 shadow-none!"
        >
          {/* Base UI popups render in a portal and hard-wire role="dialog" on
              their own popup; the named dialog role for e2e/a11y lives on this
              inner element. position:static neutralizes the legacy
              absolute-position offsets in .composer-skill-menu — placement now
              comes from the popover positioner. */}
          <div
            className="composer-skill-menu w-72 overflow-hidden rounded-xl border border-border bg-surface-elevated shadow-popover"
            role="dialog"
            aria-label={t("skill.chooseForMessage")}
          >
            <label className="composer-skill-search relative flex items-center border-b border-border">
              <Search
                size={13}
                aria-hidden="true"
                className="pointer-events-none absolute left-3 text-muted"
              />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("skill.search")}
                aria-label={t("skill.search")}
                autoFocus
                className="h-9 border-0 bg-transparent pl-8 focus-visible:border-0 focus-visible:outline-none"
              />
            </label>
            <div className="composer-skill-results max-h-[280px] overflow-y-auto p-1.5">
              {grouped.length === 0 ? (
                <span className="composer-skill-empty block px-2 py-3 text-center text-[11.5px] text-muted">
                  {t("skill.noSearchResults")}
                </span>
              ) : (
                grouped.map(([category, entries]) => (
                  <section key={category} className="composer-skill-group mb-1">
                    <h4 className="px-2 pt-1.5 pb-1 text-[10px] font-semibold tracking-wide text-muted uppercase">
                      {categoryLabel(category, entries)}
                    </h4>
                    {entries.map((skill) => {
                      const localized = localizedSkill(skill, i18n.resolvedLanguage ?? "en");
                      const incompatible = mode === "ask" && skill.manifest.capabilities.length > 0;
                      const selected = selectedSkillIds.has(skill.manifest.id);
                      return (
                        <button
                          key={skill.manifest.id}
                          type="button"
                          className={cn(
                            "flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors select-none hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-45",
                            selected && "bg-primary/[0.07]",
                          )}
                          disabled={incompatible}
                          onClick={() => toggleSelectedSkill(skill.manifest.id)}
                          aria-label={
                            incompatible
                              ? `${localized.name} — ${t("skill.requiresAgentMode")}`
                              : undefined
                          }
                          aria-pressed={selected}
                        >
                          <span className="min-w-0 flex-1">
                            <strong className="block truncate text-[12px] font-medium text-foreground">
                              {localized.name}
                            </strong>
                            <small className="block truncate text-[10.5px] text-muted">
                              {localized.description}
                            </small>
                          </span>
                          {selected && (
                            <Check size={13} aria-hidden="true" className="shrink-0 text-primary" />
                          )}
                        </button>
                      );
                    })}
                  </section>
                ))
              )}
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
