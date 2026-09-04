import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type EdgeTypes,
  type Node,
  type NodeChange,
  type NodeTypes,
} from "@xyflow/react";
import { Download, LoaderCircle, Maximize2 } from "lucide-react";
import "@xyflow/react/dist/style.css";
import "../../styles/features/canvas/canvas.css";
import { Button, Tip } from "../../components/ui";
import { downloadBlob } from "../chat/conversation-export";
import { desktopStorage } from "../../runtime/desktop-storage-adapter";
import { resolveWorkspacePath } from "../workspace/workspace-services";
import { useActiveWorkspaceRoot } from "../workspace/workspace-bridge";
import { logger } from "../../core/logging/logger";
import {
  parseCanvasDocument,
  serializeCanvasDocument,
  userEditCanvasDocument,
  type CanvasNodeStatus,
  type CanvasNodeType,
  type EvirCanvasDocument,
} from "./canvas-document";
import { CanvasNodeCard, CANVAS_EDGE } from "./canvas-node-card";

/**
 * Canvas view (§75) — renders and edits a `.evir-canvas` document with React
 * Flow. This module is ONLY loaded through PreviewTab's lazy import so
 * @xyflow/react (and its CSS) stay out of the initial bundle (§83).
 *
 * User edits (drag, connect, delete) autosave back to the document file with
 * `updatedBy: "user"`; agent tools rewrite the file through update_canvas,
 * whose merge keeps positions not explicitly moved.
 */

type DocumentNodeData = {
  title: string;
  detail?: string | undefined;
  status?: CanvasNodeStatus | undefined;
  docType: CanvasNodeType;
};

const nodeTypes: NodeTypes = {
  note: CanvasNodeCard,
  task: CanvasNodeCard,
  resource: CanvasNodeCard,
  decision: CanvasNodeCard,
};
const edgeTypes: EdgeTypes = { canvas: CANVAS_EDGE };

function toFlowNodes(document: EvirCanvasDocument): Node<DocumentNodeData>[] {
  return document.nodes.map((node) => ({
    id: node.id,
    type: node.type,
    position: { x: node.position.x, y: node.position.y },
    data: {
      title: node.title,
      ...(node.detail !== undefined ? { detail: node.detail } : {}),
      ...(node.status !== undefined ? { status: node.status } : {}),
      docType: node.type,
    },
  }));
}

function toFlowEdges(document: EvirCanvasDocument): Edge[] {
  return document.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: "canvas",
    ...(edge.label !== undefined ? { label: edge.label } : {}),
  }));
}

function flowToDocument(
  source: EvirCanvasDocument,
  nodes: readonly Node<DocumentNodeData>[],
  edges: readonly Edge[],
): EvirCanvasDocument {
  return userEditCanvasDocument(source, (draft) => {
    draft.nodes = nodes.map((node) => ({
      id: node.id,
      type: node.data.docType,
      title: node.data.title,
      ...(node.data.detail !== undefined ? { detail: node.data.detail } : {}),
      ...(node.data.status !== undefined ? { status: node.data.status } : {}),
      position: { x: node.position.x, y: node.position.y },
    }));
    draft.edges = edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      ...(edge.label !== undefined ? { label: edge.label } : {}),
    }));
  });
}

type SaveState = "idle" | "saving" | "saved" | "error";

