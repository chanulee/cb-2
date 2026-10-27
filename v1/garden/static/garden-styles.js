// Garden styles: each one paints the same shape list from garden-model.js.
// - ink: the original look, a dark out-of-focus garden behind glass
// - paper: watercolour by warping and stacking low-opacity layers (Tyler
//   Hobbs' technique, the idea behind p5.brush's fills) with a graphite line;
//   older, compressed days lose their washes and remain only as pencil
// - signal: phosphor shapes, then a WebGL pass (lens, glow, dither, scanlines)

function trace(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}

function hsla([h, s, l], a) {
  return `hsla(${h}, ${s}%, ${l}%, ${a})`;
}

function tone(item, sat, light) {
  const a = abstraction(item.age);
  const hue = item.hue ?? STEM_HUE;
  return [lerp(hue, 200, a * 0.55), lerp(hue === STEM_HUE ? sat * 0.75 : sat, 14, a), lerp(light, light + 12, a)];
}

function offscreen(size, draw) {
  const layer = document.createElement('canvas');
  layer.width = layer.height = size;
  draw(layer.getContext('2d'), layer);
  return layer;
}

function noiseLayer(size, alphaFor) {
  return offscreen(size, (c) => {
    const image = c.createImageData(size, size);
    for (let i = 0; i < image.data.length; i += 4) {
      const [v, a] = alphaFor(Math.random(), i / 4 % size, Math.floor(i / 4 / size));
      image.data[i] = image.data[i + 1] = image.data[i + 2] = v;
      image.data[i + 3] = a;
    }
    c.putImageData(image, 0, 0);
  });
}

// ---------- ink ----------

const grain = noiseLayer(256, (r) => [r * 255, 255]);

const grass = offscreen(500, (c) => {
  const rand = random('grass');
  c.scale(0.5, 0.5);
  c.filter = 'blur(9px)';
  for (let i = 0; i < 36; i += 1) {
    const x = rand() * W;
    const h = 120 + rand() * 260;
    c.strokeStyle = `hsla(${70 + rand() * 30}, 30%, ${12 + rand() * 18}%, .85)`;
    c.lineWidth = 6 + rand() * 12;
    c.beginPath();
    c.moveTo(x, W + 20);
    c.quadraticCurveTo(x + (rand() - 0.5) * 80, W - h * 0.5, x + (rand() - 0.5) * 160, W - h);
    c.stroke();
  }
});

const BLOBS = [[0.18, 0.25, 0.5, 0], [0.82, 0.2, 0.42, 40], [0.75, 0.75, 0.5, -10], [0.2, 0.85, 0.45, -25], [0.5, 0.45, 0.35, 20], [0.95, 0.5, 0.3, 60]];

// Background light follows today's mood: valence warms or cools, energy brightens.
function moodBlobs(ctx, mood, now, hueShift, lightShift, satScale) {
  const valence = mood?.valence ?? 0;
  const energy = mood?.energy ?? 0.4;
  BLOBS.forEach(([x, y, r, offset], i) => {
    const cx = (x + Math.sin(now * 0.03 + i * 1.7) * 0.04) * W;
    const cy = (y + Math.cos(now * 0.025 + i) * 0.04) * W;
    const color = [70 - valence * 25 + offset + hueShift, lerp(20, 42, (valence + 1) / 2) * satScale, lerp(14, 38, energy) + (i === 3 ? 14 : 0) + lightShift];
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * W);
    gradient.addColorStop(0, hsla(color, 0.8));
    gradient.addColorStop(1, hsla(color, 0));
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, W, W);
  });
}

function gradientFill(ctx, axis, stops, alpha) {
  const gradient = ctx.createLinearGradient(...axis);
  stops.forEach(([at, color]) => gradient.addColorStop(at, hsla(color, alpha)));
  return gradient;
}

