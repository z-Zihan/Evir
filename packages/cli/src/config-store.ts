import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  cliConfigSchema,
  sharedProviderDocumentSchema,
  type CliConfig,
  type SharedProviderDocument,
} from "./types";

const EMPTY_DOCUMENT: SharedProviderDocument = { version: 1, providers: [] };

function defaultConfigRoot(environment: NodeJS.ProcessEnv = process.env): string {
  if (environment.EVIR_CONFIG_DIR) return path.join(environment.EVIR_CONFIG_DIR, "evir");
  if (process.platform === "win32") {
    return path.join(environment.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "evir");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "evir");
  }
  return path.join(environment.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), "evir");
}

export function defaultConfigPath(environment: NodeJS.ProcessEnv = process.env): string {
  return path.join(defaultConfigRoot(environment), "providers.json");
}

export async function readConfig(configPath = defaultConfigPath()): Promise<CliConfig> {
  const document = await readProviderDocument(configPath);
  const provider =
    document.providers.find((candidate) => candidate.isDefault && candidate.enabled) ??
    document.providers.find((candidate) => candidate.enabled);
  if (provider) return provider;

  const legacyPath = path.join(path.dirname(configPath), "config.json");
  let raw: string;
  try {
    raw = await readFile(legacyPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `Evir is not configured. Run: evir configure --protocol ... --base-url ... --model ...`,
      );
    }
    throw error;
  }
  const legacy = cliConfigSchema
    .omit({
      id: true,
      name: true,
      enabled: true,
      isDefault: true,
      createdAt: true,
      updatedAt: true,
    })
    .parse(JSON.parse(raw) as unknown);
  return {
    id: "legacy-cli-default",
    name: "Evir CLI",
    ...legacy,
    enabled: true,
    isDefault: true,
    createdAt: 0,
    updatedAt: 0,
  };
}

export async function writeConfig(
  config: CliConfig,
  configPath = defaultConfigPath(),
): Promise<void> {
  const parsed = cliConfigSchema.parse(config);
  const current = await readProviderDocument(configPath);
  const providers = current.providers
    .filter((provider) => provider.id !== parsed.id)
    .map((provider) => (parsed.isDefault ? { ...provider, isDefault: false } : provider));
  await writeProviderDocument({ version: 1, providers: [...providers, parsed] }, configPath);
}

export async function readProviderDocument(
  configPath = defaultConfigPath(),
): Promise<SharedProviderDocument> {
  let raw: string;
  try {
    raw = await readFile(configPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return EMPTY_DOCUMENT;
    throw error;
  }
  return sharedProviderDocumentSchema.parse(JSON.parse(raw) as unknown);
}

export async function writeProviderDocument(
  document: SharedProviderDocument,
  configPath = defaultConfigPath(),
): Promise<void> {
  const parsed = sharedProviderDocumentSchema.parse(document);
  await mkdir(path.dirname(configPath), { recursive: true, mode: 0o700 });
  const temporary = `${configPath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(parsed, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, configPath);
  await chmod(configPath, 0o600);
}
