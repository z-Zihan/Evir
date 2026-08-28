// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProviderRecord } from "../../core/storage/db";

let mockProviders: ProviderRecord[] = [];

vi.mock("../../features/provider/provider-store", () => ({
  useProviderStore: () => ({ providers: mockProviders }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { exists: () => false },
  }),
}));

vi.mock("../../core/providers/adapter-registry", () => ({
  listModelsForProtocol: vi.fn(() => Promise.resolve(undefined)),
}));

function makeProvider(overrides: Partial<ProviderRecord> = {}): ProviderRecord {
  return {
    id: overrides.id ?? "p-1",
    name: overrides.name ?? "OpenAI",
    protocolId: overrides.protocolId ?? "openai-chat-completions",
    baseUrl: overrides.baseUrl ?? "https://api.openai.com/v1",
    apiKey: overrides.apiKey ?? "sk-test",
    modelId: overrides.modelId ?? "gpt-4o",
    enabled: overrides.enabled ?? true,
    isDefault: overrides.isDefault ?? false,
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt ?? 1,
  };
}

afterEach(() => {
  cleanup();
  mockProviders = [];
  localStorage.clear();
});

// Dynamic import so the mock is in place before the component loads
async function renderSwitcher(
  onSwitch = vi.fn(),
  onSwitchModel = vi.fn(),
  active?: { provider: ProviderRecord; modelId: string },
) {
  const { ModelSwitcher } = await import("../ModelSwitcher");
  return render(
    <ModelSwitcher
      onSwitch={onSwitch}
      onSwitchModel={onSwitchModel}
      activeProvider={active?.provider}
      activeModelId={active?.modelId}
    />,
  );
}

describe("ModelSwitcher", () => {
  it("renders the default provider name and model", async () => {
    mockProviders = [
      makeProvider({ id: "p-1", isDefault: true, enabled: true }),
      makeProvider({ id: "p-2", isDefault: false, enabled: true }),
    ];

    await renderSwitcher();

    expect(screen.getByText("OpenAI")).toBeDefined();
    expect(screen.getByText("gpt-4o")).toBeDefined();
  });

  it("opens the dropdown even with a single provider and lists its models", async () => {
    mockProviders = [makeProvider({ id: "p-1", name: "OpenAI", isDefault: true })];

    await renderSwitcher();

    fireEvent.click(screen.getByRole("button", { expanded: false }));
    const listbox = screen.getByRole("listbox");
    expect(listbox).toBeDefined();
    expect(listbox.textContent).toContain("gpt-4o");
  });

  it("opens dropdown with model options and other providers", async () => {
    mockProviders = [
      makeProvider({ id: "p-1", name: "OpenAI", isDefault: true }),
      makeProvider({ id: "p-2", name: "Anthropic", isDefault: false, modelId: "claude-3" }),
    ];

    await renderSwitcher();

    fireEvent.click(screen.getByRole("button", { expanded: false }));

    const listbox = screen.getByRole("listbox");
    expect(listbox).toBeDefined();
    expect(listbox.textContent).toContain("gpt-4o");
    expect(listbox.textContent).toContain("Anthropic");
  });

  it("calls onSwitch when another provider is clicked", async () => {
    const onSwitch = vi.fn();
    mockProviders = [
      makeProvider({ id: "p-1", name: "OpenAI", isDefault: true }),
      makeProvider({ id: "p-2", name: "Anthropic", isDefault: false, modelId: "claude-3" }),
    ];

    await renderSwitcher(onSwitch);

    fireEvent.click(screen.getByRole("button", { expanded: false }));
    fireEvent.click(screen.getByText("Anthropic"));

    expect(onSwitch).toHaveBeenCalledWith(
      expect.objectContaining({ id: "p-2", name: "Anthropic" }),
    );
  });

  it("calls onSwitchModel when a model option is clicked", async () => {
    const onSwitch = vi.fn();
    const onSwitchModel = vi.fn();
    mockProviders = [makeProvider({ id: "p-1", name: "OpenAI", isDefault: true })];
    localStorage.setItem("evir-known-models:p-1", JSON.stringify(["gpt-4o", "gpt-4o-mini"]));

    await renderSwitcher(onSwitch, onSwitchModel);

    fireEvent.click(screen.getByRole("button", { expanded: false }));
    fireEvent.click(screen.getByText("gpt-4o-mini"));

    expect(onSwitchModel).toHaveBeenCalledWith(
      expect.objectContaining({ id: "p-1" }),
      "gpt-4o-mini",
    );
    expect(onSwitch).not.toHaveBeenCalled();
  });

  it("commits a custom model id from the manual input", async () => {
    const onSwitchModel = vi.fn();
    mockProviders = [makeProvider({ id: "p-1", name: "OpenAI", isDefault: true })];

    await renderSwitcher(vi.fn(), onSwitchModel);

    fireEvent.click(screen.getByRole("button", { expanded: false }));
    const input = screen.getByLabelText("chat.modelPickerCustomPlaceholder");
    fireEvent.change(input, { target: { value: "o4-mini-2025-04-16" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onSwitchModel).toHaveBeenCalledWith(
      expect.objectContaining({ id: "p-1" }),
      "o4-mini-2025-04-16",
    );
  });

  it("closes dropdown on outside click", async () => {
    mockProviders = [
      makeProvider({ id: "p-1", name: "OpenAI", isDefault: true }),
      makeProvider({ id: "p-2", name: "Anthropic", isDefault: false }),
    ];

    await renderSwitcher();

    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByRole("listbox")).toBeDefined();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("supports listbox keyboard navigation and returns focus on Escape", async () => {
    mockProviders = [
      makeProvider({ id: "p-1", name: "OpenAI", isDefault: true }),
      makeProvider({ id: "p-2", name: "Anthropic", isDefault: false }),
    ];
    await renderSwitcher();
    const trigger = screen.getByRole("button", { expanded: false });
    trigger.focus();

    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const options = screen.getAllByRole("option");
    expect(document.activeElement).toBe(options[0]);
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(options[1]);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
