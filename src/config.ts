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

function getDefaultBase(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return 'http://localhost';
}

function normaliseBasePath(pathname: string): string {
  if (pathname === '/') {
    return '';
  }
  return pathname.replace(/\/$/, '');
}

export function createWorkerUrl(path: string): URL {
  const fallbackBase = getDefaultBase();
  const origin = getWorkerOrigin();
  if (!origin) {
    return new URL(path, fallbackBase);
  }
  try {
    const base = new URL(origin, fallbackBase);
    if (!path.startsWith('/')) {
      return new URL(path, base);
    }
    const url = new URL(base.toString());
    const basePath = normaliseBasePath(base.pathname);
    url.pathname = `${basePath}${path}` || '/';
    return url;
  } catch {
    return new URL(path, fallbackBase);
  }
}

export function __setWorkerOriginForTests(origin: string | null): void {
  cachedOrigin = origin;
}

export const features: FeatureFlags = {
  demoOptionsFallback: true,
};
