import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type MockWindow = Window & typeof globalThis & { VITE_WORKER_ORIGIN?: string };
type GlobalWithWindow = typeof globalThis & { window?: MockWindow; __VITE_WORKER_ORIGIN__?: string };
const globalWithWindow = globalThis as GlobalWithWindow;
const originalWindow = globalWithWindow.window;
const originalLocation = globalWithWindow.location;

describe('config', () => {
  beforeEach(() => {
    vi.resetModules();
    delete globalWithWindow.__VITE_WORKER_ORIGIN__;
    if (!globalWithWindow.window) {
      globalWithWindow.window = {} as MockWindow;
    }
    globalWithWindow.window.VITE_WORKER_ORIGIN = undefined;
    Object.defineProperty(globalWithWindow, 'location', {
      configurable: true,
      value: { protocol: 'https:', host: 'example.com' } as Location,
    });
  });

  afterEach(() => {
    vi.resetModules();
    delete globalWithWindow.__VITE_WORKER_ORIGIN__;
    if (originalWindow === undefined) {
      Reflect.deleteProperty(globalWithWindow, 'window');
    } else {
      globalWithWindow.window = originalWindow;
    }
    if (originalLocation) {
      Object.defineProperty(globalWithWindow, 'location', {
        configurable: true,
        value: originalLocation,
      });
    } else {
      Reflect.deleteProperty(globalWithWindow, 'location');
    }
  });

  it('falls back to browser origin when no worker origin is provided', async () => {
    const mod = await import('./config');
    expect(mod.WORKER_ORIGIN).toBe('https://example.com');
  });

  it('prefers injected runtime worker origin', async () => {
    globalWithWindow.__VITE_WORKER_ORIGIN__ = 'https://worker.example.com ';
    const mod = await import('./config');
    expect(mod.WORKER_ORIGIN).toBe('https://worker.example.com');
  });

  it('builds absolute worker URLs', async () => {
    const mod = await import('./config');
    expect(mod.wurl('/finnhub/quote')).toBe('https://example.com/finnhub/quote');
    expect(mod.wurl('finnhub/stock/candle')).toBe('https://example.com/finnhub/stock/candle');
  });
});
