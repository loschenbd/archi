import { ipcMain } from "electron";
import type { SearchQuery } from "@archi/search";
import type { SearchModule } from "../searchModule.js";

export function registerSearchIpc(module: SearchModule): void {
  ipcMain.handle("archi:search:query", async (_event, q: SearchQuery) => {
    return module.search.query(q);
  });

  ipcMain.handle("archi:search:indexerStatus", async () => {
    return module.indexer.getStatus();
  });

  // Manual trigger: kicks the indexer. Returns immediately; work happens in background.
  // Useful for v1 where automatic startup-tick is disabled to avoid main-thread freeze
  // during the initial model load.
  ipcMain.handle("archi:search:startIndexing", async () => {
    module.indexer.tick();
    return { started: true };
  });

  ipcMain.handle("archi:search:getByPassageIds", async (_event, ids: string[]) => {
    return module.search.getResultsByIds(ids);
  });
}
