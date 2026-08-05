import type { RuntimeTarget } from "../../runtime/types";
import type { HelpTopic } from "./help-topics";

export interface HelpPort {
  search(query: string): Promise<HelpTopic[]>;
  getTopic(id: string): Promise<HelpTopic | undefined>;
  listTopics(runtimeTarget: RuntimeTarget): Promise<HelpTopic[]>;
}