const ink = {
  text: { main: [52, 55, 88], sub: [52, 25, 82], serif: '"Iowan Old Style", Georgia, serif', mono: 'ui-monospace, Menlo, monospace', memory: 74 },
  background(ctx, model, now) {
    ctx.fillStyle = '#161d17';
    ctx.fillRect(0, 0, W, W);
    moodBlobs(ctx, model.mood, now, 0, 0, 1);
  },
  draw(ctx, items) {
    for (const item of items) {
      const a = abstraction(item.age ?? 0);
      if (item.kind === 'ribbon') {
        trace(ctx, item.pts);
        ctx.fillStyle = hsla(tone(item, 55, 60), item.alpha * lerp(0.95, 0.5, a));
        ctx.fill();
      } else if (item.kind === 'leaf') {
        trace(ctx, item.pts);
        ctx.fillStyle = gradientFill(ctx, item.axis, [[0, [92 + item.age * 10, 45, 36]], [1, [78 + item.age * 10, 60, 62]]], item.alpha * lerp(0.9, 0.5, a));
        ctx.fill();
      } else if (item.kind === 'petal') {
        const [h, s, l] = item.color;
        trace(ctx, item.pts);
        ctx.fillStyle = gradientFill(ctx, item.axis, [[0, [h - 12, s, l - 30]], [0.55, [h, s, l - 6]], [1, [h + 8, s - 10, l + 10]]], item.alpha * 0.95);
        ctx.fill();
        ctx.strokeStyle = hsla([h - 20, s, l - 35], item.alpha * 0.25);
        ctx.lineWidth = 0.6;
        ctx.stroke();
      } else if (item.kind === 'dot') {
        ctx.fillStyle = hsla(item.color || tone(item, 55, 62), item.alpha * lerp(0.85, 0.5, a));
        ctx.beginPath();
        ctx.arc(item.x, item.y, item.r, 0, Math.PI * 2);
        ctx.fill();
      } else if (item.kind === 'dust') {
        ctx.strokeStyle = hsla(tone(item, 30, 70), item.alpha * 0.4);
        ctx.fillStyle = hsla(tone(item, 30, 72), item.alpha * 0.6);
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        item.links.forEach(([x0, y0, x1, y1]) => { ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); });
        ctx.stroke();
        item.links.forEach(([x0, y0]) => ctx.fillRect(x0 - 0.8, y0 - 0.8, 1.6, 1.6));
      }
    }
  },
  window(ctx, model, now) {
    ctx.drawImage(grass, 0, 0, W, W);
    ctx.save();
    ctx.globalAlpha = 0.07;
    ctx.globalCompositeOperation = 'overlay';
    ctx.translate((now * 37) % 256 - 256, (now * 53) % 256 - 256);
    ctx.fillStyle = ctx.createPattern(grain, 'repeat');
    ctx.fillRect(0, 0, W + 512, W + 512);
    ctx.restore();
    vignette(ctx, 'rgba(0,0,0,.35)', 'rgba(0,0,0,.9)');
  },
};

function vignette(ctx, mid, edge) {
  const gradient = ctx.createRadialGradient(W / 2, W / 2, W * 0.32, W / 2, W / 2, W / 2);
  gradient.addColorStop(0, 'rgba(0,0,0,0)');
  gradient.addColorStop(0.85, mid);
  gradient.addColorStop(1, edge);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, W, W);
}

// ---------- paper: warped and stacked ----------

const paperGrain = noiseLayer(256, (r, x, y) => {
  const fibre = Math.sin(x * 0.9 + Math.sin(y * 0.13) * 6) * 0.5 + 0.5;
  return [lerp(150, 255, r * 0.7 + fibre * 0.3), 255];
});

function warp(pts, seed, layer, amount, boil) {
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const spread = 1 + (layer % 3) * 0.04;
  return pts.map(([x, y], i) => [
    cx + (x - cx) * spread + noise1(seed + layer * 13.1, i * 0.45 + boil) * amount,
    cy + (y - cy) * spread + noise1(seed + layer * 7.7 + 50, i * 0.45 + boil) * amount,
  ]);
}

function pencil(ctx, pts, seed, boil, alpha, closed = true) {
  ctx.strokeStyle = `rgba(48, 44, 40, ${alpha})`;
  ctx.lineWidth = 0.8;
  for (let pass = 0; pass < 2; pass += 1) {
    ctx.beginPath();
    pts.forEach(([x, y], i) => {
      const jx = noise1(seed + pass * 31, i * 0.9 + boil * 3) * 0.9;
      const jy = noise1(seed + pass * 17 + 9, i * 0.9 + boil * 3) * 0.9;
      if (i) ctx.lineTo(x + jx, y + jy); else ctx.moveTo(x + jx, y + jy);
    });
    if (closed) ctx.closePath();
    ctx.stroke();
  }
}

