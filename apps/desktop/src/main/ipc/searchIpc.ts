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
}
