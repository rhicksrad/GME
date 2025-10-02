import type { OptRow } from '../data/optionsClient';
import { MONEYNESS_ORDER, type MoneynessBucket } from '../options/chain';
import type { ExpiryTotals, MoneynessRow } from '../options/signals';

export interface UnusualContractRow {
  row: OptRow;
  contractId: string;
  flags: string[];
  deltaOpenInterest?: number;
}

export interface OptionsPanelHandle {
  element: HTMLElement;
  setSource(meta: { provider: string; delayed?: boolean; error?: string | null; updatedAt?: number | null }): void;
  renderHeatmap(rows: MoneynessRow[]): void;
  renderTotals(totals: ExpiryTotals[]): void;
  renderUnusual(rows: UnusualContractRow[]): void;
}

const COLUMN_LABELS: Record<MoneynessBucket, string> = {
  deepITM: 'Deep ITM',
  itm: 'ITM',
  atm: 'ATM',
  otm: 'OTM',
  deepOTM: 'Deep OTM',
};

export function createOptionsPanel(): OptionsPanelHandle {
  const container = document.createElement('div');
  container.className = 'panel options-panel';

  const header = document.createElement('div');
  header.className = 'panel-header';
  const title = document.createElement('h2');
  title.className = 'panel-title';
  title.textContent = 'Options activity';
  const providerBadge = document.createElement('span');
  providerBadge.className = 'badge provider';
  providerBadge.textContent = '—';
  providerBadge.title = 'Options source';
  header.append(title, providerBadge);

  const updatedLabel = document.createElement('small');
  updatedLabel.className = 'small';
  updatedLabel.textContent = 'Last refresh: —';

  const heatmapWrapper = document.createElement('div');
  heatmapWrapper.className = 'heatmap-wrapper';
  const heatmapTable = document.createElement('table');
  heatmapTable.className = 'heatmap-table';
  const head = document.createElement('thead');
  const headRow = document.createElement('tr');
  const expiryTh = document.createElement('th');
  expiryTh.textContent = 'Expiry';
  headRow.append(expiryTh);
  MONEYNESS_ORDER.forEach((bucket) => {
    const th = document.createElement('th');
    th.textContent = COLUMN_LABELS[bucket];
    headRow.append(th);
  });
  head.append(headRow);
  heatmapTable.append(head);
  const body = document.createElement('tbody');
  heatmapTable.append(body);
  heatmapWrapper.append(heatmapTable);

  const totalsStrip = document.createElement('div');
  totalsStrip.className = 'totals-strip';

  const unusualHeading = document.createElement('h3');
  unusualHeading.textContent = 'Unusual contracts';
  unusualHeading.className = 'section-heading';

  const unusualTable = document.createElement('table');
  unusualTable.className = 'unusual-table';
  const unusualHead = document.createElement('thead');
  unusualHead.innerHTML =
    '<tr><th>Contract</th><th>Strike</th><th>Type</th><th>Vol</th><th>OI</th><th>IV</th><th>Flags</th></tr>';
  const unusualBody = document.createElement('tbody');
  unusualTable.append(unusualHead, unusualBody);

  const legend = document.createElement('p');
  legend.className = 'flags-legend';
  legend.textContent = 'Flags: Vol >3× (volume spike), IV spike (>2σ move), Sweep (clustered strikes), OI Δ (open interest change).';

  container.append(header, updatedLabel, heatmapWrapper, totalsStrip, unusualHeading, unusualTable, legend);

  function setSource(meta: { provider: string; delayed?: boolean; error?: string | null; updatedAt?: number | null }) {
    providerBadge.textContent = meta.provider.toUpperCase();
    providerBadge.classList.toggle('delayed', Boolean(meta.delayed));
    providerBadge.classList.toggle('error', Boolean(meta.error));
    providerBadge.title = meta.error ? `Options source error: ${meta.error}` : meta.delayed ? 'Delayed data' : 'Live data';
    if (meta.updatedAt) {
      updatedLabel.textContent = `Last refresh: ${formatTime(meta.updatedAt)}`;
    } else {
      updatedLabel.textContent = 'Last refresh: —';
    }
  }

  function renderHeatmap(rows: MoneynessRow[]) {
    body.innerHTML = '';
    if (rows.length === 0) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = MONEYNESS_ORDER.length + 1;
      cell.textContent = 'No options data available';
      cell.className = 'empty';
      row.append(cell);
      body.append(row);
      return;
    }
    const maxVolume = rows.reduce((max, row) => {
      return Math.max(
        max,
        ...MONEYNESS_ORDER.map((bucket) => row.buckets[bucket]?.volume ?? 0),
      );
    }, 0);
    rows.slice(0, 8).forEach((entry) => {
      const tr = document.createElement('tr');
      const expiryCell = document.createElement('th');
      expiryCell.textContent = entry.exp;
      tr.append(expiryCell);
      MONEYNESS_ORDER.forEach((bucket) => {
        const cell = document.createElement('td');
        const bucketData = entry.buckets[bucket];
        const volume = bucketData?.volume ?? 0;
        const oi = bucketData?.openInterest ?? 0;
        const ratio = maxVolume > 0 ? volume / maxVolume : 0;
        const alpha = Math.min(0.65, 0.15 + ratio * 0.6);
        cell.style.backgroundColor = `rgba(56, 189, 248, ${alpha.toFixed(3)})`;
        cell.className = 'heatmap-cell';
        const best = (bucketData?.rows ?? []).slice().sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))[0];
        if (best) {
          const tooltip = [
            `${best.exp} ${best.type}${best.strike.toFixed(2)}`,
            `Vol ${formatNumber(best.volume)} | OI ${formatNumber(best.openInterest)}`,
          ];
          if (best.mid != null) {
            tooltip.push(`Mid ${best.mid.toFixed(2)}`);
          }
          if (best.iv != null) {
            tooltip.push(`IV ${(best.iv * 100).toFixed(1)}%`);
          }
          cell.title = tooltip.join('\n');
        } else {
          cell.title = `${entry.exp} ${COLUMN_LABELS[bucket]}\nVol ${formatNumber(volume)} | OI ${formatNumber(oi)}`;
        }
        cell.innerHTML = `<strong>${formatNumber(volume)}</strong><small>OI ${formatNumber(oi)}</small>`;
        tr.append(cell);
      });
      body.append(tr);
    });
  }

  function renderTotals(totals: ExpiryTotals[]) {
    totalsStrip.innerHTML = '';
    if (totals.length === 0) {
      const span = document.createElement('span');
      span.textContent = 'Totals unavailable';
      totalsStrip.append(span);
      return;
    }
    totals
      .slice(0, 4)
      .forEach((total) => {
        const item = document.createElement('div');
        item.className = 'totals-item';
        const heading = document.createElement('strong');
        heading.textContent = total.exp;
        const calls = document.createElement('span');
        calls.textContent = `C Vol ${formatNumber(total.callVolume)} | OI ${formatNumber(total.callOpenInterest)}`;
        const puts = document.createElement('span');
        puts.textContent = `P Vol ${formatNumber(total.putVolume)} | OI ${formatNumber(total.putOpenInterest)}`;
        item.append(heading, calls, puts);
        totalsStrip.append(item);
      });
  }

  function renderUnusual(rows: UnusualContractRow[]) {
    unusualBody.innerHTML = '';
    if (rows.length === 0) {
      const empty = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 7;
      cell.textContent = 'No unusual activity detected';
      empty.append(cell);
      unusualBody.append(empty);
      return;
    }
    rows.slice(0, 10).forEach((entry) => {
      const tr = document.createElement('tr');
      const { row } = entry;
      const contractCell = document.createElement('td');
      contractCell.textContent = entry.contractId;
      const strikeCell = document.createElement('td');
      strikeCell.textContent = row.strike.toFixed(2);
      const typeCell = document.createElement('td');
      typeCell.textContent = row.type;
      const volCell = document.createElement('td');
      volCell.textContent = formatNumber(row.volume);
      const oiCell = document.createElement('td');
      const oiText = entry.deltaOpenInterest != null
        ? `${formatNumber(row.openInterest)} (${formatSigned(entry.deltaOpenInterest)})`
        : formatNumber(row.openInterest);
      oiCell.textContent = oiText;
      const ivCell = document.createElement('td');
      ivCell.textContent = row.iv != null ? `${(row.iv * 100).toFixed(1)}%` : '—';
      const flagsCell = document.createElement('td');
      flagsCell.textContent = entry.flags.join(', ');
      tr.append(contractCell, strikeCell, typeCell, volCell, oiCell, ivCell, flagsCell);
      unusualBody.append(tr);
    });
  }

  return {
    element: container,
    setSource,
    renderHeatmap,
    renderTotals,
    renderUnusual,
  };
}

function formatNumber(value: number | undefined): string {
  if (value == null || Number.isNaN(value)) {
    return '—';
  }
  if (Math.abs(value) >= 1000) {
    return `${(value / 1000).toFixed(1)}k`;
  }
  return value.toFixed(0);
}

function formatSigned(value: number): string {
  const formatted = value.toFixed(0);
  return value >= 0 ? `+${formatted}` : formatted;
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
