// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const addProvider = vi.fn();

vi.mock("../../features/provider/provider-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../features/provider/provider-store")>();
  return {
    ...actual,
    useProviderStore: () => ({
      providers: [],
      addProvider,
      deleteProvider: vi.fn(),
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
});

describe("ProviderSettings", () => {
  it("reveals presets only after the user starts adding a provider", async () => {
    const { ProviderSettings } = await import("../ProviderSettings");
    render(<ProviderSettings />);

    expect(screen.queryByText("provider.presets")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "provider.add" }));
    expect(screen.getByText("provider.presets")).toBeDefined();
    expect(screen.queryByText("provider.formDescription")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /provider.custom/ }));
    expect(screen.getByText("provider.formDescription")).toBeDefined();
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
});
