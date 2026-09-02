import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  Cable,
  Globe2,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Terminal,
  Trash2,
} from "lucide-react";
import { Button, Switch, Tip } from "../components/ui";
import type { McpTool, McpTransport } from "../core/mcp/types";
import type { ToolResult } from "../core/providers/tool-registry";
import { useMcpStore, type McpServerEntry } from "../features/mcp/mcp-store";
import { SettingsFormDialog } from "./SettingsFormDialog";
import { useConfirmationDialog } from "./useConfirmationDialog";

interface FormState {
  name: string;
  transport: McpTransport;
  command: string;
  args: string;
  cwd: string;
  url: string;
}

const EMPTY_FORM: FormState = {
  name: "",
  transport: "stdio",
  command: "",
  args: "",
  cwd: "",
  url: "",
};

type FormErrors = Partial<Record<"name" | "command" | "url", string>>;

interface ToolTestState {
  input: string;
  running?: boolean | undefined;
  error?: string | undefined;
  result?: ToolResult | undefined;
}

const MAX_SCHEMA_PREVIEW_CHARS = 4_000;
const MAX_CONFIRMATION_ARGS_CHARS = 500;

function toolTestKey(serverId: string, toolName: string): string {
  return `${serverId}\0${toolName}`;
}

function schemaPreview(tool: McpTool): string {
  const value = JSON.stringify(tool.inputSchema, null, 2);
  return value.length <= MAX_SCHEMA_PREVIEW_CHARS
    ? value
    : `${value.slice(0, MAX_SCHEMA_PREVIEW_CHARS)}\n…`;
}

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
  const [form, setForm] = useState<FormState>({ ...EMPTY_FORM });
  const [errors, setErrors] = useState<FormErrors>({});
  const [toolTests, setToolTests] = useState<Record<string, ToolTestState>>({});
  const [testingServerId, setTestingServerId] = useState<string | null>(null);

  useEffect(() => {
    void loadServers().finally(() => setLoading(false));
  }, [loadServers]);

  const closeDialog = () => {
    setDialogOpen(false);
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
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

  const update = <Key extends keyof FormState>(key: Key, value: FormState[Key]) => {
    setForm((current) => ({ ...current, [key]: value }));
    if (key === "name" || key === "command" || key === "url") {
      setErrors((current) => ({ ...current, [key]: undefined }));
    }
  };

  const validate = (): FormErrors => {
    const next: FormErrors = {};
    if (!form.name.trim()) next.name = t("mcp.required");
    if (form.transport === "stdio" && !form.command.trim()) next.command = t("mcp.required");
    if (form.transport === "streamable-http") {
      try {
        const url = new URL(form.url);
        if (url.protocol !== "http:" && url.protocol !== "https:") next.url = t("mcp.invalidUrl");
      } catch {
        next.url = form.url.trim() ? t("mcp.invalidUrl") : t("mcp.required");
      }
    }
    return next;
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors = validate();
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    const config =
      form.transport === "stdio"
        ? {
            name: form.name.trim(),
            transport: "stdio" as const,
            command: form.command.trim(),
            args: form.args
              .split(",")
              .map((item) => item.trim())
              .filter(Boolean),
            ...(form.cwd.trim() ? { cwd: form.cwd.trim() } : {}),
            envSecretRefs: {},
          }
        : {
            name: form.name.trim(),
            transport: "streamable-http" as const,
            url: form.url.trim(),
            headerSecretRefs: {},
          };

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

  const updateToolTest = (key: string, update: Partial<ToolTestState>) => {
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
    <section className="mcp-settings">
      <div className="settings-page-intro compact mcp-overview">
        <div>
          <span className="settings-page-eyebrow">{t("settingsDescriptions.toolConnections")}</span>
          <p>{t("settingsDescriptions.mcp")}</p>
        </div>
        <div className="mcp-overview-actions">
          <span className="settings-count-badge">
            {t("mcp.serverSummary", { enabled: enabledCount, total: servers.length })}
          </span>
          <Button variant="primary" size="lg" className="primary-button h-auto" onClick={openAdd}>
            <Plus size={14} /> {t("mcp.add")}
          </Button>
        </div>
      </div>

      <div className="mcp-security-notice">
        <AlertTriangle size={14} />
        <span>{t("mcp.runtimeNotice")}</span>
      </div>

      {loading ? (
        <p>{t("common.loading")}</p>
      ) : servers.length === 0 ? (
        <div className="mcp-empty-state">
          <span className="mcp-empty-icon">
            <Cable size={20} />
          </span>
          <strong>{t("mcp.noServers")}</strong>
          <p>{t("settingsDescriptions.mcpEmpty")}</p>
          <Button variant="secondary" size="lg" onClick={openAdd}>
            <Plus size={14} /> {t("mcp.add")}
          </Button>
        </div>
      ) : (
        <ul className="mcp-list">
          {servers.map((server) => (
            <li key={server.id} className="mcp-item">
              {(() => {
                const snapshot = runtimeSnapshots[server.id];
                const connectionTest = connectionTests[server.id];
                const runtimeState = server.enabled
                  ? (snapshot?.state ?? "notStarted")
                  : "disabled";
                return (
                  <>
                    <span
                      className={`mcp-status-dot${runtimeState === "ready" ? " enabled" : ""}`}
                      aria-hidden="true"
                    />
                    <span className="mcp-transport-icon" aria-hidden="true">
                      {server.transport === "stdio" ? <Terminal size={16} /> : <Globe2 size={16} />}
                    </span>
                    <div className="mcp-item-copy">
                      <div>
                        <strong>{server.name}</strong>
                        <span>
                          {server.transport === "stdio"
                            ? t("mcp.localProcess")
                            : t("mcp.remoteServer")}
                        </span>
                        <span>{t(`mcp.states.${runtimeState}`)}</span>
                        {snapshot?.state === "ready" && (
                          <span>{t("mcp.toolCount", { count: snapshot.tools.length })}</span>
                        )}
                      </div>
                      <p>
                        {server.transport === "stdio"
                          ? `${server.command} ${server.args.join(" ")}`.trim()
                          : server.url}
                      </p>
                      {snapshot?.error && <p className="mcp-runtime-error">{snapshot.error}</p>}
                      {connectionTest && (
                        <p
                          className={
                            connectionTest.success
                              ? "mcp-connection-test-result"
                              : "mcp-runtime-error"
                          }
                          role={connectionTest.success ? "status" : "alert"}
                        >
                          {connectionTest.success
                            ? t("mcp.connectionTestPassed", {
                                count: connectionTest.toolCount ?? 0,
                                time: formatTimestamp(connectionTest.testedAt),
                              })
                            : t("mcp.connectionTestFailed", {
                                error: connectionTest.error,
                              })}
                        </p>
                      )}
                      {snapshot && (
                        <dl className="mcp-runtime-metadata">
                          {snapshot.pid !== undefined && (
                            <div>
                              <dt>{t("mcp.processId")}</dt>
                              <dd>{snapshot.pid}</dd>
                            </div>
                          )}
                          {snapshot.protocolVersion && (
                            <div>
                              <dt>{t("mcp.protocolVersion")}</dt>
                              <dd>{snapshot.protocolVersion}</dd>
                            </div>
                          )}
                          {snapshot.serverInfo?.name && (
                            <div>
                              <dt>{t("mcp.serverIdentity")}</dt>
                              <dd>
                                {snapshot.serverInfo.name}
                                {snapshot.serverInfo.version
                                  ? ` ${snapshot.serverInfo.version}`
                                  : ""}
                              </dd>
                            </div>
                          )}
                          {snapshot.lastReadyAt !== undefined && (
                            <div>
                              <dt>{t("mcp.lastReady")}</dt>
                              <dd>{formatTimestamp(snapshot.lastReadyAt)}</dd>
                            </div>
                          )}
                        </dl>
                      )}
                      {snapshot?.state === "ready" && snapshot.tools.length > 0 && (
                        <details className="mcp-tool-details">
                          <summary>{t("mcp.inspectTools")}</summary>
                          <div className="mcp-tool-list">
                            {snapshot.tools.map((tool) => {
                              const key = toolTestKey(server.id, tool.name);
                              const test = toolTests[key] ?? { input: "{}" };
                              return (
                                <section key={tool.name} className="mcp-tool-test">
                                  <div>
                                    <strong>{tool.name}</strong>
                                    {tool.description && <p>{tool.description}</p>}
                                  </div>
                                  <details>
                                    <summary>{t("mcp.inputSchema")}</summary>
                                    <pre>{schemaPreview(tool)}</pre>
                                  </details>
                                  <label>
                                    <span>{t("mcp.testArguments")}</span>
                                    <textarea
                                      value={test.input}
                                      aria-invalid={Boolean(test.error)}
                                      autoCapitalize="off"
                                      autoCorrect="off"
                                      spellCheck={false}
                                      onChange={(event) =>
                                        updateToolTest(key, {
                                          input: event.target.value,
                                          error: undefined,
                                          result: undefined,
                                        })
                                      }
                                    />
                                  </label>
                                  {test.error && (
                                    <p className="mcp-runtime-error" role="alert">
                                      {test.error}
                                    </p>
                                  )}
                                  <Button
                                    variant="secondary"
                                    size="lg"
                                    className="secondary-button h-auto"
                                    disabled={test.running}
                                    onClick={() => requestToolTest(server, tool)}
                                  >
                                    <Play size={13} />
                                    {test.running ? t("mcp.testingTool") : t("mcp.testTool")}
                                  </Button>
                                  {test.result && (
                                    <pre
                                      className={
                                        test.result.success
                                          ? "mcp-test-result"
                                          : "mcp-test-result error"
                                      }
                                      role={test.result.success ? "status" : "alert"}
                                    >
                                      {test.result.output}
                                    </pre>
                                  )}
                                </section>
                              );
                            })}
                          </div>
                        </details>
                      )}
                    </div>
                    <label className="mcp-toggle">
                      <span>
                        {server.enabled ? t("mcp.configurationEnabled") : t("mcp.disabled")}
                      </span>
                      <Switch
                        checked={server.enabled}
                        onCheckedChange={() => {
                          clearServerToolTests(server.id);
                          void toggleServer(server.id);
                        }}
                        aria-label={
                          server.enabled ? t("mcp.configurationEnabled") : t("mcp.disabled")
                        }
                      />
                    </label>
                    <div className="mcp-item-actions">
                      <Tip content={t("mcp.testConnection")}>
                        <button
                          type="button"
                          disabled={testingServerId === server.id}
                          onClick={() => void runConnectionTest(server.id)}
                          aria-label={t("mcp.testConnection")}
                        >
                          <Play size={14} />
                        </button>
                      </Tip>
                      {server.enabled && (
                        <Tip content={t("mcp.restart")}>
                          <button
                            type="button"
                            onClick={() => {
                              clearServerToolTests(server.id);
                              void restartServer(server.id);
                            }}
                            aria-label={t("mcp.restart")}
                          >
                            <RefreshCw size={14} />
                          </button>
                        </Tip>
                      )}
                      <Tip content={t("mcp.edit")}>
                        <button
                          type="button"
                          onClick={() => openEdit(server)}
                          aria-label={t("mcp.edit")}
                        >
                          <Pencil size={14} />
                        </button>
                      </Tip>
                      <Tip content={t("mcp.delete")}>
                        <button
                          type="button"
                          onClick={() =>
                            requestConfirmation(
                              {
                                title: t("confirmation.deleteTitle"),
                                description: t("confirmation.deleteDescription", {
                                  item: server.name,
                                }),
                                confirmLabel: t("mcp.delete"),
                              },
                              () => removeServer(server.id),
                            )
                          }
                          aria-label={t("mcp.delete")}
                        >
                          <Trash2 size={14} />
                        </button>
                      </Tip>
                    </div>
                  </>
                );
              })()}
            </li>
          ))}
        </ul>
      )}

      {dialogOpen && (
        <SettingsFormDialog
          title={editingId ? t("mcp.editServer") : t("mcp.addServer")}
          description={t("mcp.dialogDescription")}
          onClose={closeDialog}
        >
          <form
            className="mcp-form modal-form"
            noValidate
            onSubmit={(event) => void handleSubmit(event)}
          >
            <div
              className="mcp-transport-options"
              role="radiogroup"
              aria-label={t("mcp.transport")}
            >
              {(["stdio", "streamable-http"] as const).map((transport) => (
                <button
                  key={transport}
                  type="button"
                  role="radio"
                  aria-checked={form.transport === transport}
                  className={form.transport === transport ? "active" : ""}
                  onClick={() => update("transport", transport)}
                >
                  {transport === "stdio" ? <Terminal size={17} /> : <Globe2 size={17} />}
                  <span>
                    <strong>
                      {transport === "stdio" ? t("mcp.localProcess") : t("mcp.remoteServer")}
                    </strong>
                    <small>
                      {transport === "stdio" ? t("mcp.stdioDescription") : t("mcp.httpDescription")}
                    </small>
                  </span>
                </button>
              ))}
            </div>
            <div className="mcp-form-fields">
              <label>
                <span>
                  {t("mcp.name")} <em>*</em>
                </span>
                <input
                  autoFocus
                  value={form.name}
                  aria-invalid={Boolean(errors.name)}
                  onChange={(event) => update("name", event.target.value)}
                  placeholder={t("mcp.namePlaceholder")}
                />
                {errors.name && <small className="field-error">{errors.name}</small>}
              </label>
              {form.transport === "stdio" ? (
                <>
                  <label>
                    <span>
                      {t("mcp.command")} <em>*</em>
                    </span>
                    <input
                      value={form.command}
                      aria-invalid={Boolean(errors.command)}
                      onChange={(event) => update("command", event.target.value)}
                      placeholder="npx"
                    />
                    {errors.command && <small className="field-error">{errors.command}</small>}
                  </label>
                  <label>
                    <span>{t("mcp.arguments")}</span>
                    <input
                      value={form.args}
                      onChange={(event) => update("args", event.target.value)}
                      placeholder="-y, @modelcontextprotocol/server-filesystem"
                    />
                    <small>{t("mcp.argumentsHint")}</small>
                  </label>
                  <label>
                    <span>{t("mcp.workingDirectory")}</span>
                    <input
                      value={form.cwd}
                      onChange={(event) => update("cwd", event.target.value)}
                      placeholder="/optional/cwd"
                    />
                  </label>
                </>
              ) : (
                <label>
                  <span>
                    {t("mcp.url")} <em>*</em>
                  </span>
                  <input
                    value={form.url}
                    aria-invalid={Boolean(errors.url)}
                    onChange={(event) => update("url", event.target.value)}
                    placeholder="https://example.com/mcp"
                  />
                  {errors.url && <small className="field-error">{errors.url}</small>}
                </label>
              )}
            </div>
            <div className="mcp-default-note">
              <AlertTriangle size={13} /> {t("mcp.disabledByDefault")}
            </div>
            <div className="form-actions dialog-form-actions">
              <span />
              <button className="text-button" type="button" onClick={closeDialog}>
                {t("mcp.cancel")}
              </button>
              <Button variant="primary" size="lg" type="submit">
                {editingId ? t("mcp.saveChanges") : t("mcp.save")}
              </Button>
            </div>
          </form>
        </SettingsFormDialog>
      )}
      {confirmationDialog}
    </section>
  );
}
