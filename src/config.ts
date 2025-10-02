// src/config.ts
// Runtime worker origin. Use absolute URL to the Cloudflare Worker.
// Example: "https://gme-radar-rhicksrad.workers.dev"
const ENV_ORIGIN = (globalThis as any).__VITE_WORKER_ORIGIN__ || (typeof window !== "undefined" ? (window as any).VITE_WORKER_ORIGIN : "");

const FALLBACK_LOCATION = typeof location !== "undefined"
  ? location
  : ({ protocol: "https:", host: "localhost" } as Location);

// If undefined at runtime, default to same-origin root (not the /GME base path).
// This prevents "/GME/finnhub/…" which 404s on GitHub Pages.
export const WORKER_ORIGIN: string =
  typeof ENV_ORIGIN === "string" && ENV_ORIGIN.trim().length
    ? ENV_ORIGIN.trim()
    : `${FALLBACK_LOCATION.protocol}//${FALLBACK_LOCATION.host}`;

export function wurl(path: string): string {
  // Always resolve against origin root, never relative to /GME/*
  return new URL(path.startsWith("/") ? path : `/${path}`, WORKER_ORIGIN).toString();
}

export interface FeatureFlags {
  demoOptionsFallback: boolean;
}

export const features: FeatureFlags = {
  demoOptionsFallback: true,
};
