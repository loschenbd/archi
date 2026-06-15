import { ipcMain, BrowserWindow } from "electron";
import type {
  ChatConversation,
  ChatTurnRequest,
  LoadedConversation,
  ModelInfo,
  PullProgress,
} from "@archi/chat";
import type { ChatModule } from "../chatModule.js";

function broadcastHistoryChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send("archi:chat:historyChanged");
    }
  }
}

export function registerChatIpc(module: ChatModule): void {
  ipcMain.handle("archi:chat:detect", async () => module.llm.detect());

  ipcMain.handle("archi:chat:listModels", async (): Promise<ModelInfo[]> =>
    module.llm.listModels()
  );

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
    module.service
      .runTurn(req, (e) => {
        if (sender.isDestroyed()) return;
        switch (e.type) {
          case "token":
            sender.send("archi:chat:token", { turnId: e.turnId, delta: e.delta });
            break;
          case "done":
            sender.send("archi:chat:done", {
              turnId: e.turnId,
              conversationId: e.conversationId,
              citations: e.citations,
              durationMs: e.durationMs,
              skipped: e.skipped,
              skipReason: e.skipReason,
            });
            broadcastHistoryChanged();
            break;
          case "error":
            sender.send("archi:chat:error", {
              turnId: e.turnId,
              conversationId: e.conversationId,
              code: e.code,
              message: e.message,
            });
            broadcastHistoryChanged();
            break;
          case "aborted":
            sender.send("archi:chat:aborted", {
              turnId: e.turnId,
              conversationId: e.conversationId,
            });
            broadcastHistoryChanged();
            break;
        }
      })
      .catch((err) => {
        console.error(`[chat ipc] runTurn rejected for turn ${req.turnId}:`, err);
        if (!sender.isDestroyed()) {
          sender.send("archi:chat:error", {
            turnId: req.turnId,
            conversationId: req.conversationId ?? null,
            code: "unknown",
            message: `Chat service crashed: ${(err as Error).message ?? String(err)}`,
          });
        }
      });
    return { accepted: true, turnId: req.turnId };
  });

  ipcMain.handle("archi:chat:cancel", async (_event, turnId: string) => {
    module.service.cancel(turnId);
  });

  ipcMain.handle("archi:chat:listConversations", async (): Promise<ChatConversation[]> => {
    return module.store.listConversations();
  });

  ipcMain.handle(
    "archi:chat:loadConversation",
    async (_event, id: string): Promise<LoadedConversation> => {
      return module.store.loadConversation(id);
    }
  );

  ipcMain.handle(
    "archi:chat:renameConversation",
    async (_event, id: string, title: string): Promise<void> => {
      module.store.renameConversation(id, title);
      broadcastHistoryChanged();
    }
  );

  ipcMain.handle(
    "archi:chat:deleteConversation",
    async (_event, id: string): Promise<void> => {
      module.store.deleteConversation(id);
      broadcastHistoryChanged();
    }
  );
}

export function chatBroadcast(window: BrowserWindow, channel: string, payload: unknown): void {
  if (!window.isDestroyed()) {
    window.webContents.send(channel, payload);
  }
}
