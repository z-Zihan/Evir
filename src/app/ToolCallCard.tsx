import { Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ToolCallRecord, ToolResultRecord } from "../core/storage/db";
import { TOOL_NOT_AVAILABLE, TOOL_PERMISSION_REQUIRED } from "../core/tools/tool-executor";

interface ToolCallCardProps {
  call: ToolCallRecord;
  result?: ToolResultRecord;
}

export function ToolCallCard({ call, result }: ToolCallCardProps) {
  const { t, i18n } = useTranslation();
  const permissionRequired = result?.error === TOOL_PERMISSION_REQUIRED;
  const resultText =
    result?.error === TOOL_NOT_AVAILABLE ? t("tools.notAvailable") : result?.output;
  const status = permissionRequired
    ? t("tools.permissionRequired")
    : result?.success
      ? t("tools.success")
      : t("tools.failed");
  const toolKey = `tools.${call.toolName}`;
  const toolName = i18n.exists(toolKey) ? t(toolKey) : call.toolName;

  return (
    <section className="tool-call-card">
      <div className="tool-call-header">
        <span className="tool-call-name">
          <Wrench size={15} aria-hidden="true" />
          <span>{t("tools.title")}</span>
          <strong>{toolName}</strong>
        </span>
        {result && (
          <span className={`tool-call-status ${result.success ? "success" : "failed"}`}>
            {status}
          </span>
        )}
      </div>
      <details className="tool-call-details">
        <summary>{t("tools.arguments")}</summary>
        <pre>{JSON.stringify(call.arguments, null, 2)}</pre>
      </details>
      {result && (
        <details className="tool-call-details">
          <summary>{t("tools.result")}</summary>
          <pre>{resultText}</pre>
        </details>
      )}
      {permissionRequired && (
        <div className="tool-call-actions">
          <button type="button" className="tool-call-approve">
            {t("tools.approve")}
          </button>
          <button type="button" className="tool-call-deny">
            {t("tools.deny")}
          </button>
        </div>
      )}
    </section>
  );
}
