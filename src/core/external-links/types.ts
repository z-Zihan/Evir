export interface ExternalLinkService {
  open(url: string): Promise<void>;
}

export function assertSafeExternalUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`Unsupported external link protocol: ${url.protocol}`);
  }
  return url;
}
