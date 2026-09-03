import { ConfirmDialog, type ConfirmTone } from "../components/feedback";
import { useOverlayBrowserGuard } from "./workspace/use-overlay-browser-guard";

export interface ConfirmationOptions {
  title: string;
  description: string;
  confirmLabel: string;
  tone?: "danger" | "warning";
}

/**
 * Imperative confirm flow (useConfirmationDialog) rendered on the shared
 * ConfirmDialog composite — no bespoke dialog chrome any more.
 */
export function ConfirmationDialog({
  title,
  description,
  confirmLabel,
  tone = "danger",
  onCancel,
  onConfirm,
}: ConfirmationDialogProps) {
  useOverlayBrowserGuard("confirmation", true);
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      tone={tone === "warning" ? "warning" : "danger"}
      onConfirm={onConfirm}
    />
  );
}

interface ConfirmationDialogProps extends ConfirmationOptions {
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}

export type { ConfirmTone };
