// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SlashPalette, type SlashActionId, type SlashCapabilities, type SlashPaletteHandle } from "../SlashPalette";
import type { InstalledSkill } from "../../core/skills/types";
import { usePluginContributionStore } from "../../features/plugins/plugin-contributions";

const toggleSelectedSkill = vi.fn();
const loadSkills = vi.fn(() => Promise.resolve());

function fakeSkills(count: number): InstalledSkill[] {
  return Array.from({ length: count }, (_, index) => ({
    manifest: {
      schemaVersion: 1 as const,
      id: `skill-${index}`,
      name: `Skill ${index}`,
      description: `Skill number ${index}`,
      riskLevel: "low" as const,
      version: "1.0.0",
      entry: "SKILL.md",
      source: "builtin" as const,
      capabilities: [],
      optionalCapabilities: [],
      optionalMcpServers: [],
    },
    rootPath: `/skills/builtin/skill-${index}`,
    builtIn: true,
  }));
}

let skills: InstalledSkill[] = [];

vi.mock("../../features/skills/skill-store", () => ({
  useSkillStore: (
    selector: (state: { skills: InstalledSkill[]; loadSkills: () => Promise<void> }) => unknown,
  ) => selector({ skills, loadSkills }),
}));

vi.mock("../../features/chat/chat-store", () => ({
  useChatStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      selectedSkillIds: new Set<string>(),
      toggleSelectedSkill,
    }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { resolvedLanguage: "en" },
  }),
}));

const ALL_CAPABILITIES: SlashCapabilities = {
  desktop: true,
  canCompact: true,
  hasOutputs: true,
  hasTrace: true,
  hasProjectRoot: true,
};

function mountPalette(overrides?: {
  query?: string;
  projectScoped?: boolean;
  capabilities?: Partial<SlashCapabilities>;
}) {
  // Sequential mounts in one test must not stack portals.
  cleanup();
  document.querySelectorAll(".slash-palette").forEach((node) => node.remove());
  const anchor = document.createElement("div");
  document.body.append(anchor);
  // Simulate a composer dock near the bottom of the viewport.
  anchor.getBoundingClientRect = () =>
    ({
      x: 40,
      y: 500,
      top: 500,
      bottom: 560,
      left: 40,
      right: 640,
      width: 600,
      height: 60,
    }) as DOMRect;
  const handle = vi.fn();
  const onAction = vi.fn<(id: SlashActionId) => void>();
  const onDone = vi.fn();
  const utils = render(
    <SlashPalette
      ref={(instance: SlashPaletteHandle | null) => {
        handle(instance);
      }}
      query={overrides?.query ?? ""}
      anchorRef={{ current: anchor }}
      projectScoped={overrides?.projectScoped ?? true}
      capabilities={{ ...ALL_CAPABILITIES, ...(overrides?.capabilities ?? {}) }}
      onAction={onAction}
      onDone={onDone}
    />,
  );
  return { anchor, handleRef: handle, onAction, onDone, ...utils };
}

beforeEach(() => {
  skills = fakeSkills(5);
  usePluginContributionStore.getState().replaceSlashCommands([]);
});

afterEach(() => {
  cleanup();
  document.querySelectorAll(".slash-palette").forEach((node) => node.remove());
  vi.clearAllMocks();
});

function keyEvent(key: string): React.KeyboardEvent<HTMLTextAreaElement> {
  return {
    key,
    preventDefault: vi.fn(),
    nativeEvent: new KeyboardEvent("keydown", { key }),
  } as unknown as React.KeyboardEvent<HTMLTextAreaElement>;
}

function itemLabels(): string[] {
  return [...document.querySelectorAll("[cmdk-item]")].flatMap((node) => {
    const value = node.getAttribute("data-value");
    return value === null ? [] : [value];
  });
}

function headings(): string[] {
  return [...document.querySelectorAll("[cmdk-group-heading]")].map((node) => node.textContent);
}

