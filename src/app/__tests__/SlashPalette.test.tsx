// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SlashPalette, type SlashPaletteHandle } from "../SlashPalette";
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

function mountPalette(overrides?: { query?: string; projectScoped?: boolean }) {
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
  const onCommand = vi.fn();
  const onDone = vi.fn();
  const utils = render(
    <SlashPalette
      ref={(instance: SlashPaletteHandle | null) => {
        handle(instance);
      }}
      query={overrides?.query ?? ""}
      anchorRef={{ current: anchor }}
      projectScoped={overrides?.projectScoped ?? true}
      onCommand={onCommand}
      onDone={onDone}
    />,
  );
  return { anchor, handleRef: handle, onCommand, onDone, ...utils };
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

describe("SlashPalette (shadcn Command)", () => {
  it("renders as a fixed portal above the composer, never in the composer flow", () => {
    mountPalette();
    const palette = document.querySelector<HTMLElement>(".slash-palette");
    expect(palette).toBeTruthy();
    // Portal: mounted on body, positioned above the anchor with fixed positioning.
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

  it("groups commands and skills; plugin commands get their own group only when present", () => {
    mountPalette();
    const headings = [...document.querySelectorAll("[cmdk-group-heading]")].map(
      (n) => n.textContent,
    );
    expect(headings).toContain("slash.commandsGroup");
    expect(headings).toContain("slash.skillsGroup");
    expect(headings).not.toContain("slash.pluginsGroup");

    usePluginContributionStore
      .getState()
      .replaceSlashCommands([
        { pluginId: "demo", id: "deploy", description: "Deploy the site", run: vi.fn() },
      ]);
    const second = mountPalette();
    expect(second.baseElement).toBeTruthy();
    const headingsAfter = [...document.querySelectorAll("[cmdk-group-heading]")].map(
      (n) => n.textContent,
    );
    expect(headingsAfter).toContain("slash.pluginsGroup");
  });

  it("filters by the composer query, including Chinese keywords", () => {
    mountPalette({ query: "plan" });
    let labels = [...document.querySelectorAll("[cmdk-item]")].map((n) =>
      n.getAttribute("data-value"),
    );
    expect(labels).toEqual(["/plan"]);

    mountPalette({ query: "计划" });
    labels = [...document.querySelectorAll("[cmdk-item]")].map((n) => n.getAttribute("data-value"));
    expect(labels).toEqual(["/plan"]);

    mountPalette({ query: "zzzznope" });
    expect(document.querySelectorAll("[cmdk-item]").length).toBe(0);
    expect(document.body.textContent).toContain("slash.noMatches");
  });

  it("navigates with arrows and executes the selected item; Tab also runs it", () => {
    const { handleRef, onCommand, onDone } = mountPalette();
    const handle = handleRef.mock.calls[0]?.[0] as SlashPaletteHandle;

    expect(handle.handleKey(keyEvent("ArrowDown"))).toBe(true);
    expect(handle.handleKey(keyEvent("Enter"))).toBe(true);
    expect(onCommand).toHaveBeenCalledWith("plan");
    expect(onDone).toHaveBeenCalledOnce();

    const second = mountPalette();
    const handle2 = second.handleRef.mock.calls[0]?.[0] as SlashPaletteHandle;
    expect(handle2.handleKey(keyEvent("Tab"))).toBe(true);
    expect(second.onCommand).toHaveBeenCalledOnce();
  });

  it("leaves unmatched-input Enter to the composer so raw text can still be sent", () => {
    const { handleRef } = mountPalette({ query: "zzzznope" });
    const handle = handleRef.mock.calls[0]?.[0] as SlashPaletteHandle;
    expect(handle.handleKey(keyEvent("Enter"))).toBe(false);
  });

  it("hides project-only commands outside project scope", () => {
    mountPalette({ projectScoped: false });
    const labels = [...document.querySelectorAll("[cmdk-item]")].map((n) =>
      n.getAttribute("data-value"),
    );
    expect(labels).toEqual(["/model", ...skills.map((skill) => `$${skill.manifest.id}`)]);
  });
});
