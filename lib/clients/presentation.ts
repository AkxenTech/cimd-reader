import type { Attribution, OAuthIdentity } from "./resolver";

type ClientPresentation = {
  name: string;
  identities: OAuthIdentity[];
  attribution: Attribution;
  observedBehavior: string;
  latestSuccessfulCimdValidation: unknown;
};

export function clientDisplayName(client: Pick<ClientPresentation, "name" | "identities">) {
  return client.identities.length && !client.identities.some(identity => identity.displayName)
    && client.identities.some(identity => identity.clientId === client.name)
    ? "Unidentified client" : client.name;
}

export function dashboardSections<T extends ClientPresentation>(clients: T[]) {
  const primary: T[] = [];
  const other: T[] = [];
  for (const client of clients) {
    const unverifiedFailure = client.observedBehavior === "failed" && !client.latestSuccessfulCimdValidation;
    const unnamed = client.identities.length > 0 && !client.identities.some(identity => identity.displayName);
    (client.attribution.status === "unresolved" && (unverifiedFailure || unnamed) ? other : primary).push(client);
  }
  const byName = (a: T, b: T) => clientDisplayName(a).localeCompare(clientDisplayName(b)) || a.name.localeCompare(b.name);
  return { primary: primary.sort(byName), other: other.sort(byName) };
}
