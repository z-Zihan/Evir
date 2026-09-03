import { useTranslation } from "react-i18next";
import { Globe2, Pencil, Play, RefreshCw, Terminal, Trash2 } from "lucide-react";
import { Button, Switch, Textarea, Tip } from "../../components/ui";
import type { McpTool } from "../../core/mcp/types";
import type { McpServerRuntimeSnapshot } from "../../core/mcp/runtime-service";
import type { McpConnectionTestResult, McpServerEntry } from "../../features/mcp/mcp-store";
import { schemaPreview, type McpToolTestState } from "./form-model";

interface McpServerCardProps {
  server: McpServerEntry;
  snapshot: McpServerRuntimeSnapshot | undefined;
  connectionTest: McpConnectionTestResult | undefined;
  testingConnection: boolean;
  toolTest: (toolName: string) => McpToolTestState;
  formatTimestamp: (value: number) => string;
  onToolTestInput: (toolName: string, input: string) => void;
  onRequestToolTest: (server: McpServerEntry, tool: McpTool) => void;
  onToggle: () => void;
  onTestConnection: () => void;
  onRestart: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function MetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 gap-2">
      <dt className="shrink-0 text-[10px] text-muted">{label}</dt>
      <dd className="min-w-0 truncate text-[10px] text-foreground/85">{value}</dd>
    </div>
  );
}

function statusTone(state: string): string {
  if (state === "ready") return "bg-success";
  if (state === "error" || state === "failed") return "bg-danger";
  if (state === "starting") return "bg-warning animate-pulse";
  return "bg-border-strong";
}

