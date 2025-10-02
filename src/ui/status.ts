import type { ConnectionState } from '../types';

export type Mode = 'live' | 'demo';

type BannerTone = 'info' | 'error';

export interface StatusHandle {
  element: HTMLElement;
  banner: HTMLElement;
  retryButton: HTMLButtonElement;
  setMode(mode: Mode): void;
  setConnection(state: ConnectionState): void;
  setLastUpdated(timestamp: number | null): void;
  setRetries(count: number): void;
  setWorkerOrigin(origin: string): void;
  setOptionsStatus(label: string, delayed?: boolean): void;
  setOptionsUpdated(timestamp: number | null): void;
  setBanner(message: string | null, tone?: BannerTone): void;
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function createStatus(): StatusHandle {
  const footer = document.createElement('footer');
  const statusLine = document.createElement('div');
  statusLine.className = 'status-line';

  const modeBadge = document.createElement('span');
  modeBadge.className = 'badge live';
  modeBadge.textContent = 'LIVE';

  const connectionBadge = document.createElement('span');
  connectionBadge.className = 'badge live';
  connectionBadge.textContent = 'CONNECTED';

  const retryButton = document.createElement('button');
  retryButton.type = 'button';
  retryButton.textContent = 'Retry now';

  const retryLabel = document.createElement('span');
  retryLabel.textContent = 'Retries: 0';

  const updatedLabel = document.createElement('time');
  updatedLabel.setAttribute('aria-live', 'polite');
  updatedLabel.textContent = 'Last update: —';

  const workerLabel = document.createElement('span');
  workerLabel.className = 'worker-label';
  workerLabel.textContent = 'Worker: —';

  const optionsLabel = document.createElement('span');
  optionsLabel.className = 'options-label';
  optionsLabel.textContent = 'Options: —';

  let optionsBaseLabel = 'Options: —';

  statusLine.append(
    modeBadge,
    connectionBadge,
    retryLabel,
    updatedLabel,
    workerLabel,
    optionsLabel,
    retryButton,
  );
  footer.append(statusLine);

  const banner = document.createElement('div');
  banner.className = 'banner';
  banner.hidden = true;

  function setMode(mode: Mode) {
    if (mode === 'demo') {
      modeBadge.textContent = 'DEMO';
      modeBadge.className = 'badge demo';
    } else {
      modeBadge.textContent = 'LIVE';
      modeBadge.className = 'badge live';
    }
  }

  function setConnection(state: ConnectionState) {
    let label = 'CONNECTED';
    let className = 'badge live';
    if (state === 'reconnecting') {
      label = 'RECONNECTING';
      className = 'badge reconnecting';
    } else if (state === 'closed') {
      label = 'OFFLINE';
      className = 'badge offline';
    }
    connectionBadge.textContent = label;
    connectionBadge.className = className;
  }

  function setLastUpdated(timestamp: number | null) {
    if (timestamp == null) {
      updatedLabel.textContent = 'Last update: —';
      return;
    }
    updatedLabel.textContent = `Last update: ${formatTime(timestamp)}`;
  }

  function setRetries(count: number) {
    retryLabel.textContent = `Retries: ${count}`;
  }

  function setWorkerOrigin(origin: string) {
    workerLabel.textContent = `Worker: ${origin}`;
  }

  function setOptionsStatus(label: string, delayed = false) {
    optionsBaseLabel = delayed ? `Options: ${label} (delayed)` : `Options: ${label}`;
    const timestamp = optionsLabel.dataset.updatedAt;
    optionsLabel.textContent = timestamp ? `${optionsBaseLabel} – ${formatTime(Date.parse(timestamp))}` : optionsBaseLabel;
    optionsLabel.style.color = delayed ? '#facc15' : '#cbd5f5';
  }

  function setOptionsUpdated(timestamp: number | null) {
    if (timestamp == null) {
      optionsLabel.dataset.updatedAt = '';
      optionsLabel.textContent = optionsBaseLabel;
      return;
    }
    optionsLabel.dataset.updatedAt = new Date(timestamp).toISOString();
    optionsLabel.textContent = `${optionsBaseLabel} – ${formatTime(timestamp)}`;
  }

  function setBanner(message: string | null, tone: BannerTone = 'info') {
    if (!message) {
      banner.hidden = true;
      banner.textContent = '';
      return;
    }
    banner.hidden = false;
    banner.textContent = message;
    banner.style.backgroundColor = tone === 'error' ? 'rgba(248, 113, 113, 0.15)' : 'rgba(96, 165, 250, 0.15)';
    banner.style.color = tone === 'error' ? '#fca5a5' : '#93c5fd';
    banner.style.borderBottom = `1px solid ${tone === 'error' ? 'rgba(248,113,113,0.25)' : 'rgba(96,165,250,0.25)'}`;
  }

  return {
    element: footer,
    banner,
    retryButton,
    setMode,
    setConnection,
    setLastUpdated,
    setRetries,
    setWorkerOrigin,
    setOptionsStatus,
    setOptionsUpdated,
    setBanner,
  };
}
