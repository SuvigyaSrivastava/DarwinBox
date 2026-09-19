import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "..", "..", "data");

import { mkdirSync } from "node:fs";
mkdirSync(dataDir, { recursive: true });

export const db = new Database(path.join(dataDir, "migration.sqlite"));
db.pragma("journal_mode = WAL");

const schemaSql = readFileSync(path.join(__dirname, "schema.sql"), "utf-8");
db.exec(schemaSql);
