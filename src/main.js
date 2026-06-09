import './style.css';
import cityData from '../data.json';
import { Globe }       from './globe.js';
import { scrambleOut, sleep } from './scramble.js';

// ─── Globe ────────────────────────────────────────────────────────────────────
const canvas = document.getElementById('globe-canvas');

const globe = new Globe(canvas, {
  onCitySelect: showPanel,
  onDeselect:   hidePanel,
});

globe.addMarkers(cityData);

// ─── City list (2-column grid) ────────────────────────────────────────────────
const cityListEl = document.getElementById('city-list');

cityData.forEach(city => {
  const li = document.createElement('li');
  li.dataset.city = city.city;
  li.className = [
    'flex items-center gap-1.5 px-2 py-1.5 rounded-lg cursor-pointer',
    'transition-colors duration-150 hover:bg-white/[0.06] group',
  ].join(' ');
  li.innerHTML = `
    <span class="w-1.5 h-1.5 rounded-full flex-shrink-0"
          style="background:${city.statusColor};box-shadow:0 0 4px ${city.statusColor}88"></span>
    <span class="text-slate-400 text-[11px] group-hover:text-white transition-colors flex-1 truncate">
      ${city.city}
    </span>
    <span class="text-[10px] font-bold tabular-nums flex-shrink-0"
          style="color:${city.statusColor}">${city.metrics.primaryStat}</span>
  `;
  li.addEventListener('click', () => globe.selectCity(city));
  cityListEl.appendChild(li);
});

function setActiveListItem(city) {
  cityListEl.querySelectorAll('li').forEach(li => {
    li.classList.toggle('bg-white/[0.08]', li.dataset.city === city.city);
  });
}

function clearActiveListItem() {
  cityListEl.querySelectorAll('li').forEach(li => li.classList.remove('bg-white/[0.08]'));
}

// ─── Detail panel ─────────────────────────────────────────────────────────────
const detailPanel = document.getElementById('detail-panel');
const PANEL_W = 272;
const PANEL_H = 330;

document.getElementById('panel-close').addEventListener('click', () => globe.deselect());

function positionNearDot(screenPos) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Mobile: full-width card pinned near top — CSS handles the exact position
  if (vw < 640) {
    detailPanel.style.left   = '12px';
    detailPanel.style.right  = '12px';
    detailPanel.style.width  = 'auto';
    detailPanel.style.top    = '16px';
    return;
  }

  // Tablet / desktop: float near the dot
  detailPanel.style.right = 'auto';
  detailPanel.style.width = `${PANEL_W}px`;
  if (!screenPos) return;

  const margin = 18;
  let x = screenPos.x + margin;
  if (x + PANEL_W > vw - 16) x = screenPos.x - PANEL_W - margin;
  x = Math.max(12, x);

  let y = screenPos.y - PANEL_H / 2;
  y = Math.max(12, Math.min(y, vh - PANEL_H - 12));

  detailPanel.style.left = `${x}px`;
  detailPanel.style.top  = `${y}px`;
}

function showPanel(city, screenPos) {
  document.getElementById('panel-city').textContent          = city.city;
  document.getElementById('panel-country').textContent       = city.country;
  document.getElementById('panel-primary-stat').textContent  = city.metrics.primaryStat;
  document.getElementById('panel-primary-label').textContent = city.metrics.primaryLabel;
  document.getElementById('panel-detail1').textContent       = city.metrics.detail1;
  document.getElementById('panel-label1').textContent        = city.metrics.label1;
  document.getElementById('panel-detail2').textContent       = city.metrics.detail2;
  document.getElementById('panel-label2').textContent        = city.metrics.label2;

  const badge = document.getElementById('panel-status');
  badge.textContent           = city.status;
  badge.style.color           = city.statusColor;
  badge.style.borderColor     = city.statusColor + '55';
  badge.style.backgroundColor = city.statusColor + '1a';

  document.getElementById('panel-connections').innerHTML = city.connections
    .map(name => `
      <span class="px-2 py-0.5 rounded text-[10px] font-medium"
            style="background:${city.statusColor}1a;color:${city.statusColor};border:1px solid ${city.statusColor}44">
        ${name}
      </span>`)
    .join('');

  positionNearDot(screenPos);
  detailPanel.classList.remove('panel-hidden');
  detailPanel.classList.add('panel-visible');
  setActiveListItem(city);
}

function hidePanel() {
  detailPanel.classList.remove('panel-visible');
  detailPanel.classList.add('panel-hidden');
  clearActiveListItem();
}

// ─── Hero dismiss sequence ────────────────────────────────────────────────────
document.getElementById('hero-cta').addEventListener('click', async () => {
  const cta      = document.getElementById('hero-cta');
  const desc     = document.getElementById('hero-desc');
  const h1       = document.getElementById('hero-h1');
  const eyebrow  = document.getElementById('hero-eyebrow');
  const overlay  = document.getElementById('hero-overlay');
  const bottom   = document.getElementById('bottom-panel');

  cta.style.pointerEvents = 'none';

  // 1 — scramble the button text, then collapse the button
  await scrambleOut(cta, 350);
  Object.assign(cta.style, { transition: 'opacity 0.2s, transform 0.25s', opacity: '0', transform: 'scale(0.8)' });

  await sleep(120);

  // 2 — staggered scramble of copy (desc → h1 → eyebrow, slightly overlapping)
  const d = scrambleOut(desc,    750);
  await sleep(90);
  const h = scrambleOut(h1,      650);
  await sleep(90);
  const e = scrambleOut(eyebrow, 380);
  await Promise.all([d, h, e]);

  // 3 — fade out the overlay shell
  Object.assign(overlay.style, { transition: 'opacity 0.45s ease', opacity: '0', pointerEvents: 'none' });

  // 4 — fade in the bottom panel (slight delay so it doesn't compete with overlay fade)
  await sleep(120);
  Object.assign(bottom.style, { transition: 'opacity 0.65s ease', opacity: '1', pointerEvents: 'auto' });

  await sleep(500);
  overlay.remove();
});

// ─── Info overlay toggle ──────────────────────────────────────────────────────
const infoBtn     = document.getElementById('info-btn');
const infoOverlay = document.getElementById('info-overlay');

infoBtn.addEventListener('click', e => {
  e.stopPropagation();
  infoOverlay.classList.toggle('info-visible');
});

document.getElementById('info-close').addEventListener('click', e => {
  e.stopPropagation();
  infoOverlay.classList.remove('info-visible');
});

// Close on any outside click
document.addEventListener('click', () => infoOverlay.classList.remove('info-visible'));

window._globe = globe;
