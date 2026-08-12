import { eq } from "drizzle-orm";

import { client, db } from "../lib/db";
import { oauthAttempts, validationSessions } from "../lib/db/schema";
import { findRecentAuthorizeSessionForToken } from "../lib/db/queries";

async function main() {
  const tokenAttempts = await db
    .select()
    .from(oauthAttempts)
    .where(eq(oauthAttempts.path, "/token"))
    .orderBy(oauthAttempts.createdAt);

  let moved = 0;
  let deletedSessions = 0;

  for (const tokenAttempt of tokenAttempts) {
    const sourceSessionId = tokenAttempt.sessionId;
    const targetSessionId = await findRecentAuthorizeSessionForToken({
      clientId: tokenAttempt.clientId,
      redirectUri: tokenAttempt.redirectUri,
      createdAt: tokenAttempt.createdAt
    });

    if (!sourceSessionId || !targetSessionId || sourceSessionId === targetSessionId) continue;

    await db
      .update(oauthAttempts)
      .set({ sessionId: targetSessionId })
      .where(eq(oauthAttempts.id, tokenAttempt.id));
    moved += 1;

    const [targetSession] = await db
      .select()
      .from(validationSessions)
      .where(eq(validationSessions.id, targetSessionId))
      .limit(1);

    if (targetSession && !targetSession.label && tokenAttempt.clientName) {
      await db
        .update(validationSessions)
        .set({ label: tokenAttempt.clientName })
        .where(eq(validationSessions.id, targetSessionId));
    }

    const remainingAttempts = await db
      .select({ id: oauthAttempts.id })
      .from(oauthAttempts)
      .where(eq(oauthAttempts.sessionId, sourceSessionId))
      .limit(1);

    if (remainingAttempts.length === 0) {
      await db.delete(validationSessions).where(eq(validationSessions.id, sourceSessionId));
      deletedSessions += 1;
    }
  }

  console.log(`Moved ${moved} token attempt${moved === 1 ? "" : "s"}.`);
  console.log(`Deleted ${deletedSessions} empty token session${deletedSessions === 1 ? "" : "s"}.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => client.close());
