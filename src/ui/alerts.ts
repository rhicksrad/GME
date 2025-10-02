export type AlertType = 'IVSpike' | 'UnusualVol' | 'Sweep';

export interface AlertEvent {
  ts: number;
  type: AlertType;
  summary: string;
  detail?: string;
}

export interface AlertsTickerHandle {
  element: HTMLElement;
  push(event: AlertEvent): void;
  reset(): void;
}

const MAX_EVENTS = 40;
const RENDER_INTERVAL = 80; // ~12.5 Hz

export function createAlertsTicker(): AlertsTickerHandle {
  const container = document.createElement('div');
  container.className = 'alerts-ticker';
  const title = document.createElement('strong');
  title.textContent = 'Alerts';
  const list = document.createElement('ul');
  list.className = 'alerts-list';
  container.append(title, list);

  const events: AlertEvent[] = [];
  let pending = false;
  let lastRender = 0;

  function push(event: AlertEvent) {
    events.push(event);
    if (events.length > MAX_EVENTS) {
      events.splice(0, events.length - MAX_EVENTS);
    }
    schedule();
  }

  function reset() {
    events.length = 0;
    render();
  }

  function schedule() {
    if (pending) {
      return;
    }
    pending = true;
    window.requestAnimationFrame(() => {
      pending = false;
      const now = Date.now();
      if (now - lastRender < RENDER_INTERVAL) {
        schedule();
        return;
      }
      render();
      lastRender = now;
    });
  }

  function render() {
    list.innerHTML = '';
    events
      .slice(-15)
      .reverse()
      .forEach((event) => {
        const item = document.createElement('li');
        item.className = `alert-item alert-${event.type.toLowerCase()}`;
        const time = document.createElement('time');
        time.textContent = formatTime(event.ts);
        time.dateTime = new Date(event.ts).toISOString();
        const summary = document.createElement('span');
        summary.textContent = `${event.type}: ${event.summary}`;
        item.append(time, summary);
        if (event.detail) {
          const detail = document.createElement('span');
          detail.className = 'alert-detail';
          detail.textContent = event.detail;
          item.append(detail);
        }
        list.append(item);
      });
  }

  return { element: container, push, reset };
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
