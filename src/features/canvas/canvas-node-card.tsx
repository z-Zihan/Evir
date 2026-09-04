import { memo } from "react";
import { useTranslation } from "react-i18next";
import { BezierEdge, type EdgeProps, type NodeProps, type Node } from "@xyflow/react";
import { CircleCheck, CircleDashed, LoaderCircle } from "lucide-react";
import type { CanvasNodeStatus, CanvasNodeType } from "./canvas-document";

/**
 * Canvas node card (§74: simple node types) — one card component registered
 * for all four document node types; the type drives the accent + label chip,
 * the task status drives the status icon. Loaded only inside the canvas chunk.
 */

export interface DocumentNodeData extends Record<string, unknown> {
  title: string;
  detail?: string | undefined;
  status?: CanvasNodeStatus | undefined;
  docType: CanvasNodeType;
}

export type DocumentNode = Node<DocumentNodeData>;

const STATUS_ICON: Record<CanvasNodeStatus, typeof CircleDashed> = {
  todo: CircleDashed,
  doing: LoaderCircle,
  done: CircleCheck,
};

function StatusIcon({ status }: { status: CanvasNodeStatus }) {
  const Icon = STATUS_ICON[status];
  if (status === "doing") {
    return <Icon size={12} className="spin" aria-hidden="true" />;
  }
  return <Icon size={12} aria-hidden="true" />;
}

export const CanvasNodeCard = memo(function CanvasNodeCard({ data }: NodeProps<DocumentNode>) {
  const { t } = useTranslation();
  const status = data.status;
  return (
    <div className={`canvas-card canvas-card-${data.docType}`} data-canvas-type={data.docType}>
      <header className="canvas-card-header">
        <span className="canvas-card-type">{t(`canvas.nodeType.${data.docType}`)}</span>
        {status && (
          <span className={`canvas-card-status canvas-card-status-${status}`}>
            <StatusIcon status={status} />
            <span className="sr-only">{t(`canvas.nodeStatus.${status}`)}</span>
          </span>
        )}
      </header>
      <strong className="canvas-card-title">{data.title}</strong>
      {data.detail && <p className="canvas-card-detail">{data.detail}</p>}
    </div>
  );
});

export const CANVAS_EDGE = memo(function CanvasEdge(props: EdgeProps) {
  return <BezierEdge {...props} style={{ stroke: "var(--color-border-strong)" }} />;
});