/** One configured MCP server: identity, runtime state, tool inspector, actions. */
export function McpServerCard({
  server,
  snapshot,
  connectionTest,
  testingConnection,
  toolTest,
  formatTimestamp,
  onToolTestInput,
  onRequestToolTest,
  onToggle,
  onTestConnection,
  onRestart,
  onEdit,
  onDelete,
}: McpServerCardProps) {
  const { t } = useTranslation();
  const runtimeState = server.enabled ? (snapshot?.state ?? "notStarted") : "disabled";
  return (
    <li className="flex flex-col gap-2.5 rounded-xl border border-border bg-surface-subtle p-4">
      <div className="flex items-start gap-3">
        <span
          className={`mt-1.5 size-2 shrink-0 rounded-full ${statusTone(runtimeState)}`}
          aria-hidden="true"
        />
        <span className="mt-0.5 shrink-0 text-muted" aria-hidden="true">
          {server.transport === "stdio" ? <Terminal size={16} /> : <Globe2 size={16} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <strong className="text-[13px] font-semibold text-foreground">{server.name}</strong>
            <span className="text-[10.5px] text-muted">
              {server.transport === "stdio" ? t("mcp.localProcess") : t("mcp.remoteServer")}
            </span>
            <span className="text-[10.5px] text-muted">{t(`mcp.states.${runtimeState}`)}</span>
            {snapshot?.state === "ready" && (
              <span className="text-[10.5px] text-muted">
                {t("mcp.toolCount", { count: snapshot.tools.length })}
              </span>
            )}
          </div>
          <p className="mt-1 truncate font-mono text-[10.5px] text-muted">
            {server.transport === "stdio"
              ? `${server.command} ${server.args.join(" ")}`.trim()
              : server.url}
          </p>
          {snapshot?.error && (
            <p className="mt-1.5 text-[11px] text-danger" role="alert">
              {snapshot.error}
            </p>
          )}
          {connectionTest && (
            <p
              className={`mt-1.5 text-[11px] ${connectionTest.success ? "text-success" : "text-danger"}`}
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
            <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {snapshot.pid !== undefined && (
                <MetadataRow label={t("mcp.processId")} value={String(snapshot.pid)} />
              )}
              {snapshot.protocolVersion && (
                <MetadataRow label={t("mcp.protocolVersion")} value={snapshot.protocolVersion} />
              )}
              {snapshot.serverInfo?.name && (
                <MetadataRow
                  label={t("mcp.serverIdentity")}
                  value={`${snapshot.serverInfo.name}${snapshot.serverInfo.version ? ` ${snapshot.serverInfo.version}` : ""}`}
                />
              )}
              {snapshot.lastReadyAt !== undefined && (
                <MetadataRow
                  label={t("mcp.lastReady")}
                  value={formatTimestamp(snapshot.lastReadyAt)}
                />
              )}
            </dl>
          )}
          {snapshot?.state === "ready" && snapshot.tools.length > 0 && (
            <details className="mt-2.5">
              <summary className="cursor-pointer text-[11.5px] font-medium text-primary select-none hover:underline">
                {t("mcp.inspectTools")}
              </summary>
              <div className="mt-2.5 flex flex-col gap-2.5">
                {snapshot.tools.map((tool) => {
                  const test = toolTest(tool.name);
                  return (
                    <section
                      key={tool.name}
                      className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3"
                    >
                      <div>
                        <strong className="font-mono text-[11.5px] text-foreground">
                          {tool.name}
                        </strong>
                        {tool.description && (
                          <p className="mt-0.5 text-[10.5px] leading-snug text-muted">
                            {tool.description}
                          </p>
                        )}
                      </div>
                      <details>
                        <summary className="cursor-pointer text-[10.5px] text-muted select-none hover:text-foreground">
                          {t("mcp.inputSchema")}
                        </summary>
                        <pre className="mt-1.5 max-h-44 overflow-auto rounded-md bg-surface-subtle p-2 font-mono text-[10px] leading-relaxed text-foreground/85">
                          {schemaPreview(tool)}
                        </pre>
                      </details>
                      <label className="flex flex-col gap-1">
                        <span className="text-[11px] font-medium text-foreground">
                          {t("mcp.testArguments")}
                        </span>
                        <Textarea
                          value={test.input}
                          aria-invalid={Boolean(test.error)}
                          autoCapitalize="off"
                          autoCorrect="off"
                          spellCheck={false}
                          className="min-h-16 font-mono text-[11px]"
                          onChange={(event) => onToolTestInput(tool.name, event.target.value)}
                        />
                      </label>
                      {test.error && (
                        <p className="text-[11px] text-danger" role="alert">
                          {test.error}
                        </p>
                      )}
                      <div>
                        <Button
                          variant="secondary"
                          size="lg"
                          disabled={test.running}
                          onClick={() => onRequestToolTest(server, tool)}
                        >
                          <Play size={13} aria-hidden="true" />
                          {test.running ? t("mcp.testingTool") : t("mcp.testTool")}
                        </Button>
                      </div>
                      {test.result && (
                        <pre
                          className={`max-h-52 overflow-auto rounded-md p-2.5 font-mono text-[10.5px] leading-relaxed ${
                            test.result.success
                              ? "bg-surface-subtle text-foreground/85"
                              : "border border-danger/35 bg-danger/[0.06] text-danger"
                          }`}
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
        <div className="flex shrink-0 flex-col items-end gap-2">
          <label className="flex items-center gap-1.5">
            <span className="text-[10.5px] text-muted">
              {server.enabled ? t("mcp.configurationEnabled") : t("mcp.disabled")}
            </span>
            <Switch
              checked={server.enabled}
              onCheckedChange={onToggle}
              aria-label={server.enabled ? t("mcp.configurationEnabled") : t("mcp.disabled")}
            />
          </label>
          <div className="flex items-center gap-0.5">
            <Tip content={t("mcp.testConnection")}>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={testingConnection}
                onClick={onTestConnection}
                aria-label={t("mcp.testConnection")}
              >
                <Play size={14} />
              </Button>
            </Tip>
            {server.enabled && (
              <Tip content={t("mcp.restart")}>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={onRestart}
                  aria-label={t("mcp.restart")}
                >
                  <RefreshCw size={14} />
                </Button>
              </Tip>
            )}
            <Tip content={t("mcp.edit")}>
              <Button variant="ghost" size="icon-sm" onClick={onEdit} aria-label={t("mcp.edit")}>
                <Pencil size={14} />
              </Button>
            </Tip>
            <Tip content={t("mcp.delete")}>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onDelete}
                aria-label={t("mcp.delete")}
              >
                <Trash2 size={14} />
              </Button>
            </Tip>
          </div>
        </div>
      </div>
    </li>
  );
}
