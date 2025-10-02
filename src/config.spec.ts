import { describe, expect, afterEach, beforeEach, it } from 'vitest';

import { __setWorkerOriginForTests, createWorkerUrl } from './config';

interface MockWindow {
  location: { origin: string };
}

type GlobalWithWindow = typeof globalThis & { window?: MockWindow };

const globalWithWindow = globalThis as GlobalWithWindow;
const originalWindow = globalWithWindow.window;

describe('createWorkerUrl', () => {
  beforeEach(() => {
    globalWithWindow.window = {
      location: { origin: 'http://localhost:5173' },
    };
    __setWorkerOriginForTests(null);
  });

  afterEach(() => {
    __setWorkerOriginForTests(null);
    if (originalWindow === undefined) {
      Reflect.deleteProperty(globalWithWindow, 'window');
    } else {
      globalWithWindow.window = originalWindow;
    }
  });

  it('uses the browser origin when no worker origin is set', () => {
    const url = createWorkerUrl('/finnhub/quote');
    expect(url.toString()).toBe('http://localhost:5173/finnhub/quote');
  });

  it('resolves absolute worker origins', () => {
    __setWorkerOriginForTests('https://worker.example.com');
    const url = createWorkerUrl('/finnhub/quote');
    expect(url.toString()).toBe('https://worker.example.com/finnhub/quote');
  });

  it('preserves worker path prefixes', () => {
    __setWorkerOriginForTests('https://proxy.example.com/worker');
    const url = createWorkerUrl('/finnhub/quote');
    expect(url.toString()).toBe('https://proxy.example.com/worker/finnhub/quote');
  });

  it('handles trailing slashes on the worker origin path', () => {
    __setWorkerOriginForTests('https://proxy.example.com/worker/');
    const url = createWorkerUrl('/ws');
    expect(url.toString()).toBe('https://proxy.example.com/worker/ws');
  });
});

