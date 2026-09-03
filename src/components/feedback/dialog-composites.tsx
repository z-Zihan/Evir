import { useState, type ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Button,
} from "../ui";
import { cn } from "../ui/utils";

/**
 * Public dialog composites (§17). All app dialogs build on these instead of
 * hand-rolling overlays: Escape/outside-click/focus handling comes from the
 * Base UI dialog primitive; these add the shared header/footer/error chrome.
 *
 * Policy: ConfirmDialog/DangerConfirmDialog are for decisions and dangerous
 * or irreversible actions. Lightweight non-blocking feedback uses notify.*;
 * in-place failures use InlineError/ErrorState.
 */

export interface AppDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  /** sm ≈ 420px (confirmations), md ≈ 540px default, lg ≈ 680px (forms) */
  size?: "sm" | "md" | "lg";
  showCloseButton?: boolean;
}

const sizeClass = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl" } as const;

export function AppDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = "md",
  showCloseButton = true,
}: AppDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn("gap-4", sizeClass[size])} showCloseButton={showCloseButton}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        {children}
        {footer ? <DialogFooter>{footer}</DialogFooter> : null}
      </DialogContent>
    </Dialog>
  );
}

export type ConfirmTone = "default" | "warning" | "danger";

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
  /** Async confirm; the footer shows busy state and keeps the dialog open on failure. */
  onConfirm: () => Promise<void> | void;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  tone = "default",
  onConfirm,
}: ConfirmDialogProps) {
  const { t } = useTranslation();
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

  return (
    // Confirmations render on the AlertDialog primitive: role="alertdialog",
    // no outside-click dismissal, focus stays trapped on the decision.
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
    >
      <AlertDialogContent className="max-w-sm gap-4">
        <AlertDialogTitle>{title}</AlertDialogTitle>
        {description ? <AlertDialogDescription>{description}</AlertDialogDescription> : null}
        {tone !== "default" && (
          <div
            className={cn(
              "flex items-start gap-2 rounded-lg border px-3 py-2 text-[12px] leading-relaxed",
              tone === "danger"
                ? "border-danger/35 bg-danger/[0.06] text-danger"
                : "border-warning/40 bg-warning/[0.07] text-warning",
            )}
          >
            <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>
              {tone === "danger" ? t("confirmation.dangerHint") : t("confirmation.warningHint")}
            </span>
          </div>
        )}
        {failed && (
          <p className="text-[12px] text-danger" role="alert">
            {t("confirmation.failed")}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>
            {cancelLabel ?? t("confirmation.cancel")}
          </AlertDialogCancel>
          <Button
            variant={tone === "danger" ? "destructive" : "primary"}
            disabled={busy}
            onClick={() => void handleConfirm()}
          >
            {busy ? t("confirmation.processing") : confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** DangerConfirmDialog: confirmation for destructive/irreversible actions. */
export function DangerConfirmDialog(props: Omit<ConfirmDialogProps, "tone">) {
  return <ConfirmDialog {...props} tone="danger" />;
}

export interface FormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  submitLabel: string;
  cancelLabel?: string;
  busy?: boolean;
  disabled?: boolean;
  onSubmit: () => void | Promise<void>;
  children: ReactNode;
  size?: "sm" | "md" | "lg";
}

/** Dialog hosting a form; submit/cancel live in the shared footer. */
export function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  submitLabel,
  cancelLabel,
  busy = false,
  disabled = false,
  onSubmit,
  children,
  size = "md",
}: FormDialogProps) {
  const { t } = useTranslation();
  return (
    <AppDialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
      size={size}
      title={title}
      description={description}
      footer={
        <>
          <DialogClose render={<Button variant="secondary" disabled={busy} />}>
            {cancelLabel ?? t("confirmation.cancel")}
          </DialogClose>
          <Button type="submit" form="app-form-dialog" disabled={busy || disabled}>
            {busy ? t("confirmation.processing") : submitLabel}
          </Button>
        </>
      }
    >
      <form
        id="app-form-dialog"
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmit();
        }}
      >
        {children}
      </form>
    </AppDialog>
  );
}
