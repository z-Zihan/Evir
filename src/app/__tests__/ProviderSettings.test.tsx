// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const addProvider = vi.fn();
const updateProvider = vi.fn();
const deleteProvider = vi.fn();
let providers: Array<{
  id: string;
  name: string;
  protocolId: string;
  baseUrl: string;
  apiKey: string;
  modelId: string;
  enabled: boolean;
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
}> = [];

vi.mock("../../features/provider/provider-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../features/provider/provider-store")>();
  return {
    ...actual,
    useProviderStore: () => ({
      providers,
      addProvider,
      updateProvider,
      deleteProvider,
      setDefaultProvider: vi.fn(),
      testConnection: vi.fn(),
      fetchModels: vi.fn().mockResolvedValue([]),
    }),
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  providers = [];
});

describe("ProviderSettings", () => {
  it("reveals presets only after the user starts adding a provider", async () => {
    const { ProviderSettings } = await import("../ProviderSettings");
    render(<ProviderSettings />);

    expect(screen.queryByText("provider.chooseProvider")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "provider.add" }));
    expect(screen.getByText("provider.chooseProvider")).toBeDefined();
    expect(screen.queryByText("provider.formDescription")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /provider.custom/ }));
    expect(screen.getByText("provider.formDescription")).toBeDefined();
    expect(screen.getByRole("checkbox", { name: /provider.toolCalling/ })).toBeDefined();
  });

  it("blocks save and marks every empty required field", async () => {
    const { ProviderSettings } = await import("../ProviderSettings");
    render(<ProviderSettings />);

    fireEvent.click(screen.getByRole("button", { name: "provider.add" }));
    fireEvent.click(screen.getByRole("button", { name: /provider.custom/ }));
    fireEvent.click(screen.getByRole("button", { name: "provider.save" }));

    expect(screen.getAllByText("provider.validation.required")).toHaveLength(4);
    expect(addProvider).not.toHaveBeenCalled();
  });

  it("opens an existing provider in an edit dialog and saves changes", async () => {
    providers = [
      {
        id: "provider-1",
        name: "OpenAI",
        protocolId: "openai-responses",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "secret",
        modelId: "gpt-5",
        enabled: true,
        isDefault: true,
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    const { ProviderSettings } = await import("../ProviderSettings");
    render(<ProviderSettings />);

    fireEvent.click(screen.getByRole("button", { name: "provider.edit" }));
    const nameInput = screen.getByDisplayValue("OpenAI");
    fireEvent.change(nameInput, { target: { value: "OpenAI Work" } });
    fireEvent.click(screen.getByRole("button", { name: "provider.saveChanges" }));

    expect(updateProvider).toHaveBeenCalledWith(
      "provider-1",
      expect.objectContaining({ name: "OpenAI Work", modelId: "gpt-5" }),
    );
  });

  it("requires confirmation before deleting a provider", async () => {
    providers = [
      {
        id: "provider-1",
        name: "OpenAI",
        protocolId: "openai-responses",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "secret",
        modelId: "gpt-5",
        enabled: true,
        isDefault: true,
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    const { ProviderSettings } = await import("../ProviderSettings");
    render(<ProviderSettings />);

    fireEvent.click(screen.getByRole("button", { name: "provider.delete" }));
    expect(deleteProvider).not.toHaveBeenCalled();
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "provider.delete",
      }),
    );
    await vi.waitFor(() => expect(deleteProvider).toHaveBeenCalledWith("provider-1"));
  });
});
