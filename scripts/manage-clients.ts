import { eq } from "drizzle-orm";
import { db, client } from "../lib/db";
import { clientIdentityMappings, mcpClients, oauthAttempts } from "../lib/db/schema";
import { oauthIdentityId } from "../lib/clients/identity";

async function main() {
  const [action, id, target, ...words] = process.argv.slice(2);
  if (action === "bind" && /^[a-f0-9]{64}$/.test(id ?? "") && target) {
    const attempts = await db.select().from(oauthAttempts);
    if (!attempts.some(row => row.clientId && oauthIdentityId(row.issuer, row.clientId) === id)) {
      throw new Error("Identity was not found in recorded OAuth traffic");
    }
    const [product] = await db.select().from(mcpClients).where(eq(mcpClients.id, target));
    if (!product) {
      if (!words.length) throw new Error("Provide a product name when creating a new product");
      const now = new Date().toISOString();
      await db.insert(mcpClients).values({ id: target, name: words.join(" "), supportStatus: "unknown", createdAt: now, updatedAt: now });
    }
    await db.insert(clientIdentityMappings).values({ identityId: id, productId: target, createdAt: new Date().toISOString() })
      .onConflictDoUpdate({ target: clientIdentityMappings.identityId, set: { productId: target } });
    console.log(`Mapped identity ${id} to product ${target}.`);
    return;
  }
  if (action === "unbind" && id) {
    await db.delete(clientIdentityMappings).where(eq(clientIdentityMappings.identityId, id));
    console.log(`Removed explicit mapping for ${id}.`);
    return;
  }
  if (action === "visibility" && id && ["visible", "hidden"].includes(target)) {
    const reason = words.join(" ");
    if (target === "hidden" && !reason) throw new Error("Provide a reason when hiding a product");
    const updated = await db.update(mcpClients).set({ isHidden: target === "hidden" ? 1 : 0, hiddenReason: reason || null, updatedAt: new Date().toISOString() })
      .where(eq(mcpClients.id, id)).returning({ id: mcpClients.id });
    if (!updated.length) throw new Error("Product was not found");
    console.log(`Product ${id} is ${target}.`);
    return;
  }
  throw new Error("Usage: clients:manage -- bind <identity-id> <product-id> [product name] | unbind <identity-id> | visibility <product-id> visible|hidden [reason]");
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => client.close());
