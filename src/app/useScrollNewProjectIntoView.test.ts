// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectRecord } from "../core/storage/db";
import { useScrollNewProjectIntoView } from "./useScrollNewProjectIntoView";

function project(id: string, lastOpenedAt: number): ProjectRecord {
  return {
    id,
    rootPath: `/tmp/${id}`,
    displayName: id,
    permissionProfile: "workspace",
    requiredCapabilities: [],
    accessRoots: [],
    lastOpenedAt,
    createdAt: 1,
    updatedAt: 1,
  } as unknown as ProjectRecord;
}

describe("useScrollNewProjectIntoView", () => {
  beforeEach(() => {
    // jsdom has neither rAF flushing nor scrollIntoView; provide both.
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    // @ts-expect-error restore jsdom's missing built-in
    delete Element.prototype.scrollIntoView;
  });

  it("scrolls the newly added project into view when the list grows", () => {
    const container = document.createElement("section");
    const row = document.createElement("div");
    row.setAttribute("data-project-id", "p2");
    container.appendChild(row);
    document.body.appendChild(container);

    const { result, rerender } = renderHook(
      ({ projects }) => useScrollNewProjectIntoView(projects),
      { initialProps: { projects: [project("p1", 1)] } },
    );
    // The hook returns the container ref; point it at our stand-in section.
    (result.current as { current: unknown }).current = container;

    const rowScroll = vi.fn();
    row.scrollIntoView = rowScroll;
    act(() => rerender({ projects: [project("p1", 1), project("p2", 2)] }));

    expect(rowScroll).toHaveBeenCalledWith({ block: "nearest" });
  });

  it("does nothing when the list shrinks or stays the same", () => {
    const container = document.createElement("section");
    document.body.appendChild(container);
    const { result, rerender } = renderHook(
      ({ projects }) => useScrollNewProjectIntoView(projects),
      { initialProps: { projects: [project("p1", 1), project("p2", 2)] } },
    );
    (result.current as { current: unknown }).current = container;
    // No rows with data-project-id exist in this harness; the prototype spy
    // would catch any accidental scrollIntoView call.
    const protoSpy = vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(() => {});

    act(() => rerender({ projects: [project("p1", 1)] }));
    expect(protoSpy).not.toHaveBeenCalled();
    act(() => rerender({ projects: [project("p1", 1)] }));
    expect(protoSpy).not.toHaveBeenCalled();
    protoSpy.mockRestore();
  });
});
