import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Cable, Plus } from "lucide-react";
import { Button } from "../components/ui";
import { SettingsPage, SettingsPageIntro } from "../components/settings";
import { LoadingState, EmptyState } from "../components/feedback";
import type { McpTool } from "../core/mcp/types";
import { useMcpStore, type McpServerEntry } from "../features/mcp/mcp-store";
import { useConfirmationDialog } from "./useConfirmationDialog";
import {
  buildMcpConfig,
  EMPTY_MCP_FORM,
  MAX_CONFIRMATION_ARGS_CHARS,
  toolTestKey,
  validateMcpForm,
  type McpFormErrors,
  type McpFormState,
  type McpToolTestState,
} from "./mcp/form-model";
import { McpServerCard } from "./mcp/McpServerCard";
import { McpServerFormDialog } from "./mcp/McpServerFormDialog";

/**
 * MCP settings page: server list orchestration + add/edit dialog. The server
 * card and the form dialog are presentational components in ./mcp/.
 */
export function McpSettings() {
  const { t, i18n } = useTranslation();
  const { requestConfirmation, confirmationDialog } = useConfirmationDialog();
  const {
    servers,
    runtimeSnapshots,
    connectionTests,
    loadServers,
    addServer,
    updateServer,
    removeServer,
    toggleServer,
    restartServer,
    testServer,
    executeApprovedTestTool,
  } = useMcpStore();
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<McpFormState>({ ...EMPTY_MCP_FORM });
  const [errors, setErrors] = useState<McpFormErrors>({});
  const [toolTests, setToolTests] = useState<Record<string, McpToolTestState>>({});
  const [testingServerId, setTestingServerId] = useState<string | null>(null);

  useEffect(() => {
    void loadServers().finally(() => setLoading(false));
  }, [loadServers]);

  const closeDialog = () => {
    setDialogOpen(false);
    setEditingId(null);
    setForm({ ...EMPTY_MCP_FORM });
    setErrors({});
  };

  const openAdd = () => {
    closeDialog();
    setDialogOpen(true);
  };

  const openEdit = (server: McpServerEntry) => {
    setEditingId(server.id);
    setForm({
      name: server.name,
      transport: server.transport,
      command: server.transport === "stdio" ? server.command : "",
      args: server.transport === "stdio" ? server.args.join(", ") : "",
      cwd: server.transport === "stdio" ? (server.cwd ?? "") : "",
      url: server.transport === "streamable-http" ? server.url : "",
    });
    setErrors({});
    setDialogOpen(true);
  };

  const update = <Key extends keyof McpFormState>(key: Key, value: McpFormState[Key]) => {
    setForm((current) => ({ ...current, [key]: value }));
    if (key === "name" || key === "command" || key === "url") {
      setErrors((current) => ({ ...current, [key]: undefined }));
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors = validateMcpForm(form, t);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    const config = buildMcpConfig(form);
    if (editingId) await updateServer(editingId, config);
    else await addServer(config);
    closeDialog();
  };

  const enabledCount = servers.filter((server) => server.enabled).length;

  const runConnectionTest = async (serverId: string) => {
    setTestingServerId(serverId);
    try {
      await testServer(serverId);
    } finally {
      setTestingServerId(null);
    }
  };

  const formatTimestamp = (value: number) =>
    new Intl.DateTimeFormat(i18n.language, {
      dateStyle: "short",
      timeStyle: "medium",
    }).format(value);

  const updateToolTest = (key: string, update: Partial<McpToolTestState>) => {
    setToolTests((current) => ({
      ...current,
      [key]: { input: current[key]?.input ?? "{}", ...current[key], ...update },
    }));
  };

  const clearServerToolTests = (serverId: string) => {
    const prefix = `${serverId}\0`;
    setToolTests((current) =>
      Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(prefix))),
    );
  };

  const requestToolTest = (server: McpServerEntry, tool: McpTool) => {
    const key = toolTestKey(server.id, tool.name);
    const input = toolTests[key]?.input ?? "{}";
    let args: Record<string, unknown>;
    try {
      const parsed = JSON.parse(input) as unknown;
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error();
      args = parsed as Record<string, unknown>;
    } catch {
      updateToolTest(key, { error: t("mcp.invalidToolArguments"), result: undefined });
      return;
    }
    const serializedArgs = JSON.stringify(args);
    const argsPreview =
      serializedArgs.length <= MAX_CONFIRMATION_ARGS_CHARS
        ? serializedArgs
        : `${serializedArgs.slice(0, MAX_CONFIRMATION_ARGS_CHARS)}…`;
    const remoteDestination =
      server.transport === "streamable-http"
        ? `\n${t("mcp.testToolRemoteDestination", { destination: server.url })}`
        : "";
    requestConfirmation(
      {
        title: t("mcp.testToolTitle"),
        description: `${t("mcp.testToolConfirmation", {
          server: server.name,
          tool: tool.name,
          risk: server.transport === "stdio" ? "L3" : "L4",
          args: argsPreview,
        })}${remoteDestination}`,
        confirmLabel: t("mcp.runTest"),
        tone: "warning",
      },
      async () => {
        updateToolTest(key, { running: true, error: undefined, result: undefined });
        const result = await executeApprovedTestTool(server.id, tool.name, args);
        updateToolTest(key, { running: false, result });
      },
    );
  };

  return (
    <SettingsPage className="mcp-settings">
      <SettingsPageIntro
        eyebrow={t("settingsDescriptions.toolConnections")}
        description={t("settingsDescriptions.mcp")}
        action={
          <div className="flex shrink-0 items-center gap-2">
            <span className="rounded-md border border-border px-2 py-1 text-[9.5px] whitespace-nowrap text-muted">
              {t("mcp.serverSummary", { enabled: enabledCount, total: servers.length })}
            </span>
            <Button variant="primary" size="lg" onClick={openAdd}>
              <Plus size={14} /> {t("mcp.add")}
            </Button>
          </div>
        }
      />

      <div className="flex items-center gap-1.5 rounded-lg border border-warning/35 bg-warning/[0.07] px-3 py-2 text-[11.5px] text-warning">
        <AlertTriangle size={14} aria-hidden="true" />
        <span>{t("mcp.runtimeNotice")}</span>
      </div>

      {loading ? (
        <LoadingState label={t("common.loading")} />
      ) : servers.length === 0 ? (
        <EmptyState
          icon={<Cable />}
          title={t("mcp.noServers")}
          description={t("settingsDescriptions.mcpEmpty")}
          primaryAction={
            <Button variant="secondary" size="lg" onClick={openAdd}>
              <Plus size={14} aria-hidden="true" /> {t("mcp.add")}
            </Button>
          }
          className="rounded-xl border border-dashed border-border-strong"
        />
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {servers.map((server) => (
            <McpServerCard
              key={server.id}
              server={server}
              snapshot={runtimeSnapshots[server.id]}
              connectionTest={connectionTests[server.id]}
              testingConnection={testingServerId === server.id}
              toolTest={(toolName) =>
                toolTests[toolTestKey(server.id, toolName)] ?? { input: "{}" }
              }
              formatTimestamp={formatTimestamp}
              onToolTestInput={(toolName, input) =>
                updateToolTest(toolTestKey(server.id, toolName), {
                  input,
                  error: undefined,
                  result: undefined,
                })
              }
              onRequestToolTest={requestToolTest}
              onToggle={() => {
                clearServerToolTests(server.id);
                void toggleServer(server.id);
              }}
              onTestConnection={() => void runConnectionTest(server.id)}
              onRestart={() => {
                clearServerToolTests(server.id);
                void restartServer(server.id);
              }}
              onEdit={() => openEdit(server)}
              onDelete={() =>
                requestConfirmation(
                  {
                    title: t("confirmation.deleteTitle"),
                    description: t("confirmation.deleteDescription", { item: server.name }),
                    confirmLabel: t("mcp.delete"),
                  },
                  () => removeServer(server.id),
                )
              }
            />
          ))}
        </ul>
      )}

      {dialogOpen && (
        <McpServerFormDialog
          editing={Boolean(editingId)}
          form={form}
          errors={errors}
          onFieldChange={update}
          onSubmit={(event) => void handleSubmit(event)}
          onClose={closeDialog}
        />
      )}
      {confirmationDialog}
    </SettingsPage>
  );
}
