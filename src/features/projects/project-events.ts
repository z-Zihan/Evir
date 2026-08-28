// Decouples project-store from chat-store: removing a project must detach its
// conversations, but the projects feature must not import the chat feature
// (that edge closed a module cycle chat → send-message → projects → chat).
// The chat side registers its listener on load; projects only notifies.
type ProjectRemovedListener = (projectId: string) => void;

const listeners = new Set<ProjectRemovedListener>();

export function onProjectRemoved(listener: ProjectRemovedListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyProjectRemoved(projectId: string): void {
  for (const listener of listeners) listener(projectId);
}
