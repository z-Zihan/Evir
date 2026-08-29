import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown } from "lucide-react";
import { useProviderStore } from "../features/provider/provider-store";
import { listModelsForProtocol } from "../core/providers/adapter-registry";
import type { ProviderRecord } from "../core/storage/db";

interface ModelSwitcherProps {
  /** Provider backing the active conversation; falls back to the default. */
  activeProvider?: ProviderRecord | null | undefined;
  /** Model id the active conversation currently uses. */
  activeModelId?: string | undefined;
  /** Bump this counter to open the dropdown programmatically (e.g. /model). */
  openSignal?: number | undefined;
  onSwitch: (provider: ProviderRecord) => void;
  /** Switch the given provider to a specific model id. */
  onSwitchModel: (provider: ProviderRecord, modelId: string) => void;
}

const knownModelsCacheKey = (providerId: string) => `evir-known-models:${providerId}`;

function readKnownModels(provider: ProviderRecord): string[] {
  try {
    const raw = localStorage.getItem(knownModelsCacheKey(provider.id));
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    const cached = Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string")
      : [];
    return Array.from(new Set([provider.modelId, ...cached]));
  } catch {
    return [provider.modelId];
  }
}

function writeKnownModels(providerId: string, models: string[]): void {
  try {
    localStorage.setItem(knownModelsCacheKey(providerId), JSON.stringify(models));
  } catch {
    // Cache is best-effort; losing it only costs a re-fetch.
  }
}

export function ModelSwitcher({
  activeProvider,
  activeModelId,
  openSignal,
  onSwitch,
  onSwitchModel,
}: ModelSwitcherProps) {
  const { t } = useTranslation();
  const { providers } = useProviderStore();
  const [open, setOpen] = useState(false);
  const [customModel, setCustomModel] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const fetchedProviderRef = useRef<string | null>(null);

  const enabled = providers.filter((p) => p.enabled);
  const current =
    (activeProvider && enabled.find((p) => p.id === activeProvider.id)) ??
    enabled.find((p) => p.isDefault) ??
    enabled[0] ??
    null;
  const shownModelId = activeModelId ?? current?.modelId;
  const [knownModels, setKnownModels] = useState<string[]>(() =>
    current ? readKnownModels(current) : [],
  );

  useEffect(() => {
    if (!open || !current) return;
    setKnownModels(readKnownModels(current));
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
  }, [open, current]);

  useEffect(() => {
    if (!openSignal) return;
    setOpen(true);
    triggerRef.current?.focus();
  }, [openSignal]);

  useEffect(() => {
    if (!open || !current || fetchedProviderRef.current === current.id) return;
    fetchedProviderRef.current = current.id;
    void (async () => {
      try {
        const models = await listModelsForProtocol(current.protocolId, {
          providerId: current.id,
          baseUrl: current.baseUrl,
          apiKey: current.apiKey,
        });
        if (!models?.length) return;
        const merged = Array.from(new Set([...readKnownModels(current), ...models]));
        writeKnownModels(current.id, merged);
        setKnownModels(merged);
      } catch {
        // Discovery is best-effort; cached + manual ids still work.
      }
    })();
  }, [open, current]);

  const handleListKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const options = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [],
    );
    if (options.length === 0) return;
    const currentIndex = Math.max(0, options.indexOf(document.activeElement as HTMLButtonElement));
    let nextIndex: number | undefined;
    if (event.key === "ArrowDown") nextIndex = (currentIndex + 1) % options.length;
    if (event.key === "ArrowUp") nextIndex = (currentIndex - 1 + options.length) % options.length;
    if (nextIndex === undefined) return;
    event.preventDefault();
    options[nextIndex]?.focus();
  };

  const commitCustomModel = () => {
    const modelId = customModel.trim();
    if (!modelId || !current) return;
    const merged = Array.from(new Set([modelId, ...readKnownModels(current)]));
    writeKnownModels(current.id, merged);
    setKnownModels(merged);
    setCustomModel("");
    setOpen(false);
    onSwitchModel(current, modelId);
  };

  if (!current) {
    return (
      <span className="model-label empty">
        <span className="model-status-dot" aria-hidden="true" />
        {t("chat.modelPlaceholder")}
      </span>
    );
  }

  const otherProviders = enabled.filter((p) => p.id !== current.id);

  return (
    <div className="model-switcher" ref={containerRef}>
      <button
        ref={triggerRef}
        type="button"
        className="model-switcher-button"
        data-tip={t("chat.switchModel")}
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
        {otherProviders.length > 0 && <span>{current.name}</span>}
        <span className="model-switcher-model">{shownModelId}</span>
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
          <div className="model-switcher-group-label">{t("chat.modelPickerModels")}</div>
          {knownModels.map((modelId) => {
            const selected = modelId === shownModelId;
            return (
              <button
                key={modelId}
                type="button"
                role="option"
                aria-selected={selected}
                className={`model-switcher-item model-switcher-item-row${selected ? " active" : ""}`}
                onClick={() => {
                  setOpen(false);
                  if (!selected) onSwitchModel(current, modelId);
                }}
              >
                <span className="model-switcher-item-name">{modelId}</span>
                {selected && <Check size={13} aria-hidden="true" />}
              </button>
            );
          })}
          <div className="model-switcher-custom">
            <input
              type="text"
              value={customModel}
              placeholder={t("chat.modelPickerCustomPlaceholder")}
              aria-label={t("chat.modelPickerCustomPlaceholder")}
              onChange={(event) => setCustomModel(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitCustomModel();
                }
                event.stopPropagation();
              }}
            />
            <button
              type="button"
              disabled={!customModel.trim()}
              onClick={commitCustomModel}
              aria-label={t("chat.modelPickerUse")}
              data-tip={t("chat.modelPickerUse")}
            >
              {t("chat.modelPickerUse")}
            </button>
          </div>
          {otherProviders.length > 0 && (
            <>
              <div className="model-switcher-group-label">
                {t("chat.modelPickerOtherProviders")}
              </div>
              {otherProviders.map((provider) => (
                <button
                  key={provider.id}
                  type="button"
                  role="option"
                  aria-selected={false}
                  className="model-switcher-item"
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
            </>
          )}
        </div>
      )}
    </div>
  );
}