function pigment(item) {
  if (item.kind === 'petal' || item.color) {
    const [h, s, l] = item.color;
    return [h, s * 0.9, Math.min(l, 76)];
  }
  if (item.kind === 'leaf') return [88, 34, 52];
  return tone(item, 40, 52);
}

// Big pigment washes under the drawing: a halo of today's bloom colour and a
// ground, painted with the same warp-and-stack as everything else.
function paperWashes(ctx, model, settings, boil) {
  const flower = model.flowers.find((f) => f.main);
  const b = model.stem;
  if (!flower || b.g < 0.5) return;
  const grow = b.g;
  const [h, s] = flower.hue;
  const washes = [
    [circle(b.px[b.n], b.py[b.n] + 10, 150 * Math.max(grow, 0.2), 40), [h, s * 0.6, 80], 1],
    [circle(W / 2, model.root.y + 240, 300, 60), [80, 18, 78], 0.8],
  ];
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  washes.forEach(([pts, color, strength], index) => {
    ctx.fillStyle = hsla(color, settings.opacity / 100 * strength);
    for (let layer = 0; layer < settings.layers; layer += 1) {
      trace(ctx, warp(pts, index * 11 + 3, layer, settings.warp * 2.5, boil * 0.3));
      ctx.fill();
    }
  });
  ctx.restore();
}

const paper = {
  fps: true,
  text: { main: [30, 10, 22], sub: [30, 8, 34], serif: '"Iowan Old Style", Georgia, serif', mono: 'ui-monospace, Menlo, monospace', memory: 38, dark: true },
  background(ctx) {
    ctx.fillStyle = '#efe8dc';
    ctx.fillRect(0, 0, W, W);
  },
  draw(ctx, items, settings, boil, model) {
    paperWashes(ctx, model, settings, boil);
    const layers = settings.layers;
    const opacity = settings.opacity / 100;
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    for (const item of items) {
      if (item.kind === 'dust') continue;
      const wash = 1 - abstraction(item.age ?? 0);
      const count = Math.round(layers * wash);
      if (!count) continue;
      const color = pigment(item);
      const seed = hash1(typeof item.key === 'number' ? item.key : hash(String(item.key)) % 9973) * 100;
      const base = item.kind === 'dot' ? circle(item.x, item.y, item.r * 2.2) : item.pts;
      const amount = settings.warp * (item.kind === 'ribbon' ? 0.35 + item.w * 0.05 : item.kind === 'dot' ? 0.3 : 0.6);
      ctx.fillStyle = hsla(color, opacity * item.alpha);
      for (let layer = 0; layer < count; layer += 1) {
        trace(ctx, warp(base, seed, layer, amount, boil * 0.6));
        ctx.fill();
      }
    }
    ctx.restore();
    for (const item of items) {
      const seed = hash1(typeof item.key === 'number' ? item.key : hash(String(item.key)) % 9973) * 100;
      const a = abstraction(item.age ?? 0);
      const line = item.alpha * lerp(0.42, 0.62, a);
      if (item.kind === 'dust') {
        ctx.strokeStyle = `rgba(48, 44, 40, ${item.alpha * 0.4})`;
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        item.links.forEach(([x0, y0, x1, y1]) => { ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); });
        ctx.stroke();
      } else if (item.kind === 'dot') {
        pencil(ctx, circle(item.x, item.y, item.r), seed, boil, line * 0.7);
      } else if (item.kind === 'ribbon' && item.w < 2.2) {
        pencil(ctx, item.pts.slice(0, Math.ceil(item.pts.length / 2)), seed, boil, line, false);
      } else {
        pencil(ctx, item.pts, seed, boil, item.kind === 'petal' ? line * 0.55 : line);
      }
    }
  },
  window(ctx) {
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = ctx.createPattern(paperGrain, 'repeat');
    ctx.fillRect(0, 0, W, W);
    ctx.restore();
    const gradient = ctx.createRadialGradient(W / 2, W / 2, W * 0.38, W / 2, W / 2, W / 2);
    gradient.addColorStop(0, 'rgba(120,100,80,0)');
    gradient.addColorStop(1, 'rgba(120,100,80,.28)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, W, W);
    pencil(ctx, circle(W / 2, W / 2, W / 2 - 6, 160), 3, 0, 0.35);
  },
};

