import type { SearchFilters } from "@archi/search";
import { Fragment, type ReactNode } from "react";

export function highlightMatch(text: string, query: string): ReactNode {
  const q = query.trim();
  if (!q) return text;
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${escaped})`, "gi"));
  return parts.map((part, i) =>
    part.toLowerCase() === q.toLowerCase() ? (
      <mark key={i}>{part}</mark>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    )
  );
}

export function excerptAroundMatch(body: string, query: string, max = 180): string {
  const clean = body.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const idx = query ? clean.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (idx < 0) {
    return `${clean.slice(0, max - 1).trimEnd()}…`;
  }
  const half = Math.floor(max / 2);
  const start = Math.max(0, idx - half);
  const end = Math.min(clean.length, start + max);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < clean.length ? "…" : "";
  return `${prefix}${clean.slice(start, end).trim()}${suffix}`;
}

export function excerptOf(body: string, max: number): string {
  const trimmed = body.replace(/\s+/g, " ").trim();
  if (trimmed.length <= max) {
    return trimmed;
  }
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

export function formatRelative(iso: string, nowMs: number): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) {
    return "";
  }
  const diff = Math.max(0, Math.floor((nowMs - t) / 1000));
  if (diff < 5) return "just now";
  if (diff < 60) return `${diff}s ago`;
  const m = Math.floor(diff / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function formatElapsed(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  if (minutes < 60) {
    return `${minutes}m ${String(remaining).padStart(2, "0")}s`;
  }
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return `${hours}h ${String(remMinutes).padStart(2, "0")}m`;
}

export function hasNonDefaultFilters(filters: SearchFilters): boolean {
  return (
    (filters.workIds?.length ?? 0) > 0 ||
    filters.creator !== undefined ||
    (filters.labels?.length ?? 0) > 0 ||
    filters.isStarred === true ||
    filters.markerColor !== undefined ||
    filters.workType !== undefined ||
    filters.markedAfter !== undefined ||
    filters.markedBefore !== undefined ||
    filters.isArchived === true ||
    filters.isHidden === true
  );
}
