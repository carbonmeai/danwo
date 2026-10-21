/** Where `drizzle-kit push` finds the schema and the database it creates the tables in. */
import { defineConfig } from "drizzle-kit"

export default defineConfig({
  dialect: "postgresql",
  schema: "./db/schema.ts",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
})
