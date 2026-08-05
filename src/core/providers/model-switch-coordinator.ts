import type {
  ModelSwitchAssessment,
  ModelSwitchRequest,
  ModelSwitchStatus,
} from "./model-switching";

export interface ModelSwitchCoordinator {
  assess(request: ModelSwitchRequest): Promise<ModelSwitchAssessment>;
  execute(
    request: ModelSwitchRequest,
    assessment: ModelSwitchAssessment,
  ): Promise<ModelSwitchStatus>;
  cancel(conversationId: string): void;
}
