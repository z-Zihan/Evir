import { type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Globe2, Terminal } from "lucide-react";
import { Button, Input } from "../../components/ui";
import { SettingsFormDialog } from "../SettingsFormDialog";
import { type McpFormErrors, type McpFormState } from "./form-model";

interface McpServerFormDialogProps {
  editing: boolean;
  form: McpFormState;
  errors: McpFormErrors;
  onFieldChange: <Key extends keyof McpFormState>(key: Key, value: McpFormState[Key]) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
}

function FieldLabel({ text, required }: { text: string; required?: boolean }) {
  return (
    <span className="flex items-center gap-1 text-[11.5px] font-semibold text-foreground">
      {text}
      &nbsp;
      {required && <em className="font-normal text-danger not-italic">*</em>}
    </span>
  );
}

function FieldError({ message }: { message: string | undefined }) {
  if (!message) return null;
  return (
    <small className="text-[10.5px] text-danger" role="alert">
      {message}
    </small>
  );
}

const fieldClass = "flex min-w-0 flex-col gap-1.5";

/** Add/Edit MCP server dialog: transport picker + transport-specific fields. */
export function McpServerFormDialog({
  editing,
  form,
  errors,
  onFieldChange,
  onSubmit,
  onClose,
}: McpServerFormDialogProps) {
  const { t } = useTranslation();
  return (
    <SettingsFormDialog
      title={editing ? t("mcp.editServer") : t("mcp.addServer")}
      description={t("mcp.dialogDescription")}
      onClose={onClose}
    >
      <form className="flex flex-col gap-3.5 p-5" noValidate onSubmit={onSubmit}>
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("mcp.transport")}>
          {(["stdio", "streamable-http"] as const).map((transport) => {
            const active = form.transport === transport;
            const Icon = transport === "stdio" ? Terminal : Globe2;
            return (
              <button
                key={transport}
                type="button"
                role="radio"
                aria-checked={active}
                className={`flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 text-left transition-colors ${
                  active
                    ? "border-primary/60 bg-primary/[0.06]"
                    : "border-border bg-surface-subtle hover:border-border-strong hover:bg-surface-hover"
                }`}
                onClick={() => onFieldChange("transport", transport)}
              >
                <Icon size={17} aria-hidden="true" className="mt-0.5 shrink-0 text-muted" />
                <span className="min-w-0">
                  <strong className="block text-[12px] font-semibold text-foreground">
                    {transport === "stdio" ? t("mcp.localProcess") : t("mcp.remoteServer")}
                  </strong>
                  <small className="mt-0.5 block text-[10.5px] leading-snug text-muted">
                    {transport === "stdio" ? t("mcp.stdioDescription") : t("mcp.httpDescription")}
                  </small>
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex flex-col gap-3.5">
          <label className={fieldClass}>
            <FieldLabel text={t("mcp.name")} required />
            <Input
              autoFocus
              value={form.name}
              aria-invalid={Boolean(errors.name)}
              onChange={(event) => onFieldChange("name", event.target.value)}
              placeholder={t("mcp.namePlaceholder")}
            />
            <FieldError message={errors.name} />
          </label>
          {form.transport === "stdio" ? (
            <>
              <label className={fieldClass}>
                <FieldLabel text={t("mcp.command")} required />
                <Input
                  value={form.command}
                  aria-invalid={Boolean(errors.command)}
                  onChange={(event) => onFieldChange("command", event.target.value)}
                  placeholder="npx"
                />
                <FieldError message={errors.command} />
              </label>
              <label className={fieldClass}>
                <FieldLabel text={t("mcp.arguments")} />
                <Input
                  value={form.args}
                  onChange={(event) => onFieldChange("args", event.target.value)}
                  placeholder="-y, @modelcontextprotocol/server-filesystem"
                />
                <small className="text-[10px] text-muted">{t("mcp.argumentsHint")}</small>
              </label>
              <label className={fieldClass}>
                <FieldLabel text={t("mcp.workingDirectory")} />
                <Input
                  value={form.cwd}
                  onChange={(event) => onFieldChange("cwd", event.target.value)}
                  placeholder="/optional/cwd"
                />
              </label>
            </>
          ) : (
            <label className={fieldClass}>
              <FieldLabel text={t("mcp.url")} required />
              <Input
                value={form.url}
                aria-invalid={Boolean(errors.url)}
                onChange={(event) => onFieldChange("url", event.target.value)}
                placeholder="https://example.com/mcp"
              />
              <FieldError message={errors.url} />
            </label>
          )}
        </div>
        <div className="flex items-center gap-1.5 rounded-lg border border-warning/35 bg-warning/[0.07] px-3 py-2 text-[11.5px] text-warning">
          <AlertTriangle size={13} aria-hidden="true" /> {t("mcp.disabledByDefault")}
        </div>
        <div className="grid grid-cols-[1fr_auto_auto] items-center gap-2 border-t border-border pt-3.5">
          <span />
          <Button variant="ghost" size="default" type="button" onClick={onClose}>
            {t("mcp.cancel")}
          </Button>
          <Button variant="primary" size="lg" type="submit">
            {editing ? t("mcp.saveChanges") : t("mcp.save")}
          </Button>
        </div>
      </form>
    </SettingsFormDialog>
  );
}
