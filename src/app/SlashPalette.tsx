import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  Activity,
  Bot,
  Combine,
  Cpu,
  Eye,
  FolderOpen,
  Globe,
  History,
  ListChecks,
  MessageSquare,
  MessageSquarePlus,
  Package,
  Puzzle,
  Sparkles,
  Target,
  Users,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "../components/ui";
import type { InstalledSkill } from "../core/skills/types";
import { useSkillStore } from "../features/skills/skill-store";
import { useChatStore } from "../features/chat/chat-store";
import { usePluginContributionStore } from "../features/plugins/plugin-contributions";

/** Mode/model entries — handled inside the composer layer. */
export type SlashCommandId = "plan" | "goal" | "agent" | "model";

/**
 * Full `/` action surface (§4-8): direct actions and mode switches that run or
 * route on selection — never "paste text back into the input" placeholders.
 */
export type SlashActionId =
  | SlashCommandId
  | "new-conversation"
  | "new-project-task"
  | "compact"
  | "open-preview"
  | "toggle-browser"
  | "open-outputs"
  | "open-files"
  | "open-recent-output"
  | "open-trace"
  | "new-canvas"
  | "switch-user";

/** Availability flags computed by the owner (ChatView) — the palette stays presentational. */
export interface SlashCapabilities {
  /** Desktop runtime: the workspace panel, canvas and file outputs exist. */
  desktop: boolean;
  /** Enough non-private history to make compaction meaningful, not streaming. */
  canCompact: boolean;
  hasOutputs: boolean;
  /** A trace exists for the latest assistant turn. */
  hasTrace: boolean;
  /** A project workspace root is active (canvas creation). */
  hasProjectRoot: boolean;
}

interface SlashPaletteProps {
  /** Text after the leading "/" in the composer; drives Command filtering. */
  query: string;
  /** The composer surface the palette anchors to (portal + fixed positioning). */
  anchorRef: RefObject<HTMLElement | null>;
  projectScoped: boolean;
  capabilities: SlashCapabilities;
  /** Runs the selected action (modes/model included). */
  onAction: (id: SlashActionId) => void;
  /** Called after an item executes so the owner can clear the input. */
  onDone: () => void;
}

interface SlashItem {
  key: string;
  actionId: SlashActionId;
  icon: LucideIcon;
  label: string;
  description: string;
  keywords: string[];
  /** Plugin commands carry their own runner. */
  run?: () => void | Promise<void>;
}

interface SlashSkillItem {
  key: string;
  kind: "skill";
  skillId: string;
  label: string;
  description: string;
  keywords: string[];
}

interface SlashPluginItem {
  key: string;
  kind: "plugin";
  label: string;
  description: string;
  keywords: string[];
  run?: () => void | Promise<void>;
}

export interface SlashPaletteHandle {
  /**
   * Keyboard routing for palette keys while the composer textarea keeps
   * focus. Returns true when the event was consumed (navigation, Enter,
   * Tab); Escape and plain typing stay with the composer.
   */
  handleKey: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => boolean;
  /** Runs the highlighted item; false when nothing is selected. */
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

const GAP = 8;
/** Palette height budget (§6): ~7-10 rows visible, list scrolls internally. */
const MAX_LIST_HEIGHT = { px: 360, vhShare: 0.45 } as const;
/** Below this much space above, flipping under the anchor beats shrinking. */
const MIN_PREFERRED_SPACE = 168;

/** Live anchor geometry: fixed-position palettes must track layout changes. */
function useAnchorRect(anchorRef: RefObject<HTMLElement | null>) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useEffect(() => {
    const update = () => {
      const element = anchorRef.current;
      if (element) setRect(element.getBoundingClientRect());
    };
    update();
    const raf = requestAnimationFrame(update);
    window.addEventListener("resize", update);
    // Capture: catch scrolls from any nested scroll container.
    window.addEventListener("scroll", update, { capture: true, passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, { capture: true });
    };
  }, [anchorRef]);
  return rect;
}