function CanvasViewInner({ path }: { path: string; title?: string | undefined }) {
  const { t } = useTranslation();
  const root = useActiveWorkspaceRoot();
  const { fitView } = useReactFlow();
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [document, setDocument] = useState<EvirCanvasDocument | null>(null);
  const [nodes, setNodes] = useState<Node<DocumentNodeData>[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const documentRef = useRef<EvirCanvasDocument | null>(null);
  const saveTimer = useRef<number | null>(null);
  const nodesRef = useRef<Node<DocumentNodeData>[]>([]);
  const edgesRef = useRef<Edge[]>([]);
  const resolvedPath = useMemo(() => resolveWorkspacePath(path, root) ?? path, [path, root]);

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);
  useEffect(() => {
    edgesRef.current = edges;
  }, [edges]);

  useEffect(() => {
    let cancelled = false;
    setLoadState("loading");
    void desktopStorage
      .readFile(resolvedPath)
      .then((raw) => {
        if (cancelled) return;
        const parsed = parseCanvasDocument(raw);
        documentRef.current = parsed;
        setDocument(parsed);
        setNodes(toFlowNodes(parsed));
        setEdges(toFlowEdges(parsed));
        setLoadState("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : String(error));
        setLoadState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [resolvedPath]);

  const persist = useCallback(() => {
    const source = documentRef.current;
    if (!source) return;
    const next = flowToDocument(source, nodesRef.current, edgesRef.current);
    documentRef.current = next;
    setDocument(next);
    setSaveState("saving");
    desktopStorage
      .writeFile(resolvedPath, serializeCanvasDocument(next))
      .then(() => setSaveState("saved"))
      .catch(() => setSaveState("error"));
  }, [resolvedPath]);

  /** Debounced autosave: bursts of drags/deletes produce one write. */
  const schedulePersist = useCallback(() => {
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null;
      persist();
    }, 500);
  }, [persist]);

  useEffect(
    () => () => {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    },
    [],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<DocumentNodeData>[]) => {
      setNodes((current) => applyNodeChanges(changes, current));
      const structural = changes.some((change) => change.type === "remove");
      const dragStop = changes.some((change) => change.type === "position" && !change.dragging);
      if (structural || dragStop) {
        // Defer one tick so the refs reflect the committed state.
        window.setTimeout(() => schedulePersist(), 0);
      }
    },
    [schedulePersist],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      setEdges((current) => applyEdgeChanges(changes, current));
      if (changes.some((change) => change.type === "remove")) {
        window.setTimeout(() => schedulePersist(), 0);
      }
    },
    [schedulePersist],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((current) =>
        addEdge(
          {
            ...connection,
            type: "canvas",
            id: `e-${connection.source}-${connection.target}-${Date.now().toString(36)}`,
          },
          current,
        ),
      );
      window.setTimeout(() => schedulePersist(), 0);
    },
    [schedulePersist],
  );

  const exportJson = useCallback(() => {
    if (!documentRef.current) return;
    const name = resolvedPath.split("/").pop() ?? "canvas.evir-canvas";
    void downloadBlob(
      new Blob([serializeCanvasDocument(documentRef.current)], { type: "application/json" }),
      name,
    );
    logger.info("workspace", "canvas.export", { path: resolvedPath });
  }, [resolvedPath]);

  if (loadState === "loading") {
    return (
      <div className="canvas-view canvas-view-loading">
        <LoaderCircle size={18} className="spin" aria-hidden="true" />
        <p>{t("canvas.loading")}</p>
      </div>
    );
  }
  if (loadState === "error" || document === null) {
    return (
      <div className="canvas-view canvas-view-error">
        <p>{t("canvas.loadFailed")}</p>
        {loadError && <small>{loadError}</small>}
      </div>
    );
  }

  return (
    <div
      className="canvas-view"
      role="region"
      aria-label={t("canvas.region", { title: document.title })}
    >
      <header className="canvas-toolbar">
        <div className="canvas-toolbar-copy min-w-0">
          <strong className="block truncate text-[12.5px] font-semibold">{document.title}</strong>
          <span className="block text-[11px] text-muted">
            {t("canvas.summary", {
              nodes: document.nodes.length,
              edges: document.edges.length,
            })}
            {saveState === "saving" ? ` · ${t("canvas.saving")}` : ""}
            {saveState === "saved" ? ` · ${t("canvas.saved")}` : ""}
            {saveState === "error" ? ` · ${t("canvas.saveFailed")}` : ""}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Tip content={t("canvas.fit")} side="bottom">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("canvas.fit")}
              onClick={() => void fitView({ padding: 0.15, duration: 200 })}
            >
              <Maximize2 size={14} aria-hidden="true" />
            </Button>
          </Tip>
          <Tip content={t("canvas.export")} side="bottom">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("canvas.export")}
              onClick={exportJson}
            >
              <Download size={14} aria-hidden="true" />
            </Button>
          </Tip>
        </div>
      </header>
      <div className="canvas-flow-root">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          deleteKeyCode={["Backspace", "Delete"]}
          minZoom={0.2}
          maxZoom={2}
          fitView
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1.5} />
        </ReactFlow>
      </div>
    </div>
  );
}

export default function CanvasView(props: { path: string; title?: string | undefined }) {
  return (
    <ReactFlowProvider>
      <CanvasViewInner {...props} />
    </ReactFlowProvider>
  );
}
