import type {
  ModelSwitchAssessment,
  ModelSwitchRequest,
  ModelSwitchResult,
} from "./model-switching";

export interface ModelSwitchCoordinator {
  assess(request: ModelSwitchRequest): Promise<ModelSwitchAssessment>;
  execute(
    request: ModelSwitchRequest,
    assessment: ModelSwitchAssessment,
  ): Promise<ModelSwitchResult>;
  cancel(conversationId: string): void;
}
