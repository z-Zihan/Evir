import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown } from "lucide-react";
import { Button, Input, Tip } from "../components/ui";
import { cn } from "../components/ui/utils";
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
      <span className="model-label empty inline-flex h-7 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-[11.5px] text-muted">
        <span className="model-status-dot size-1.5 rounded-full bg-muted" aria-hidden="true" />
        {t("chat.modelPlaceholder")}
      </span>
    );
  }

  const otherProviders = enabled.filter((p) => p.id !== current.id);

  return (
    <div className="model-switcher relative" ref={containerRef}>
      <Tip content={t("chat.switchModel")} side="bottom">
        <button
          ref={triggerRef}
          type="button"
          className="model-switcher-button inline-flex h-7 max-w-[240px] cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-[11.5px] transition-colors select-none hover:border-border-strong focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
          aria-label={[current.name, shownModelId].filter(Boolean).join(" ")}
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setOpen(true);
              // Move focus into the list so the container-level Arrow handlers
              // take over; without this the trigger keeps focus and the listbox
              // never receives the navigation keys (a11y keyboard trap test).
              requestAnimationFrame(() => {
                const options =
                  listRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [];
                const target =
                  event.key === "ArrowDown" ? options[0] : options[Math.max(0, options.length - 1)];
                target?.focus();
              });
            }
          }}
        >
          {otherProviders.length > 0 && <span className="font-medium">{current.name}</span>}
          <span className="model-switcher-model min-w-0 truncate text-muted">{shownModelId}</span>
          <ChevronDown
            size={12}
            className={cn(
              "model-switcher-chevron shrink-0 text-muted transition-transform",
              open && "rotate-180",
            )}
          />
        </button>
      </Tip>
      {open && (
        <div
          ref={listRef}
          className="model-switcher-dropdown absolute top-9 right-0 z-40 max-h-[320px] w-64 overflow-y-auto rounded-xl border border-border bg-surface-elevated py-1 shadow-popover"
          role="listbox"
          aria-label={t("chat.switchModel")}
          onKeyDown={handleListKeyDown}
        >
          <div className="model-switcher-group-label px-3 pt-1.5 pb-1 text-[10.5px] font-semibold tracking-wide text-muted uppercase">
            {t("chat.modelPickerModels")}
          </div>
          {knownModels.map((modelId) => {
            const selected = modelId === shownModelId;
            return (
              <button
                key={modelId}
                type="button"
                role="option"
                aria-selected={selected}
                className={cn(
                  "model-switcher-item model-switcher-item-row flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors select-none hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:outline-none",
                  selected && "active text-primary",
                )}
                onClick={() => {
                  setOpen(false);
                  if (!selected) onSwitchModel(current, modelId);
                }}
              >
                <span className="model-switcher-item-name min-w-0 flex-1 truncate">{modelId}</span>
                {selected && <Check size={13} aria-hidden="true" className="shrink-0" />}
              </button>
            );
          })}
          <div className="model-switcher-custom m-1.5 mt-1 flex items-center gap-1.5 border-t border-border pt-2">
            <Input
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
              className="h-7 flex-1 text-[11.5px]"
            />
            <Tip content={t("chat.modelPickerUse")}>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={!customModel.trim()}
                onClick={commitCustomModel}
                aria-label={t("chat.modelPickerUse")}
              >
                {t("chat.modelPickerUse")}
              </Button>
            </Tip>
          </div>
          {otherProviders.length > 0 && (
            <>
              <div className="model-switcher-group-label px-3 pt-1.5 pb-1 text-[10.5px] font-semibold tracking-wide text-muted uppercase">
                {t("chat.modelPickerOtherProviders")}
              </div>
              {otherProviders.map((provider) => (
                <button
                  key={provider.id}
                  type="button"
                  role="option"
                  aria-selected={false}
                  className="model-switcher-item flex w-full cursor-pointer flex-col gap-px px-3 py-1.5 text-left transition-colors select-none hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:outline-none"
                  onClick={() => {
                    onSwitch(provider);
                    setOpen(false);
                  }}
                >
                  <span className="model-switcher-item-name text-[12px] font-medium">
                    {provider.name}
                  </span>
                  <span className="model-switcher-item-detail truncate text-[10.5px] text-muted">
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
