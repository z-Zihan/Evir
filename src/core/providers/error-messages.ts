import { ProviderErrorType } from "./stream-events";

export interface ErrorDisplay {
  title: string;
  description: string;
  action?: string;
}

type Translate = (key: string) => string;

const ERROR_KEYS: Record<ProviderErrorType, string> = {
  [ProviderErrorType.AUTH_FAILED]: "AUTH_FAILED",
  [ProviderErrorType.CORS_BLOCKED]: "CORS_BLOCKED",
  [ProviderErrorType.RATE_LIMITED]: "RATE_LIMITED",
  [ProviderErrorType.INSUFFICIENT_BALANCE]: "INSUFFICIENT_BALANCE",
  [ProviderErrorType.MODEL_NOT_FOUND]: "MODEL_NOT_FOUND",
  [ProviderErrorType.CONTEXT_OVERFLOW]: "CONTEXT_OVERFLOW",
  [ProviderErrorType.TOOL_CALL_UNSUPPORTED]: "TOOL_CALL_UNSUPPORTED",
  [ProviderErrorType.VISION_UNSUPPORTED]: "VISION_UNSUPPORTED",
  [ProviderErrorType.PROTOCOL_INCOMPATIBLE]: "PROTOCOL_INCOMPATIBLE",
  [ProviderErrorType.NETWORK_ERROR]: "NETWORK_ERROR",
  [ProviderErrorType.PROVIDER_ERROR]: "PROVIDER_ERROR",
  [ProviderErrorType.CANCELLED]: "CANCELLED",
};

export function getErrorDisplay(errorType: ProviderErrorType, t: Translate): ErrorDisplay {
  const key = `errors.${ERROR_KEYS[errorType]}`;
  return {
    title: t(`${key}.title`),
    description: t(`${key}.description`),
  };
}
