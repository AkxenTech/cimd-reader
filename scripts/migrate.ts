import { readFileSync } from "node:fs";
import { join } from "node:path";

import { client } from "../lib/db";

async function main() {
  const migration = readFileSync(join(process.cwd(), "drizzle/0001_initial.sql"), "utf8");
  const statements = migration
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);

  for (const statement of statements) {
    await client.execute(statement);
  }

  console.log(`Applied ${statements.length} migration statements.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => client.close());
