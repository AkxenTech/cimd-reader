import type { McpProtocolObservation } from "@/lib/db/schema";

export function protocolObservationStatus(row: McpProtocolObservation) {
  // These method errors are emitted only after protocol/header validation.
  // Existing rows retain their original wire outcome and error evidence.
  const methodError = row.phase === "request" && (row.errorCode === -32601 || row.errorCode === -32602);
  const protocolVersion = row.selectedVersion ?? (methodError ? row.requestedVersion : null);
  const protocolStatus = methodError ? "accepted" : row.outcome;
  const requestStatus = row.errorCode === -32601 ? "unsupported_method"
    : row.errorCode === -32602 ? "invalid_params"
    : row.outcome === "rejected" ? "failed" : "succeeded";
  return { protocolVersion, protocolStatus, requestStatus };
}
