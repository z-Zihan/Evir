// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatView } from "../ChatView";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        "workspace.annotation.header": "【浏览器反馈】",
        "workspace.annotation.url": "URL",
        "workspace.annotation.element": "元素",
        "workspace.annotation.box": "位置",
        "workspace.annotation.comment": "请修改",
      };
      return map[key] ?? key;
    },
    i18n: { exists: () => false, resolvedLanguage: "zh-CN" },
  }),
}));

// Capture the annotation subscription so the test can fire a payload.
let annotationHandler: ((raw: unknown) => void) | null = null;
vi.mock("../../features/workspace/browser-panel-service", () => ({
  subscribePanelAnnotations: (handler: (raw: unknown) => void) => {
    annotationHandler = handler;
    return Promise.resolve(() => {
      annotationHandler = null;
    });
  },
  panelLayoutUpdate: vi.fn().mockResolvedValue(undefined),
  panelTabList: vi.fn().mockResolvedValue([]),
  panelTabNew: vi.fn().mockResolvedValue({ id: 1, url: "", title: "", active: true }),
  panelTabActivate: vi.fn(),
  panelTabClose: vi.fn(),
  panelTabNavigate: vi.fn(),
  panelTabHistory: vi.fn(),
  readScreenshotBase64: vi.fn(),
}));

vi.mock("../ModelSwitcher", () => ({ ModelSwitcher: () => null }));
vi.mock("../MarkdownContent", () => ({ MarkdownContent: () => null }));
vi.mock("../ChatMessage", () => ({ ChatMessage: () => null }));
vi.mock("../ChatEmptyState", () => ({ ChatEmptyState: () => null }));
vi.mock("../AgentRunSummary", () => ({ AgentRunSummary: () => null }));
vi.mock("../SkillPicker", () => ({ SkillPicker: () => null }));
vi.mock("../PermissionSwitcher", () => ({ PermissionSwitcher: () => null }));
vi.mock("../SlashPalette", () => ({ SlashPalette: () => null }));
vi.mock("../use-drag-drop", () => ({ useDragDrop: () => ({ dragOver: false }) }));
let runtimeTarget: "web" | "desktop" = "desktop";
vi.mock("../../runtime/use-runtime", () => ({
  getRuntime: () => ({ target: runtimeTarget, has: () => runtimeTarget === "desktop" }),
}));
vi.mock("../../features/chat/chat-store", () => ({
  useChatStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      messages: [],
      mode: "agent",
      isStreaming: false,
      activeStreamConversationId: null,
      activeStreamStartedAt: null,
      streamingContent: "",
      error: null,
      sendMessage: vi.fn(),
      regenerate: vi.fn(),
      editMessage: vi.fn(),
      stopGeneration: vi.fn(),
      pendingAttachments: [],
      addAttachment: vi.fn(),
      removeAttachment: vi.fn(),
      setMode: vi.fn(),
      updateConversationProvider: vi.fn(),
      currentConversationId: "c1",
      conversations: [],
      latestAgentRun: null,
      pendingToolApproval: null,
      selectedSkillIds: new Set(),
      toggleSelectedSkill: vi.fn(),
      privateSession: false,
    }),
}));
vi.mock("../../features/provider/provider-store", () => ({
  useProviderStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      getDefaultProvider: () => ({
        id: "p1",
        modelId: "m1",
        modelCapabilities: { toolCalling: true },
      }),
      switchProvider: vi.fn(),
      providers: [],
    }),
}));
vi.mock("../../features/skills/skill-store", () => ({
  useSkillStore: () => ({ skills: [] }),
}));
vi.mock("../../features/memory/memory-store", () => ({
  useMemoryStore: () => ({ addMemory: vi.fn() }),
}));
vi.mock("../../features/orchestration/orchestration-store", () => ({
  useOrchestrationStore: Object.assign(
    (selector?: (state: { current: null }) => unknown) =>
      selector ? selector({ current: null }) : { current: null },
    { getState: () => ({ current: null }) },
  ),
}));
vi.mock("../../features/projects/project-store", () => ({
  useProjectStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) =>
      selector({ projects: [], currentProjectId: null }),
    { getState: () => ({ projects: [], currentProjectId: null }) },
  ),
}));
vi.mock("../../features/workspace/workspace-bridge", () => ({
  useActiveWorkspaceRoot: () => "/tmp/demo",
}));

afterEach(() => {
  runtimeTarget = "desktop";
  cleanup();
});

describe("browser annotation → composer draft", () => {
  it("does not expose the Workspace entry in the Web product", () => {
    runtimeTarget = "web";
    render(
      <ChatView
        input=""
        onInputChange={vi.fn()}
        onSendMessage={vi.fn()}
        onOpenSettings={vi.fn()}
        onNewConversation={vi.fn()}
        onToggleSidebar={vi.fn()}
        sidebarVisible
      />,
    );
    expect(screen.queryByRole("button", { name: "workspace.open" })).toBeNull();
  });

  it("prefills a Browser Feedback draft when an annotation payload arrives (§37)", async () => {
    const onInputChange = vi.fn();
    render(
      <ChatView
        input=""
        onInputChange={onInputChange}
        onSendMessage={vi.fn()}
        onOpenSettings={vi.fn()}
        onNewConversation={vi.fn()}
        onToggleSidebar={vi.fn()}
        sidebarVisible
      />,
    );
    // Let the subscription promise resolve.
    await vi.waitFor(() => expect(annotationHandler).not.toBeNull());
    annotationHandler?.({
      url: "http://localhost:5173/login",
      tag: "button",
      id: "login",
      classes: null,
      role: null,
      ariaLabel: null,
      name: null,
      text: "登录",
      box: { x: 120, y: 40, width: 180, height: 44 },
      selector: "button#login",
    });
    expect(onInputChange).toHaveBeenCalledTimes(1);
    const draft = onInputChange.mock.calls[0]?.[0] as string;
    expect(draft).toContain("【浏览器反馈】");
    expect(draft).toContain("URL: http://localhost:5173/login");
    expect(draft).toContain('元素: button "登录"#login');
    expect(draft).toContain("位置: 180×44 @ (120, 40)");
    expect(draft.endsWith("请修改: ")).toBe(true);
  });

  it("ignores malformed payloads without touching the draft", async () => {
    const onInputChange = vi.fn();
    render(
      <ChatView
        input=""
        onInputChange={onInputChange}
        onSendMessage={vi.fn()}
        onOpenSettings={vi.fn()}
        onNewConversation={vi.fn()}
        onToggleSidebar={vi.fn()}
        sidebarVisible
      />,
    );
    await vi.waitFor(() => expect(annotationHandler).not.toBeNull());
    annotationHandler?.({ tag: "button" });
    annotationHandler?.("garbage");
    expect(onInputChange).not.toHaveBeenCalled();
  });
});
