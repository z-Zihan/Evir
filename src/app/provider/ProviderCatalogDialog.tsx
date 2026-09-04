import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronRight, Search, SlidersHorizontal } from "lucide-react";
import { Input } from "../../components/ui";
import type { ProviderPreset } from "../../core/providers/types";
import { SettingsFormDialog } from "../SettingsFormDialog";
import { providerInitial } from "./form-model";

interface ProviderCatalogDialogProps {
  presets: ProviderPreset[];
  selectedPresetId: string | null;
  onChoose: (preset: ProviderPreset | null) => void;
  onClose: () => void;
}

const REGIONS = ["all", "international", "china", "local"] as const;

/**
 * Preset catalog (step 1 of provider setup): region filter + search + tile
 * grid. Filter state is local — it resets naturally when the dialog unmounts.
 */
export function ProviderCatalogDialog({
  presets,
  selectedPresetId,
  onChoose,
  onClose,
}: ProviderCatalogDialogProps) {
  const { t } = useTranslation();
  const [presetFilter, setPresetFilter] = useState<(typeof REGIONS)[number]>("all");
  const [presetQuery, setPresetQuery] = useState("");

  const filteredPresets = useMemo(
    () =>
      presets.filter((preset) => {
        const query = presetQuery.trim().toLowerCase();
        return (
          (presetFilter === "all" || preset.region === presetFilter) &&
          (!query || preset.name.toLowerCase().includes(query))
        );
      }),
    [presets, presetFilter, presetQuery],
  );

  return (
    <SettingsFormDialog
      title={t("provider.chooseProvider")}
      description={t("provider.presetsDescription")}
      onClose={onClose}
      wide
    >
      <div className="flex items-center justify-between gap-3 px-3.5 pt-3 pb-0.5">
        <div className="flex gap-0.5" role="group" aria-label={t("provider.region")}>
          {REGIONS.map((region) => (
            <button
              type="button"
              key={region}
              className={`min-h-6.5 cursor-pointer rounded-md px-2.5 text-[9.5px] font-medium transition-colors ${
                presetFilter === region
                  ? "bg-surface-hover font-semibold text-foreground"
                  : "text-muted hover:text-foreground"
              }`}
              aria-pressed={presetFilter === region}
              onClick={() => setPresetFilter(region)}
            >
              {t(`provider.regions.${region}`)}
            </button>
          ))}
        </div>
        <label className="flex h-7 w-52 shrink-0 items-center gap-1.5 rounded-md border border-border bg-background px-2 text-muted focus-within:border-border-strong">
          <Search size={13} aria-hidden="true" />
          <Input
            type="search"
            value={presetQuery}
            placeholder={t("provider.searchPresets")}
            aria-label={t("provider.searchPresets")}
            className="h-auto w-full rounded-none border-0 bg-transparent p-0 text-[11.5px] focus-visible:shadow-none"
            onChange={(event) => setPresetQuery(event.target.value)}
          />
        </label>
      </div>
      <div className="grid max-h-69 grid-cols-[repeat(3,minmax(0,1fr))] gap-2 overflow-y-auto p-3 max-lg:grid-cols-[repeat(2,minmax(0,1fr))] max-md:grid-cols-1">
        <button
          className="provider-preset-tile col-span-1 flex min-h-13 min-w-0 cursor-pointer items-center gap-2 rounded-lg border border-border bg-surface px-2 py-1.5 text-left transition-colors hover:border-border-strong hover:bg-surface-hover"
          type="button"
          onClick={() => onChoose(null)}
        >
          <SlidersHorizontal
            size={15}
            className="mx-auto shrink-0 text-primary"
            aria-hidden="true"
          />
          <span className="min-w-0 flex-1">
            <strong className="block truncate text-[11px] font-semibold">
              {t("provider.custom")}
            </strong>
            <small className="mt-0.5 block truncate text-[10px] text-muted">
              {t("provider.customDescription")}
            </small>
          </span>
          <ChevronRight size={13} className="shrink-0 text-muted" aria-hidden="true" />
        </button>
        {filteredPresets.map((preset) => {
          const selected = selectedPresetId === preset.id;
          return (
            <button
              className={`provider-preset-tile flex min-h-13 min-w-0 cursor-pointer items-center gap-2 rounded-lg border px-2 py-1.5 text-left transition-colors ${
                selected
                  ? "border-primary/60 bg-primary/[0.06]"
                  : "border-border bg-surface hover:border-border-strong hover:bg-surface-hover"
              }`}
              type="button"
              key={preset.id}
              onClick={() => onChoose(preset)}
            >
              <span
                className="grid size-7 shrink-0 place-items-center rounded-md bg-surface-hover text-[9.5px] font-bold text-foreground"
                aria-hidden="true"
              >
                {providerInitial(preset.name)}
              </span>
              <span className="min-w-0 flex-1">
                <strong className="flex items-center gap-1 truncate text-[11px] font-semibold">
                  <span className="truncate">{preset.name}</span>
                  {preset.agentTier !== "preset" && (
                    <span
                      className={`provider-tier provider-tier-${preset.agentTier} shrink-0 rounded px-1 text-[8.5px] font-bold uppercase ${
                        preset.agentTier === "agent-verified"
                          ? "bg-success/15 text-success"
                          : "bg-primary/12 text-primary"
                      }`}
                      title={t(`provider.tiers.${preset.agentTier}`)}
                    >
                      {preset.agentTier === "agent-verified" ? "Agent" : "Protocol"}
                    </span>
                  )}
                </strong>
                <small className="mt-0.5 block truncate text-[10px] text-muted">
                  {t(`provider.regions.${preset.region}`)}
                </small>
              </span>
              {selected ? (
                <Check size={13} className="shrink-0 text-primary" aria-hidden="true" />
              ) : (
                <ChevronRight size={13} className="shrink-0 text-muted" aria-hidden="true" />
              )}
            </button>
          );
        })}
      </div>
    </SettingsFormDialog>
  );
}
