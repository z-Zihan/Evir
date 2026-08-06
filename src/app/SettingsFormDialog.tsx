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

  useEffect(() => {
    closeRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="settings-form-backdrop" onMouseDown={onClose}>
      <section
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
          <button ref={closeRef} type="button" onClick={onClose} aria-label={title}>
            <X size={17} />
          </button>
        </header>
        <div className="settings-form-dialog-body">{children}</div>
      </section>
    </div>
  );
}