describe("SlashPalette action center (shadcn Command)", () => {
  it("renders as a fixed portal above the composer, never in the composer flow", () => {
    mountPalette();
    const palette = document.querySelector<HTMLElement>(".slash-palette");
    expect(palette).toBeTruthy();
    expect(palette?.parentElement).toBe(document.body);
    expect(palette?.className).toContain("fixed");
    // 768px viewport − 500px anchor top − 8px gap.
    expect(palette?.style.bottom).toBe("276px");
  });

  it("caps the list height (max ~45vh/360px) and scrolls only inside CommandList", () => {
    skills = fakeSkills(120);
    mountPalette();
    const palette = document.querySelector<HTMLElement>(".slash-palette");
    expect(palette?.className).toContain("overflow-hidden");
    const list = palette?.querySelector<HTMLElement>('[cmdk-list-sizer=""]')?.parentElement;
    expect(list).toBeTruthy();
    const maxHeight = Number.parseFloat(list?.style.maxHeight ?? "0");
    expect(maxHeight).toBeGreaterThan(0);
    expect(maxHeight).toBeLessThanOrEqual(360);
    expect(list?.className).toContain("overflow-y-auto");
  });

  it("groups actions (Core/Modes/Preview&Browser/Files&Outputs/Advanced) plus skills and plugins", () => {
    mountPalette();
    const groupHeadings = headings();
    expect(groupHeadings).toContain("slash.groupCore");
    expect(groupHeadings).toContain("slash.groupModes");
    expect(groupHeadings).toContain("slash.groupPreviewBrowser");
    expect(groupHeadings).toContain("slash.groupFilesOutputs");
    expect(groupHeadings).toContain("slash.groupAdvanced");
    expect(groupHeadings).toContain("slash.skillsGroup");
    expect(groupHeadings).not.toContain("slash.pluginsGroup");

    usePluginContributionStore
      .getState()
      .replaceSlashCommands([
        { pluginId: "demo", id: "deploy", description: "Deploy the site", run: vi.fn() },
      ]);
    const second = mountPalette();
    expect(second.baseElement).toBeTruthy();
    expect(headings()).toContain("slash.pluginsGroup");
  });

  it("hides gated actions when capabilities are off (§5 availability model)", () => {
    mountPalette({
      capabilities: {
        desktop: false,
        canCompact: false,
        hasOutputs: false,
        hasTrace: false,
        hasProjectRoot: false,
      },
    });
    const labels = itemLabels();
    // No panel/browser/canvas/trace/compact/recent actions on a bare web chat.
    expect(labels).not.toContain("/compact");
    expect(labels).not.toContain("/preview");
    expect(labels).not.toContain("/browser");
    expect(labels).not.toContain("/outputs");
    expect(labels).not.toContain("/recent");
    expect(labels).not.toContain("/trace");
    expect(labels).not.toContain("/canvas");
    // Core actions that always exist stay.
    expect(labels).toContain("/model");
    expect(labels).toContain("/new");
  });

  it("hides project-only groups outside project scope; /new stays a standalone chat", () => {
    mountPalette({ projectScoped: false });
    const labels = itemLabels();
    expect(labels).not.toContain("/plan");
    expect(labels).not.toContain("/goal");
    expect(labels).not.toContain("/agent");
    expect(labels).toContain("/new");
    expect(labels).toContain("/compact");
    expect(labels).toContain("/user");
    expect(labels).toEqual([
      "/new",
      "/model",
      "/compact",
      "/preview",
      "/browser",
      "/outputs",
      "/files",
      "/recent",
      "/trace",
      "/canvas",
      "/user",
      ...skills.map((skill) => `$${skill.manifest.id}`),
    ]);
  });

  it("filters by the composer query, including Chinese keywords", () => {
    mountPalette({ query: "plan" });
    expect(itemLabels()).toEqual(["/plan"]);

    mountPalette({ query: "计划" });
    expect(itemLabels()).toEqual(["/plan"]);

    mountPalette({ query: "压缩" });
    expect(itemLabels()).toEqual(["/compact"]);

    mountPalette({ query: "运行详情" });
    expect(itemLabels()).toEqual(["/trace"]);

    mountPalette({ query: "zzzznope" });
    expect(document.querySelectorAll("[cmdk-item]").length).toBe(0);
    expect(document.body.textContent).toContain("slash.noMatches");
  });

  it("navigates with arrows and executes the selected action; Tab also runs it", () => {
    const { handleRef, onAction, onDone } = mountPalette();
    const handle = handleRef.mock.calls[0]?.[0] as SlashPaletteHandle;

    expect(handle.handleKey(keyEvent("ArrowDown"))).toBe(true);
    expect(handle.handleKey(keyEvent("Enter"))).toBe(true);
    // First item in the project-scoped Core group is the /new project task.
    expect(onAction).toHaveBeenCalledWith("new-project-task");
    expect(onDone).toHaveBeenCalledOnce();

    const second = mountPalette();
    const handle2 = second.handleRef.mock.calls[0]?.[0] as SlashPaletteHandle;
    expect(handle2.handleKey(keyEvent("Tab"))).toBe(true);
    expect(second.onAction).toHaveBeenCalledOnce();
  });

  it("leaves unmatched-input Enter to the composer so raw text can still be sent", () => {
    const { handleRef } = mountPalette({ query: "zzzznope" });
    const handle = handleRef.mock.calls[0]?.[0] as SlashPaletteHandle;
    expect(handle.handleKey(keyEvent("Enter"))).toBe(false);
  });

  it("keeps 100+ items usable: filtering narrows to one action", () => {
    skills = fakeSkills(120);
    mountPalette({ query: "画布" });
    expect(itemLabels()).toEqual(["/canvas"]);
  });
});
