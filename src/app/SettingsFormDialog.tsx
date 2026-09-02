import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "../components/ui";

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
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
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

  useEffect(() => {
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        requestClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true");
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      previousFocusRef.current?.focus();
    };
  }, []);

  useEffect(() => {
    if (confirmingDiscard) keepRef.current?.focus();
  }, [confirmingDiscard]);

  return (
    <div className="settings-form-backdrop" onMouseDown={requestClose}>
      <section
        ref={dialogRef}
        className={`settings-form-dialog${wide ? " wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="settings-form-dialog-header">
          <div>
            <h4 id={titleId}>{title}</h4>
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
        {confirmingDiscard && (
          <footer
            className="settings-form-discard"
            role="alertdialog"
            aria-label={discardPrompt?.message ?? "Unsaved changes"}
          >
            <span>{discardPrompt?.message ?? "Unsaved changes will be lost."}</span>
            <div className="settings-form-discard-actions">
              <Button
                ref={keepRef}
                variant="secondary"
                size="lg"
                onClick={() => setConfirmingDiscard(false)}
              >
                {discardPrompt?.keepLabel ?? "Keep editing"}
              </Button>
              <button type="button" className="danger-button" onClick={() => onCloseRef.current()}>
                {discardPrompt?.discardLabel ?? "Discard changes"}
              </button>
            </div>
          </footer>
        )}
      </section>
    </div>
  );
}
