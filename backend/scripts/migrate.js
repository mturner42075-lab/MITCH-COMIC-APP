const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const schemaPath = path.join(__dirname, "..", "schema.sql");
const schemaSql = fs.readFileSync(schemaPath, "utf8");

async function run() {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const tableCheck = await client.query(
      "SELECT to_regclass('public.comics') AS exists"
    );

    if (tableCheck.rows[0]?.exists) {
      await client.query("CREATE EXTENSION IF NOT EXISTS pgcrypto");

      const alterStatements = [
        "ALTER TABLE comics ADD COLUMN IF NOT EXISTS issue_title TEXT",
        "ALTER TABLE comics ADD COLUMN IF NOT EXISTS variant_description TEXT",
        "ALTER TABLE comics ADD COLUMN IF NOT EXISTS format TEXT",
        "ALTER TABLE comics ADD COLUMN IF NOT EXISTS added_date DATE",
        "ALTER TABLE comics ADD COLUMN IF NOT EXISTS cover_price NUMERIC",
        "ALTER TABLE comics ADD COLUMN IF NOT EXISTS cover_currency TEXT",
        "ALTER TABLE comics ADD COLUMN IF NOT EXISTS page_count INTEGER",
        "ALTER TABLE comics ADD COLUMN IF NOT EXISTS age TEXT",
        "ALTER TABLE comics ADD COLUMN IF NOT EXISTS language TEXT",
        "ALTER TABLE comics ADD COLUMN IF NOT EXISTS country TEXT",
        "ALTER TABLE comics ADD COLUMN IF NOT EXISTS key_reason TEXT",
        "ALTER TABLE comics ADD COLUMN IF NOT EXISTS series_group TEXT",
        "ALTER TABLE comics ADD COLUMN IF NOT EXISTS collection_name TEXT",
        "ALTER TABLE comics ADD COLUMN IF NOT EXISTS collection_hash TEXT",
        "ALTER TABLE comics ADD COLUMN IF NOT EXISTS quantity INTEGER",
        "ALTER TABLE comics ADD COLUMN IF NOT EXISTS cover_date DATE",
        "ALTER TABLE comics ADD COLUMN IF NOT EXISTS publication_date DATE"
      ];

      for (const statement of alterStatements) {
        await client.query(statement);
      }

      console.log("Schema updated with new columns.");
      return;
    }

    await client.query("BEGIN");
    // Execute schema as a single script so function bodies and triggers remain intact.
    await client.query(schemaSql);
    await client.query("COMMIT");
    console.log("Schema migration complete.");
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Ignore rollback errors.
    }
    throw error;
  } finally {
    await client.end();
  }
}

run().catch((error) => {
  console.error("Schema migration failed:", error);
  process.exit(1);
});