function circle(x, y, r, n = 14) {
  return Array.from({ length: n }, (_, i) => [x + Math.cos(i / n * Math.PI * 2) * r, y + Math.sin(i / n * Math.PI * 2) * r]);
}

// ---------- signal: phosphor shapes for the shader ----------

const signal = {
  shader: true,
  text: { main: [140, 70, 72], sub: [140, 40, 58], serif: 'ui-monospace, Menlo, monospace', mono: 'ui-monospace, Menlo, monospace', memory: 66, upper: true },
  background(ctx) {
    ctx.fillStyle = '#030605';
    ctx.fillRect(0, 0, W, W);
    ctx.strokeStyle = 'rgba(80, 200, 140, .09)';
    ctx.lineWidth = 1;
    for (let r = 100; r < W / 2; r += 100) {
      ctx.beginPath();
      ctx.arc(W / 2, W / 2, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, W);
    ctx.moveTo(0, W / 2); ctx.lineTo(W, W / 2);
    ctx.stroke();
  },
  draw(ctx, items) {
    for (const item of items) {
      const a = abstraction(item.age ?? 0);
      const hue = item.color ? item.color[0] : (item.hue ?? 140) === STEM_HUE ? 140 : item.hue;
      const color = [hue, lerp(90, 30, a), lerp(62, 50, a)];
      const alpha = item.alpha * lerp(1, 0.55, a);
      ctx.lineWidth = 1.2;
      if (item.kind === 'ribbon') {
        trace(ctx, item.pts);
        ctx.fillStyle = hsla(color, alpha * 0.85);
        ctx.fill();
      } else if (item.kind === 'leaf' || item.kind === 'petal') {
        trace(ctx, item.pts);
        ctx.fillStyle = hsla(color, alpha * (item.kind === 'petal' ? 0.28 : 0.12));
        ctx.fill();
        ctx.strokeStyle = hsla([hue, 90, 70], alpha);
        ctx.stroke();
      } else if (item.kind === 'dot') {
        ctx.fillStyle = hsla([hue, 90, 70], alpha);
        ctx.fillRect(item.x - item.r, item.y - item.r, item.r * 2, item.r * 2);
      } else if (item.kind === 'dust') {
        ctx.fillStyle = hsla(color, alpha);
        item.links.forEach(([x0, y0]) => ctx.fillRect(x0 - 1, y0 - 1, 2, 2));
      }
    }
  },
  window() {},
};

const STYLES = { ink, paper, signal };

// ---------- shared text layer ----------

function textColor(theme, which, alpha) {
  return hsla(theme[which], alpha);
}

function font(theme, size, { italic = false, mono = false } = {}) {
  return `${italic && !theme.upper ? 'italic ' : ''}${size}px ${mono ? theme.mono : theme.serif}`;
}

const say = (theme, text) => (theme.upper ? text.toUpperCase() : text);

function labelVisible(model, focus, label) {
  const focusedDay = focus?.day === label.day;
  if (focus?.memory) return label.branch.mem.includes(focus.memory) && label.kind !== 'facet' && label.kind !== 'date';
  if (label.kind === 'today') return !focus || focusedDay;
  if (label.kind === 'date') return true;
  if (label.kind === 'facet') return focusedDay;
  return focusedDay || (!focus && label.kind === 'thread' && model.days[label.day].age <= 1);
}

function drawLabels(ctx, model, focus, theme) {
  ctx.textBaseline = 'middle';
  const dim = dimmer(focus);
  for (const label of model.labels) {
    const b = label.branch;
    if (b.g < 0.98 || !label.text || !labelVisible(model, focus, label)) continue;
    const alpha = dim(b);
    const x = b.px[b.n] + label.side * 8;
    const y = b.py[b.n];
    ctx.textAlign = label.side > 0 ? 'left' : 'right';
    if (label.kind === 'today') {
      ctx.font = font(theme, 21, { italic: true });
      ctx.fillStyle = textColor(theme, 'main', 0.95 * alpha);
      ctx.fillText(say(theme, label.text), x, y - 10);
    } else if (label.kind === 'facet') {
      ctx.font = font(theme, 13);
      ctx.fillStyle = textColor(theme, 'sub', 0.85 * alpha);
      ctx.fillText(say(theme, label.text), x, y);
    } else if (label.kind === 'date') {
      const p = b.parent;
      ctx.font = font(theme, 11, { mono: true });
      ctx.textAlign = label.side > 0 ? 'right' : 'left';
      ctx.fillStyle = textColor(theme, 'sub', 0.75 * alpha);
      ctx.fillText(label.text, p.px[b.attach] - label.side * 12, p.py[b.attach]);
    } else {
      ctx.font = font(theme, 14, { italic: label.kind === 'keywords' });
      ctx.fillStyle = textColor(theme, 'sub', 0.85 * alpha);
      ctx.fillText(say(theme, label.text), x, y + (label.kind === 'keywords' ? 34 : 0));
    }
  }
}

// Strongest memories sit on the rim of the window, like notes on a lens.
function drawRim(ctx, model, focus, theme) {
  const hits = [];
  const items = model.memory.slice(0, 7);
  const top = items[0]?.weight || 1;
  ctx.textBaseline = 'middle';
  items.forEach((item, index) => {
    const side = index % 2 ? 1 : -1;
    const angle = -Math.PI / 2 + side * (0.62 + Math.floor(index / 2) * 0.3);
    const x = W / 2 + Math.cos(angle) * W * 0.425;
    const y = W / 2 + Math.sin(angle) * W * 0.425;
    const strength = item.weight / top;
    const active = focus?.memory === item.key;
    const alpha = focus && !active ? 0.35 : lerp(0.6, 1, strength);
    const text = say(theme, item.label);
    ctx.font = font(theme, Math.round(lerp(13, 19, strength)));
    ctx.textAlign = side > 0 ? 'right' : 'left';
    ctx.fillStyle = hsla([model.hueOf[item.key], theme.dark ? 45 : 60, theme.memory + (active ? 8 : 0)], alpha);
    ctx.fillText(text, x, y);
    ctx.beginPath();
    ctx.arc(x + (side > 0 ? 9 : -9), y, lerp(2, 4, strength), 0, Math.PI * 2);
    ctx.fill();
    const width = ctx.measureText(text).width;
    hits.push({ key: item.key, x: side > 0 ? x - width : x - 16, y: y - 14, w: width + 16, h: 28 });
  });
  return hits;
}

function wrap(ctx, text, width) {
  const lines = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    if (line && ctx.measureText(`${line} ${word}`).width > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function dateText(day) {
  const label = new Date(`${day.date}T12:00:00`).toLocaleDateString('en', { month: 'short', day: 'numeric' });
  return day.age === 0 ? `today · ${label}` : `${label} · ${day.age}d ago · ${day.compression}`;
}

function dayText(model, day) {
  if (day.compression === 'raw') return `“${day.lines?.[day.lines.length - 1] || ''}”`;
  if (day.compression === 'summary') return day.summary || '';
  if (day.compression === 'gist') return day.gist || '';
  return [...new Set((day.threads || []).flatMap((thread) => thread.memory || []))]
    .map((key) => model.memory.find((item) => item.key === key)?.label || key).join(' · ');
}

function drawCaption(ctx, model, focus, theme) {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const sample = model.sample ? '  ·  SAMPLE' : '';
  const lines = (text, size, width, y, gap, max, which, alpha, italic) => {
    ctx.font = font(theme, size, { italic });
    ctx.fillStyle = textColor(theme, which, alpha);
    wrap(ctx, say(theme, text), width).slice(0, max).forEach((line, i) => ctx.fillText(line, W / 2, y + i * gap));
  };
  if (focus?.memory) {
    const item = model.memory.find((m) => m.key === focus.memory);
    lines(`${item.kind} · ${item.days.length} day${item.days.length === 1 ? '' : 's'}`.toUpperCase() + sample, 13, 600, 840, 0, 1, 'sub', 0.7);
    ctx.font = font(theme, 26, { italic: true });
    ctx.fillStyle = hsla([model.hueOf[item.key], 60, theme.memory + 4], 0.95);
    ctx.fillText(say(theme, item.label), W / 2, 874);
    lines(item.note || '', 16, 440, 902, 21, 2, 'sub', 0.8);
    return;
  }
  const day = model.days[focus?.day ?? model.todayIndex];
  if (!day) {
    lines('a bud, waiting for today’s pond', 22, 500, 870, 0, 1, 'main', 0.8, true);
    return;
  }
  lines(dateText(day).toUpperCase() + sample, 13, 600, 840, 0, 1, 'sub', 0.7);
  if (!focus) {
    lines(day.gist || `${day.turns} conversations`, 24, 520, 874, 28, 2, 'main', 0.92, true);
    const bloom = model.flowers.find((flower) => flower.main)?.memory;
    if (bloom) {
      ctx.font = font(theme, 14);
      ctx.fillStyle = hsla([model.hueOf[bloom.key], 55, theme.memory], 0.9);
      ctx.fillText(say(theme, `blooming from: ${bloom.label}`), W / 2, 936);
    }
    return;
  }
  lines(dayText(model, day), 16, 480, 870, 21, 4, 'main', lerp(0.92, 0.65, abstraction(day.age)), day.compression === 'keywords');
}

// ---------- signal post-process ----------

const SIGNAL_SHADER = `
precision mediump float;
uniform sampler2D scene;
uniform vec2 resolution;
uniform float time, pixel, levels, glow, aberration, scanlines;
varying vec2 uv;

float bayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }

vec3 sample(vec2 p, vec2 c) {
  vec2 shift = c * aberration * 0.006;
  return vec3(texture2D(scene, p + shift).r, texture2D(scene, p).g, texture2D(scene, p - shift).b);
}

void main() {
  vec2 c = uv - 0.5;
  vec2 p = 0.5 + c * (1.0 - 0.05 * dot(c, c));            // round lens
  vec2 cell = pixel / resolution;
  p = (floor(p / cell) + 0.5) * cell;                     // pixel grid
  vec3 color = sample(p, c);
  vec3 halo = vec3(0.0);
  for (int i = 0; i < 12; i++) {                          // cheap glow
    float a = float(i) * 0.5236;
    float r = (mod(float(i), 3.0) + 1.0) * 0.006;
    halo += texture2D(scene, p + vec2(cos(a), sin(a)) * r).rgb;
  }
  color += halo / 12.0 * glow;
  vec2 dither = gl_FragCoord.xy / pixel;
  color = floor(color * levels + bayer4(dither)) / levels; // ordered dither
  float line = 0.5 + 0.5 * sin(gl_FragCoord.y / pixel * 3.14159);
  color *= 1.0 - scanlines * 0.35 * line;
  color *= 0.94 + 0.06 * sin(time * 1.7 + uv.y * 40.0);
  color *= smoothstep(0.5, 0.42, length(c));
  gl_FragColor = vec4(color, 1.0);
}`;

function signalPass(gl) {
  const compile = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
    return shader;
  };
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, 'attribute vec2 p; varying vec2 uv; void main() { uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }'));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, SIGNAL_SHADER));
  gl.linkProgram(program);
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, 'p');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const at = (name) => gl.getUniformLocation(program, name);
  const uniforms = ['resolution', 'time', 'pixel', 'levels', 'glow', 'aberration', 'scanlines'].reduce((all, name) => ({ ...all, [name]: at(name) }), {});
  return (source, now, settings) => {
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.uniform2f(uniforms.resolution, gl.canvas.width, gl.canvas.height);
    gl.uniform1f(uniforms.time, now);
    gl.uniform1f(uniforms.pixel, settings.pixel * gl.canvas.width / W);
    gl.uniform1f(uniforms.levels, settings.levels);
    gl.uniform1f(uniforms.glow, settings.glow);
    gl.uniform1f(uniforms.aberration, settings.aberration);
    gl.uniform1f(uniforms.scanlines, settings.scanlines);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };
}
