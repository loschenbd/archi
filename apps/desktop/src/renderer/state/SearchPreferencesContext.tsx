import { createContext, useCallback, useContext, useEffect, useState } from "react";

type SearchPreferences = {
  showMatchSource: boolean;
  includeArchived: boolean;
  includeHidden: boolean;
};

type ContextValue = SearchPreferences & {
  setShowMatchSource: (value: boolean) => void;
  setIncludeArchived: (value: boolean) => void;
  setIncludeHidden: (value: boolean) => void;
};

const DEFAULTS: SearchPreferences = {
  showMatchSource: true,
  includeArchived: false,
  includeHidden: false
};

const KEYS = {
  showMatchSource: "search.showMatchSource",
  includeArchived: "search.includeArchived",
  includeHidden: "search.includeHidden"
} as const;

const SearchPreferencesContext = createContext<ContextValue | null>(null);

export function SearchPreferencesProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [prefs, setPrefs] = useState<SearchPreferences>(DEFAULTS);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [showMatchSource, includeArchived, includeHidden] = await Promise.all([
        window.archi.preferences.get<boolean>(KEYS.showMatchSource, DEFAULTS.showMatchSource),
        window.archi.preferences.get<boolean>(KEYS.includeArchived, DEFAULTS.includeArchived),
        window.archi.preferences.get<boolean>(KEYS.includeHidden, DEFAULTS.includeHidden)
      ]);
      if (cancelled) return;
      setPrefs({ showMatchSource, includeArchived, includeHidden });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback(
    (key: keyof SearchPreferences, value: boolean) => {
      setPrefs((current) => ({ ...current, [key]: value }));
      void window.archi.preferences.set(KEYS[key], value);
    },
    []
  );

  const value: ContextValue = {
    ...prefs,
    setShowMatchSource: (v) => persist("showMatchSource", v),
    setIncludeArchived: (v) => persist("includeArchived", v),
    setIncludeHidden: (v) => persist("includeHidden", v)
  };

  return (
    <SearchPreferencesContext.Provider value={value}>{children}</SearchPreferencesContext.Provider>
  );
}

export function useSearchPreferences(): ContextValue {
  const ctx = useContext(SearchPreferencesContext);
  if (!ctx) {
    throw new Error("useSearchPreferences must be used inside <SearchPreferencesProvider>");
  }
  return ctx;
}
