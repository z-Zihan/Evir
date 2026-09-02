// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InstalledSkill, SkillManifest } from "../../core/skills/types";

const mockToggleSkill = vi.fn<(id: string) => Promise<void>>();
const mockLoadSkills = vi.fn<() => Promise<void>>();
const mockUninstallSkill = vi.fn<(id: string) => Promise<void>>();

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
      attribution: {
        author: "Community Author",
        repository: "https://github.com/community/skills",
        license: "MIT",
        upstreamPath: "skills/bug-fix/SKILL.md",
        upstreamRevision: "abc123",
        adapted: true,
      },
    } satisfies SkillManifest,
    rootPath: "/skills/builtin/bug-fix",
    builtIn: true,
  },
  {
    manifest: {
      schemaVersion: 1,
      id: "custom-helper",
      name: "Custom Helper",
      version: "0.1.0",
      description: "A locally installed helper",
      entry: "SKILL.md",
      source: "created",
      capabilities: [],
      optionalCapabilities: [],
      optionalMcpServers: [],
      riskLevel: "low",
    } satisfies SkillManifest,
    rootPath: "/skills/custom/custom-helper",
    builtIn: false,
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
      platforms: ["desktop"],
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
      uninstallSkill: (id: string) => Promise<void>;
    }) => unknown,
  ) => {
    return selector({
      skills: sampleSkills,
      enabledSkillIds: enabledIds,
      loadSkills: mockLoadSkills,
      toggleSkill: mockToggleSkill,
      uninstallSkill: mockUninstallSkill,
    });
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { exists: () => false, resolvedLanguage: "en" },
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
      expect(screen.getAllByText("skill.low")).toHaveLength(2);
    });
    expect(screen.getByText("skill.medium")).toBeDefined();
  });

  it("shows verifiable community provenance for adapted built-ins", async () => {
    mockLoadSkills.mockResolvedValue(undefined);
    const { SkillSettings } = await import("../SkillSettings");
    render(<SkillSettings />);

    await waitFor(() => {
      expect(screen.getByText(/Community Author/)).toBeDefined();
    });
    expect(screen.getByText(/MIT/)).toBeDefined();
    expect(screen.getByText(/skill\.adapted/)).toBeDefined();
  });

  it("marks Desktop-only skills", async () => {
    mockLoadSkills.mockResolvedValue(undefined);
    const { SkillSettings } = await import("../SkillSettings");
    render(<SkillSettings />);

    await waitFor(() => {
      expect(screen.getByText("skill.desktopOnly")).toBeDefined();
    });
  });

  it("calls toggleSkill when toggle is clicked", async () => {
    mockLoadSkills.mockResolvedValue(undefined);
    mockToggleSkill.mockResolvedValue(undefined);
    const { SkillSettings } = await import("../SkillSettings");
    render(<SkillSettings />);

    await waitFor(() => {
      expect(screen.queryByText("common.loading")).toBeNull();
    });

    const switches = screen.getAllByRole("switch");
    fireEvent.click(switches[0]!);
    expect(mockToggleSkill).toHaveBeenCalledWith("bug-fix");
  });

  it("requires confirmation before uninstalling a custom skill", async () => {
    mockLoadSkills.mockResolvedValue(undefined);
    mockUninstallSkill.mockResolvedValue(undefined);
    const { SkillSettings } = await import("../SkillSettings");
    render(<SkillSettings />);
    await waitFor(() => expect(screen.getByText("Custom Helper")).toBeDefined());

    fireEvent.click(screen.getByRole("button", { name: "skill.uninstall" }));
    expect(mockUninstallSkill).not.toHaveBeenCalled();
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "skill.uninstall",
      }),
    );
    await waitFor(() => expect(mockUninstallSkill).toHaveBeenCalledWith("custom-helper"));
  });
});