/**
 * Slash palette on shadcn-style Command primitives (cmdk): the composer stays
 * the single source of query text (§8) via a visually-hidden controlled
 * CommandInput, keyboard events are forwarded from the textarea into the
 * Command root, and the palette floats above the composer inside a portal —
 * it never grows the conversation layout and never exceeds the window (§4-8).
 * Items are grouped (Core Actions / Modes / Preview & Browser / Files &
 * Outputs / Skills / Plugins / Advanced) and every entry executes directly.
 */
export const SlashPalette = forwardRef<SlashPaletteHandle, SlashPaletteProps>(function SlashPalette(
  { query, anchorRef, projectScoped, capabilities, onAction, onDone },
  ref,
) {
  const { t, i18n } = useTranslation();
  const skills = useSkillStore((state) => state.skills);
  const loadSkills = useSkillStore((state) => state.loadSkills);
  const selectedSkillIds = useChatStore((state) => state.selectedSkillIds);
  const toggleSelectedSkill = useChatStore((state) => state.toggleSelectedSkill);
  const pluginSlashCommands = usePluginContributionStore((state) => state.slashCommands);
  const commandRef = useRef<HTMLDivElement>(null);
  const rect = useAnchorRect(anchorRef);

  useEffect(() => {
    void loadSkills();
  }, [loadSkills]);

  // Action groups (§5-6). Availability gates keep the list honest: hidden
  // entries never exist, so search can't surface a dead action.
  const groups = useMemo(() => {
    const { desktop, canCompact, hasOutputs, hasTrace, hasProjectRoot } = capabilities;
    const core: SlashItem[] = [];
    if (projectScoped) {
      core.push({
        key: "act-new-project-task",
        actionId: "new-project-task",
        icon: MessageSquarePlus,
        label: "/new",
        description: t("slash.actionNewTask"),
        keywords: ["new", "task", "chat", "新任务", "新对话"],
      });
    }
    core.push(
      {
        key: "act-new-conversation",
        actionId: "new-conversation",
        icon: MessageSquare,
        label: projectScoped ? "/chat" : "/new",
        description: t("slash.actionNewChat"),
        keywords: ["new", "chat", "conversation", "新对话", "新聊天"],
      },
      {
        key: "act-model",
        actionId: "model",
        icon: Cpu,
        label: "/model",
        description: t("slash.commandModel"),
        keywords: ["model", "模型", "切换模型"],
      },
    );
    if (canCompact) {
      core.push({
        key: "act-compact",
        actionId: "compact",
        icon: Combine,
        label: "/compact",
        description: t("slash.actionCompact"),
        keywords: ["compact", "compress", "summarize", "压缩", "总结"],
      });
    }

    const modes: SlashItem[] = projectScoped
      ? [
          {
            key: "cmd-plan",
            actionId: "plan",
            icon: ListChecks,
            label: "/plan",
            description: t("slash.commandPlan"),
            keywords: ["plan", "计划"],
          },
          {
            key: "cmd-goal",
            actionId: "goal",
            icon: Target,
            label: "/goal",
            description: t("slash.commandGoal"),
            keywords: ["goal", "目标"],
          },
          {
            key: "cmd-agent",
            actionId: "agent",
            icon: Bot,
            label: "/agent",
            description: t("slash.commandAgent"),
            keywords: ["agent", "代理"],
          },
        ]
      : [];

    const previewBrowser: SlashItem[] = desktop
      ? [
          {
            key: "act-open-preview",
            actionId: "open-preview",
            icon: Eye,
            label: "/preview",
            description: t("slash.actionOpenPreview"),
            keywords: ["preview", "预览", "打开预览"],
          },
          {
            key: "act-toggle-browser",
            actionId: "toggle-browser",
            icon: Globe,
            label: "/browser",
            description: t("slash.actionToggleBrowser"),
            keywords: ["browser", "浏览器", "网页"],
          },
        ]
      : [];

    const filesOutputs: SlashItem[] = [];
    if (desktop) {
      filesOutputs.push(
        {
          key: "act-open-outputs",
          actionId: "open-outputs",
          icon: Package,
          label: "/outputs",
          description: t("slash.actionOpenOutputs"),
          keywords: ["outputs", "产出", "输出"],
        },
        {
          key: "act-open-files",
          actionId: "open-files",
          icon: FolderOpen,
          label: "/files",
          description: t("slash.actionOpenFiles"),
          keywords: ["files", "文件", "文件预览"],
        },
      );
      if (hasOutputs) {
        filesOutputs.push({
          key: "act-open-recent-output",
          actionId: "open-recent-output",
          icon: History,
          label: "/recent",
          description: t("slash.actionRecentOutput"),
          keywords: ["recent", "最近", "最近输出"],
        });
      }
    }

    const advanced: SlashItem[] = [];
    if (hasTrace) {
      advanced.push({
        key: "act-open-trace",
        actionId: "open-trace",
        icon: Activity,
        label: "/trace",
        description: t("slash.actionOpenTrace"),
        keywords: ["trace", "details", "运行详情", "诊断"],
      });
    }
    if (desktop && hasProjectRoot) {
      advanced.push({
        key: "act-new-canvas",
        actionId: "new-canvas",
        icon: Workflow,
        label: "/canvas",
        description: t("slash.actionNewCanvas"),
        keywords: ["canvas", "画布", "创建画布"],
      });
    }
    advanced.push({
      key: "act-switch-user",
      actionId: "switch-user",
      icon: Users,
      label: "/user",
      description: t("slash.actionSwitchUser"),
      keywords: ["user", "profile", "用户", "切换用户"],
    });

    return [
      { id: "core", heading: t("slash.groupCore"), items: core },
      { id: "modes", heading: t("slash.groupModes"), items: modes },
      { id: "preview-browser", heading: t("slash.groupPreviewBrowser"), items: previewBrowser },
      { id: "files-outputs", heading: t("slash.groupFilesOutputs"), items: filesOutputs },
      { id: "advanced", heading: t("slash.groupAdvanced"), items: advanced },
    ].filter((group) => group.items.length > 0);
  }, [capabilities, projectScoped, t]);

  const runItem = (item: SlashItem | SlashSkillItem | SlashPluginItem) => {
    if ("actionId" in item) onAction(item.actionId);
    else if (item.kind === "skill") {
      if (!selectedSkillIds.has(item.skillId)) toggleSelectedSkill(item.skillId);
    } else if (item.kind === "plugin") void item.run?.();
    onDone();
  };

  const selectedItemElement = (): HTMLElement | null =>
    commandRef.current?.querySelector<HTMLElement>('[cmdk-item][aria-selected="true"]') ?? null;

  const execute = () => {
    const element = selectedItemElement();
    if (!element) return false;
    element.click();
    return true;
  };

  const forwardKey = (key: string) => {
    commandRef.current?.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
  };

  useImperativeHandle(
    ref,
    () => ({
      handleKey: (event) => {
        if (
          event.key === "ArrowDown" ||
          event.key === "ArrowUp" ||
          event.key === "Home" ||
          event.key === "End"
        ) {
          event.preventDefault();
          forwardKey(event.key);
          return true;
        }
        if (event.key === "Enter") {
          // With no selected item the palette is exhausted: let the composer
          // send the raw "/" text as a normal message (previous behavior).
          if (!selectedItemElement()) return false;
          event.preventDefault();
          forwardKey("Enter");
          return true;
        }
        if (event.key === "Tab") {
          if (!selectedItemElement()) return false;
          event.preventDefault();
          execute();
          return true;
        }
        return false;
      },
      execute,
    }),
    // execute/selectedItemElement/forwardKey close over refs and stores that
    // are stable across renders; the handle itself must not churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const language = i18n.resolvedLanguage ?? "en";
  const skillItems: SlashSkillItem[] = skills.map((skill) => {
    const localized = localizedSkill(skill, language);
    return {
      key: `skill-${skill.manifest.id}`,
      kind: "skill" as const,
      skillId: skill.manifest.id,
      label: `$${skill.manifest.id}`,
      description: localized.description,
      keywords: [skill.manifest.id, localized.name],
    };
  });
  const pluginItems: SlashPluginItem[] = pluginSlashCommands.map((command) => ({
    key: `plugin-${command.pluginId}-${command.id}`,
    kind: "plugin" as const,
    label: `/${command.id}`,
    description: command.description,
    keywords: [command.id, command.pluginId],
    run: command.run,
  }));

  // Viewport placement (§5): prefer above the composer, flip below when the
  // space above cannot host the minimum palette, clamp to what exists.
  const viewportHeight = typeof window === "undefined" ? 800 : window.innerHeight;
  const preferredListHeight = Math.min(
    MAX_LIST_HEIGHT.px,
    Math.round(viewportHeight * MAX_LIST_HEIGHT.vhShare),
  );
  let placement: { style: React.CSSProperties; listMaxHeight: number } | null = null;
  if (rect) {
    const spaceAbove = rect.top - GAP;
    const spaceBelow = viewportHeight - rect.bottom - GAP;
    const flipBelow = spaceAbove < MIN_PREFERRED_SPACE && spaceBelow > spaceAbove;
    const available = flipBelow ? spaceBelow : spaceAbove;
    const paletteMaxHeight = Math.max(120, available);
    placement = {
      style: flipBelow
        ? {
            left: rect.left,
            top: rect.bottom + GAP,
            width: Math.max(240, rect.width),
            maxHeight: paletteMaxHeight,
          }
        : {
            left: rect.left,
            bottom: viewportHeight - rect.top + GAP,
            width: Math.max(240, rect.width),
            maxHeight: paletteMaxHeight,
          },
      listMaxHeight: Math.min(preferredListHeight, Math.max(96, paletteMaxHeight - 56)),
    };
  }

  if (!placement) return null;

  const renderAction = (item: SlashItem) => (
    <CommandItem
      key={item.key}
      value={item.label}
      keywords={item.keywords}
      onSelect={() => runItem(item)}
    >
      <item.icon size={12} aria-hidden="true" className="shrink-0 text-muted" />
      <span className="shrink-0 font-medium">{item.label}</span>
      <span className="min-w-0 flex-1 truncate text-[11px] text-muted">{item.description}</span>
    </CommandItem>
  );

  return createPortal(
    <div
      className="slash-palette fixed z-[95] flex flex-col overflow-hidden rounded-xl border border-border bg-surface-elevated shadow-popover"
      style={placement.style}
      data-slot="slash-palette"
    >
      <Command ref={commandRef} loop className="min-h-0 flex-1" label={t("slash.paletteLabel")}>
        {/* Mirror of the composer query so cmdk filters natively; never
              focusable — all typing happens in the composer textarea (§8). */}
        <CommandInput
          value={query}
          onValueChange={() => undefined}
          tabIndex={-1}
          aria-hidden="true"
          className="sr-only"
        />
        <CommandList style={{ maxHeight: placement.listMaxHeight }}>
          <CommandEmpty>{t("slash.noMatches")}</CommandEmpty>
          {groups.map((group) => (
            <CommandGroup key={group.id} heading={group.heading}>
              {group.items.map(renderAction)}
            </CommandGroup>
          ))}
          {skillItems.length > 0 && (
            <CommandGroup heading={t("slash.skillsGroup")}>
              {skillItems.map((item) => (
                <CommandItem
                  key={item.key}
                  value={item.label}
                  keywords={item.keywords}
                  onSelect={() => runItem(item)}
                >
                  <Sparkles size={12} aria-hidden="true" className="shrink-0 text-primary/80" />
                  <span className="shrink-0 font-medium">{item.label}</span>
                  <span className="min-w-0 flex-1 truncate text-[11px] text-muted">
                    {selectedSkillIds.has(item.skillId)
                      ? t("slash.skillSelected")
                      : item.description}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {pluginItems.length > 0 && (
            <CommandGroup heading={t("slash.pluginsGroup")}>
              {pluginItems.map((item) => (
                <CommandItem
                  key={item.key}
                  value={item.label}
                  keywords={item.keywords}
                  onSelect={() => runItem(item)}
                >
                  <Puzzle size={12} aria-hidden="true" className="shrink-0 text-primary/80" />
                  <span className="shrink-0 font-medium">{item.label}</span>
                  <span className="min-w-0 flex-1 truncate text-[11px] text-muted">
                    {item.description}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
        <div className="slash-hint shrink-0 border-t border-border px-3 py-1.5 text-[10.5px] text-muted">
          {t("slash.hint")}
        </div>
      </Command>
    </div>,
    document.body,
  );
});
