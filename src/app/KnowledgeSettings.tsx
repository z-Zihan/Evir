import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Database,
  FileText,
  FolderOpen,
  Globe2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { Badge, Button, cn, Input, Switch, Tip } from "../components/ui";
import { EmptyState, InlineError, LoadingState, notify } from "../components/feedback";
import {
  SettingsGroup,
  SettingsPage,
  SettingsPageIntro,
  SettingsRow,
} from "../components/settings";
import { useKnowledgeStore } from "../features/knowledge/knowledge-store";
import { useProjectStore } from "../features/projects/project-store";
import { getRuntime } from "../runtime/use-runtime";
import type { KnowledgeSourceType } from "../core/knowledge/types";
import { useConfirmationDialog } from "./useConfirmationDialog";

const LOCAL_TYPES = new Set<KnowledgeSourceType>(["local-file", "local-folder", "project-docs"]);
const REF_TYPES = new Set<KnowledgeSourceType>(["mcp-resource", "historical-task"]);

function SourceTypeIcon({ type }: { type: KnowledgeSourceType }) {
  if (type === "web-url") return <Globe2 size={13} aria-hidden="true" />;
  if (type === "local-folder" || type === "project-docs")
    return <FolderOpen size={13} aria-hidden="true" />;
  return <FileText size={13} aria-hidden="true" />;
}

/**
 * Knowledge settings (§53-67): create/rename/delete knowledge bases, manage
 * sources (local file/folder, project docs, web URL), reindex on demand,
 * and watch index status. Local sources are validated against the currently
 * open project's granted roots — a folder outside them must be added as an
 * additional access root first (§65).
 */
