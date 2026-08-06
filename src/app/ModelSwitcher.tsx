import { useEffect, useRef, useState } from "react";
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

  const current = providers.find((p) => p.isDefault && p.enabled) ?? null;
  const enabled = providers.filter((p) => p.enabled);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  if (!current || enabled.length <= 1) {
    return <span className="model-label">{current?.modelId ?? t("chat.modelPlaceholder")}</span>;
  }

  return (
    <div className="flex items-center gap-1" ref={containerRef}>
      <button
        type="button"
        className="model-switcher-button"
        title={t("chat.switchModel")}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span>{current.name}</span>
        <span className="model-switcher-model">{current.modelId}</span>
        <ChevronDown
          size={12}
          className={`flex items-center gap-1-chevron${open ? " open" : ""}`}
        />
      </button>
      {open && (
        <div className="model-switcher-dropdown" role="listbox" aria-label={t("chat.switchModel")}>
          {enabled.map((provider) => (
            <button
              key={provider.id}
              type="button"
              role="option"
              aria-selected={provider.id === current.id}
              className={`flex items-center gap-1-item${provider.id === current.id ? " active" : ""}`}
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
