// Garden styles: each one paints the same shape list from garden-model.js.
// - ink: the original look, a dark out-of-focus garden behind glass
// - paper: watercolour by warping and stacking low-opacity layers (Tyler
//   Hobbs' technique, the idea behind p5.brush's fills) with a graphite line;
//   older, compressed days lose their washes and remain only as pencil
// - words: the plant written in its own conversation, behind grainy glass

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

// ---------- words: the plant written in its own conversation ----------

// Each day speaks with the words it still has: today its full answers,
// yesterday its summary, then its gist, then only its memory keywords.
function vocabulary(model, index) {
  model.vocabulary ??= {};
  if (model.vocabulary[index]) return model.vocabulary[index];
  const day = model.days[index];
  let text = '';
  if (day) {
    const memory = (day.threads || []).flatMap((thread) => thread.memory || [])
      .map((key) => model.memory.find((item) => item.key === key)?.label || key);
    if (day.compression === 'raw') text = (day.lines || []).join(' ');
    else if (day.compression === 'summary') text = day.summary || '';
    else if (day.compression === 'gist') text = day.gist || '';
    else text = memory.join(' ');
    text += ` ${(day.threads || []).map((thread) => thread.topic).join(' ')}`;
  }
  const list = text.toLowerCase().replace(/[^a-z가-힣' ]/g, ' ').split(/\s+/).filter((word) => word.length > 2 && !['and', 'the', 'like', 'that', 'was', 'just', 'kind', 'okay', 'really'].includes(word));
  model.vocabulary[index] = list.length ? list : ['bloom'];
  return model.vocabulary[index];
}

const widths = new Map();
function measure(ctx, word, size) {
  const key = `${size}|${word}`;
  if (!widths.has(key)) {
    ctx.font = `${size}px "Iowan Old Style", Georgia, serif`;
    widths.set(key, ctx.measureText(word).width);
  }
  return widths.get(key);
}

function spine(pts) {
  const half = pts.length / 2;
  return Array.from({ length: half }, (_, i) => {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[pts.length - 1 - i];
    return [(ax + bx) / 2, (ay + by) / 2, Math.hypot(ax - bx, ay - by)];
  });
}

// soft out-of-focus light, rendered once per mood and drifted each frame
let bokeh = null;
function bokehLayer(mood) {
  const key = JSON.stringify(mood || {});
  if (bokeh?.key === key) return bokeh.layer;
  const layer = offscreen(400, (c) => {
    c.scale(400 / W, 400 / W);
    c.fillStyle = '#2c3324';
    c.fillRect(0, 0, W, W);
    c.filter = 'blur(60px)';
    moodBlobs(c, mood, 0, 6, 16, 1.2);
    const valence = mood?.valence ?? 0;
    [[0.25, 0.3, 0.3, [58, 55, 70]], [0.8, 0.85, 0.28, [52, 45, 62]], [0.7, 0.15, 0.25, [140, 25, 18]]].forEach(([x, y, r, color]) => {
      const gradient = c.createRadialGradient(x * W, y * W, 0, x * W, y * W, r * W);
      gradient.addColorStop(0, hsla([color[0] - valence * 15, color[1], color[2]], 0.75));
      gradient.addColorStop(1, hsla(color, 0));
      c.fillStyle = gradient;
      c.fillRect(0, 0, W, W);
    });
  });
  bokeh = { key, layer };
  return layer;
}

const fineGrain = noiseLayer(256, (r) => [r * 255, 255]);

const words = {
  labels: false,
  text: { main: [55, 55, 86], sub: [55, 35, 80], serif: '"Iowan Old Style", Georgia, serif', mono: 'ui-monospace, Menlo, monospace', memory: 78 },
  background(ctx, model, now) {
    const drift = Math.sin(now * 0.05) * 30;
    ctx.drawImage(bokehLayer(model.mood), -40 + drift, -40 - drift * 0.6, W + 80, W + 80);
  },
  draw(ctx, items, settings, boil, model) {
    const spacing = settings.spacing;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(255, 248, 200, .35)';
    ctx.shadowBlur = settings.glow;
    const ink = (item, strength = 1) => {
      const a = abstraction(item.age ?? 0);
      const hue = item.color ? item.color[0] : item.hue === STEM_HUE || item.hue === undefined ? 58 : item.hue;
      const sat = item.hue === STEM_HUE || item.hue === undefined ? 50 : 40;
      return hsla([lerp(hue, 58, 0.55), lerp(sat, 15, a), lerp(84, 78, a)], item.alpha * lerp(0.95, 0.5, a) * strength);
    };
    for (const item of items) {
      const vocab = vocabulary(model, item.day);
      const rand = random(String(item.key));
      const pick = () => vocab[Math.floor(rand() * vocab.length)];
      const age = abstraction(item.age ?? 0);
      if (item.kind === 'ribbon') {
        // stack words up the branch; thick parts carry several side by side
        const path = spine(item.pts);
        let carry = 0;
        for (let i = 1; i < path.length; i += 1) {
          const [x0, y0] = path[i - 1];
          const [x1, y1, width] = path[i];
          const length = Math.hypot(x1 - x0, y1 - y0);
          carry += length;
          const body = 6 + width * 6; // words need more room than a line does
          const size = Math.round(clamp(11 + width * 0.8 - age * 2, 10, 19));
          const word = pick();
          const w = measure(ctx, word, size);
          const along = Math.abs((x1 - x0) / (length || 1));
          const step = (along * w * 0.9 + (1 - along) * size * 0.8) * spacing;
          if (carry < step) continue;
          carry = 0;
          const across = Math.max(1, Math.round(body / (w * 0.9 + 4)));
          ctx.font = `${size}px "Iowan Old Style", Georgia, serif`;
          ctx.fillStyle = ink(item);
          for (let k = 0; k < across; k += 1) {
            const offset = (k - (across - 1) / 2) * w * 0.8;
            ctx.fillText(k ? pick() : word, x1 + offset + (rand() - 0.5) * 4, y1 + (rand() - 0.5) * 3);
          }
        }
      } else if (item.kind === 'leaf' || item.kind === 'petal') {
        // a leaf or petal is a small heap of words around its axis
        const [x0, y0, x1, y1] = item.axis;
        const count = item.kind === 'petal' ? 2 : 2;
        ctx.fillStyle = ink(item, item.kind === 'petal' ? 1 : 0.85);
        for (let k = 0; k < count; k += 1) {
          const t = (k + 0.5) / count;
          const size = item.kind === 'petal' ? 13 + Math.round(rand() * 4) : 12;
          ctx.font = `${size}px "Iowan Old Style", Georgia, serif`;
          ctx.fillText(pick(), lerp(x0, x1, t) + (rand() - 0.5) * 6, lerp(y0, y1, t) + (rand() - 0.5) * 6);
        }
      } else if (item.kind === 'dot') {
        if (item.color) continue;
        ctx.font = '9px "Iowan Old Style", Georgia, serif';
        ctx.fillStyle = ink(item, 0.8);
        ctx.fillText(pick(), item.x, item.y);
      } else if (item.kind === 'dust') {
        // a compressed day: only its keywords, scattered and faint
        ctx.font = 'italic 9px "Iowan Old Style", Georgia, serif';
        ctx.fillStyle = ink(item, 0.7);
        item.links.forEach(([x, y], i) => { if (i % 7 === 0) ctx.fillText(pick(), x, y); });
      }
    }
    ctx.shadowBlur = 0;
  },
  window(ctx, model, now) {
    ctx.save();
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = model.grain ?? 0.16;
    ctx.translate((now * 37) % 256 - 256, (now * 53) % 256 - 256);
    ctx.fillStyle = ctx.createPattern(fineGrain, 'repeat');
    ctx.fillRect(0, 0, W + 512, W + 512);
    ctx.restore();
    // glass: darker rim, a soft highlight top left and a thin inner reflection
    vignette(ctx, 'rgba(10,14,8,.25)', 'rgba(5,8,4,.8)');
    const shine = ctx.createRadialGradient(W * 0.3, W * 0.22, 0, W * 0.3, W * 0.22, W * 0.5);
    shine.addColorStop(0, 'rgba(255,255,240,.10)');
    shine.addColorStop(1, 'rgba(255,255,240,0)');
    ctx.fillStyle = shine;
    ctx.fillRect(0, 0, W, W);
  },
};

const STYLES = { ink, paper, words };

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
