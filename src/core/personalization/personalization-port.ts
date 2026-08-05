import type {
  EditablePromptDocumentId,
  PersonalizationDocument,
  PersonalizationScope,
} from "./types";

export interface PersonalizationPort {
  getDocument(
    id: EditablePromptDocumentId,
    scope: PersonalizationScope,
  ): Promise<PersonalizationDocument | undefined>;
  saveDocument(doc: PersonalizationDocument): Promise<void>;
  listDocuments(scope?: PersonalizationScope): Promise<PersonalizationDocument[]>;
  exportAll(): Promise<Record<string, PersonalizationDocument>>;
  importAll(data: Record<string, PersonalizationDocument>): Promise<void>;
}
