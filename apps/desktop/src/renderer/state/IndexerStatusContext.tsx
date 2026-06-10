import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { IndexerStatus } from "@archi/search";

type ContextValue = {
  status: IndexerStatus | null;
  start: () => Promise<void>;
  starting: boolean;
};

const IndexerStatusContext = createContext<ContextValue | null>(null);

type ProviderProps = {
  pollMs?: number;
  children: React.ReactNode;
};

export function IndexerStatusProvider({ pollMs = 2000, children }: ProviderProps): JSX.Element {
  const [status, setStatus] = useState<IndexerStatus | null>(null);
  const [starting, setStarting] = useState(false);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      try {
        const next = await window.archi.search.indexerStatus();
        if (!aliveRef.current) return;
        setStatus(next);
      } catch {
        // ignore transient IPC failures
      } finally {
        if (aliveRef.current) {
          timer = setTimeout(tick, pollMs);
        }
      }
    };
    void tick();
    return () => {
      aliveRef.current = false;
      if (timer) clearTimeout(timer);
    };
  }, [pollMs]);

  const start = useCallback(async () => {
    setStarting(true);
    try {
      await window.archi.search.startIndexing();
    } finally {
      setStarting(false);
    }
  }, []);

  return (
    <IndexerStatusContext.Provider value={{ status, start, starting }}>
      {children}
    </IndexerStatusContext.Provider>
  );
}

export function useIndexerStatus(): ContextValue {
  const ctx = useContext(IndexerStatusContext);
  if (!ctx) {
    throw new Error("useIndexerStatus must be used inside <IndexerStatusProvider>");
  }
  return ctx;
}
