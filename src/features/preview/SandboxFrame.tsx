import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * Hardened frame for UNTRUSTED_CODE artifacts.
 *
 * Security contract:
 * - `sandbox` never includes `allow-same-origin`, so the frame gets an opaque
 *   origin: no access to Evir's localStorage/IndexedDB, no Tauri IPC.
 * - No popups, downloads, forms, clipboard or navigation of the parent.
 * - Desktop: content is served from the dedicated `preview://` scheme handler
 *   with its own restrictive CSP, so the app CSP is never widened or inherited.
 * - Web: content goes through a blob URL inside the same sandbox attributes.
 */
const SANDBOX_FLAGS = "allow-scripts";

export interface SandboxFrameProps {
  /** Raw untrusted document source. */
  source: string;
  /** Suggested MIME type (text/html). */
  mimeType?: string;
  title?: string;
  className?: string;
}

function isDesktopRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

interface PreviewRegistration {
  url: string;
  revoke(): void;
}

async function registerDesktopPreview(source: string): Promise<PreviewRegistration> {
  const { tauriInvoke } = await import("../../runtime/tauri-ipc");
  const id = await tauriInvoke<string>("preview_artifact_register", { source });
  return {
    url: `preview://localhost/artifact/${encodeURIComponent(id)}`,
    revoke() {
      void tauriInvoke("preview_artifact_revoke", { id }).catch(() => undefined);
    },
  };
}

function registerWebPreview(source: string, mimeType: string): PreviewRegistration {
  const blob = new Blob([source], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  return {
    url,
    revoke() {
      URL.revokeObjectURL(url);
    },
  };
}

export function SandboxFrame({
  source,
  mimeType = "text/html",
  title,
  className,
}: SandboxFrameProps) {
  const { t } = useTranslation();
  const [registration, setRegistration] = useState<PreviewRegistration | null>(null);
  const [failed, setFailed] = useState(false);
  const frameRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    let active: PreviewRegistration | null = null;
    setFailed(false);
    const create = isDesktopRuntime()
      ? registerDesktopPreview(source).catch(() => registerWebPreview(source, mimeType))
      : Promise.resolve(registerWebPreview(source, mimeType));
    void create.then(
      (entry) => {
        if (cancelled) {
          entry.revoke();
          return;
        }
        active = entry;
        setRegistration(entry);
      },
      () => {
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
      active?.revoke();
      setRegistration(null);
    };
  }, [source, mimeType]);

  return (
    <div className={`sandbox-frame${className ? ` ${className}` : ""}`}>
      {failed ? (
        <p className="preview-fallback-text">{t("preview.sandboxUnavailable")}</p>
      ) : registration ? (
        <iframe
          ref={frameRef}
          title={title ?? t("preview.sandboxTitle")}
          className="sandbox-frame-iframe"
          sandbox={SANDBOX_FLAGS}
          src={registration.url}
          referrerPolicy="no-referrer"
        />
      ) : (
        <div className="sandbox-frame-loading" aria-hidden="true" />
      )}
    </div>
  );
}
