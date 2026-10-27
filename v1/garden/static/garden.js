// Garden display app: data refresh, frame loop, style GUI and touch.
// The skeleton lives in garden-model.js and the looks in garden-styles.js.

const view = document.querySelector('#window');
const canvas = document.querySelector('#garden');
const ctx = canvas.getContext('2d');
const params = new URLSearchParams(location.search);
const gui = document.querySelector('#gui');

const DEFAULTS = Object.freeze({
  style: 'ink', wind: 1, labels: true,
  layers: 8, opacity: 8, warp: 6, boil: 4,
  spacing: 1, glow: 4, grain: 0.16,
});

function loadSettings() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem('garden.settings') || '{}');
  } catch {
    saved = {};
  }
  const style = params.get('style');
  const result = { ...DEFAULTS, ...saved, ...(STYLES[style] ? { style } : {}) };
  return STYLES[result.style] ? result : { ...result, style: DEFAULTS.style };
}

let settings = loadSettings();
let model = build({ days: [], memory: [] }, new Set());
let focus = null; // null, { day }, or { memory }
let lastInput = 0;
let lastRender = -1;
let dirty = true;
let rimHits = [];
const time0 = performance.now();
const clock = () => (performance.now() - time0) / 1000;

function saveSettings() {
  try {
    localStorage.setItem('garden.settings', JSON.stringify(settings));
  } catch {
    // settings simply won't persist
  }
}

// ---------- render ----------

function paint(target, now) {
  const style = STYLES[settings.style];
  const c = target.getContext('2d');
  c.save();
  c.setTransform(target.width / W, 0, 0, target.height / W, 0, 0);
  c.clearRect(0, 0, W, W);
  c.beginPath();
  c.arc(W / 2, W / 2, W / 2, 0, Math.PI * 2);
  c.clip();
  style.background(c, model, now);
  layout(model, now, settings.wind);
  const boil = Math.floor(now * settings.boil);
  style.draw(c, collect(model, now, focus), settings, boil, model);
  if (settings.labels && style.labels !== false) drawLabels(c, model, focus, style.text);
  style.window(c, model, now);
  rimHits = drawRim(c, model, focus, style.text);
  drawCaption(c, model, focus, style.text);
  c.restore();
}

function frame() {
  const now = clock();
  if (focus && now - lastInput > 25) {
    focus = null;
    dirty = true;
  }
  const style = STYLES[settings.style];
  const growing = now - model.buildAt < 12;
  // paper is redrawn at its boil rate, like hand-drawn animation
  const interval = style.fps ? 1 / (growing ? Math.max(settings.boil, 12) : settings.boil) : 0;
  if (dirty || now - lastRender >= interval) {
    dirty = false;
    lastRender = now;
    model.grain = settings.grain;
    paint(canvas, now);
  }
  requestAnimationFrame(frame);
}

function showStyle() {
  gui.querySelectorAll('fieldset[data-style]').forEach((set) => { set.hidden = set.dataset.style !== settings.style; });
  dirty = true;
}

// ---------- data ----------

let signature = '';

async function refresh() {
  let data;
  try {
    const response = await fetch(`/api/garden${params.has('demo') ? '?demo' : ''}`, { cache: 'no-store' });
    data = await response.json();
  } catch {
    return;
  }
  data.days.forEach((day) => {
    if (Array.isArray(day.turns)) {
      day.turns_detail = day.turns;
      day.turns = day.turns.length;
    }
  });
  const next = JSON.stringify(data);
  if (next === signature) return;
  const keys = new Set(signature ? model.branches.map((branch) => branch.key) : []);
  signature = next;
  regrow(data, keys);
}

function regrow(data, keys) {
  model = build(data, keys);
  model.buildAt = clock();
  focus = null;
  dirty = true;
}

// ---------- size and input ----------

function resize() {
  const size = Math.min(innerWidth, innerHeight);
  const pixels = Math.round(size * Math.min(devicePixelRatio || 1, 2));
  view.style.width = view.style.height = `${size}px`;
  canvas.width = canvas.height = pixels;
  dirty = true;
}

function touched() {
  lastInput = clock();
  dirty = true;
}

function step(delta) {
  const count = model.days.length;
  if (!count) return;
  focus = { day: clamp((focus?.day ?? count - 1) + delta, 0, count - 1) };
  touched();
}

function toGarden(event) {
  const rect = view.getBoundingClientRect();
  return { x: (event.clientX - rect.left) / rect.width * W, y: (event.clientY - rect.top) / rect.height * W };
}

function tap(point) {
  const rim = rimHits.find((hit) => point.x >= hit.x && point.x <= hit.x + hit.w && point.y >= hit.y && point.y <= hit.y + hit.h);
  if (rim) {
    focus = focus?.memory === rim.key ? null : { memory: rim.key };
    touched();
    return;
  }
  let best = null;
  let distance = 36;
  for (const b of model.branches) {
    if (b.kind === 'stem') continue;
    for (let i = 0; i <= b.n; i += 2) {
      const d = Math.hypot(b.px[i] - point.x, b.py[i] - point.y);
      if (d < distance) { best = b; distance = d; }
    }
  }
  focus = best && best.day >= 0 ? { day: best.day } : null;
  touched();
}

let drag = null;
view.addEventListener('pointerdown', (event) => {
  drag = { y: event.clientY, start: toGarden(event), moved: 0 };
  view.setPointerCapture(event.pointerId);
});
view.addEventListener('pointermove', (event) => {
  if (!drag) return;
  const delta = event.clientY - drag.y;
  if (Math.abs(delta) > 26) {
    step(delta > 0 ? -1 : 1);
    drag.y = event.clientY;
    drag.moved += 1;
  }
});
view.addEventListener('pointerup', () => {
  if (drag && !drag.moved) tap(drag.start);
  drag = null;
});
view.addEventListener('wheel', (event) => step(event.deltaY > 0 ? -1 : 1), { passive: true });
addEventListener('keydown', (event) => {
  if (event.target.closest?.('#gui')) return;
  if (event.key === 'ArrowDown') step(-1);
  if (event.key === 'ArrowUp') step(1);
  if (event.key === 'Escape') { focus = null; dirty = true; }
  if (event.key === 'g') toggleGui();
});
addEventListener('resize', resize);

// ---------- GUI ----------

function syncGui() {
  for (const input of gui.querySelectorAll('input')) {
    if (input.type === 'radio') input.checked = input.value === settings.style;
    else if (input.type === 'checkbox') input.checked = settings[input.name];
    else input.value = settings[input.name];
    const output = input.parentElement.querySelector('output');
    if (output) output.textContent = input.value;
  }
}

function toggleGui() {
  gui.hidden = !gui.hidden;
  document.querySelector('#gui-toggle').setAttribute('aria-expanded', String(!gui.hidden));
}

gui.addEventListener('input', (event) => {
  const input = event.target;
  const value = input.type === 'checkbox' ? input.checked : input.type === 'radio' ? input.value : Number(input.value);
  settings = { ...settings, [input.name]: value };
  saveSettings();
  syncGui();
  if (input.name === 'style') showStyle();
  dirty = true;
});
document.querySelector('#gui-toggle').addEventListener('click', toggleGui);
document.querySelector('#regrow').addEventListener('click', () => regrow(JSON.parse(signature || '{"days":[],"memory":[]}'), new Set()));
document.querySelector('#reset').addEventListener('click', () => {
  settings = { ...DEFAULTS, style: settings.style };
  saveSettings();
  syncGui();
  dirty = true;
});

resize();
syncGui();
showStyle();
refresh();
setInterval(refresh, 8000);
requestAnimationFrame(frame);