export function KnowledgeSettings() {
  const { t } = useTranslation();
  const {
    bases,
    sourcesByBase,
    loading,
    busy,
    load,
    createBase,
    renameBase,
    setBaseEnabled,
    deleteBase,
    addSource,
    setSourceEnabled,
    removeSource,
    reindexSource,
  } = useKnowledgeStore();
  const projects = useProjectStore((state) => state.projects);
  const currentProjectId = useProjectStore((state) => state.currentProjectId);
  const [selectedBaseId, setSelectedBaseId] = useState<string | null>(null);
  const [newBaseName, setNewBaseName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [sourceType, setSourceType] = useState<KnowledgeSourceType>("local-folder");
  const [sourceTitle, setSourceTitle] = useState("");
  const [sourceRef, setSourceRef] = useState("");
  const [addError, setAddError] = useState("");
  const { requestConfirmation, confirmationDialog } = useConfirmationDialog();

  useEffect(() => {
    void load();
  }, [load]);

  // Local sources are validated against the CURRENT project's granted
  // roots (workspace + additional access roots) — the same roots the
  // permission model enforces at run time.
  const permissionRoots = useMemo(() => {
    const project = projects.find((item) => item.id === currentProjectId);
    return {
      workspaceRoot: project?.canonicalRootPath ?? null,
      additionalRoots: project?.additionalAccessRoots ?? [],
    };
  }, [projects, currentProjectId]);
  const workspacePath = permissionRoots.workspaceRoot;

  const selectedBase = bases.find((base) => base.id === selectedBaseId) ?? null;
  const sources = selectedBaseId ? (sourcesByBase[selectedBaseId] ?? []) : [];

  const handleAddBase = async () => {
    const name = newBaseName.trim();
    if (!name) return;
    await createBase(name);
    setNewBaseName("");
  };

  const pickFolder = async () => {
    const runtime = getRuntime();
    const selected = await runtime.selectWorkspaceDirectory?.();
    if (selected) {
      setSourceRef(selected);
      setSourceTitle((current) => current.trim() || (selected.split("/").at(-1) ?? selected));
    }
  };

  const handleAddSource = async () => {
    setAddError("");
    const ref = sourceRef.trim();
    if (!selectedBaseId || !ref) return;
    const result = await addSource({
      baseId: selectedBaseId,
      type: sourceType,
      title: sourceTitle.trim() || ref,
      ref,
      ...(LOCAL_TYPES.has(sourceType) ? { permissionRoots } : {}),
    });
    if ("status" in result) {
      if (result.status === "failed") {
        setAddError(result.error ?? t("knowledge.reindexFailed"));
      } else {
        notify.success(t("knowledge.sourceAdded"));
      }
    } else {
      setAddError(result.error);
    }
    setSourceRef("");
    setSourceTitle("");
  };

  return (
    <SettingsPage>
      <SettingsPageIntro title={t("knowledge.title")} description={t("knowledge.intro")} />
      {loading ? (
        <LoadingState label={t("common.loading")} />
      ) : (
        <>
          <SettingsGroup title={t("knowledge.bases.title")}>
            <SettingsRow
              label={t("knowledge.bases.new")}
              control={
                <div className="flex w-full items-center gap-2">
                  <Input
                    value={newBaseName}
                    onChange={(event) => setNewBaseName(event.target.value)}
                    placeholder={t("knowledge.bases.namePlaceholder")}
                    className="h-8 flex-1"
                    aria-label={t("knowledge.bases.namePlaceholder")}
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!newBaseName.trim() || busy}
                    onClick={() => void handleAddBase()}
                  >
                    <Plus size={13} />
                    {t("knowledge.bases.create")}
                  </Button>
                </div>
              }
            />
            {bases.length === 0 && (
              <EmptyState
                icon={<Database size={18} />}
                title={t("knowledge.bases.empty")}
                description={t("knowledge.bases.emptyHint")}
              />
            )}
            {bases.map((base) => {
              const selected = base.id === selectedBaseId;
              return (
                <SettingsRow
                  key={base.id}
                  label={
                    renamingId === base.id ? (
                      <span className="flex items-center gap-2">
                        <Input
                          value={renameDraft}
                          onChange={(event) => setRenameDraft(event.target.value)}
                          className="h-7 w-48"
                          aria-label={t("knowledge.bases.rename")}
                        />
                        <Button
                          size="sm"
                          disabled={!renameDraft.trim()}
                          onClick={() => {
                            void renameBase(base.id, renameDraft.trim());
                            setRenamingId(null);
                          }}
                        >
                          {t("common.save")}
                        </Button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        className={cn(
                          "flex min-w-0 flex-col items-start gap-0.5 rounded-md px-1.5 py-1 text-left",
                          selected ? "bg-surface-hover" : "hover:bg-surface-hover/60",
                        )}
                        data-knowledge-base={base.name}
                        onClick={() => setSelectedBaseId(selected ? null : base.id)}
                      >
                        <strong className="truncate text-[12.5px] font-medium">{base.name}</strong>
                        <span className="text-[11px] text-muted tabular-nums">
                          {t("knowledge.bases.stats", {
                            sources: base.sourceCount,
                            docs: base.docCount,
                            chunks: base.chunkCount,
                          })}
                        </span>
                      </button>
                    )
                  }
                  control={
                    <span className="flex items-center gap-1">
                      <Switch
                        checked={base.enabled}
                        aria-label={t("knowledge.bases.enable")}
                        onCheckedChange={(checked) => void setBaseEnabled(base.id, checked)}
                      />
                      <Tip content={t("knowledge.bases.rename")}>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t("knowledge.bases.rename")}
                          onClick={() => {
                            setRenamingId(base.id);
                            setRenameDraft(base.name);
                          }}
                        >
                          <Pencil size={13} />
                        </Button>
                      </Tip>
                      <Tip content={t("knowledge.bases.delete")}>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t("knowledge.bases.delete")}
                          onClick={() =>
                            requestConfirmation(
                              {
                                title: t("knowledge.bases.deleteConfirmTitle", { name: base.name }),
                                description: t("knowledge.bases.deleteConfirmBody"),
                                confirmLabel: t("knowledge.bases.delete"),
                              },
                              () => {
                                void deleteBase(base.id);
                                if (selectedBaseId === base.id) setSelectedBaseId(null);
                              },
                            )
                          }
                        >
                          <Trash2 size={13} />
                        </Button>
                      </Tip>
                    </span>
                  }
                />
              );
            })}
          </SettingsGroup>

          {selectedBase && (
            <SettingsGroup title={t("knowledge.sources.title", { name: selectedBase.name })}>
              <SettingsRow
                label={t("knowledge.sources.add")}
                control={
                  <div className="flex w-full flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={sourceType}
                        onChange={(event) =>
                          setSourceType(event.target.value as KnowledgeSourceType)
                        }
                        className="h-8 rounded-md border border-border bg-surface px-2 text-[12px]"
                        aria-label={t("knowledge.sources.type")}
                      >
                        <option value="local-folder">
                          {t("knowledge.sources.types.local-folder")}
                        </option>
                        <option value="project-docs">
                          {t("knowledge.sources.types.project-docs")}
                        </option>
                        <option value="local-file">
                          {t("knowledge.sources.types.local-file")}
                        </option>
                        <option value="web-url">{t("knowledge.sources.types.web-url")}</option>
                        <option value="mcp-resource">
                          {t("knowledge.sources.types.mcp-resource")}
                        </option>
                        <option value="historical-task">
                          {t("knowledge.sources.types.historical-task")}
                        </option>
                      </select>
                      {(sourceType === "local-folder" || sourceType === "project-docs") && (
                        <Button size="sm" variant="secondary" onClick={() => void pickFolder()}>
                          <FolderOpen size={13} />
                          {t("knowledge.sources.pickFolder")}
                        </Button>
                      )}
                      <Input
                        value={sourceRef}
                        onChange={(event) => setSourceRef(event.target.value)}
                        placeholder={
                          sourceType === "web-url" ? "https://example.com/docs" : "/absolute/path"
                        }
                        className="h-8 min-w-0 flex-1"
                        aria-label={t("knowledge.sources.ref")}
                      />
                      <Input
                        value={sourceTitle}
                        onChange={(event) => setSourceTitle(event.target.value)}
                        placeholder={t("knowledge.sources.titlePlaceholder")}
                        className="h-8 w-40"
                        aria-label={t("knowledge.sources.titlePlaceholder")}
                      />
                      <Button
                        size="sm"
                        disabled={!sourceRef.trim() || busy}
                        onClick={() => void handleAddSource()}
                      >
                        <Plus size={13} />
                        {t("knowledge.sources.add")}
                      </Button>
                    </div>
                    {REF_TYPES.has(sourceType) && (
                      <p className="text-[11px] text-muted">{t("knowledge.sources.refTypeHint")}</p>
                    )}
                    {addError && <InlineError message={addError} />}
                    {LOCAL_TYPES.has(sourceType) && !workspacePath && (
                      <p className="text-[11px] text-muted">
                        {t("knowledge.sources.needWorkspace")}
                      </p>
                    )}
                  </div>
                }
              />
              {sources.length === 0 && (
                <EmptyState
                  icon={<FolderOpen size={18} />}
                  title={t("knowledge.sources.empty")}
                  description={t("knowledge.sources.emptyHint")}
                />
              )}
              {sources.map((source) => (
                <SettingsRow
                  key={source.id}
                  label={
                    <div
                      className="flex min-w-0 flex-col gap-0.5"
                      data-knowledge-source={source.title}
                    >
                      <span className="flex items-center gap-1.5 text-[12.5px] font-medium">
                        <SourceTypeIcon type={source.type} />
                        <span className="truncate">{source.title}</span>
                        <Badge
                          variant={
                            source.status === "ready"
                              ? "success"
                              : source.status === "failed"
                                ? "danger"
                                : "secondary"
                          }
                        >
                          {t(`knowledge.sources.status.${source.status}`)}
                        </Badge>
                      </span>
                      <span className="truncate text-[11px] text-muted" title={source.ref}>
                        {source.ref}
                      </span>
                      <span className="text-[11px] text-muted tabular-nums">
                        {t("knowledge.sources.indexed", {
                          docs: source.docCount,
                          chunks: source.chunkCount,
                          when: source.lastIndexedAt
                            ? new Date(source.lastIndexedAt).toLocaleString()
                            : "–",
                        })}
                      </span>
                      {source.error && <InlineError message={source.error} />}
                    </div>
                  }
                  control={
                    <span className="flex items-center gap-1">
                      <Tip content={t("knowledge.sources.reindex")}>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t("knowledge.sources.reindex")}
                          disabled={busy}
                          onClick={() => void reindexSource(source.id, permissionRoots)}
                        >
                          <RefreshCw size={13} />
                        </Button>
                      </Tip>
                      <Switch
                        checked={source.enabled}
                        aria-label={t("knowledge.sources.enable")}
                        onCheckedChange={(checked) => void setSourceEnabled(source.id, checked)}
                      />
                      <Tip content={t("knowledge.sources.remove")}>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t("knowledge.sources.remove")}
                          onClick={() =>
                            requestConfirmation(
                              {
                                title: t("knowledge.sources.removeConfirmTitle", {
                                  name: source.title,
                                }),
                                description: t("knowledge.sources.removeConfirmBody"),
                                confirmLabel: t("knowledge.sources.remove"),
                              },
                              () => void removeSource(source.id),
                            )
                          }
                        >
                          <Trash2 size={13} />
                        </Button>
                      </Tip>
                    </span>
                  }
                />
              ))}
            </SettingsGroup>
          )}
        </>
      )}
      {confirmationDialog}
    </SettingsPage>
  );
}

export default KnowledgeSettings;
