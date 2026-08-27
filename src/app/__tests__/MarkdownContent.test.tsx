// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarkdownContent } from "../MarkdownContent";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { exists: () => false },
  }),
}));

afterEach(cleanup);

describe("MarkdownContent code blocks", () => {
  it("keeps the copy button for fenced blocks without a language tag", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<MarkdownContent content={"```\nplain fenced code\n```"} />);
    const copyButton = screen.getByRole("button", { name: "chat.copyCode" });
    fireEvent.click(copyButton);

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("plain fenced code\n"));
    expect(screen.getByText("chat.copied")).toBeTruthy();
  });

  it("copies the full text of language-tagged blocks", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<MarkdownContent content={"```ts\nconst x = 1;\n```"} />);
    fireEvent.click(screen.getByRole("button", { name: "chat.copyCode" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("const x = 1;\n"));
  });

  it("does not render a copy button for inline code", () => {
    const { container } = render(<MarkdownContent content={"use `span` here"} />);
    expect(screen.queryByRole("button", { name: "chat.copyCode" })).toBeNull();
    expect(container.querySelectorAll("pre")).toHaveLength(0);
  });
});

describe("MarkdownContent tables and links", () => {
  it("wraps tables in a scrollable region", () => {
    const { container } = render(
      <MarkdownContent content={"| a | b |\n| --- | --- |\n| 1 | 2 |"} />,
    );
    const region = container.querySelector(".table-scroll");
    expect(region).not.toBeNull();
    expect(region?.getAttribute("role")).toBe("region");
    expect(region?.querySelector("table")).not.toBeNull();
  });

  it("renders direct video links as an inline player", () => {
    const { container } = render(
      <MarkdownContent content={"[demo](https://example.com/clip.mp4)"} />,
    );
    const video = container.querySelector("video");
    expect(video?.getAttribute("src")).toBe("https://example.com/clip.mp4");
  });

  it("keeps regular links as external anchors", () => {
    render(<MarkdownContent content={"[docs](https://example.com/page)"} />);
    const anchor = screen.getByRole("link", { name: "docs" });
    expect(anchor.getAttribute("href")).toBe("https://example.com/page");
    expect(anchor.getAttribute("target")).toBe("_blank");
  });
});

describe("MarkdownContent images", () => {
  it("opens a lightbox dialog on image click and closes on Escape", () => {
    render(<MarkdownContent content={"![chart](https://example.com/chart.png)"} />);

    fireEvent.click(screen.getByRole("button", { name: "chat.previewImage" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog.querySelector("img")?.getAttribute("src")).toBe("https://example.com/chart.png");

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("MarkdownContent math", () => {
  it("renders block math once the katex plugin has loaded", async () => {
    const { container } = render(<MarkdownContent content={"$$\nE=mc^2\n$$"} />);
    await waitFor(
      () => {
        expect(container.querySelector(".katex")).not.toBeNull();
      },
      { timeout: 5000 },
    );
  });
});
