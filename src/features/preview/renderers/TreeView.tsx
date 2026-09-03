import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown, ChevronRight, Copy } from "lucide-react";
import { notify } from "../../../components/feedback";
import { Button } from "../../../components/ui";

export const MAX_TREE_CHILDREN = 500;

function copyValue(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2) ?? String(value);
}

/** Keys are strings or numeric indexes; render without Object coercion. */
function renderKey(name: string | number): string {
  return typeof name === "number" ? String(name) : name;
}

function TypeBadge({ kind }: { kind: string }) {
  return <span className={`json-tree-badge json-tree-badge-${kind}`}>{kind}</span>;
}

interface TreeNodeProps {
  name: string | number | null;
  value: unknown;
  depth: number;
}

function TreeNode({ name, value, depth }: TreeNodeProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(depth < 2);
  const isArray = Array.isArray(value);
  const isObject = !isArray && typeof value === "object" && value !== null;

  if (!isArray && !isObject) {
    const kind = value === null ? "null" : typeof value;
    const display =
      typeof value === "string"
        ? `"${value}"`
        : typeof value === "number" || typeof value === "boolean" || value === null
          ? String(value)
          : "";
    return (
      <div className="json-tree-leaf">
        {name !== null && <span className="json-tree-key">{renderKey(name)}:</span>}
        <span className={`json-tree-value json-tree-value-${kind}`}>{display}</span>
        <TreeCopyButton value={copyValue(value)} label={t("preview.copyValue")} />
      </div>
    );
  }

  const entries: [string | number, unknown][] = isArray
    ? (value as unknown[]).slice(0, MAX_TREE_CHILDREN).map((item, index) => [index, item])
    : Object.entries(value as Record<string, unknown>).slice(0, MAX_TREE_CHILDREN);
  const totalCount = isArray ? (value as unknown[]).length : Object.keys(value).length;
  const label = name !== null ? renderKey(name) : isArray ? `[] ${totalCount}` : `{} ${totalCount}`;

  return (
    <div className="json-tree-branch">
      <button
        type="button"
        className="json-tree-toggle"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="json-tree-key">{label}</span>
        <TypeBadge kind={isArray ? "array" : "object"} />
        {!open && (
          <span className="json-tree-summary">
            {totalCount > MAX_TREE_CHILDREN ? `${MAX_TREE_CHILDREN}+` : totalCount}
          </span>
        )}
      </button>
      {open && (
        <div className="json-tree-children">
          {entries.map(([key, child]) => (
            <TreeNode key={renderKey(key)} name={key} value={child} depth={depth + 1} />
          ))}
          {totalCount > MAX_TREE_CHILDREN && (
            <div className="json-tree-truncated">
              {t("preview.childrenTruncated", { shown: MAX_TREE_CHILDREN, total: totalCount })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Copy affordance with transient check morph + toast for quiet confirmation. */
function TreeCopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      className="json-tree-copy text-muted hover:text-foreground"
      aria-label={label}
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
          notify.success(label);
        });
      }}
    >
      {copied ? <Check size={11} /> : <Copy size={11} />}
    </Button>
  );
}

export { TreeNode };
