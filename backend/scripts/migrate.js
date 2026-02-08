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

function splitStatements(sql) {
  return sql
    .split(/;\s*\n/)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

async function run() {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const tableCheck = await client.query(
    "SELECT to_regclass('public.comics') AS exists"
  );
  if (tableCheck.rows[0]?.exists) {
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
    await client.end();
    console.log("Schema updated with new columns.");
    return;
  }
  const statements = splitStatements(schemaSql);
  for (const statement of statements) {
    await client.query(statement);
  }
  await client.end();
  console.log("Schema migration complete.");
}

run().catch((error) => {
  console.error("Schema migration failed:", error);
  process.exit(1);
});
