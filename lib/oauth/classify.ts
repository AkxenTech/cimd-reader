export type RequestClassification = "cimd" | "dcr" | "static" | "unknown";

export function isHttpsUrl(value: string | null | undefined) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

export function classifyAuthorizeRequest(clientId: string | null, hadDcrAttempt: boolean): RequestClassification {
  if (!clientId) return "unknown";
  if (isHttpsUrl(clientId)) return "cimd";
  if (hadDcrAttempt) return "dcr";
  try {
    new URL(clientId);
    return "unknown";
  } catch {
    return "static";
  }
}
