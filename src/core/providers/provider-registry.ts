import type { ProtocolAdapter } from "./stream-events";
import type { ProtocolAdapterId, ProviderPreset, ProviderRegion } from "./types";

export interface ProviderRegistry {
  listPresets(): readonly ProviderPreset[];
  getPreset(id: string): ProviderPreset | undefined;
  listByRegion(region: ProviderRegion): readonly ProviderPreset[];
  getProtocolAdapters(protocolId: ProtocolAdapterId): ProtocolAdapter[];
}
