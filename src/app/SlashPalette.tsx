import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Terminal } from "lucide-react";
import type { InstalledSkill } from "../core/skills/types";
import { useSkillStore } from "../features/skills/skill-store";
import { useChatStore } from "../features/chat/chat-store";
import { cn } from "../components/ui/utils";

export type SlashCommandId = "plan" | "goal" | "agent" | "model";

interface SlashPaletteProps {
  /** Text after the leading "/" in the composer. */
  query: string;
  projectScoped: boolean;
  onCommand: (id: SlashCommandId) => void;
  /** Called after an item executes so the owner can clear the input. */
  onDone: () => void;
}

interface SlashItem {
  key: string;
  kind: "command" | "skill";
  commandId?: SlashCommandId;
  skillId?: string;
  label: string;
  description: string;
  keywords: string;
}

export interface SlashPaletteHandle {
  move: (delta: 1 | -1) => void;
  /** Executes the highlighted item; false when the list is empty. */
  execute: () => boolean;
}

function localizedSkill(skill: InstalledSkill, language: string) {
  const locale = language === "zh-CN" ? "zh-CN" : "en";
  const localization = skill.manifest.localizations?.[locale];
  return {
    name: localization?.name ?? skill.manifest.name,
    description: localization?.description ?? skill.manifest.description,
  };
}

export const SlashPalette = forwardRef<SlashPaletteHandle, SlashPaletteProps>(function SlashPalette(
  { query, projectScoped, onCommand, onDone },
  ref,
) {
  const { t, i18n } = useTranslation();
  const skills = useSkillStore((state) => state.skills);
  const loadSkills = useSkillStore((state) => state.loadSkills);
  const selectedSkillIds = useChatStore((state) => state.selectedSkillIds);
  const toggleSelectedSkill = useChatStore((state) => state.toggleSelectedSkill);
  const [highlight, setHighlight] = useState(0);

  useEffect(() => {
    void loadSkills();
  }, [loadSkills]);

  const items = useMemo<SlashItem[]>(() => {
    const normalized = query.trim().toLocaleLowerCase();
    const commands: SlashItem[] = [];
    if (projectScoped) {
      commands.push(
        {
          key: "cmd-plan",
          kind: "command",
          commandId: "plan",
          label: "/plan",
          description: t("slash.commandPlan"),
          keywords: "plan",
        },
        {
          key: "cmd-goal",
          kind: "command",
          commandId: "goal",
          label: "/goal",
          description: t("slash.commandGoal"),
          keywords: "goal",
        },
        {
          key: "cmd-agent",
          kind: "command",
          commandId: "agent",
          label: "/agent",
          description: t("slash.commandAgent"),
          keywords: "agent",
        },
      );
    }
    commands.push({
      key: "cmd-model",
      kind: "command",
      commandId: "model",
      label: "/model",
      description: t("slash.commandModel"),
      keywords: "model",
    });
    const language = i18n.resolvedLanguage ?? "en";
    const skillItems: SlashItem[] = skills.map((skill) => {
      const localized = localizedSkill(skill, language);
      return {
        key: `skill-${skill.manifest.id}`,
        kind: "skill",
        skillId: skill.manifest.id,
        label: `$${skill.manifest.id}`,
        description: localized.description,
        keywords: `${skill.manifest.id} ${localized.name}`.toLocaleLowerCase(),
      };
    });
    const all = [...commands, ...skillItems];
    if (!normalized) return all;
    return all.filter(
      (item) =>
        item.label.toLocaleLowerCase().includes(normalized) || item.keywords.includes(normalized),
    );
  }, [query, projectScoped, skills, i18n.resolvedLanguage, t]);

  useEffect(() => {
    setHighlight(0);
  }, [query]);

  useImperativeHandle(
    ref,
    () => ({
      move: (delta) => {
        setHighlight((current) => {
          if (items.length === 0) return 0;
          return (current + delta + items.length) % items.length;
        });
      },
      execute: () => {
        const item = items[highlight];
        if (!item) return false;
        if (item.kind === "command" && item.commandId) {
          onCommand(item.commandId);
        } else if (item.kind === "skill" && item.skillId) {
          if (!selectedSkillIds.has(item.skillId)) toggleSelectedSkill(item.skillId);
        }
        onDone();
        return true;
      },
    }),
    [items, highlight, onCommand, onDone, selectedSkillIds, toggleSelectedSkill],
  );

  const commandItems = items.filter((item) => item.kind === "command");
  const skillItems = items.filter((item) => item.kind === "skill");
  let flatIndex = -1;
  const renderItem = (item: SlashItem) => {
    flatIndex += 1;
    const index = flatIndex;
    const selected =
      skillItems.length > 0 && item.kind === "skill" && selectedSkillIds.has(item.skillId!);
    return (
      <button
        key={item.key}
        type="button"
        role="option"
        aria-selected={index === highlight}
        className={cn(
          "slash-item flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors select-none hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:outline-none",
          index === highlight && "active bg-surface-hover",
        )}
        onMouseEnter={() => setHighlight(index)}
        onClick={() => {
          if (item.kind === "command" && item.commandId) onCommand(item.commandId);
          else if (item.kind === "skill" && item.skillId) {
            if (!selectedSkillIds.has(item.skillId)) toggleSelectedSkill(item.skillId);
          }
          onDone();
        }}
      >
        <span className="slash-item-label text-[12.5px] font-medium text-foreground">
          {item.kind === "command" && <Terminal size={12} aria-hidden="true" />}
          {item.label}
        </span>
        <span className="slash-item-description min-w-0 flex-1 truncate text-[11px] text-muted">
          {selected ? t("slash.skillSelected") : item.description}
        </span>
      </button>
    );
  };

  return (
    <div
      className="slash-palette mb-1.5 w-full overflow-hidden rounded-xl border border-border bg-surface-elevated shadow-popover"
      role="listbox"
      aria-label={t("slash.paletteLabel")}
    >
      {items.length === 0 && (
        <div className="slash-empty px-3 py-2.5 text-[11.5px] text-muted">
          {t("slash.noMatches")}
        </div>
      )}
      {commandItems.length > 0 && (
        <>
          <div className="px-3 pt-2 pb-1 text-[10px] font-semibold tracking-wide text-muted uppercase">
            {t("slash.commandsGroup")}
          </div>
          {commandItems.map(renderItem)}
        </>
      )}
      {skillItems.length > 0 && (
        <>
          <div className="px-3 pt-2 pb-1 text-[10px] font-semibold tracking-wide text-muted uppercase">
            {t("slash.skillsGroup")}
          </div>
          {skillItems.map(renderItem)}
        </>
      )}
      <div className="slash-hint border-t border-border px-3 py-1.5 text-[10.5px] text-muted/80">
        {t("slash.hint")}
      </div>
    </div>
  );
});
