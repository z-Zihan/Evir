import { useEffect, useId, useRef, useState } from "react";
import { AlertTriangle, RotateCcw, X } from "lucide-react";
import { useTranslation } from "react-i18next";

export interface ConfirmationOptions {
  title: string;
  description: string;
  confirmLabel: string;
  tone?: "danger" | "warning";
}

interface ConfirmationDialogProps extends ConfirmationOptions {
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}

export function ConfirmationDialog({
  title,
  description,
  confirmLabel,
  tone = "danger",
  onCancel,
  onConfirm,
}: ConfirmationDialogProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const descriptionId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  busyRef.current = busy;

  useEffect(() => {
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyRef.current) onCancel();
      if (event.key !== "Tab") return;

      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      restoreFocusRef.current?.focus();
    };
  }, [onCancel]);

  const handleConfirm = async () => {
    setBusy(true);
    setFailed(false);
    try {
      await onConfirm();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const Icon = tone === "warning" ? RotateCcw : AlertTriangle;

  return (
    <div className="confirmation-backdrop" onMouseDown={busy ? undefined : onCancel}>
      <section
        ref={dialogRef}
        className={`confirmation-dialog ${tone}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button
          className="confirmation-close"
          type="button"
          aria-label={t("confirmation.close")}
          data-tip={t("confirmation.close")}
          disabled={busy}
          onClick={onCancel}
        >
          <X size={16} />
        </button>
        <span className="confirmation-icon" aria-hidden="true">
          <Icon size={20} />
        </span>
        <div className="confirmation-copy">
          <h4 id={titleId}>{title}</h4>
          <p id={descriptionId}>{description}</p>
          {failed && (
            <p className="confirmation-error" role="alert">
              {t("confirmation.failed")}
            </p>
          )}
        </div>
        <footer>
          <button ref={cancelRef} type="button" disabled={busy} onClick={onCancel}>
            {t("confirmation.cancel")}
          </button>
          <button
            className="confirmation-submit"
            type="button"
            disabled={busy}
            onClick={() => void handleConfirm()}
          >
            {busy ? t("confirmation.processing") : confirmLabel}
          </button>
        </footer>
      </section>
    </div>
  );
}
