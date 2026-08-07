import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

interface SettingsFormDialogProps {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}

export function SettingsFormDialog({
  title,
  description,
  children,
  onClose,
  wide = false,
}: SettingsFormDialogProps) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
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

  return (
    <div className="settings-form-backdrop" onMouseDown={onClose}>
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
          <button ref={closeRef} type="button" onClick={onClose} aria-label={title} title={title}>
            <X size={17} />
          </button>
        </header>
        <div className="settings-form-dialog-body">{children}</div>
      </section>
    </div>
  );
}
