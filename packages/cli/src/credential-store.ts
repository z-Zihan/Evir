import { AsyncEntry } from "@napi-rs/keyring";

const SERVICE = "evir";

export function providerCredentialKey(providerId: string): string {
  return `provider:${providerId}:api-key`;
}

export async function getProviderCredential(providerId: string): Promise<string | undefined> {
  return (
    (await new AsyncEntry(SERVICE, providerCredentialKey(providerId)).getPassword()) ?? undefined
  );
}

export async function setProviderCredential(providerId: string, apiKey: string): Promise<void> {
  if (!apiKey) throw new Error("API key must not be empty");
  await new AsyncEntry(SERVICE, providerCredentialKey(providerId)).setPassword(apiKey);
}
