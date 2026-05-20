import { Menu, shell, type MenuItemConstructorOptions } from "electron";

export const SUPPORT_URL = "https://buymeacoffee.com/<your-handle>";

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
          void shell.openExternal(SUPPORT_URL);
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
