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
});

// Dynamic import so the mock is in place before the component loads
async function renderSwitcher(onSwitch = vi.fn()) {
  const { ModelSwitcher } = await import("../ModelSwitcher");
  return render(<ModelSwitcher onSwitch={onSwitch} />);
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

  it("opens dropdown with all enabled providers on click", async () => {
    mockProviders = [
      makeProvider({ id: "p-1", name: "OpenAI", isDefault: true }),
      makeProvider({ id: "p-2", name: "Anthropic", isDefault: false, modelId: "claude-3" }),
    ];

    await renderSwitcher();

    fireEvent.click(screen.getByRole("button", { expanded: false }));

    const listbox = screen.getByRole("listbox");
    expect(listbox).toBeDefined();
    expect(listbox.textContent).toContain("OpenAI");
    expect(listbox.textContent).toContain("Anthropic");
  });

  it("calls onSwitch when a provider is clicked", async () => {
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
});
