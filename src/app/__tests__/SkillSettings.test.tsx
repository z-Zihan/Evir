// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InstalledSkill, SkillManifest } from "../../core/skills/types";

const mockToggleSkill = vi.fn<(id: string) => Promise<void>>();
const mockLoadSkills = vi.fn<() => Promise<void>>();

const sampleSkills: InstalledSkill[] = [
  {
    manifest: {
      schemaVersion: 1,
      id: "bug-fix",
      name: "Bug Fix",
      version: "0.1.0",
      description: "Reproduce, locate, fix, and verify bugs",
      entry: "SKILL.md",
      source: "builtin",
      capabilities: [],
      optionalCapabilities: [],
      optionalMcpServers: [],
      riskLevel: "low",
    } satisfies SkillManifest,
    rootPath: "/skills/builtin/bug-fix",
    builtIn: true,
  },
  {
    manifest: {
      schemaVersion: 1,
      id: "code-review",
      name: "Code Review",
      version: "0.1.0",
      description: "Review code for correctness and security",
      entry: "SKILL.md",
      source: "builtin",
      capabilities: [],
      optionalCapabilities: [],
      optionalMcpServers: [],
      riskLevel: "medium",
    } satisfies SkillManifest,
    rootPath: "/skills/builtin/code-review",
    builtIn: true,
  },
];

const enabledIds = new Set<string>(["bug-fix"]);

vi.mock("../../features/skills/skill-store", () => ({
  useSkillStore: (
    selector: (state: {
      skills: InstalledSkill[];
      enabledSkillIds: Set<string>;
      loadSkills: () => Promise<void>;
      toggleSkill: (id: string) => Promise<void>;
    }) => unknown,
  ) => {
    return selector({
      skills: sampleSkills,
      enabledSkillIds: enabledIds,
      loadSkills: mockLoadSkills,
      toggleSkill: mockToggleSkill,
    });
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { exists: () => false },
  }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SkillSettings", () => {
  it("renders the skill list", async () => {
    mockLoadSkills.mockResolvedValue(undefined);
    const { SkillSettings } = await import("../SkillSettings");
    render(<SkillSettings />);

    await waitFor(() => {
      expect(screen.getByText("Bug Fix")).toBeDefined();
    });
    expect(screen.getByText("Code Review")).toBeDefined();
  });

  it("shows risk level badges", async () => {
    mockLoadSkills.mockResolvedValue(undefined);
    const { SkillSettings } = await import("../SkillSettings");
    render(<SkillSettings />);

    await waitFor(() => {
      expect(screen.getByText("skill.low")).toBeDefined();
    });
    expect(screen.getByText("skill.medium")).toBeDefined();
  });

  it("calls toggleSkill when toggle is clicked", async () => {
    mockLoadSkills.mockResolvedValue(undefined);
    mockToggleSkill.mockResolvedValue(undefined);
    const { SkillSettings } = await import("../SkillSettings");
    render(<SkillSettings />);

    await waitFor(() => {
      expect(screen.queryByText("common.loading")).toBeNull();
    });

    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]!);
    expect(mockToggleSkill).toHaveBeenCalledWith("bug-fix");
  });
});
