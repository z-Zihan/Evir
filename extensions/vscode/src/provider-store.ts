import type * as vscode from "vscode";
import type { ProviderConfig } from "./types";
import { providerConfigSchema } from "./types";

const CONFIG_KEY = "evir.provider.config";
const SECRET_KEY = "evir.provider.apiKey";

export class ProviderStore {
  constructor(private readonly context: vscode.ExtensionContext) {}

  getConfig(): ProviderConfig | undefined {
    const parsed = providerConfigSchema.safeParse(this.context.globalState.get(CONFIG_KEY));
    return parsed.success ? parsed.data : undefined;
  }

  getApiKey(): Thenable<string | undefined> {
    return this.context.secrets.get(SECRET_KEY);
  }

  async save(config: ProviderConfig, apiKey: string): Promise<void> {
    await this.context.globalState.update(CONFIG_KEY, config);
    if (apiKey.trim()) await this.context.secrets.store(SECRET_KEY, apiKey.trim());
  }
}
