import { ipcMain, BrowserWindow } from "electron";
import type {
  ChatTurnRequest,
  ModelInfo,
  PullProgress,
} from "@archi/chat";
import type { ChatModule } from "../chatModule.js";

export function registerChatIpc(module: ChatModule): void {
  ipcMain.handle("archi:chat:detect", async () => {
    return module.llm.detect();
  });

  ipcMain.handle("archi:chat:listModels", async (): Promise<ModelInfo[]> => {
    return module.llm.listModels();
  });

  ipcMain.handle("archi:chat:pullModel", async (event, name: string) => {
    const sender = event.sender;
    void (async () => {
      try {
        for await (const progress of module.llm.pullModel(name)) {
          if (sender.isDestroyed()) return;
          sender.send("archi:chat:pullProgress", progress satisfies PullProgress);
          if (progress.done || progress.error) return;
        }
      } catch (err) {
        if (sender.isDestroyed()) return;
        sender.send("archi:chat:pullProgress", {
          name,
          status: "error",
          done: true,
          error: (err as Error).message,
        });
      }
    })();
    return { started: true };
  });

  ipcMain.handle("archi:chat:turn", async (event, req: ChatTurnRequest) => {
    const sender = event.sender;
    void module.service.runTurn(req, (e) => {
      if (sender.isDestroyed()) return;
      switch (e.type) {
        case "token":
          sender.send("archi:chat:token", { turnId: e.turnId, delta: e.delta });
          break;
        case "done":
          sender.send("archi:chat:done", {
            turnId: e.turnId,
            citations: e.citations,
            durationMs: e.durationMs,
            skipped: e.skipped,
            skipReason: e.skipReason,
          });
          break;
        case "error":
          sender.send("archi:chat:error", {
            turnId: e.turnId,
            code: e.code,
            message: e.message,
          });
          break;
        case "aborted":
          sender.send("archi:chat:aborted", { turnId: e.turnId });
          break;
      }
    });
    return { accepted: true, turnId: req.turnId };
  });

  ipcMain.handle("archi:chat:cancel", async (_event, turnId: string) => {
    module.service.cancel(turnId);
  });
}

export function chatBroadcast(window: BrowserWindow, channel: string, payload: unknown): void {
  if (!window.isDestroyed()) {
    window.webContents.send(channel, payload);
  }
}
