import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Cable, Globe2, Pencil, Plus, Terminal, Trash2 } from "lucide-react";
import type { McpTransport } from "../core/mcp/types";
import { useMcpStore, type McpServerEntry } from "../features/mcp/mcp-store";
import { SettingsFormDialog } from "./SettingsFormDialog";

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

export function McpSettings() {
  const { t } = useTranslation();
  const { servers, loadServers, addServer, updateServer, removeServer, toggleServer } =
    useMcpStore();
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({ ...EMPTY_FORM });
  const [errors, setErrors] = useState<FormErrors>({});

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
          <button className="primary-button" type="button" onClick={openAdd}>
            <Plus size={14} /> {t("mcp.add")}
          </button>
        </div>
      </div>

      <div className="mcp-security-notice">
        <AlertTriangle size={14} />
        <span>{t("mcp.securityNotice")}</span>
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
          <button className="secondary-button" type="button" onClick={openAdd}>
            <Plus size={14} /> {t("mcp.add")}
          </button>
        </div>
      ) : (
        <ul className="mcp-list">
          {servers.map((server) => (
            <li key={server.id} className="mcp-item">
              <span
                className={`mcp-status-dot${server.enabled ? " enabled" : ""}`}
                aria-hidden="true"
              />
              <span className="mcp-transport-icon" aria-hidden="true">
                {server.transport === "stdio" ? <Terminal size={16} /> : <Globe2 size={16} />}
              </span>
              <div className="mcp-item-copy">
                <div>
                  <strong>{server.name}</strong>
                  <span>
                    {server.transport === "stdio" ? t("mcp.localProcess") : t("mcp.remoteServer")}
                  </span>
                </div>
                <p>
                  {server.transport === "stdio"
                    ? `${server.command} ${server.args.join(" ")}`.trim()
                    : server.url}
                </p>
              </div>
              <label className="mcp-toggle">
                <span>{server.enabled ? t("mcp.enabled") : t("mcp.disabled")}</span>
                <input
                  type="checkbox"
                  checked={server.enabled}
                  onChange={() => void toggleServer(server.id)}
                />
                <i aria-hidden="true" />
              </label>
              <div className="mcp-item-actions">
                <button type="button" onClick={() => openEdit(server)} aria-label={t("mcp.edit")}>
                  <Pencil size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(t("mcp.confirmDelete"))) void removeServer(server.id);
                  }}
                  aria-label={t("mcp.delete")}
                >
                  <Trash2 size={14} />
                </button>
              </div>
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
              <button className="primary-button" type="submit">
                {editingId ? t("mcp.saveChanges") : t("mcp.save")}
              </button>
            </div>
          </form>
        </SettingsFormDialog>
      )}
    </section>
  );
}
