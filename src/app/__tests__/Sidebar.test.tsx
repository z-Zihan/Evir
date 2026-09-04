// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const deleteConversation = vi.fn<(id: string) => Promise<void>>();
const togglePin = vi.fn<(id: string) => Promise<void>>();

const chatState = {
  conversations: [
    {
      id: "conversation-1",
      title: "产品讨论",
      providerId: "provider-1",
      modelId: "model-1",
      createdAt: 1,
      updatedAt: 1,
    },
    {
      id: "conversation-2",
      title:
        "一个特别长的任务标题用来验证侧边栏 More 菜单出现后标题保持截断且状态徽标不被挤出或遮挡 an-extremely-long-project-thread-title-for-truncation",
      providerId: "provider-1",
      modelId: "model-1",
      createdAt: 2,
      updatedAt: 2,
    },
  ],
  currentConversationId: null as string | null,
  selectConversation: vi.fn(),
  deleteConversation,
  renameConversation: vi.fn(),
  togglePin,
  createConversation: vi.fn(),
};

vi.mock("../../features/chat/chat-store", () => ({
  useChatStore: Object.assign(
    (selector?: (state: typeof chatState) => unknown) =>
      selector ? selector(chatState) : chatState,
    { getState: () => chatState },
  ),
}));

vi.mock("../../features/projects/project-store", () => ({
  useProjectStore: (selector?: (state: Record<string, unknown>) => unknown) =>
    selector
      ? selector({
          projects: [],
          currentProjectId: null,
          loaded: true,
          folderMissing: {},
          load: vi.fn().mockResolvedValue(undefined),
          addProject: vi.fn(),
          selectProject: vi.fn(),
          renameProject: vi.fn(),
          togglePinProject: vi.fn(),
          rebindProject: vi.fn(),
          removeProject: vi.fn(),
          setPermissionProfile: vi.fn(),
          addAccessRoot: vi.fn(),
          removeAccessRoot: vi.fn(),
          refreshFolderStatus: vi.fn(),
          currentProject: () => null,
        })
      : {
          projects: [],
          currentProjectId: null,
          loaded: true,
          folderMissing: {},
          load: vi.fn().mockResolvedValue(undefined),
          addProject: vi.fn(),
          selectProject: vi.fn(),
          renameProject: vi.fn(),
          togglePinProject: vi.fn(),
          rebindProject: vi.fn(),
          removeProject: vi.fn(),
          setPermissionProfile: vi.fn(),
          addAccessRoot: vi.fn(),
          removeAccessRoot: vi.fn(),
          refreshFolderStatus: vi.fn(),
          currentProject: () => null,
        },
}));

vi.mock("../../runtime/use-runtime", () => ({
  getRuntime: () => ({ target: "web" as const, capabilities: new Set(), has: () => false }),
}));

vi.mock("../../features/provider/provider-store", () => ({
  useProviderStore: { getState: () => ({ getDefaultProvider: () => null }) },
}));

