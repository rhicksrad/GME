// Allow ?worker=... override, else hard-code your Worker origin for Pages.
const qs = new URL(location.href).searchParams.get('worker');
const DEFAULT = 'https://fnproxy.hicksrch.workers.dev';
if (!('VITE_WORKER_ORIGIN' in window)) {
  window.VITE_WORKER_ORIGIN = qs || DEFAULT;
}
