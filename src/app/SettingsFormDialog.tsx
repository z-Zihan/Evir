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
  buttonVariants,
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
        className={`settings-form-dialog${wide ? " wide" : ""} max-w-none p-0`}
        showCloseButton={false}
        initialFocus={closeRef}
      >
        <header className="settings-form-dialog-header">
          <div>
            <DialogTitle render={<h4 />}>{title}</DialogTitle>
            {description && <p>{description}</p>}
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={requestClose}
            aria-label={title}
            data-tip={title}
          >
            <X size={17} />
          </button>
        </header>
        <div className="settings-form-dialog-body">{children}</div>
      </DialogContent>
      {confirmingDiscard && (
        <AlertDialog
          open
          onOpenChange={(nextOpen) => {
            if (!nextOpen) setConfirmingDiscard(false);
          }}
        >
          <AlertDialogContent className="settings-form-discard" initialFocus={keepRef}>
            <AlertDialogTitle render={<span />}>
              {discardPrompt?.message ?? "Unsaved changes will be lost."}
            </AlertDialogTitle>
            <div className="settings-form-discard-actions">
              <AlertDialogCancel
                ref={keepRef}
                className={buttonVariants({ size: "lg" })}
                onClick={() => setConfirmingDiscard(false)}
              >
                {discardPrompt?.keepLabel ?? "Keep editing"}
              </AlertDialogCancel>
              <Button variant="destructive" onClick={() => onCloseRef.current()}>
                {discardPrompt?.discardLabel ?? "Discard changes"}
              </Button>
            </div>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </Dialog>
  );
}
