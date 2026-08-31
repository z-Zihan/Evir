import { useMemo } from "react";
import { useTranslation } from "react-i18next";

export const MAX_DIFF_LINES = 5000;

interface DiffPreviewProps {
  source: string;
}

interface DiffRow {
  kind: "context" | "add" | "remove" | "hunk" | "meta";
  text: string;
  oldLine?: number;
  newLine?: number;
}

function parseUnifiedDiff(source: string): DiffRow[] {
  const rows: DiffRow[] = [];
  let oldLine = 0;
  let newLine = 0;
  const lines = source.split(/\r?\n/);
  for (const line of lines.slice(0, MAX_DIFF_LINES)) {
    if (line.startsWith("@@")) {
      const match = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      if (match) {
        oldLine = Number(match[1]);
        newLine = Number(match[2]);
      }
      rows.push({ kind: "hunk", text: line });
    } else if (
      line.startsWith("diff --git") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ") ||
      line.startsWith("Index: ") ||
      line.startsWith("====")
    ) {
      rows.push({ kind: "meta", text: line });
    } else if (line.startsWith("+")) {
      rows.push({ kind: "add", text: line.slice(1), newLine: newLine++ });
    } else if (line.startsWith("-")) {
      rows.push({ kind: "remove", text: line.slice(1), oldLine: oldLine++ });
    } else {
      const text = line.startsWith(" ") ? line.slice(1) : line;
      if (line.length === 0 && rows.length === 0) continue;
      rows.push({ kind: "context", text, oldLine: oldLine++, newLine: newLine++ });
    }
  }
  return rows;
}

/** Unified-diff artifact preview, consistent with Evir's diff color language. */
export function DiffPreview({ source }: DiffPreviewProps) {
  const { t } = useTranslation();
  const rows = useMemo(() => parseUnifiedDiff(source), [source]);
  const truncated = source.split(/\r?\n/).length > MAX_DIFF_LINES;

  return (
    <div className="diff-preview" role="region" aria-label={t("preview.diffView")} tabIndex={0}>
      <table className="diff-table">
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className={`diff-row diff-row-${row.kind}`}>
              <td className="diff-lineno">{row.oldLine ?? ""}</td>
              <td className="diff-lineno">{row.newLine ?? ""}</td>
              <td className="diff-marker" aria-hidden="true">
                {row.kind === "add" ? "+" : row.kind === "remove" ? "−" : ""}
              </td>
              <td className="diff-text">
                <pre>{row.text}</pre>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {truncated && (
        <p className="diff-truncated">{t("preview.linesTruncated", { limit: MAX_DIFF_LINES })}</p>
      )}
    </div>
  );
}
