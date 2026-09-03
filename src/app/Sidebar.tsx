import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  ChevronRight,
  FolderPlus,
  MessageSquarePlus,
  Search,
  Settings2,
  X,
} from "lucide-react";
import { Button, Input, Tip } from "../components/ui";
import type { PersonalizationPreferences } from "../core/personalization/types";
import { isMac } from "../core/shortcuts/platform";
import type { ProjectRecord } from "../core/storage/db";
import { useChatStore } from "../features/chat/chat-store";
import { useProjectStore } from "../features/projects/project-store";
import { useScrollNewProjectIntoView } from "./useScrollNewProjectIntoView";
import { useProviderStore } from "../features/provider/provider-store";
import { loadPersonalizationPreferences } from "../features/settings/personalization-settings";
import { getRuntime } from "../runtime/use-runtime";
import type { SettingsTab } from "./SettingsModal";
import { ProjectPermissionPanel } from "./ProjectPermissionPanel";
import { SidebarConversationItem } from "./SidebarConversationItem";
import { useConversationStatusIndex } from "./useConversationStatus";
import { SidebarProjectItem } from "./SidebarProjectItem";
import { useConfirmationDialog } from "./useConfirmationDialog";

interface SidebarProps {
  onOpenSettings: (tab?: SettingsTab) => void;
  onNewConversation: () => void;
  onClose: () => void;
}

type SortOrder = "recent" | "name";

const SORT_KEY = "evir-sidebar-sort";
const EXPANDED_KEY = "evir-sidebar-expanded-projects";

function readSortOrder(): SortOrder {
  return localStorage.getItem(SORT_KEY) === "name" ? "name" : "recent";
}

