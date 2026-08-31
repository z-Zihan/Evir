import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

export const CSV_RENDER_ROW_LIMIT = 500;
export const MAX_CSV_BYTES = 20_000_000;

interface CsvTablePreviewProps {
  source: string;
  delimiter: "," | "\t";
}

interface ParseOutcome {
  headers: string[];
  rows: string[][];
  truncated: boolean;
  totalRows: number;
  error?: string;
}

type PapaModule = typeof import("papaparse");

/** papaparse's UMD default carries internal state; keep the object intact. */
type PapaHandle = { parse: PapaModule["parse"] };

async function loadPapa(): Promise<PapaHandle> {
  const mod = (await import("papaparse")) as unknown as PapaHandle & { default?: PapaHandle };
  return mod.default ?? mod;
}

let papaPromise: Promise<PapaHandle> | null = null;
function getPapa(): Promise<PapaHandle> {
  papaPromise ??= loadPapa();
  return papaPromise;
}

function parseCsv(source: string, delimiter: string): ParseOutcome {
  // Quoted commas/newlines are handled by papaparse below; this is the
  // synchronous preview used before the parser chunk loads (plain rows only).
  const lines = source.split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length === 0) return { headers: [], rows: [], truncated: false, totalRows: 0 };
  const split = (line: string) => line.split(delimiter).map((cell) => cell.trim());
  const headers = split(lines[0] ?? "");
  const all = lines.slice(1).map(split);
  return {
    headers,
    rows: all.slice(0, CSV_RENDER_ROW_LIMIT),
    truncated: all.length > CSV_RENDER_ROW_LIMIT,
    totalRows: all.length,
  };
}

/**
 * CSV/TSV table preview with horizontal scrolling, header row, and a hard
 * render cap: datasets beyond CSV_RENDER_ROW_LIMIT rows render the first page
 * only — never hundreds of thousands of DOM rows.
 */
export function CsvTablePreview({ source, delimiter }: CsvTablePreviewProps) {
  const { t } = useTranslation();
  const [papa, setPapa] = useState<PapaHandle | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getPapa()
      .then((mod) => {
        if (!cancelled) setPapa(mod);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const outcome = useMemo<ParseOutcome>(() => {
    if (source.length > MAX_CSV_BYTES)
      return { headers: [], rows: [], truncated: false, totalRows: 0, error: "too-large" };
    if (papa === null) return parseCsv(source, delimiter);
    const result = papa.parse(source.trimEnd(), {
      delimiter,
      skipEmptyLines: true,
    });
    const data = (result.data ?? []).map((row: unknown) =>
      Array.isArray(row) ? row.map((cell) => String(cell)) : [String(row)],
    );
    if (result.errors.length > 0 && data.length === 0) {
      return {
        headers: [],
        rows: [],
        truncated: false,
        totalRows: 0,
        error: result.errors[0]?.message ?? "parse error",
      };
    }
    const [headerRow = [], ...dataRows] = data;
    return {
      headers: headerRow.map((cell, index) =>
        cell.length > 0 ? cell : `${t("preview.csvColumn", { index: index + 1 })}`,
      ),
      rows: dataRows.slice(0, CSV_RENDER_ROW_LIMIT),
      truncated: dataRows.length > CSV_RENDER_ROW_LIMIT,
      totalRows: dataRows.length,
    };
  }, [source, delimiter, papa, t]);

  if (outcome.error === "too-large") {
    return <p className="preview-fallback-text">{t("preview.tooLarge")}</p>;
  }
  if (loadError) {
    return <p className="preview-fallback-text">{t("preview.parserUnavailable")}</p>;
  }
  if (outcome.error !== undefined) {
    return (
      <div className="csv-table-error">
        <p className="preview-parse-error">{t("preview.malformedCsv")}</p>
        <p className="csv-table-error-detail">{outcome.error.slice(0, 200)}</p>
      </div>
    );
  }
  if (outcome.headers.length === 0 && outcome.rows.length === 0) {
    return <p className="preview-fallback-text">{t("preview.emptyContent")}</p>;
  }

  return (
    <div className="csv-table-wrap" role="region" aria-label={t("preview.csvTable")} tabIndex={0}>
      <table className="csv-table">
        <thead>
          <tr>
            <th className="csv-table-rownum" aria-hidden="true">
              #
            </th>
            {outcome.headers.map((header, index) => (
              <th key={index}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {outcome.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              <td className="csv-table-rownum">{rowIndex + 1}</td>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {outcome.truncated && (
        <p className="csv-table-truncated">
          {t("preview.rowsTruncated", { shown: CSV_RENDER_ROW_LIMIT, total: outcome.totalRows })}
        </p>
      )}
    </div>
  );
}
