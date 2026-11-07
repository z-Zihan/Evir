import { describe, expect, it } from "vitest";
import { isSupportedProtocol } from "../adapter-registry";
import { PROVIDER_OFFICIAL_LINKS } from "../provider-links";
import { PROVIDER_PRESETS } from "../provider-presets";
import type { ProviderOfficialLinks, ProviderPreset } from "../types";

/**
 * Data invariants for the static PROVIDER_PRESETS catalog (36 shipped
 * entries). Generic rules validate every current and future entry; the
 * sorted id lists below intentionally PIN the shipped state of drift-prone
 * facts, so any catalog change fails here by name and gets reviewed instead
 * of silently shipping.
 */

// Read the const tuples through their declared interface — the literal
// unions are narrower than the assertions need.
const PRESETS: readonly ProviderPreset[] = PROVIDER_PRESETS;
const OFFICIAL_LINKS: Readonly<Record<string, ProviderOfficialLinks>> = PROVIDER_OFFICIAL_LINKS;

const REGIONS = new Set(["international", "china", "local", "custom"]);
const ENDPOINT_SITES = new Set(["mainland", "international", "local"]);

function parseableUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function httpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function loopbackHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost")
    );
  } catch {
    return false;
  }
}

const presetIds = () => PRESETS.map((preset) => preset.id);

