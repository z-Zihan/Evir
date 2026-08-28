// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import type { ConversationRecord } from "../../../core/storage/db";
import { useProjectStore } from "../project-store";

import { allowsProjectModes, effectiveMode, effectiveModeForModel } from "../conversation-mode";
import { parseDoneWhen } from "../../chat/send-message";

function conversation(projectId?: string | null): ConversationRecord {
  return {
    id: "c1",
    title: "T",
    providerId: "p",
    modelId: "m",
    createdAt: 1,
    updatedAt: 1,
    ...(projectId === undefined ? {} : { projectId }),
  };
}

beforeEach(() => {
  useProjectStore.setState({ projects: [], currentProjectId: null });
  localStorage.clear();
});

describe("effectiveMode", () => {
  it("project threads keep the requested mode", () => {
    expect(effectiveMode(conversation("p1"), "agent")).toBe("agent");
    expect(effectiveMode(conversation("p1"), "plan")).toBe("plan");
    expect(effectiveMode(conversation("p1"), "goal")).toBe("goal");
  });

  it("standalone chats are ask-only once any project exists", () => {
    useProjectStore.setState({
      projects: [
        {
          id: "p1",
          displayName: "Evir",
          nameIsCustom: false,
          rootPath: "/x",
          canonicalRootPath: "/x",
          permissionProfile: "ask",
          additionalAccessRoots: [],
          createdAt: 1,
          updatedAt: 1,
          lastOpenedAt: 1,
        },
      ],
    });
    expect(effectiveMode(conversation(null), "agent")).toBe("ask");
    expect(allowsProjectModes(conversation(undefined))).toBe(false);
  });

  it("legacy workspace keeps standalone agent behavior until the first project", () => {
    localStorage.setItem("evir-workspace-current", "/tmp/legacy");
    expect(effectiveMode(conversation(null), "agent")).toBe("agent");
    useProjectStore.setState({
      projects: [
        {
          id: "p1",
          displayName: "E",
          nameIsCustom: false,
          rootPath: "/x",
          canonicalRootPath: "/x",
          permissionProfile: "ask",
          additionalAccessRoots: [],
          createdAt: 1,
          updatedAt: 1,
          lastOpenedAt: 1,
        },
      ],
    });
    expect(effectiveMode(conversation(null), "agent")).toBe("ask");
  });

  it("without a project or legacy workspace standalone is ask", () => {
    expect(effectiveMode(conversation(null), "agent")).toBe("ask");
  });

  it("lets a project default task fall back to chat when the model has no tools", () => {
    expect(effectiveModeForModel(conversation("p1"), "agent", false)).toBe("ask");
    expect(effectiveModeForModel(conversation("p1"), "agent", true)).toBe("agent");
  });

  it("safely falls back stale Plan or Goal state when the model has no tools", () => {
    expect(effectiveModeForModel(conversation("p1"), "plan", false)).toBe("ask");
    expect(effectiveModeForModel(conversation("p1"), "goal", false)).toBe("ask");
  });
});

describe("parseDoneWhen", () => {
  it("collects marker lines as conditions", () => {
    const text = "把测试修到通过\nDone when:\n- pnpm check 通过\n- e2e 通过";
    expect(parseDoneWhen(text)).toEqual(["pnpm check 通过", "e2e 通过"]);
  });

  it("supports the Chinese marker and ignores non-list content after conditions", () => {
    const text = "目标\n完成条件：\n1. A\n2. B\n\n无关段落";
    expect(parseDoneWhen(text)).toEqual(["A", "B"]);
  });

  it("returns empty without a marker", () => {
    expect(parseDoneWhen("只是普通任务")).toEqual([]);
  });
});
