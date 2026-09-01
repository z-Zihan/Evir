import { describe, expect, it, vi, beforeEach } from "vitest";
import { useWorkspacePanelStore, shouldAutoOpenResource } from "../workspace-panel-store";
import { useRunWorkspaceStore } from "../workspace-run-store";
import { emitWorkspaceToolEvent, subscribeWorkspaceToolEvents } from "../workspace-events";
import { detectDevScriptFromPackageJson, packageManagerFor } from "../dev-server-service";
import type { AgentRunRecord } from "../../chat/agent-run-record";
import type { ToolCallRecord, ToolResultRecord } from "../../../core/storage/db";
import type { SnapshotResult } from "../../../runtime/desktop-storage-adapter";

function call(id: string, toolName: string, args: Record<string, unknown>): ToolCallRecord {
  return { id, toolName, arguments: args };
}

function result(id: string, toolName: string, success = true): ToolResultRecord {
  return { toolCallId: id, toolName, success, output: "ok", completedAt: 1 };
}

function snapshot(path: string, existed: boolean): SnapshotResult {
  return { snapshot_id: `s-${path}`, file_path: path, existed, original_hash: null };
}

function runRecord(overrides: Partial<AgentRunRecord> = {}): AgentRunRecord {
  return {
    id: "run-1",
    conversationId: "c-1",
    status: "completed",
    toolCalls: [],
    toolResults: [],
    snapshots: [],
    fileReferences: [],
    verificationEvidence: [],
    resolution: { complete: true, reason: "verified" },
    maxIterationsReached: false,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("workspace panel store", () => {
  beforeEach(() => {
    useWorkspacePanelStore.setState({
      open: false,
      activeTab: "changes",
      activeResource: null,
      history: [],
      historyIndex: -1,
      pinnedKey: null,
      viewMode: "preview",
      overlayBlockers: null,
      browserContextUrl: null,
      conversationSnapshots: {},
    });
  });

  it("openResource switches to the preview tab and records history", () => {
    const { openResource } = useWorkspacePanelStore.getState();
    openResource({ kind: "file", path: "/a/App.tsx" });
    openResource({ kind: "file", path: "/a/index.html" });
    const state = useWorkspacePanelStore.getState();
    expect(state.open).toBe(true);
    expect(state.activeTab).toBe("preview");
    expect(state.activeResource).toEqual({ kind: "file", path: "/a/index.html" });
    expect(state.history).toHaveLength(2);
    expect(state.historyIndex).toBe(1);
  });

  it("re-opening the current resource does not spam history", () => {
    const { openResource } = useWorkspacePanelStore.getState();
    openResource({ kind: "file", path: "/a/App.tsx" });
    openResource({ kind: "file", path: "/a/App.tsx" });
    expect(useWorkspacePanelStore.getState().history).toHaveLength(1);
  });

  it("navigates back and forward through resource history", () => {
    const store = useWorkspacePanelStore.getState();
    store.openResource({ kind: "file", path: "/a/1" });
    store.openResource({ kind: "file", path: "/a/2" });
    useWorkspacePanelStore.getState().goBack();
    let state = useWorkspacePanelStore.getState();
    expect(state.activeResource).toEqual({ kind: "file", path: "/a/1" });
    expect(state.canGoForward()).toBe(true);
    useWorkspacePanelStore.getState().goForward();
    state = useWorkspacePanelStore.getState();
    expect(state.activeResource).toEqual({ kind: "file", path: "/a/2" });
  });

  it("pins and unpins the active resource", () => {
    const store = useWorkspacePanelStore.getState();
    store.openResource({ kind: "url", uri: "http://localhost:5173" });
    useWorkspacePanelStore.getState().togglePin();
    expect(useWorkspacePanelStore.getState().pinnedKey).toBe("url:http://localhost:5173");
    useWorkspacePanelStore.getState().togglePin();
    expect(useWorkspacePanelStore.getState().pinnedKey).toBeNull();
  });

  it("auto-open respects pinned resources", () => {
    expect(shouldAutoOpenResource("file:/a/1", { kind: "file", path: "/a/1" })).toBe(true);
    expect(shouldAutoOpenResource("url:http://x", { kind: "file", path: "/a/1" })).toBe(false);
    expect(shouldAutoOpenResource(null, { kind: "file", path: "/a/1" })).toBe(true);
  });

  it("saves and restores per-conversation snapshots without leaking", () => {
    const store = useWorkspacePanelStore.getState();
    store.openResource({ kind: "file", path: "/proj-a/index.html" });
    store.saveConversationState("thread-a");
    useWorkspacePanelStore.getState().closePanel();
    useWorkspacePanelStore.getState().openResource({ kind: "file", path: "/proj-b/x" });
    useWorkspacePanelStore.getState().saveConversationState("thread-b");

    useWorkspacePanelStore.getState().restoreConversationState("thread-a");
    expect(useWorkspacePanelStore.getState().activeResource).toEqual({
      kind: "file",
      path: "/proj-a/index.html",
    });
    expect(useWorkspacePanelStore.getState().open).toBe(true);

    useWorkspacePanelStore.getState().restoreConversationState("unknown-thread");
    expect(useWorkspacePanelStore.getState().open).toBe(false);
    expect(useWorkspacePanelStore.getState().activeResource).toBeNull();
  });

  it("stacks overlay blockers and clears only when all close", () => {
    const setBlocked = useWorkspacePanelStore.getState().setOverlayBlocked;
    setBlocked("settings", true);
    setBlocked("lightbox", true);
    expect(useWorkspacePanelStore.getState().overlayBlockers).toEqual({
      settings: true,
      lightbox: true,
    });
    setBlocked("settings", false);
    expect(useWorkspacePanelStore.getState().overlayBlockers).toEqual({ lightbox: true });
    setBlocked("lightbox", false);
    expect(useWorkspacePanelStore.getState().overlayBlockers).toBeNull();
  });
});

describe("workspace tool events", () => {
  it("delivers events to subscribers and isolates their crashes", () => {
    const good = vi.fn();
    const bad = vi.fn(() => {
      throw new Error("listener exploded");
    });
    const unsubscribeGood = subscribeWorkspaceToolEvents(good);
    subscribeWorkspaceToolEvents(bad);
    expect(() =>
      emitWorkspaceToolEvent({
        conversationId: "c",
        runId: "r",
        toolCall: call("t", "write_file", { path: "/x" }),
        result: result("t", "write_file"),
        newSnapshots: [],
      }),
    ).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
    expect(bad).toHaveBeenCalledTimes(1);
    unsubscribeGood();
    emitWorkspaceToolEvent({
      conversationId: "c",
      runId: "r",
      toolCall: call("t2", "write_file", { path: "/y" }),
      result: result("t2", "write_file"),
      newSnapshots: [],
    });
    expect(good).toHaveBeenCalledTimes(1);
  });
});

describe("run workspace store", () => {
  it("hydrates changes and outputs from a persisted record", () => {
    useRunWorkspaceStore.getState().hydrate(
      runRecord({
        toolCalls: [call("w1", "write_file", { path: "/p/report.html" })],
        toolResults: [result("w1", "write_file")],
        snapshots: [snapshot("/p/report.html", false)],
      }),
    );
    const state = useRunWorkspaceStore.getState();
    expect(state.runId).toBe("run-1");
    expect(state.changes.map((c) => c.changeType)).toEqual(["added"]);
    expect(state.outputs).toHaveLength(1);
    expect(state.outputs[0]?.path).toBe("/p/report.html");
  });

  it("applies live tool events incrementally within the same run", () => {
    useRunWorkspaceStore.getState().hydrate(runRecord());
    emitWorkspaceToolEvent({
      conversationId: "c-1",
      runId: "run-1",
      toolCall: call("x1", "write_file", { path: "/p/new.svg" }),
      result: result("x1", "write_file"),
      newSnapshots: [snapshot("/p/new.svg", false)],
    });
    let state = useRunWorkspaceStore.getState();
    expect(state.changes).toHaveLength(1);
    expect(state.outputs).toHaveLength(1);
    emitWorkspaceToolEvent({
      conversationId: "c-1",
      runId: "run-1",
      toolCall: call("x2", "browser_screenshot", {}),
      result: {
        toolCallId: "x2",
        toolName: "browser_screenshot",
        success: true,
        output: JSON.stringify({ path: "/shots/2.png" }),
        completedAt: 2,
      },
      newSnapshots: [],
    });
    state = useRunWorkspaceStore.getState();
    expect(state.outputs).toHaveLength(2);
    expect(state.browserActive).toBe(true);
  });

  it("resets when a different run starts", () => {
    useRunWorkspaceStore.getState().hydrate(
      runRecord({
        toolCalls: [call("w1", "write_file", { path: "/p/old.html" })],
        toolResults: [result("w1", "write_file")],
        snapshots: [snapshot("/p/old.html", false)],
      }),
    );
    emitWorkspaceToolEvent({
      conversationId: "c-2",
      runId: "run-2",
      toolCall: call("n1", "write_file", { path: "/p2/next.html" }),
      result: result("n1", "write_file"),
      newSnapshots: [snapshot("/p2/next.html", false)],
    });
    const state = useRunWorkspaceStore.getState();
    expect(state.runId).toBe("run-2");
    expect(state.changes).toHaveLength(1);
    expect(state.changes[0]?.path).toBe("/p2/next.html");
  });
});

describe("dev script detection", () => {
  it("prefers dev > start > preview and reports the raw command", () => {
    const plan = detectDevScriptFromPackageJson(
      JSON.stringify({ scripts: { start: "node server.js", dev: "vite --port 3000" } }),
    );
    expect(plan).toMatchObject({ scriptName: "dev", command: "vite --port 3000" });
    expect(plan?.args).toEqual(["run", "dev"]);

    const fallback = detectDevScriptFromPackageJson(
      JSON.stringify({ scripts: { preview: "vite preview", build: "x" } }),
    );
    expect(fallback?.scriptName).toBe("preview");
  });

  it("returns null for broken json or scriptless packages", () => {
    expect(detectDevScriptFromPackageJson("{oops")).toBeNull();
    expect(detectDevScriptFromPackageJson(JSON.stringify({ name: "x" }))).toBeNull();
    expect(detectDevScriptFromPackageJson(JSON.stringify({ scripts: { build: "x" } }))).toBeNull();
  });

  it("maps lockfiles to package managers", () => {
    expect(packageManagerFor(["pnpm-lock.yaml"])).toEqual({ program: "pnpm", runArgs: ["run"] });
    expect(packageManagerFor(["yarn.lock"])).toEqual({ program: "yarn", runArgs: [] });
    expect(packageManagerFor(["package-lock.json"])).toEqual({ program: "npm", runArgs: ["run"] });
    expect(packageManagerFor([])).toEqual({ program: "npm", runArgs: ["run"] });
  });
});
