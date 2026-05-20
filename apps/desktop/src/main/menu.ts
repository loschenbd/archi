import { BrowserWindow, Menu, shell, type MenuItemConstructorOptions } from "electron";

export const SUPPORT_URL = "https://buymeacoffee.com/benjlos";

let supportWindow: BrowserWindow | null = null;

export function openSupportWindow(parent?: BrowserWindow | null): BrowserWindow {
  if (supportWindow && !supportWindow.isDestroyed()) {
    if (supportWindow.isMinimized()) {
      supportWindow.restore();
    }
    supportWindow.focus();
    return supportWindow;
  }

  const window = new BrowserWindow({
    title: "Support Archi",
    width: 520,
    height: 760,
    parent: parent ?? undefined,
    autoHideMenuBar: true,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // Send target="_blank" links (e.g. Stripe 3-D Secure popups) to the OS browser
  // so checkout flows that depend on a real browser surface keep working.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  window.on("closed", () => {
    if (supportWindow === window) {
      supportWindow = null;
    }
  });

  void window.loadURL(SUPPORT_URL);
  supportWindow = window;
  return window;
}

type MenuActions = {
  onCheckForUpdates: () => void;
};

export function buildApplicationMenu(actions: MenuActions): Menu {
  const isMac = process.platform === "darwin";

  const appMenu: MenuItemConstructorOptions = {
    label: "Archi",
    submenu: [
      { role: "about" },
      {
        label: "Support Archi…",
        click: () => {
          openSupportWindow(BrowserWindow.getFocusedWindow());
        }
      },
      { type: "separator" },
      { role: "services" },
      { type: "separator" },
      { role: "hide" },
      { role: "hideOthers" },
      { role: "unhide" },
      { type: "separator" },
      { role: "quit" }
    ]
  };

  const editMenu: MenuItemConstructorOptions = {
    label: "Edit",
    submenu: [
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { role: "selectAll" }
    ]
  };

  const viewMenu: MenuItemConstructorOptions = {
    label: "View",
    submenu: [
      { role: "reload" },
      { role: "forceReload" },
      { role: "toggleDevTools" },
      { type: "separator" },
      { role: "resetZoom" },
      { role: "zoomIn" },
      { role: "zoomOut" },
      { type: "separator" },
      { role: "togglefullscreen" }
    ]
  };

  const windowMenu: MenuItemConstructorOptions = {
    label: "Window",
    submenu: [{ role: "minimize" }, { role: "zoom" }, { type: "separator" }, { role: "front" }]
  };

  const helpMenu: MenuItemConstructorOptions = {
    role: "help",
    submenu: [
      {
        label: "Check for Updates…",
        click: () => {
          actions.onCheckForUpdates();
        }
      }
    ]
  };

  const template: MenuItemConstructorOptions[] = isMac
    ? [appMenu, editMenu, viewMenu, windowMenu, helpMenu]
    : [editMenu, viewMenu, windowMenu, helpMenu];

  return Menu.buildFromTemplate(template);
}
