import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { client } from "../lib/db";

async function main() {
  const dir = join(process.cwd(), "drizzle");
  const statements = readdirSync(dir)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .flatMap((file) =>
      readFileSync(join(dir, file), "utf8")
        .split(";")
        .map((statement) => statement.trim())
        .filter(Boolean)
    );

  let applied = 0;
  for (const statement of statements) {
    try {
      await client.execute(statement);
      applied += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/duplicate column name/i.test(message)) throw error;
    }
  }

  console.log(`Applied ${applied} migration statements.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => client.close());
