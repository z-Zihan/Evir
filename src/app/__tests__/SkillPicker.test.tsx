// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InstalledSkill, SkillManifest } from "../../core/skills/types";
import { useChatStore } from "../../features/chat/chat-store";
import { useSkillStore } from "../../features/skills/skill-store";
import { SkillPicker } from "../SkillPicker";

const instructionSkill: InstalledSkill = {
  manifest: {
    schemaVersion: 1,
    id: "meeting-minutes",
    name: "Meeting Minutes",
    version: "1.0.0",
    description: "Turn notes into structured minutes",
    entry: "SKILL.md",
    source: "builtin",
    capabilities: [],
    optionalCapabilities: [],
    optionalMcpServers: [],
    riskLevel: "low",
    category: "office-productivity",
  } satisfies SkillManifest,
  rootPath: "/skills/builtin/meeting-minutes",
  builtIn: true,
};

const localToolSkill: InstalledSkill = {
  manifest: {
    schemaVersion: 1,
    id: "file-organization",
    name: "File Organization",
    version: "1.0.0",
    description: "Organize local files",
    entry: "SKILL.md",
    source: "builtin",
    capabilities: ["read_file"],
    optionalCapabilities: [],
    optionalMcpServers: [],
    riskLevel: "medium",
    category: "system-tools",
  } satisfies SkillManifest,
  rootPath: "/skills/builtin/file-organization",
  builtIn: true,
};

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { exists: () => false, resolvedLanguage: "en" },
  }),
}));

beforeEach(() => {
  useSkillStore.setState({
    skills: [instructionSkill, localToolSkill],
    enabledSkillIds: new Set<string>(),
    loadSkills: vi.fn(() => Promise.resolve()),
  });
  useChatStore.setState({ selectedSkillIds: new Set<string>(), mode: "ask" });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SkillPicker", () => {
  it("selects an instruction Skill even when it is globally disabled", () => {
    render(<SkillPicker mode="ask" disabled={false} />);

    fireEvent.click(screen.getByRole("button", { name: "skill.chooseForMessage" }));
    fireEvent.click(screen.getByRole("button", { name: /Meeting Minutes/ }));

    expect(useChatStore.getState().selectedSkillIds.has("meeting-minutes")).toBe(true);
  });

  it("prevents Ask mode from selecting a Skill that needs local capabilities", () => {
    render(<SkillPicker mode="ask" disabled={false} />);

    fireEvent.click(screen.getByRole("button", { name: "skill.chooseForMessage" }));
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: /File Organization/ }).disabled,
    ).toBe(true);
  });

  it("filters Skills by localized name and description", () => {
    render(<SkillPicker mode="agent" disabled={false} />);

    fireEvent.click(screen.getByRole("button", { name: "skill.chooseForMessage" }));
    fireEvent.change(screen.getByRole("textbox", { name: "skill.search" }), {
      target: { value: "structured minutes" },
    });

    expect(screen.getByText("Meeting Minutes")).toBeDefined();
    expect(screen.queryByText("File Organization")).toBeNull();
  });
});