vi.mock("../../features/settings/personalization-settings", () => ({
  loadPersonalizationPreferences: vi.fn().mockResolvedValue({
    displayName: "",
    avatarColor: "sage",
    avatarImage: "",
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function openMoreMenuFor(title: string | RegExp) {
  const row = screen.getByText(title).closest(".conversation-item");
  if (!row) throw new Error(`row for ${String(title)} not found`);
  const trigger = row.querySelector('button[aria-label="sidebar.more"]');
  if (!trigger) throw new Error("more trigger not found in row");
  fireEvent.click(trigger);
  return within(screen.getByRole("menu"));
}

describe("Sidebar", () => {
  it("keeps secondary actions in the ••• menu and none exposed on the row", async () => {
    const { Sidebar } = await import("../Sidebar");
    render(<Sidebar onOpenSettings={vi.fn()} onNewConversation={vi.fn()} onClose={vi.fn()} />);

    // The only hover controls are 新任务 (projects only) and ••• — pin/rename/
    // delete buttons must not be exposed directly on conversation rows.
    expect(screen.queryByRole("button", { name: "sidebar.pin" })).toBeNull();
    expect(screen.queryByRole("button", { name: "sidebar.rename" })).toBeNull();
    expect(screen.queryByRole("button", { name: "provider.delete" })).toBeNull();

    openMoreMenuFor("产品讨论");
    const menu = screen.getByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "sidebar.pin" })).toBeTruthy();
    expect(within(menu).getByRole("menuitem", { name: "sidebar.rename" })).toBeTruthy();
    expect(within(menu).getByRole("menuitem", { name: "provider.delete" })).toBeTruthy();
  });

  it("pins a conversation from the ••• menu", async () => {
    const { Sidebar } = await import("../Sidebar");
    render(<Sidebar onOpenSettings={vi.fn()} onNewConversation={vi.fn()} onClose={vi.fn()} />);

    const menu = openMoreMenuFor("产品讨论");
    fireEvent.click(menu.getByRole("menuitem", { name: "sidebar.pin" }));

    await waitFor(() => expect(togglePin).toHaveBeenCalledWith("conversation-1"));
  });

  it("requires confirmation before deleting a conversation via the ••• menu", async () => {
    const { Sidebar } = await import("../Sidebar");
    render(<Sidebar onOpenSettings={vi.fn()} onNewConversation={vi.fn()} onClose={vi.fn()} />);

    const menu = openMoreMenuFor("产品讨论");
    fireEvent.click(menu.getByRole("menuitem", { name: "provider.delete" }));
    expect(deleteConversation).not.toHaveBeenCalled();
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "provider.delete",
      }),
    );

    await waitFor(() => expect(deleteConversation).toHaveBeenCalledWith("conversation-1"));
  });

  it("exposes keyboard/AT metadata on the ••• trigger", async () => {
    const { Sidebar } = await import("../Sidebar");
    render(<Sidebar onOpenSettings={vi.fn()} onNewConversation={vi.fn()} onClose={vi.fn()} />);

    const triggers = screen.getAllByRole("button", { name: "sidebar.more" });
    expect(triggers.length).toBe(chatState.conversations.length);
    for (const trigger of triggers) {
      expect(trigger.getAttribute("aria-haspopup")).toBeTruthy();
      // Base UI drives aria-expanded when the menu opens (keyboard: Enter/Space).
      expect(trigger.getAttribute("aria-expanded")).toBe("false");
    }
    const [firstTrigger] = triggers;
    if (!firstTrigger) throw new Error("no more trigger");
    fireEvent.click(firstTrigger);
    await waitFor(() => expect(firstTrigger.getAttribute("aria-expanded")).toBe("true"));
  });

  it("keeps long titles truncated with the More trigger present (no row shift)", async () => {
    const { Sidebar } = await import("../Sidebar");
    render(<Sidebar onOpenSettings={vi.fn()} onNewConversation={vi.fn()} onClose={vi.fn()} />);

    const titles = screen.getAllByText(/一个特别长的任务标题/);
    expect(titles.length).toBeGreaterThan(0);
    for (const title of titles) {
      expect(title.className).toContain("truncate");
      // The ••• trigger reserves its slot in the same row even before hover.
      const row = title.closest(".conversation-item");
      expect(row?.querySelector('[aria-label="sidebar.more"]')).toBeTruthy();
    }
  });

  it("has no sort control and clears the legacy sort key on mount", async () => {
    window.localStorage.setItem("evir-sidebar-sort", "name");
    const { Sidebar } = await import("../Sidebar");
    render(<Sidebar onOpenSettings={vi.fn()} onNewConversation={vi.fn()} onClose={vi.fn()} />);

    expect(screen.queryByRole("button", { name: "sidebar.sortToggle" })).toBeNull();
    expect(window.localStorage.getItem("evir-sidebar-sort")).toBeNull();
  });

  it("orders conversations pinned-first then by updatedAt descending", async () => {
    const original = [...chatState.conversations];
    chatState.conversations = [
      {
        id: "old-chat",
        title: "Older chat",
        providerId: "provider-1",
        modelId: "model-1",
        createdAt: 1,
        updatedAt: 100,
      },
      {
        id: "pinned-old",
        title: "Pinned older",
        providerId: "provider-1",
        modelId: "model-1",
        createdAt: 1,
        updatedAt: 50,
        pinned: 1,
      },
      {
        id: "new-chat",
        title: "Newest chat",
        providerId: "provider-1",
        modelId: "model-1",
        createdAt: 1,
        updatedAt: 200,
      },
    ] as unknown as typeof chatState.conversations;
    try {
      const { Sidebar } = await import("../Sidebar");
      render(<Sidebar onOpenSettings={vi.fn()} onNewConversation={vi.fn()} onClose={vi.fn()} />);

      const rows = [...document.querySelectorAll(".sidebar-section-chats .conversation-item")].map(
        (row) => row.textContent ?? "",
      );
      const order = rows.map((text) =>
        text.includes("Pinned older")
          ? "pinned-old"
          : text.includes("Newest chat")
            ? "new-chat"
            : "old-chat",
      );
      expect(order).toEqual(["pinned-old", "new-chat", "old-chat"]);
    } finally {
      chatState.conversations = original;
    }
  });

  it("shows the relative time sharing the trailing slot with ••• (no layout shift)", async () => {
    const original = [...chatState.conversations];
    const now = Date.now();
    chatState.conversations = [
      {
        id: "recent-chat",
        title: "Recent chat",
        providerId: "provider-1",
        modelId: "model-1",
        createdAt: 1,
        updatedAt: now - 3 * 60_000,
      },
    ];
    try {
      const { Sidebar } = await import("../Sidebar");
      render(<Sidebar onOpenSettings={vi.fn()} onNewConversation={vi.fn()} onClose={vi.fn()} />);

      const time = document.querySelector("time.conversation-time");
      expect(time).toBeTruthy();
      // Relative minutes since the row's language falls back to English.
      expect(time?.textContent).toBe("3m");
      // Same grid cell as the more menu, swapped out on hover/focus — the
      // time keeps its box (invisible, not display:none) so nothing shifts.
      const slot = time?.closest(".conversation-trailing");
      expect(slot).toBeTruthy();
      expect(slot?.querySelector('[aria-label="sidebar.more"]')).toBeTruthy();
      expect(time?.className).toContain("group-hover:invisible");
      const actions = slot?.querySelector(".conversation-actions") as HTMLElement | null;
      expect(actions?.className).toContain("opacity-0");
      expect(actions?.className).toContain("group-hover:opacity-100");
    } finally {
      chatState.conversations = original;
    }
  });
});
