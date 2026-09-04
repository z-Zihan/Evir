import { useEffect, useRef, useState } from "react";
import { loadShikiLanguage, resolveShikiLanguage } from "./shiki-languages";

/**
 * Shiki singleton holder. The highlighter is created once with both themes and
 * an empty language set; grammars lazy-load per language from the curated
 * registry (shiki-languages.ts) so neither the initial bundle nor the shipped
 * chunk set carries the full ~200-grammar web bundle. Same oniguruma engine
 * as before — tokenization is unchanged. Unknown languages fall back to text.
 */
type ShikiHighlighter = Awaited<ReturnType<(typeof import("shiki/core"))["createHighlighterCore"]>>;

let highlighterPromise: Promise<ShikiHighlighter> | null = null;
const loadedLanguages = new Set<string>();
const highlightCache = new Map<string, string>();
const CACHE_LIMIT = 40;

export const LIGHT_THEME = "github-light";
export const DARK_THEME = "github-dark";

export const PLAIN_LANGUAGES = new Set(["txt", "text", "plaintext", "plain", "log", ""]);

function getHighlighter(): Promise<ShikiHighlighter> {
  highlighterPromise ??= Promise.all([
    import("shiki/core"),
    import("shiki/engine/oniguruma"),
    import("shiki/wasm"),
    import("shiki/themes/github-light.mjs"),
    import("shiki/themes/github-dark.mjs"),
  ]).then(
    ([{ createHighlighterCore }, { createOnigurumaEngine }, { default: wasm }, light, dark]) =>
      createHighlighterCore({
        engine: createOnigurumaEngine(() => Promise.resolve(wasm)),
        themes: [light.default, dark.default],
        langs: [],
      }),
  );
  return highlighterPromise;
}

async function ensureLanguage(highlighter: ShikiHighlighter, language: string): Promise<string> {
  if (PLAIN_LANGUAGES.has(language) || language === "ansi") return "text";
  const resolved = resolveShikiLanguage(language);
  if (!resolved) return "text";
  if (loadedLanguages.has(resolved)) return resolved;
  const grammar = await loadShikiLanguage(resolved);
  await highlighter.loadLanguage(grammar.default);
  loadedLanguages.add(resolved);
  return resolved;
}

interface HighlightRequest {
  code: string;
  language: string;
}

async function highlight({ code, language }: HighlightRequest): Promise<string> {
  const cacheKey = `${language}\u0000${code}`;
  const cached = highlightCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const highlighter = await getHighlighter();
  const lang = await ensureLanguage(highlighter, language);
  if (lang === "text") {
    const html = highlighter.codeToHtml(code, {
      lang: "text",
      themes: { light: LIGHT_THEME, dark: DARK_THEME },
      defaultColor: false,
    });
    cachePut(cacheKey, html);
    return html;
  }
  const html = highlighter.codeToHtml(code, {
    lang,
    themes: { light: LIGHT_THEME, dark: DARK_THEME },
    defaultColor: false,
  });
  cachePut(cacheKey, html);
  return html;
}

function cachePut(key: string, html: string): void {
  if (highlightCache.size >= CACHE_LIMIT) {
    const oldest = highlightCache.keys().next();
    if (!oldest.done) highlightCache.delete(oldest.value);
  }
  highlightCache.set(key, html);
}

/** Skip syntax highlighting entirely beyond this size (streaming safety). */
export const MAX_HIGHLIGHT_BYTES = 240_000;

export function isHighlightable(code: string): boolean {
  return code.length <= MAX_HIGHLIGHT_BYTES;
}

interface UseShikiResult {
  html: string | null;
  error: boolean;
}

/**
 * Highlights code with Shiki. While `streaming` is true, intermediate frames
 * are skipped and only the latest content is highlighted after a short quiet
 * period, so token deltas do not re-run tokenization for every chunk.
 */
export function useShikiHighlight(
  code: string,
  language: string,
  streaming: boolean,
): UseShikiResult {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const latestCode = useRef(code);
  latestCode.current = code;

  useEffect(() => {
    if (!isHighlightable(code)) {
      setHtml(null);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = () => {
      highlight({ code: latestCode.current, language })
        .then((result) => {
          if (!cancelled) {
            setHtml(result);
            setError(false);
          }
        })
        .catch(() => {
          if (!cancelled) setError(true);
        });
    };
    if (streaming) {
      // Debounce: wait for a quiet window, but refresh at least every 450ms
      // so long generations keep updating.
      let elapsed = 0;
      const tick = () => {
        if (cancelled) return;
        elapsed += 150;
        if (latestCode.current !== code || elapsed >= 450) run();
        else timer = setTimeout(tick, 150);
      };
      timer = setTimeout(tick, 150);
    } else {
      run();
    }
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [code, language, streaming]);

  return { html, error };
}
