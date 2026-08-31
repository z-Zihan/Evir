import { useTranslation } from "react-i18next";
import { SandboxFrame } from "../SandboxFrame";

interface HtmlPreviewProps {
  source: string;
}

/**
 * UNTRUSTED_CODE artifact preview: model-generated HTML/CSS/JS runs only
 * inside the hardened SandboxFrame (opaque origin, no IPC, no storage access,
 * no popups/downloads/forms). The code tab remains the default view; preview
 * is opt-in per artifact.
 */
export function HtmlPreview({ source }: HtmlPreviewProps) {
  const { t } = useTranslation();
  return (
    <div className="html-preview">
      <SandboxFrame source={source} title={t("preview.htmlPreviewTitle")} />
    </div>
  );
}
