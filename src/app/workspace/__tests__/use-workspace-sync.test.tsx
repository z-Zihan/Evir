// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationRecord } from "../../../core/storage/db";
import { useWorkspacePanelStore } from "../../../features/workspace/workspace-panel-store";
import {
  markWorkbenchClosedForProject,
  readClosedWorkbenchProjects,
} from "../../../features/workspace/workbench-preference";

vi.mock("../../../runtime/use-runtime", () => ({
  getRuntime: () => ({ target: "desktop", capabilities: new Set(), has: () => false }),
}));

import { useChatStore } from "../../../features/chat/chat-store";
import { useWorkspaceSync } from "../use-workspace-sync";

const CLOSED_KEY = "evir-workbench-closed-projects::default";

function conversation(id: string, projectId: string | null): ConversationRecord {
  return {
    id,
    title: id,
    projectId,
    providerId: "p",
    modelId: "m",
    createdAt: 1,
    updatedAt: 1,
  };
}

function resetPanel() {
  useWorkspacePanelStore.setState({
    open: false,
    activeTab: "outputs",
    activeResource: null,
    history: [],
    historyIndex: -1,
    pinnedKey: null,
    viewMode: "preview",
    changesBadge: 0,
    conversationSnapshots: {},
  });
}

afterEach(cleanup);
beforeEach(() => {
  window.localStorage.clear();
  resetPanel();
  useChatStore.setState({ latestAgentRun: null });
});

describe("useWorkspaceSync workbench defaults", () => {
  it("a fresh project thread opens the workbench on Changes", async () => {
    useChatStore.setState({
      conversations: [conversation("t1", "p1")],
      currentConversationId: "t1",
    });
    renderHook(({ id }) => useWorkspaceSync(id), { initialProps: { id: "t1" } });
    await waitFor(() => {
      expect(useWorkspacePanelStore.getState().open).toBe(true);
      expect(useWorkspacePanelStore.getState().activeTab).toBe("changes");
    });
  });

  it("a standalone chat never opens the workbench", async () => {
    useChatStore.setState({
      conversations: [conversation("chat1", null)],
      currentConversationId: "chat1",
    });
    renderHook(({ id }) => useWorkspaceSync(id), {
      initialProps: { id: "chat1" },
    });
    await waitFor(() => {
      expect(useWorkspacePanelStore.getState().open).toBe(false);
    });
  });

  it("an explicit close is remembered per project and stops the default until reopened", async () => {
    useChatStore.setState({
      conversations: [conversation("t1", "p1"), conversation("t2", "p1")],
      currentConversationId: "t1",
    });
    const { rerender } = renderHook(({ id }) => useWorkspaceSync(id), {
      initialProps: { id: "t1" },
    });
    await waitFor(() => expect(useWorkspacePanelStore.getState().open).toBe(true));

    // The user closes the workbench while a p1 thread is on screen.
    useWorkspacePanelStore.getState().closePanel();
    await waitFor(() => {
      expect(readClosedWorkbenchProjects().has("p1")).toBe(true);
    });

    // A different fresh thread in the same project stays closed.
    useWorkspacePanelStore.setState({ conversationSnapshots: {} });
    useChatStore.setState({ currentConversationId: "t2" });
    rerender({ id: "t2" });
    await waitFor(() => {
      expect(useWorkspacePanelStore.getState().open).toBe(false);
    });

    // Reopening clears the preference, so the next fresh thread defaults open.
    useWorkspacePanelStore.getState().openPanel("changes");
    await waitFor(() => {
      expect(readClosedWorkbenchProjects().has("p1")).toBe(false);
    });
    useWorkspacePanelStore.setState({ conversationSnapshots: {} });
    useChatStore.setState({
      conversations: [conversation("t3", "p1")],
      currentConversationId: "t3",
    });
    rerender({ id: "t3" });
    await waitFor(() => {
      expect(useWorkspacePanelStore.getState().open).toBe(true);
      expect(useWorkspacePanelStore.getState().activeTab).toBe("changes");
    });
  });
});

describe("workbench preference storage", () => {
  it("stores ids as a profile-scoped JSON array", () => {
    expect(window.localStorage.getItem(CLOSED_KEY)).toBeNull();
    markWorkbenchClosedForProject("pX");
    expect(JSON.parse(window.localStorage.getItem(CLOSED_KEY) ?? "[]")).toEqual(["pX"]);
  });
});
