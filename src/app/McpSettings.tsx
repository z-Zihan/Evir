import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Trash2, Plus, AlertTriangle } from "lucide-react";
import { useMcpStore } from "../features/mcp/mcp-store";
import type { McpTransport } from "../core/mcp/types";

interface FormState {
  name: string;
  transport: McpTransport;
  command: string;
  args: string;
  cwd: string;
  url: string;
  headers: string;
}

const emptyForm: FormState = {
  name: "",
  transport: "stdio",
  command: "",
  args: "",
  cwd: "",
  url: "",
  headers: "",
};

export function McpSettings() {
  const { t } = useTranslation();
  const servers = useMcpStore((s) => s.servers);
  const loadServers = useMcpStore((s) => s.loadServers);
  const addServer = useMcpStore((s) => s.addServer);
  const removeServer = useMcpStore((s) => s.removeServer);
  const toggleServer = useMcpStore((s) => s.toggleServer);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);

  useEffect(() => {
    void loadServers().finally(() => setLoading(false));
  }, [loadServers]);

  const handleSubmit = async () => {
    if (!form.name.trim()) return;
    if (form.transport === "stdio") {
      await addServer({
        name: form.name.trim(),
        transport: "stdio",
        command: form.command.trim(),
        args: form.args
          .split(",")
          .map((a) => a.trim())
          .filter(Boolean),
        ...(form.cwd.trim() ? { cwd: form.cwd.trim() } : {}),
        envSecretRefs: {},
      });
    } else {
      await addServer({
        name: form.name.trim(),
        transport: "streamable-http",
        url: form.url.trim(),
        headerSecretRefs: {},
      });
    }
    setForm(emptyForm);
    setShowForm(false);
  };

  if (loading) return <p>{t("common.loading")}</p>;

  return (
    <section className="mcp-settings">
      <div className="settings-page-intro compact">
        <div>
          <span className="settings-page-eyebrow">{t("settingsDescriptions.toolConnections")}</span>
          <p>{t("settingsDescriptions.mcp")}</p>
        </div>
      </div>
      <p className="mcp-security-notice">
        <AlertTriangle size={14} />
        {t("mcp.securityNotice")}
      </p>
      {servers.length === 0 ? (
        <div className="settings-empty-state">
          <strong>{t("mcp.noServers")}</strong>
          <span>{t("settingsDescriptions.mcpEmpty")}</span>
        </div>
      ) : (
        <ul className="mcp-list">
          {servers.map((server) => (
            <li key={server.id} className="mcp-item">
              <div className="mcp-item-header">
                <span className="mcp-item-name">{server.name}</span>
                <span className="mcp-transport-badge">{server.transport}</span>
              </div>
              <p className="mcp-item-detail">
                {server.transport === "stdio"
                  ? `${server.command} ${server.args.join(" ")}`
                  : server.url}
              </p>
              <div className="mcp-item-footer">
                <label className="mcp-toggle">
                  <input
                    type="checkbox"
                    checked={server.enabled}
                    onChange={() => void toggleServer(server.id)}
                  />
                  <span>{server.enabled ? t("mcp.enabled") : t("mcp.disabled")}</span>
                </label>
                <button
                  type="button"
                  className="mcp-delete"
                  aria-label={t("mcp.delete")}
                  onClick={() => void removeServer(server.id)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {showForm ? (
        <div className="mcp-form">
          <label>
            <span>{t("mcp.name")}</span>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label>
            <span>{t("mcp.transport")}</span>
            <select
              value={form.transport}
              onChange={(e) => setForm({ ...form, transport: e.target.value as McpTransport })}
            >
              <option value="stdio">{t("mcp.stdio")}</option>
              <option value="streamable-http">{t("mcp.streamableHttp")}</option>
            </select>
          </label>
          {form.transport === "stdio" ? (
            <>
              <label>
                <span>{t("mcp.command")}</span>
                <input
                  value={form.command}
                  onChange={(e) => setForm({ ...form, command: e.target.value })}
                  placeholder="npx"
                />
              </label>
              <label>
                <span>{t("mcp.arguments")}</span>
                <input
                  value={form.args}
                  onChange={(e) => setForm({ ...form, args: e.target.value })}
                  placeholder="-y, @modelcontextprotocol/server-filesystem, /path"
                />
              </label>
              <label>
                <span>{t("mcp.workingDirectory")}</span>
                <input
                  value={form.cwd}
                  onChange={(e) => setForm({ ...form, cwd: e.target.value })}
                  placeholder="/optional/cwd"
                />
              </label>
              <p className="mcp-desktop-notice">{t("mcp.desktopOnly")}</p>
            </>
          ) : (
            <>
              <label>
                <span>{t("mcp.url")}</span>
                <input
                  value={form.url}
                  onChange={(e) => setForm({ ...form, url: e.target.value })}
                  placeholder="https://example.com/mcp"
                />
              </label>
              <label>
                <span>{t("mcp.headers")}</span>
                <input
                  value={form.headers}
                  onChange={(e) => setForm({ ...form, headers: e.target.value })}
                  placeholder="Authorization: Bearer ..."
                />
              </label>
            </>
          )}
          <div className="flex gap-2 mt-3">
            <button
              type="button"
              onClick={() => {
                setForm(emptyForm);
                setShowForm(false);
              }}
            >
              {t("mcp.cancel")}
            </button>
            <button type="button" onClick={() => void handleSubmit()} disabled={!form.name.trim()}>
              {t("mcp.save")}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="mcp-add" onClick={() => setShowForm(true)}>
          <Plus size={15} />
          {t("mcp.add")}
        </button>
      )}
    </section>
  );
}
