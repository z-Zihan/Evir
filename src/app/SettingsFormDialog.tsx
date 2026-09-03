import { useEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogTitle,
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  Tip,
} from "../components/ui";

interface SettingsFormDialogProps {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  /** 为 true 时，Esc/背景点击/关闭按钮会先要求确认丢弃未保存的更改 */
  dirty?: boolean;
  discardPrompt?: { message: string; keepLabel: string; discardLabel: string };
}

/**
 * Provider/MCP record editor shell. The chrome is utilities on the shared
 * Dialog primitive; the distinctive behavior is the dirty-close guard, which
 * raises an AlertDialog before discarding unsaved changes.
 */
export function SettingsFormDialog({
  title,
  description,
  children,
  onClose,
  wide = false,
  dirty = false,
  discardPrompt,
}: SettingsFormDialogProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const keepRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  useEffect(() => {
    if (!dirty) setConfirmingDiscard(false);
  }, [dirty]);

  const requestClose = () => {
    if (dirtyRef.current) setConfirmingDiscard(true);
    else onCloseRef.current();
  };

  return (
    <Dialog
      open
      onOpenChange={(nextOpen) => {
        if (!nextOpen) requestClose();
      }}
    >
      <DialogContent
        className={[
          "grid max-h-[min(720px,calc(100vh-48px))] max-w-none grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-[14px] p-0 shadow-[0_24px_70px_rgb(0_0_0/0.24)]",
          wide
            ? "h-[min(620px,calc(100vh-96px))] w-[min(760px,calc(100vw-48px))]"
            : "w-[min(560px,calc(100vw-48px))]",
        ].join(" ")}
        showCloseButton={false}
        initialFocus={closeRef}
      >
        <header className="flex items-start justify-between gap-4.5 border-b border-border px-5 pt-4.5 pb-4">
          <div className="min-w-0">
            <DialogTitle render={<h4 />} className="m-0 text-[15px] font-semibold tracking-tight">
              {title}
            </DialogTitle>
            {description && (
              <p className="mt-1.5 text-[10.5px] leading-normal text-muted">{description}</p>
            )}
          </div>
          <Tip content={title}>
            <Button
              ref={closeRef}
              variant="ghost"
              size="icon"
              type="button"
              onClick={requestClose}
              aria-label={title}
            >
              <X size={16} />
            </Button>
          </Tip>
        </header>
        <div className="min-h-0 overflow-y-auto">{children}</div>
      </DialogContent>
      {confirmingDiscard && (
        <AlertDialog
          open
          onOpenChange={(nextOpen) => {
            if (!nextOpen) setConfirmingDiscard(false);
          }}
        >
          <AlertDialogContent
            className="flex items-center justify-between gap-3.5 border-border bg-surface-hover px-4.5 py-2.5 text-[13.5px] text-foreground"
            initialFocus={keepRef}
          >
            <AlertDialogTitle render={<span />}>
              {discardPrompt?.message ?? "Unsaved changes will be lost."}
            </AlertDialogTitle>
            <div className="flex shrink-0 gap-2">
              <AlertDialogCancel ref={keepRef} className="h-9 rounded-lg px-3.5 text-[13px]">
                {discardPrompt?.keepLabel ?? "Keep editing"}
              </AlertDialogCancel>
              <Button variant="destructive" size="default" onClick={() => onCloseRef.current()}>
                {discardPrompt?.discardLabel ?? "Discard changes"}
              </Button>
            </div>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </Dialog>
  );
}
