import { useEffect, useMemo, useState } from "react";
import {
  detectDevScript,
  devServerList,
  devServerStart,
  devServerStop,
  subscribeDevServerStatus,
  type DevScriptPlan,
  type DevServerState,
} from "../../features/workspace/dev-server-service";
import { useWorkspacePanelStore } from "../../features/workspace/workspace-panel-store";
import {
  panelTabList,
  panelTabNavigate,
  panelTabNew,
} from "../../features/workspace/browser-panel-service";
import { useActiveWorkspaceRoot } from "../../features/workspace/workspace-bridge";
import { useProjectStore } from "../../features/projects/project-store";
import { logger } from "../../core/logging/logger";

/**
 * Shared UI controller for the project's dev server (Preview App). One store
 * instance backs BOTH the Preview tab entry and the Browser tab status row,
 * so starting from either surface keeps the other in sync, and the
 * Starting → Ready journey works even while the Browser tab is unmounted.
 */

export interface DevServerUiController {
  plan: DevScriptPlan | null;
  server: DevServerState | null;
  starting: boolean;
  /** Ready/starting/running — a live preview is (becoming) available. */
  active: boolean;
  /** Human-readable failure reason (invoke error or crash tail). */
  failure: string | null;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

export function useDevServerUi(): DevServerUiController {
  const root = useActiveWorkspaceRoot();
  const projects = useProjectStore((state) => state.projects);
  const currentProjectId = useProjectStore((state) => state.currentProjectId);
  const project = projects.find(({ id }) => id === currentProjectId);
  const [plan, setPlan] = useState<DevScriptPlan | null>(null);
  const [server, setServer] = useState<DevServerState | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setServer(null);
    setError(null);
    setStarting(false);
  }, [project?.id]);

  // Detection: which script would run for this project (cached per root).
  useEffect(() => {
    if (!root) {
      setPlan(null);
      return;
    }
    let cancelled = false;
    void detectDevScript(root).then((detected) => {
      if (!cancelled) setPlan(detected);
    });
    return () => {
      cancelled = true;
    };
  }, [root]);

  // Events are the primary channel; polling re-syncs a missed push so
  // "starting" can never wedge forever.
  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    const unsubscribe = subscribeDevServerStatus((state) => {
      if (state.projectId === project.id) setServer(state);
    }).catch(() => undefined);
    const sync = () => {
      void devServerList()
        .then((servers) => {
          if (cancelled) return;
          const match = servers.find((entry) => entry.projectId === project.id);
          // Never downgrade an already-ready state to a stale poll result.
          setServer((current) => (current?.status === "ready" ? current : (match ?? null)));
        })
        .catch(() => undefined);
    };
    sync();
    const timer = window.setInterval(sync, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      void unsubscribe?.then((fn) => fn?.());
    };
  }, [project]);

  const start = useMemo(
    () => async () => {
      if (!plan || !root || !project) return;
      setStarting(true);
      setError(null);
      try {
        const state = await devServerStart({
          projectId: project.id,
          cwd: root,
          program: plan.program,
          args: plan.args,
          workspaceRoot: root,
        });
        // The invoke resolves with the Starting snapshot; the ready event
        // often lands first and must not be overwritten backwards.
        setServer((current) => (current?.status === "ready" ? current : state));
      } catch (startError) {
        setError(startError instanceof Error ? startError.message : String(startError));
      } finally {
        setStarting(false);
      }
    },
    [plan, root, project],
  );

  const stop = useMemo(
    () => async () => {
      if (!project) return;
      try {
        await devServerStop(project.id);
      } finally {
        setServer(null);
      }
    },
    [project],
  );

  // Ready → open the URL in the panel browser and bring the Browser tab
  // forward. This runs from whichever surface is mounted, so the journey
  // works identically when started from the Preview tab.
  const readyUrl = server?.status === "ready" ? server.url : null;
  useEffect(() => {
    if (!readyUrl) return;
    const url = readyUrl;
    let cancelled = false;
    void (async () => {
      try {
        const tabs = await panelTabList();
        const existing = tabs.find((tab) => tab.url === url);
        if (existing && !existing.active) await panelTabNavigate(existing.id, url);
        else if (!existing) await panelTabNew(url);
        if (cancelled) return;
        useWorkspacePanelStore.getState().setTab("browser");
        logger.info("workspace", "dev-server.opened", { url });
      } catch (openError) {
        logger.error("workspace", "dev-server.open-failed", {
          url,
          error: openError instanceof Error ? openError.message : String(openError),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [readyUrl]);

  const active =
    server?.status === "starting" || server?.status === "ready" || server?.status === "running";

  return {
    plan,
    server,
    starting: starting || server?.status === "starting",
    active,
    failure: error,
    start,
    stop,
  };
}

/** Failure copy: invoke error, or the crash tail from the process output. */
export function devServerFailureText(
  controller: Pick<DevServerUiController, "server" | "failure">,
  fallback: string,
): string | null {
  if (controller.failure) return controller.failure;
  if (controller.server?.status === "crashed") {
    const tail = controller.server.lastOutput
      .at(-1)
      ?.replace(/^(out|err):\s*/, "")
      .trim();
    return tail && tail.length > 0 ? tail : fallback;
  }
  return null;
}
