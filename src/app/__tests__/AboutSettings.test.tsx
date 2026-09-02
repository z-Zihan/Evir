// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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

describe("AboutSettings", () => {
  it("renders title and version", async () => {
    const { AboutSettings } = await import("../AboutSettings");
    render(<AboutSettings />);

    expect(screen.getByText("about.title")).toBeDefined();
    expect(screen.getByText("about.description")).toBeDefined();
    expect(screen.getByText("about.notDeclared")).toBeDefined();
    expect(screen.getByText("0.1.0")).toBeDefined();
  });

  it("renders GitHub link", async () => {
    const { AboutSettings } = await import("../AboutSettings");
    render(<AboutSettings />);

    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("https://github.com/z-Zihan/Evir");
  });
});
