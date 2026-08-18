// Phase 0 (foundation): zero tables. Phase 1 adds the `jobs` table here.
//
// Column-naming convention for Phase 1 to follow (confirmed identical in
// both apps/swole/src/db/schema.ts and apps/auth/src/db/schema.ts):
//   - camelCase TS property names; explicit snake_case string column names
//     for any multi-word property (e.g. `requestedBy: text('requested_by')`).
//     A single-word property (`id`, `name`) omits the redundant string arg.
//   - No global `casing` option is configured anywhere in this monorepo's
//     drizzle configs — naming is manual, per column, every time.
//   - Primary keys: `integer({ mode: 'number' }).primaryKey({ autoIncrement: true })`,
//     always named `id`, never given an explicit column-name string.
//   - Foreign keys: `.references(() => otherTable.id, { onDelete: 'restrict' })`.
//   - Timestamps: `integer('col_name', { mode: 'timestamp_ms' })`, defaulted
//     via `.$defaultFn(() => new Date())` — never a SQL-side default.
//   - JSON columns: `text({ mode: 'json' }).$type<T>()`.
//
// `export {}` is required, not decorative — see tsconfig's
// `isolatedModules`. Remove it the moment the first real table is added.
export {}
