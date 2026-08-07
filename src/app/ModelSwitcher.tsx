import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown } from "lucide-react";
import { useProviderStore } from "../features/provider/provider-store";
import type { ProviderRecord } from "../core/storage/db";

interface ModelSwitcherProps {
  onSwitch: (provider: ProviderRecord) => void;
}

export function ModelSwitcher({ onSwitch }: ModelSwitcherProps) {
  const { t } = useTranslation();
  const { providers } = useProviderStore();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const current = providers.find((p) => p.isDefault && p.enabled) ?? null;
  const enabled = providers.filter((p) => p.enabled);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>('[role="option"][aria-selected="true"]')?.focus();
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const handleListKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const options = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [],
    );
    if (options.length === 0) return;
    const currentIndex = Math.max(0, options.indexOf(document.activeElement as HTMLButtonElement));
    let nextIndex: number | undefined;
    if (event.key === "ArrowDown") nextIndex = (currentIndex + 1) % options.length;
    if (event.key === "ArrowUp") nextIndex = (currentIndex - 1 + options.length) % options.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = options.length - 1;
    if (nextIndex === undefined) return;
    event.preventDefault();
    options[nextIndex]?.focus();
  };

  if (!current || enabled.length <= 1) {
    return (
      <span className={`model-label${current ? "" : " empty"}`}>
        <span className="model-status-dot" aria-hidden="true" />
        {current?.modelId ?? t("chat.modelPlaceholder")}
      </span>
    );
  }

  return (
    <div className="model-switcher" ref={containerRef}>
      <button
        ref={triggerRef}
        type="button"
        className="model-switcher-button"
        title={t("chat.switchModel")}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span>{current.name}</span>
        <span className="model-switcher-model">{current.modelId}</span>
        <ChevronDown size={12} className={`model-switcher-chevron${open ? " open" : ""}`} />
      </button>
      {open && (
        <div
          ref={listRef}
          className="model-switcher-dropdown"
          role="listbox"
          aria-label={t("chat.switchModel")}
          onKeyDown={handleListKeyDown}
        >
          {enabled.map((provider) => (
            <button
              key={provider.id}
              type="button"
              role="option"
              aria-selected={provider.id === current.id}
              className={`model-switcher-item${provider.id === current.id ? " active" : ""}`}
              onClick={() => {
                onSwitch(provider);
                setOpen(false);
              }}
            >
              <span className="model-switcher-item-name">{provider.name}</span>
              <span className="model-switcher-item-detail">
                {provider.protocolId} — {provider.modelId}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
