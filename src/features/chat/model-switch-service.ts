import { ModelSwitchCoordinatorImpl } from "../../core/providers/model-switch-coordinator-impl";
import type { ModelSwitchCoordinator } from "../../core/providers/model-switch-coordinator";

// UI-facing facade: app components must not import the coordinator
// implementation from core directly. Constructed lazily so importing this
// module is side-effect free.
let coordinator: ModelSwitchCoordinator | undefined;

export function getModelSwitchCoordinator(): ModelSwitchCoordinator {
  return (coordinator ??= new ModelSwitchCoordinatorImpl());
}
