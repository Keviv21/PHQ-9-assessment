import { openPostgres, DEFAULT_SCHEMA } from "./postgres/database.js";
import { openPostgresWorkspace } from "./postgres/workspace-store.js";
import { openPostgresLegacy } from "./postgres/legacy-store.js";

export async function openApplicationStorage(env = process.env) {
  if (env.DATABASE_URL?.trim()) {
    const database = await openPostgres(env.DATABASE_URL, {
      schema: env.DATABASE_SCHEMA || DEFAULT_SCHEMA,
    });
    try {
      return {
        kind: "postgresql",
        description: database.description,
        store: openPostgresLegacy(database),
        draftStore: openPostgresLegacy(database, { draft: true }),
        workspaceStore: await openPostgresWorkspace(database),
        close: () => database.close(),
      };
    } catch (error) {
      await database.close();
      throw error;
    }
  }
  // SQLite is explicit only: isolated tests, migration tools and offline development.
  if (env.DB_PATH) {
    const [{ openStore }, { openDraftStore }, { openWorkspaceStore }] =
      await Promise.all([
        import("./sqlite/standard-store.js"),
        import("./sqlite/draft-store.js"),
        import("./sqlite/workspace-store.js"),
      ]);
    const store = openStore(env.DB_PATH),
      draftStore = openDraftStore(env.DB_PATH),
      workspaceStore = openWorkspaceStore(env.DB_PATH);
    return {
      kind: "sqlite",
      description: env.DB_PATH,
      store,
      draftStore,
      workspaceStore,
      close() {
        store.close();
        draftStore.close();
        workspaceStore.close();
      },
    };
  }
  throw new Error(
    "Set DATABASE_URL in .env. SQLite requires an explicit DB_PATH for offline use.",
  );
}