describe("catalog shape", () => {
  it("ids are unique and non-empty, names non-empty, regions stay in the enum", () => {
    const ids = presetIds();
    expect(new Set(ids).size).toBe(ids.length);
    for (const preset of PRESETS) {
      expect(preset.id.length).toBeGreaterThan(0);
      expect(preset.name.length).toBeGreaterThan(0);
      // Runtime guard: `as const satisfies` cannot stop a hand-written entry
      // from smuggling a region outside the four-value enum.
      expect(REGIONS.has(preset.region), `${preset.id}: region ${preset.region}`).toBe(true);
    }
  });

  it("recommendedProtocol is always one of the preset's own protocols", () => {
    // The type system does not constrain this — easiest invariant to drift.
    for (const preset of PRESETS) {
      expect(
        preset.protocols.some((protocol) => protocol === preset.recommendedProtocol),
        `${preset.id}: recommendedProtocol ${preset.recommendedProtocol} not in protocols`,
      ).toBe(true);
    }
  });

  it("protocols and authModes are non-empty and duplicate-free", () => {
    for (const preset of PRESETS) {
      expect(preset.protocols.length).toBeGreaterThan(0);
      expect(new Set(preset.protocols).size).toBe(preset.protocols.length);
      expect(preset.authModes.length).toBeGreaterThan(0);
      expect(new Set(preset.authModes).size).toBe(preset.authModes.length);
    }
  });

  it("notes are non-empty strings when present", () => {
    for (const preset of PRESETS) {
      if (preset.notes === undefined) continue;
      expect(preset.notes.length).toBeGreaterThan(0);
      for (const note of preset.notes) {
        expect(note.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("endpoints", () => {
  it("endpoint ids are unique per preset; id/label/baseUrl non-empty; baseUrl parses; site in enum", () => {
    for (const preset of PRESETS) {
      const endpointIds = preset.endpoints.map((endpoint) => endpoint.id);
      expect(new Set(endpointIds).size, `${preset.id}: duplicate endpoint ids`).toBe(
        endpointIds.length,
      );
      for (const endpoint of preset.endpoints) {
        expect(endpoint.id.length).toBeGreaterThan(0);
        expect(endpoint.label.length).toBeGreaterThan(0);
        expect(parseableUrl(endpoint.baseUrl), `${preset.id}/${endpoint.id}: baseUrl`).toBe(true);
        if (endpoint.site !== undefined) {
          expect(ENDPOINT_SITES.has(endpoint.site), `${preset.id}/${endpoint.id}: site`).toBe(true);
        }
      }
    }
  });

  it("an endpoint is local exactly when its baseUrl is a plain-http loopback URL", () => {
    // All five shipped local endpoints are http://127.0.0.1:<port> — plain
    // http, never https — and every remote endpoint is https, so the
    // biconditional holds across the whole catalog.
    for (const preset of PRESETS) {
      for (const endpoint of preset.endpoints) {
        expect(
          loopbackHttpUrl(endpoint.baseUrl),
          `${preset.id}/${endpoint.id}: site=${endpoint.site} baseUrl=${endpoint.baseUrl}`,
        ).toBe(endpoint.site === "local");
      }
    }
  });
});

describe("region ↔ endpoint site consistency", () => {
  it("international presets only expose international endpoints", () => {
    for (const preset of PRESETS.filter((p) => p.region === "international")) {
      for (const endpoint of preset.endpoints) {
        expect(endpoint.site, `${preset.id}/${endpoint.id}`).toBe("international");
      }
    }
  });

  it("china presets never expose local endpoints and always ship a mainland one", () => {
    // NOT "all endpoints mainland": moonshot-kimi and minimax legitimately
    // add international endpoints next to their mainland one. The real
    // invariant is sites ⊆ {mainland, international} plus at least one
    // mainland endpoint per china preset.
    for (const preset of PRESETS.filter((p) => p.region === "china")) {
      for (const endpoint of preset.endpoints) {
        expect(["mainland", "international"], `${preset.id}/${endpoint.id}: site`).toContain(
          endpoint.site,
        );
      }
      expect(
        preset.endpoints.some((endpoint) => endpoint.site === "mainland"),
        `${preset.id}: no mainland endpoint`,
      ).toBe(true);
    }
  });

  it("local presets only expose local endpoints", () => {
    for (const preset of PRESETS.filter((p) => p.region === "local")) {
      for (const endpoint of preset.endpoints) {
        expect(endpoint.site, `${preset.id}/${endpoint.id}`).toBe("local");
      }
    }
  });

  it("custom presets ship no endpoints", () => {
    for (const preset of PRESETS.filter((p) => p.region === "custom")) {
      expect(preset.endpoints).toEqual([]);
    }
  });
});

describe("official links", () => {
  const linkKeys = new Set(Object.keys(OFFICIAL_LINKS));

  it("every non-custom preset has links keyed by its id; custom presets have none", () => {
    for (const preset of PRESETS) {
      if (preset.region === "custom") {
        expect(linkKeys.has(preset.id), `${preset.id}: custom preset has links`).toBe(false);
        expect(preset.officialLinks).toBeUndefined();
      } else {
        // A typo'd or missing key silently resolves to undefined at runtime.
        expect(linkKeys.has(preset.id), `${preset.id}: missing PROVIDER_OFFICIAL_LINKS entry`).toBe(
          true,
        );
        expect(preset.officialLinks, `${preset.id}: preset.officialLinks`).toBeDefined();
      }
    }
  });

  it("website is always a valid https URL; console/docs/status are https when present", () => {
    for (const [id, links] of Object.entries(OFFICIAL_LINKS)) {
      expect(httpsUrl(links.website), `${id}: website`).toBe(true);
      for (const key of ["console", "docs", "status"] as const) {
        const value = links[key];
        if (value !== undefined) {
          expect(httpsUrl(value), `${id}: ${key}`).toBe(true);
        }
      }
    }
  });

  it("no dead keys: every links key resolves to a preset id", () => {
    const ids = new Set(presetIds());
    for (const key of linkKeys) {
      expect(ids.has(key), `PROVIDER_OFFICIAL_LINKS["${key}"] matches no preset`).toBe(true);
    }
  });
});

describe("protocol adapter cross-links", () => {
  it("every protocol-verified preset has at least one protocol with a real adapter", () => {
    for (const preset of PRESETS) {
      if (preset.agentTier !== "protocol-verified") continue;
      expect(
        preset.protocols.some((protocol) => isSupportedProtocol(protocol)),
        `${preset.id}: protocol-verified but no protocol has an adapter`,
      ).toBe(true);
    }
  });

  it("pins the presets whose RECOMMENDED protocol has no adapter", () => {
    // Twelve shipped presets recommend a protocol outside SUPPORTED_PROTOCOLS,
    // across three families: vendor-native protocols without adapters yet
    // (azure-openai-responses, gemini-interactions, mistral-native,
    // aws-bedrock-converse, vertex-gemini, cohere-chat-v2), the
    // openai-compatible-responses dialect (alibaba-model-studio,
    // baidu-qianfan, volcengine-ark, lm-studio) and
    // anthropic-compatible-messages (minimax, custom-anthropic). All of
    // these except the four template-only presets below fall back to another
    // supported protocol in their own list at runtime.
    const unsupportedRecommendation = PRESETS.filter(
      (preset) => !isSupportedProtocol(preset.recommendedProtocol),
    )
      .map((preset) => preset.id)
      .sort();
    expect(unsupportedRecommendation).toEqual(
      [
        "alibaba-model-studio",
        "aws-bedrock",
        "azure-openai",
        "baidu-qianfan",
        "cohere",
        "custom-anthropic",
        "google-gemini",
        "google-vertex-ai",
        "lm-studio",
        "minimax",
        "mistral",
        "volcengine-ark",
      ].sort(),
    );

    // Of those, exactly the two protocol-verified presets recommend a
    // protocol with no adapter — every other protocol-verified preset
    // recommends one it can actually run.
    const protocolVerifiedWithUnsupportedRecommendation = PRESETS.filter(
      (preset) =>
        preset.agentTier === "protocol-verified" &&
        !isSupportedProtocol(preset.recommendedProtocol),
    )
      .map((preset) => preset.id)
      .sort();
    expect(protocolVerifiedWithUnsupportedRecommendation).toEqual(
      ["azure-openai", "google-gemini"].sort(),
    );
  });

  it("pins the presets with NO supported protocol at all (pure templates)", () => {
    const templateOnly = PRESETS.filter(
      (preset) => !preset.protocols.some((protocol) => isSupportedProtocol(protocol)),
    )
      .map((preset) => preset.id)
      .sort();
    expect(templateOnly).toEqual(
      ["aws-bedrock", "cohere", "custom-anthropic", "google-vertex-ai"].sort(),
    );
    // No adapter at all ⇒ the tier can never claim protocol verification.
    for (const preset of PRESETS) {
      if (templateOnly.includes(preset.id)) {
        expect(preset.agentTier, `${preset.id}: template tier`).not.toBe("protocol-verified");
      }
    }
  });
});

describe("none-local auth mode", () => {
  it("none-local only appears on local or custom presets", () => {
    for (const preset of PRESETS) {
      if (!preset.authModes.some((mode) => mode === "none-local")) continue;
      expect(["local", "custom"], `${preset.id}: region ${preset.region}`).toContain(preset.region);
    }
  });

  it("every local preset offers none-local auth", () => {
    for (const preset of PRESETS.filter((p) => p.region === "local")) {
      expect(
        preset.authModes.some((mode) => mode === "none-local"),
        `${preset.id}: missing none-local`,
      ).toBe(true);
    }
  });
});
