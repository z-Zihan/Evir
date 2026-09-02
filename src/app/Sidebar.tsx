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
import { Button, Tip } from "../components/ui";
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
      <aside className="sidebar">
        <div className="brand-row">
          <div className="brand-mark" aria-hidden="true">
            <img src="/evir-mark.svg" alt="" />
          </div>
          <div className="brand-lockup">
            <strong className="brand-name">Evir</strong>
            <span className="brand-caption">{t("sidebar.localAi")}</span>
          </div>
          <Tip content={t("sidebar.hide")} side="bottom">
            <Button
              variant="ghost"
              size="icon"
              className="sidebar-close"
              onClick={onClose}
              aria-label={t("sidebar.hide")}
            >
              <X size={17} />
            </Button>
          </Tip>
        </div>

        <div className="sidebar-search">
          <Search size={13} aria-hidden="true" />
          <input
            type="search"
            value={search}
            placeholder={t("sidebar.searchPlaceholder")}
            aria-label={t("sidebar.searchPlaceholder")}
            onChange={(event) => setSearch(event.target.value)}
          />
          {search.length > 0 && (
            <button type="button" aria-label={t("common.close")} onClick={() => setSearch("")}>
              <X size={12} />
            </button>
          )}
        </div>

        <Tip content={t("sidebar.sortToggle")}>
          <Button
            variant="ghost"
            size="sm"
            className="sidebar-sort-toggle"
            onClick={() => setSortOrder(sortOrder === "recent" ? "name" : "recent")}
            aria-label={t("sidebar.sortToggle")}
          >
            {sortOrder === "recent" ? t("sidebar.sortRecent") : t("sidebar.sortName")}
            <ChevronDown size={12} aria-hidden="true" />
          </Button>
        </Tip>

        <div className="sidebar-scroll">
          {getRuntime().target === "desktop" && (
            <section
              ref={projectsScrollRef}
              className="sidebar-section sidebar-section-projects"
              aria-label={t("sidebar.projects")}
            >
              <div className="section-label-row">
                <div className="section-label">{t("sidebar.projects")}</div>
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
                <div className="empty-list">{t("sidebar.noProjects")}</div>
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
                          <div className="project-thread-list">
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
                          <div className="empty-list project-empty">
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
            className="sidebar-section sidebar-section-chats"
            aria-label={t("sidebar.chats")}
          >
            <div className="section-label-row">
              <div className="section-label">{t("sidebar.chats")}</div>
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
              <div className="empty-list">{t("sidebar.noConversations")}</div>
            ) : (
              <div className="conversation-list">
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

        <div className="sidebar-footer">
          <button
            className="sidebar-identity"
            type="button"
            onClick={() => onOpenSettings("identity")}
            aria-label={t("sidebar.editIdentity")}
          >
            <span className={`sidebar-identity-avatar avatar-${identity.avatarColor}`}>
              {identity.avatarImage ? <img src={identity.avatarImage} alt="" /> : localInitial}
            </span>
            <span className="sidebar-identity-copy">
              <strong>{localName}</strong>
              <small>{t("sidebar.localIdentity")}</small>
            </span>
            <ChevronRight size={14} aria-hidden="true" />
          </button>
          <Button
            variant="ghost"
            className="settings-button"
            onClick={() => onOpenSettings()}
            aria-label={t("settings.title")}
          >
            <Settings2 size={17} />
            <span>{t("settings.title")}</span>
            <span className="settings-shortcut" aria-hidden="true">
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
