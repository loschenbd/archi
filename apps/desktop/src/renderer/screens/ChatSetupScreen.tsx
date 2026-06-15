import { useCallback, useEffect, useRef, useState } from "react";
import type {
  DetectResult,
  ModelInfo,
  PullProgress,
} from "@archi/chat";
import { ModelPicker } from "../components/chat/ModelPicker.js";
import { PullProgressBar } from "../components/chat/PullProgressBar.js";

const RECOMMENDED_PRIMARY = "llama3.1:8b";

export type ChatSetupScreenProps = {
  onConfigured: (modelName: string) => void;
};

export function ChatSetupScreen({ onConfigured }: ChatSetupScreenProps): JSX.Element {
  const [detect, setDetect] = useState<DetectResult | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [pull, setPull] = useState<PullProgress | null>(null);
  const offProgressRef = useRef<(() => void) | null>(null);

  const runDetect = useCallback(async () => {
    const result = await window.archi.chat.detect();
    setDetect(result);
    if (result.status === "ready") {
      const list = await window.archi.chat.listModels();
      setModels(list);
    }
  }, []);

  useEffect(() => {
    void runDetect();
  }, [runDetect]);

  useEffect(() => {
    offProgressRef.current = window.archi.chat.onPullProgress((p) => {
      setPull(p);
      if (p.done && !p.error) {
        void runDetect();
      }
    });
    return () => {
      offProgressRef.current?.();
    };
  }, [runDetect]);

  const handleOpenOllamaSite = useCallback(() => {
    void window.archi.openExternalUrl?.("https://ollama.com/download");
  }, []);

  const handlePull = useCallback(async (name: string) => {
    setPull({ name, status: "starting", done: false });
    await window.archi.chat.pullModel(name);
  }, []);

  const handleConfirmModel = useCallback(() => {
    if (selected) onConfigured(selected);
  }, [selected, onConfigured]);

  if (!detect) {
    return (
      <div className="chat-setup-shell">
        <section className="ui-card ui-card--ruled ui-card--loose chat-setup-card chat-setup chat-setup-loading">
          <div className="ui-card__body">
            <span className="chat-spinner" aria-hidden="true" />
            <span>Checking for Ollama…</span>
          </div>
        </section>
      </div>
    );
  }

  if (detect.status === "not_installed") {
    return (
      <div className="chat-setup-shell">
        <section className="ui-card ui-card--ruled ui-card--loose chat-setup-card chat-setup">
          <h1 className="ui-card__title">Local AI chat for your library</h1>
          <div className="ui-card__body">
            <p>
              Archi answers questions about your saved passages using a small local AI runtime called
              Ollama. Install it once and everything runs on your machine — no accounts, no cloud,
              no per-token cost.
            </p>
          </div>
          <div className="ui-card__footer">
            <button
              type="button"
              className="ui-btn ui-btn--primary"
              onClick={handleOpenOllamaSite}
            >
              Download Ollama
            </button>
            <button
              type="button"
              className="ui-btn ui-btn--secondary"
              onClick={() => void runDetect()}
            >
              I've installed it — recheck
            </button>
          </div>
        </section>
      </div>
    );
  }

  if (detect.status === "error") {
    return (
      <div className="chat-setup-shell">
        <section className="ui-card ui-card--ruled ui-card--loose chat-setup-card chat-setup chat-setup-error">
          <h1 className="ui-card__title">Ollama is running but something's wrong</h1>
          <div className="ui-card__body">
            <p>{detect.message}</p>
          </div>
          <div className="ui-card__footer">
            <button
              type="button"
              className="ui-btn ui-btn--secondary"
              onClick={() => void runDetect()}
            >
              Recheck
            </button>
          </div>
        </section>
      </div>
    );
  }

  if (detect.status === "no_models") {
    return (
      <div className="chat-setup-shell">
        <section className="ui-card ui-card--ruled ui-card--loose chat-setup-card chat-setup">
          <h1 className="ui-card__title">Ollama is running. Pull a model to get started.</h1>
          <div className="ui-card__body">
            <p>
              We recommend <code>{RECOMMENDED_PRIMARY}</code> (~5 GB). It runs well on M1+ Macs and
              follows our citation rules reliably.
            </p>
            <PullProgressBar progress={pull} />
          </div>
          <div className="ui-card__footer">
            <button
              type="button"
              className="ui-btn ui-btn--primary"
              onClick={() => void handlePull(RECOMMENDED_PRIMARY)}
              disabled={!!pull && !pull.done}
            >
              Pull {RECOMMENDED_PRIMARY}
            </button>
          </div>
        </section>
      </div>
    );
  }

  // detect.status === "ready"
  return (
    <div className="chat-setup-shell">
      <section className="ui-card ui-card--ruled ui-card--loose chat-setup-card chat-setup">
        <h1 className="ui-card__title">Pick a model for Archi to use</h1>
        <div className="ui-card__body">
          <p>You can change this later. Recommended models are listed first.</p>
          <ModelPicker models={models} selected={selected} onSelect={setSelected} />
        </div>
        <div className="ui-card__footer">
          <button
            type="button"
            className="ui-btn ui-btn--primary"
            disabled={!selected}
            onClick={handleConfirmModel}
          >
            Use {selected ?? "model"}
          </button>
        </div>
      </section>
    </div>
  );
}
