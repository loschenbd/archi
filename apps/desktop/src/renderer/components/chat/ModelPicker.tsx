import { useState } from "react";
import type { ModelInfo } from "@archi/chat";

export type ModelPickerProps = {
  models: ModelInfo[];
  selected: string | null;
  onSelect: (name: string) => void;
};

export function ModelPicker({ models, selected, onSelect }: ModelPickerProps): JSX.Element {
  const [custom, setCustom] = useState("");
  const sorted = [...models].sort((a, b) => {
    if (a.recommended && !b.recommended) return -1;
    if (!a.recommended && b.recommended) return 1;
    return a.name.localeCompare(b.name);
  });
  return (
    <div className="chat-model-picker">
      <ul className="chat-model-list">
        {sorted.map((m) => (
          <li key={m.name}>
            <label className={selected === m.name ? "chat-model-row selected" : "chat-model-row"}>
              <input
                type="radio"
                name="chat-model"
                value={m.name}
                checked={selected === m.name}
                onChange={() => onSelect(m.name)}
              />
              <span className="chat-model-name">{m.name}</span>
              {m.recommended ? <span className="chat-model-pill">Recommended</span> : null}
            </label>
          </li>
        ))}
      </ul>
      <div className="chat-model-custom">
        <input
          type="text"
          placeholder="Or type any model name (e.g., qwen2.5:7b)"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
        />
        <button
          type="button"
          onClick={() => {
            if (custom.trim()) onSelect(custom.trim());
          }}
          disabled={!custom.trim()}
        >
          Use this model
        </button>
      </div>
    </div>
  );
}
