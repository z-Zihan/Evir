// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderRecord } from "../../../core/storage/db";

const { storeState } = vi.hoisted(() => ({
  storeState: {
    addProvider: vi.fn(),
    updateProvider: vi.fn(),
    fetchModels: vi.fn(),
    probeToolCalling: vi.fn(),
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { exists: () => false },
  }),
}));

vi.mock("../../../features/provider/provider-store", () => ({
  useProviderStore: (selector: (state: Record<string, unknown>) => unknown) => selector(storeState),
}));

vi.mock("../../../runtime/use-runtime", () => ({
  getRuntime: () => ({
    target: "desktop",
    capabilities: new Set(),
    has: () => false,
    selectWorkspaceDirectory: vi.fn(() => Promise.resolve("/tmp/project")),
  }),
}));

import { FirstRunSetupCard } from "../FirstRunSetupCard";

const provider = { id: "provider-1" } as unknown as ProviderRecord;

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  storeState.addProvider.mockResolvedValue(provider);
  storeState.fetchModels.mockResolvedValue(["qwen3-coder", "qwen3-mini"]);
  storeState.probeToolCalling.mockResolvedValue(true);
});

describe("FirstRunSetupCard", () => {
  it("offers quick presets, requires a key for keyed providers, and links the full catalog", () => {
    render(<FirstRunSetupCard onOpenSettings={vi.fn()} />);
    expect(screen.getByText("智谱 BigModel / GLM")).toBeDefined();
    expect(screen.getByText("Ollama")).toBeDefined();
    expect(screen.getByRole("button", { name: "firstRun.moreProviders" })).toBeDefined();
    // Default preset is keyed: empty key blocks connect with a message.
    fireEvent.click(screen.getByRole("button", { name: "firstRun.connect" }));
    expect(screen.getByText("firstRun.keyRequired")).toBeDefined();
    expect(storeState.addProvider).not.toHaveBeenCalled();
  });

  it("connects, auto-detects a model, probes tool calling, and reports Agent ready", async () => {
    render(<FirstRunSetupCard onOpenSettings={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("firstRun.apiKeyPlaceholder"), {
      target: { value: "sk-test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "firstRun.connect" }));

    await waitFor(() => {
      expect(storeState.addProvider).toHaveBeenCalledTimes(1);
    });
    expect(storeState.fetchModels).toHaveBeenCalledTimes(1);
    expect(storeState.probeToolCalling).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "sk-test" }),
      "qwen3-coder",
    );
    expect(storeState.updateProvider).toHaveBeenCalledWith(provider.id, {
      modelId: "qwen3-coder",
      toolCalling: true,
    });
    await screen.findByText(/firstRun.agentReady/);
    expect(screen.getByText("qwen3-coder")).toBeDefined();
    expect(screen.getByRole("button", { name: /firstRun.openFolder/ })).toBeDefined();
  });

  it("reports Chat only when the probe cannot confirm tool calling (honest default)", async () => {
    storeState.probeToolCalling.mockResolvedValue(false);
    render(<FirstRunSetupCard onOpenSettings={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("firstRun.apiKeyPlaceholder"), {
      target: { value: "sk-test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "firstRun.connect" }));
    await screen.findByText(/firstRun.chatOnly/);
    expect(storeState.updateProvider).toHaveBeenCalledWith(provider.id, {
      modelId: "qwen3-coder",
      toolCalling: false,
    });
  });

  it("a failed connect returns to the form with an error, no detection claims", async () => {
    storeState.addProvider.mockRejectedValue(new Error("401 unauthorized"));
    render(<FirstRunSetupCard onOpenSettings={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("firstRun.apiKeyPlaceholder"), {
      target: { value: "sk-bad" },
    });
    fireEvent.click(screen.getByRole("button", { name: "firstRun.connect" }));
    await screen.findByText("401 unauthorized");
    expect(screen.getByRole("button", { name: "firstRun.connect" })).toBeDefined();
    expect(screen.queryByText(/firstRun.agentReady/)).toBeNull();
  });
});
