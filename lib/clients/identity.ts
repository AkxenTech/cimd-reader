import { createHash } from "node:crypto";

export function oauthIdentityId(issuer: string | null | undefined, clientId: string) {
  return createHash("sha256").update(JSON.stringify([issuer ?? null, clientId])).digest("hex");
}

const aliases: Record<string, string> = {
  "claude": "claude-code", "claude code": "claude-code",
  "codex": "codex-cli", "codex cli": "codex-cli", "codex mcp client": "codex-cli",
  "openai codex": "codex-cli", "openai codex cli": "codex-cli",
  "mcpjam": "mcpjam", "mcpjam inspector": "mcpjam", "mcp jam": "mcpjam", "mcp inspector": "mcpjam",
  "visual studio code": "visual-studio-code", "vscode": "visual-studio-code", "vs code": "visual-studio-code", "vscode dev": "visual-studio-code"
};

// This is a label/routing hint, never proof that observations share an owner.
export function clientNameKey(value: string | null | undefined) {
  const normalized = (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return normalized ? aliases[normalized] ?? normalized.replace(/\s+/g, "-") : null;
}
