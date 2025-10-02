// src/config.ts
// Runtime worker origin. Use absolute URL to the Cloudflare Worker.
// Example: "https://gme-radar-rhicksrad.workers.dev"
type GlobalWithOrigin = typeof globalThis & { __VITE_WORKER_ORIGIN__?: string };
type WindowWithOrigin = typeof window & { VITE_WORKER_ORIGIN?: string };

const globalEnv = globalThis as GlobalWithOrigin;
const windowEnv = typeof window !== "undefined" ? (window as WindowWithOrigin) : undefined;

const ENV_ORIGIN = globalEnv.__VITE_WORKER_ORIGIN__ || windowEnv?.VITE_WORKER_ORIGIN || "";

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
