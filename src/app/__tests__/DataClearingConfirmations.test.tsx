// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const clearUsage = vi.fn<() => Promise<void>>();
const loadRecords = vi.fn<() => Promise<void>>();
const clearLogs = vi.fn();
const clearWorkspace = vi.fn();

vi.mock("../../core/storage/db", () => ({
  db: { usage_records: { clear: clearUsage } },
}));

vi.mock("../../features/usage/usage-store", () => ({
  useUsageStore: () => ({
    records: [
      {
        id: "usage-1",
        providerId: "provider-1",
        modelId: "model-1",
        totalTokens: 42,
        evidence: "provider",
        success: true,
        durationMs: 100,
        createdAt: Date.now(),
      },
    ],
    loadRecords,
  }),
}));

vi.mock("../../core/logging/logger", () => ({
  logger: {
    getEntries: vi.fn(() => []),
    exportLogs: vi.fn(() => "[]"),
    clear: clearLogs,
  },
}));

vi.mock("../../features/workspace/workspace-store", () => ({
  useWorkspaceStore: () => ({
    currentWorkspace: "/Users/example/project",
    recentWorkspaces: ["/Users/example/project"],
    setWorkspace: vi.fn(),
    clearWorkspace,
    loadWorkspace: vi.fn(),
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      options?.count === undefined ? key : `${key}:${options.count}`,
    i18n: { resolvedLanguage: "en", language: "en" },
  }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("data clearing confirmations", () => {
  it("guards usage data clearing", async () => {
    clearUsage.mockResolvedValue(undefined);
    loadRecords.mockResolvedValue(undefined);
    const { UsagePanel } = await import("../UsagePanel");
    render(<UsagePanel />);

    fireEvent.click(screen.getByRole("button", { name: "usage.clear" }));
    expect(clearUsage).not.toHaveBeenCalled();
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "usage.clear" }),
    );
    await waitFor(() => expect(clearUsage).toHaveBeenCalledOnce());
  });

  it("guards diagnostic log clearing", async () => {
    const { DiagnosticsSettings } = await import("../DiagnosticsSettings");
    render(<DiagnosticsSettings />);

    fireEvent.click(screen.getByRole("button", { name: "diagnostics.clear" }));
    expect(clearLogs).not.toHaveBeenCalled();
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "diagnostics.clear",
      }),
    );
    await waitFor(() => expect(clearLogs).toHaveBeenCalledOnce());
  });

  it("guards workspace unlinking", async () => {
    const { WorkspaceSelector } = await import("../WorkspaceSelector");
    render(<WorkspaceSelector />);

    fireEvent.click(screen.getByRole("button", { name: "workspace.clear" }));
    expect(clearWorkspace).not.toHaveBeenCalled();
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "workspace.clear" }),
    );
    await waitFor(() => expect(clearWorkspace).toHaveBeenCalledOnce());
  });
});
