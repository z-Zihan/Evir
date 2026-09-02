import { useRef, useState } from "react";
import { AlertTriangle, RotateCcw, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  buttonVariants,
  Tip,
} from "../components/ui";
import { useOverlayBrowserGuard } from "./workspace/use-overlay-browser-guard";

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
  useOverlayBrowserGuard("confirmation", true);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

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
    <AlertDialog
      open
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !busy) onCancel();
      }}
    >
      {/* `.confirmation-dialog` keeps the shell visuals (and its ≤640px rules), but it
      pins `position: relative` for the old in-flow backdrop layout; the inline style
      restores the fixed, viewport-centered placement the primitive expects. */}
      <AlertDialogContent
        className={`confirmation-dialog ${tone}`}
        style={{ position: "fixed" }}
        initialFocus={cancelRef}
      >
        <Tip content={t("confirmation.close")}>
          <button
            className="confirmation-close"
            type="button"
            aria-label={t("confirmation.close")}
            disabled={busy}
            onClick={onCancel}
          >
            <X size={16} />
          </button>
        </Tip>
        <span className="confirmation-icon" aria-hidden="true">
          <Icon size={20} />
        </span>
        <div className="confirmation-copy">
          <AlertDialogTitle render={<h4 />}>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
          {failed && (
            <p className="confirmation-error" role="alert">
              {t("confirmation.failed")}
            </p>
          )}
        </div>
        <footer>
          <AlertDialogCancel ref={cancelRef} disabled={busy}>
            {t("confirmation.cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            className={`confirmation-submit ${buttonVariants({ variant: tone === "warning" ? "primary" : "destructive" })}`}
            disabled={busy}
            onClick={() => void handleConfirm()}
          >
            {busy ? t("confirmation.processing") : confirmLabel}
          </AlertDialogAction>
        </footer>
      </AlertDialogContent>
    </AlertDialog>
  );
}
