// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const clearUsage = vi.fn<() => Promise<void>>();
const loadRecords = vi.fn<() => Promise<void>>();
const clearLogs = vi.fn();
const infoLog = vi.fn<(channel: string, event: string, data: Record<string, unknown>) => void>();

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
    info: infoLog,
    latestActionId: vi.fn(() => "action-existing"),
    subscribe: vi.fn(() => () => undefined),
    persistenceStatus: vi.fn(() => ({ active: false, directory: null })),
  },
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

    // Memory-only persistence status renders before any sink is attached.
    expect(screen.getByText("diagnostics.persistenceMemoryOnly")).toBeTruthy();

    // The ZIP bundle export is desktop-only; web target must not show it.
    expect(screen.queryByRole("button", { name: "diagnostics.exportBundle" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "diagnostics.clear" }));
    expect(clearLogs).not.toHaveBeenCalled();
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "diagnostics.clear",
      }),
    );
    await waitFor(() => expect(clearLogs).toHaveBeenCalledOnce());
  });

  it("creates a screenshot evidence marker linked to an action", async () => {
    const { DiagnosticsSettings } = await import("../DiagnosticsSettings");
    render(<DiagnosticsSettings />);

    fireEvent.click(screen.getByRole("button", { name: "diagnostics.createEvidenceMarker" }));

    const call = infoLog.mock.calls.at(-1);
    expect(call?.[0]).toBe("artifact");
    expect(call?.[1]).toBe("evidence.capture");
    expect(call?.[2]?.evidenceId).toMatch(/^ev-/);
    expect(call?.[2]).toMatchObject({ actionId: "action-existing", screen: "diagnostics" });
    expect(screen.getByRole("status").textContent).toBe("diagnostics.evidenceMarkerCreated");
  });

  it("shows the active persistence status with the log directory", async () => {
    const { logger: loggerMock } = await import("../../core/logging/logger");
    vi.spyOn(loggerMock, "persistenceStatus").mockReturnValue({
      active: true,
      directory: "/Users/example/Library/Application Support/com.zihan.evir/logs",
    });
    const { DiagnosticsSettings } = await import("../DiagnosticsSettings");
    render(<DiagnosticsSettings />);

    expect(screen.getByText("diagnostics.persistenceActive")).toBeTruthy();
    expect(
      screen.getByText("/Users/example/Library/Application Support/com.zihan.evir/logs"),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "diagnostics.copyLogDirectory" })).toBeTruthy();
  });
});
