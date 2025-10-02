export interface FeatureFlags {
  demoOptionsFallback: boolean;
}

let cachedOrigin: string | null = null;

export function getWorkerOrigin(): string {
  if (cachedOrigin != null) {
    return cachedOrigin;
  }
  if (typeof window === 'undefined') {
    cachedOrigin = '';
    return cachedOrigin;
  }
  const raw = (import.meta.env.VITE_WORKER_ORIGIN as string | undefined)?.trim() ?? '';
  cachedOrigin = raw.length > 0 ? raw : window.location.origin;
  return cachedOrigin;
}

export const features: FeatureFlags = {
  demoOptionsFallback: true,
};