function readExpanded(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

export function Sidebar({ onOpenSettings, onNewConversation, onClose }: SidebarProps) {
  const { t } = useTranslation();
  // Field selectors keep the sidebar out of per-frame streaming re-renders;
  // only conversation/project list changes repaint it.
  const conversations = useChatStore((state) => state.conversations);
  const currentConversationId = useChatStore((state) => state.currentConversationId);
  const selectConversation = useChatStore((state) => state.selectConversation);
  const deleteConversation = useChatStore((state) => state.deleteConversation);
  const renameConversation = useChatStore((state) => state.renameConversation);
  const togglePin = useChatStore((state) => state.togglePin);
  const createConversation = useChatStore((state) => state.createConversation);
  const projects = useProjectStore((state) => state.projects);
  const currentProjectId = useProjectStore((state) => state.currentProjectId);
  const folderMissing = useProjectStore((state) => state.folderMissing);
  const loadProjects = useProjectStore((state) => state.load);
  const addProject = useProjectStore((state) => state.addProject);
  const selectProject = useProjectStore((state) => state.selectProject);
  const renameProject = useProjectStore((state) => state.renameProject);
  const togglePinProject = useProjectStore((state) => state.togglePinProject);
  const rebindProject = useProjectStore((state) => state.rebindProject);
  const removeProject = useProjectStore((state) => state.removeProject);
  // Live per-row run status (running / approval / failed / unread). The hook's
  // projections stay stable across streaming deltas, so the sidebar tree does
  // not repaint on every token.
  const statusIndex = useConversationStatusIndex();
  const [search, setSearch] = useState("");
  const [sortOrder, setSortOrder] = useState<SortOrder>(readSortOrder);
  const [expanded, setExpanded] = useState<Set<string>>(readExpanded);
  const [permissionProjectId, setPermissionProjectId] = useState<string | null>(null);
  const [identity, setIdentity] = useState<
    Pick<PersonalizationPreferences, "displayName" | "avatarColor" | "avatarImage">
  >({ displayName: "", avatarColor: "sage", avatarImage: "" });
  const { requestConfirmation, confirmationDialog } = useConfirmationDialog();
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    let mounted = true;
    const loadIdentity = () => {
      void loadPersonalizationPreferences().then((preferences) => {
        if (mounted) setIdentity(preferences);
      });
    };
    loadIdentity();
    window.addEventListener("evir:personalization-updated", loadIdentity);
    return () => {
      mounted = false;
      window.removeEventListener("evir:personalization-updated", loadIdentity);
    };
  }, []);

  useEffect(() => {
    localStorage.setItem(SORT_KEY, sortOrder);
  }, [sortOrder]);

  const persistExpanded = (next: Set<string>) => {
    setExpanded(next);
    localStorage.setItem(EXPANDED_KEY, JSON.stringify([...next]));
  };

  const shortcutModifier = isMac() ? "⌘" : "Ctrl+";
  const localName = identity.displayName.trim() || t("chat.localUser");
  const localInitial = Array.from(localName)[0] ?? "•";

  const query = search.trim().toLowerCase();
  const matches = (...values: Array<string | undefined>) =>
    query.length === 0 || values.some((value) => value?.toLowerCase().includes(query));

  const sortProjects = (items: ProjectRecord[]) =>
    [...items].sort((a, b) => {
      if (sortOrder === "name") {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        return a.displayName.localeCompare(b.displayName);
      }
      return (b.pinned ?? 0) - (a.pinned ?? 0) || b.lastOpenedAt - a.lastOpenedAt;
    });

  const sortConversations = <T extends { pinned?: number; updatedAt: number; title: string }>(
    items: T[],
  ) =>
    [...items].sort((a, b) => {
      if (sortOrder === "name") {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        return (a.title || "").localeCompare(b.title || "");
      }
      return (b.pinned ?? 0) - (a.pinned ?? 0) || b.updatedAt - a.updatedAt;
    });

  const visibleProjects = useMemo(
    () =>
      sortProjects(
        projects.filter(
          (project) =>
            query.length === 0 ||
            matches(project.displayName, project.rootPath) ||
            conversations.some((c) => c.projectId === project.id && matches(c.title)),
        ),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projects, conversations, query, sortOrder],
  );

  const projectsScrollRef = useScrollNewProjectIntoView(visibleProjects);

  const standaloneChats = useMemo(
    () => sortConversations(conversations.filter((c) => !c.projectId && matches(c.title))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [conversations, query, sortOrder],
  );

  const threadsOf = useMemo(
    () => (projectId: string) =>
      sortConversations(conversations.filter((c) => c.projectId === projectId && matches(c.title))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [conversations, query, sortOrder],
  );

  const handleAddProject = async () => {
    const runtime = getRuntime();
    const selected = await runtime.selectWorkspaceDirectory?.();
    if (!selected) return;
    const result = await addProject(selected);
    if (result.error === "folder-missing") {
      requestConfirmation(
        {
          title: t("project.folderInvalidTitle"),
          description: t("project.folderInvalidDescription"),
          confirmLabel: t("common.ok"),
        },
        () => undefined,
      );
    }
  };

  const handleNewTask = (project: ProjectRecord) => {
    selectProject(project.id);
    if (!expandedRef.current.has(project.id))
      persistExpanded(new Set([...expandedRef.current, project.id]));
    const provider = useProviderStore.getState().getDefaultProvider();
    if (!provider) {
      onOpenSettings("providers");
      return;
    }
    void createConversation(provider.id, provider.modelId, project.id);
    window.dispatchEvent(new CustomEvent("evir:focus-composer"));
  };

  const handleNewChat = () => {
    // Standalone chats are never bound to a project, even while a project is open.
    selectProject(null);
    onNewConversation();
  };

  const handleSelectConversation = (projectId: string | null) => (conversationId: string) => {
    selectProject(projectId);
    void selectConversation(conversationId);
  };

  const handleLocate = (project: ProjectRecord) => {
    requestConfirmation(
      {
        title: t("project.locateTitle"),
        description: t("project.locateDescription", { name: project.displayName }),
        confirmLabel: t("sidebar.locateFolder"),
      },
      async () => {
        const runtime = getRuntime();
        const selected = await runtime.selectWorkspaceDirectory?.();
        if (!selected) return;
        await rebindProject(project.id, selected);
      },
    );
  };

  const handleRemoveProject = (project: ProjectRecord) => {
    requestConfirmation(
      {
        title: t("project.removeTitle"),
        description: t("project.removeDescription", { name: project.displayName }),
        confirmLabel: t("sidebar.removeProject"),
        tone: "warning",
      },
      () => void removeProject(project.id),
    );
  };

  const permissionProject = projects.find(({ id }) => id === permissionProjectId) ?? null;

  return (
    <>
      <aside className="sidebar flex h-full min-h-0 flex-col gap-2 overflow-hidden bg-sidebar px-2.5 pt-3 pb-2.5">
        <div className="brand-row flex h-8 shrink-0 items-center gap-2 px-1">
          <div
            className="brand-mark grid size-6 shrink-0 place-items-center overflow-hidden rounded-md"
            aria-hidden="true"
          >
            <img src="/evir-mark.svg" alt="" className="size-5" />
          </div>
          <div className="brand-lockup flex min-w-0 flex-1 items-baseline gap-1.5">
            <strong className="brand-name text-[13.5px] font-bold tracking-tight text-foreground">
              Evir
            </strong>
            <span className="brand-caption truncate text-[10.5px] text-muted">
              {t("sidebar.localAi")}
            </span>
          </div>
          <Tip content={t("sidebar.hide")} side="bottom">
            <Button
              variant="ghost"
              size="icon-sm"
              className="sidebar-close"
              onClick={onClose}
              aria-label={t("sidebar.hide")}
            >
              <X size={15} />
            </Button>
          </Tip>
        </div>

        <div className="sidebar-search relative flex h-8 shrink-0 items-center">
          <Search
            size={13}
            aria-hidden="true"
            className="pointer-events-none absolute left-2.5 text-muted"
          />
          <Input
            type="search"
            value={search}
            placeholder={t("sidebar.searchPlaceholder")}
            aria-label={t("sidebar.searchPlaceholder")}
            onChange={(event) => setSearch(event.target.value)}
            className="h-8 rounded-lg bg-surface pl-8 pr-7 text-[12px]"
          />
          {search.length > 0 && (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t("common.close")}
              onClick={() => setSearch("")}
              className="absolute right-1 text-muted hover:text-foreground"
            >
              <X size={11} />
            </Button>
          )}
        </div>

        <Tip content={t("sidebar.sortToggle")}>
          <Button
            variant="ghost"
            size="sm"
            className="sidebar-sort-toggle h-6 w-fit px-1.5 text-[11px] font-normal text-muted hover:text-foreground"
            onClick={() => setSortOrder(sortOrder === "recent" ? "name" : "recent")}
            aria-label={t("sidebar.sortToggle")}
          >
            {sortOrder === "recent" ? t("sidebar.sortRecent") : t("sidebar.sortName")}
            <ChevronDown size={11} aria-hidden="true" />
          </Button>
        </Tip>

        <div className="sidebar-scroll flex min-h-0 flex-1 flex-col overflow-hidden">
          {getRuntime().target === "desktop" && (
            <section
              ref={projectsScrollRef}
              className="sidebar-section sidebar-section-projects flex min-h-0 shrink basis-1/2 flex-col overflow-y-auto pb-1"
              aria-label={t("sidebar.projects")}
            >
              <div className="section-label-row flex h-7 shrink-0 items-center justify-between pl-1.5">
                <div className="section-label text-[10.5px] font-semibold tracking-wide text-muted/90 uppercase">
                  {t("sidebar.projects")}
                </div>
                <Tip content={t("sidebar.addProject")}>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => void handleAddProject()}
                    aria-label={t("sidebar.addProject")}
                  >
                    <FolderPlus size={13} />
                  </Button>
                </Tip>
              </div>
              {visibleProjects.length === 0 ? (
                <div className="empty-list px-2 py-2 text-[11.5px] text-muted/80">
                  {t("sidebar.noProjects")}
                </div>
              ) : (
                visibleProjects.map((project) => {
                  const isOpen = expanded.has(project.id);
                  const threads = threadsOf(project.id);
                  return (
                    <div key={project.id} className="project-group" data-project-id={project.id}>
                      <SidebarProjectItem
                        project={project}
                        expanded={isOpen}
                        active={currentProjectId === project.id}
                        folderMissing={folderMissing[project.id] ?? false}
                        onToggleExpand={() => {
                          const next = new Set(expandedRef.current);
                          if (next.has(project.id)) next.delete(project.id);
                          else next.add(project.id);
                          persistExpanded(next);
                        }}
                        onSelect={() => selectProject(project.id)}
                        onNewTask={() => handleNewTask(project)}
                        onTogglePin={() => void togglePinProject(project.id)}
                        onRename={(name) => void renameProject(project.id, name)}
                        onLocate={() => handleLocate(project)}
                        onPermission={() => setPermissionProjectId(project.id)}
                        onRemove={() => handleRemoveProject(project)}
                      />
                      {isOpen &&
                        (threads.length > 0 ? (
                          <div className="project-thread-list ml-3 flex flex-col border-l border-border/70 pl-1">
                            {threads.map((conversation) => (
                              <SidebarConversationItem
                                key={conversation.id}
                                conversation={conversation}
                                variant="thread"
                                status={statusIndex.statusOf(
                                  conversation.id,
                                  conversation.updatedAt,
                                )}
                                isActive={conversation.id === currentConversationId}
                                onSelect={() =>
                                  handleSelectConversation(project.id)(conversation.id)
                                }
                                onRename={(title) =>
                                  void renameConversation(conversation.id, title)
                                }
                                onTogglePin={() => void togglePin(conversation.id)}
                                onDelete={() =>
                                  requestConfirmation(
                                    {
                                      title: t("confirmation.deleteTitle"),
                                      description: t("confirmation.deleteDescription", {
                                        item: conversation.title || t("chat.title"),
                                      }),
                                      confirmLabel: t("provider.delete"),
                                    },
                                    () => deleteConversation(conversation.id),
                                  )
                                }
                              />
                            ))}
                          </div>
                        ) : (
                          <div className="empty-list project-empty px-3 py-1.5 text-[11.5px] text-muted/80">
                            {t("sidebar.emptyProject")}
                          </div>
                        ))}
                    </div>
                  );
                })
              )}
            </section>
          )}

          <section
            className="sidebar-section sidebar-section-chats flex min-h-0 flex-1 flex-col overflow-hidden"
            aria-label={t("sidebar.chats")}
          >
            <div className="section-label-row flex h-7 shrink-0 items-center justify-between pl-1.5">
              <div className="section-label text-[10.5px] font-semibold tracking-wide text-muted/90 uppercase">
                {t("sidebar.chats")}
              </div>
              <Tip content={`${t("sidebar.newChat")} (${shortcutModifier}N)`}>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={handleNewChat}
                  aria-label={t("sidebar.newChat")}
                >
                  <MessageSquarePlus size={13} />
                </Button>
              </Tip>
            </div>
            {standaloneChats.length === 0 ? (
              <div className="empty-list px-2 py-2 text-[11.5px] text-muted/80">
                {t("sidebar.noConversations")}
              </div>
            ) : (
              <div className="conversation-list flex min-h-0 flex-1 flex-col overflow-y-auto pb-1">
                {standaloneChats.map((conversation) => (
                  <SidebarConversationItem
                    key={conversation.id}
                    conversation={conversation}
                    status={statusIndex.statusOf(conversation.id, conversation.updatedAt)}
                    isActive={conversation.id === currentConversationId}
                    onSelect={() => handleSelectConversation(null)(conversation.id)}
                    onRename={(title) => void renameConversation(conversation.id, title)}
                    onTogglePin={() => void togglePin(conversation.id)}
                    onDelete={() =>
                      requestConfirmation(
                        {
                          title: t("confirmation.deleteTitle"),
                          description: t("confirmation.deleteDescription", {
                            item: conversation.title || t("chat.title"),
                          }),
                          confirmLabel: t("provider.delete"),
                        },
                        () => deleteConversation(conversation.id),
                      )
                    }
                  />
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="sidebar-footer flex shrink-0 flex-col gap-1 border-t border-border pt-2">
          <button
            className="sidebar-identity flex w-full cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1.5 text-left transition-colors select-none hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
            type="button"
            onClick={() => onOpenSettings("identity")}
            aria-label={t("sidebar.editIdentity")}
          >
            <span
              className={`sidebar-identity-avatar grid size-7 shrink-0 place-items-center overflow-hidden rounded-full text-[11.5px] font-semibold text-white avatar-${identity.avatarColor}`}
            >
              {identity.avatarImage ? (
                <img src={identity.avatarImage} alt="" className="size-full object-cover" />
              ) : (
                localInitial
              )}
            </span>
            <span className="sidebar-identity-copy flex min-w-0 flex-1 items-center leading-tight">
              <strong className="truncate text-[12px] font-medium text-foreground">
                {localName}
              </strong>
            </span>
            <ChevronRight size={13} aria-hidden="true" className="shrink-0 text-muted" />
          </button>
          <Button
            variant="ghost"
            className="settings-button h-8 justify-start gap-2 px-1.5 text-[12px] font-normal text-muted hover:text-foreground"
            onClick={() => onOpenSettings()}
            aria-label={t("settings.title")}
          >
            <Settings2 size={15} />
            <span>{t("settings.title")}</span>
            <span
              className="settings-shortcut ml-auto text-[10px] text-muted/70"
              aria-hidden="true"
            >
              {shortcutModifier},
            </span>
          </Button>
        </div>
      </aside>
      {permissionProject && (
        <ProjectPermissionPanel
          project={permissionProject}
          onClose={() => setPermissionProjectId(null)}
        />
      )}
      {confirmationDialog}
    </>
  );
}
