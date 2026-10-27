// Garden idle display: a round window onto a plant grown from Pond conversations.
// Old days sit low on the stem and abstract (cool, sparse, DLA dust) like a
// summarised context; today grows a three-level crown of topics and one flower.
// References: L-system branching (nylki/lindenmayer), diffusion-limited
// aggregation (fogleman/dlaf), procedural petals (LingDong-/nonflowers).

const W = 1000;
const canvas = document.querySelector('#garden');
const ctx = canvas.getContext('2d');
const params = new URLSearchParams(location.search);

// ---------- pure helpers ----------

function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

function random(seed) {
  let a = typeof seed === 'string' ? hash(seed) : seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => 1 - (1 - t) ** 3;

// Abstraction: 0 = today (vivid), 1 = long summarised (pale, cool, sparse).
function abstraction(age) {
  return clamp(Math.log2(1 + age) / Math.log2(1 + 30));
}

function stemColor(age, alpha = 1) {
  const a = abstraction(age);
  return `hsla(${lerp(88, 205, a)}, ${lerp(48, 12, a)}%, ${lerp(58, 72, a)}%, ${alpha * lerp(0.95, 0.5, a)})`;
}

const PETALS = [[352, 70, 72], [18, 80, 66], [42, 85, 64], [328, 45, 78], [268, 40, 74], [8, 60, 80]];

function petalHue(word) {
  return PETALS[hash(word || 'today') % PETALS.length];
}

// fogleman/dlaf in miniature: walkers stick to a growing cluster.
function dla(seed, count) {
  const rand = random(seed);
  const size = 61;
  const mid = 30;
  const grid = new Int16Array(size * size).fill(-1);
  const points = [{ x: 0, y: 0, parent: -1 }];
  grid[mid * size + mid] = 0;
  let radius = 2;
  while (points.length < count) {
    const angle = rand() * Math.PI * 2;
    let x = Math.round(mid + Math.cos(angle) * (radius + 3));
    let y = Math.round(mid + Math.sin(angle) * (radius + 3));
    for (let step = 0; step < 900; step += 1) {
      const dir = (rand() * 4) | 0;
      x += dir === 0 ? 1 : dir === 1 ? -1 : 0;
      y += dir === 2 ? 1 : dir === 3 ? -1 : 0;
      if (x < 1 || y < 1 || x > size - 2 || y > size - 2) break;
      const near = [grid[y * size + x + 1], grid[y * size + x - 1], grid[(y + 1) * size + x], grid[(y - 1) * size + x]].find((v) => v >= 0);
      if (near !== undefined && rand() < 0.7) {
        grid[y * size + x] = points.length;
        points.push({ x: x - mid, y: y - mid, parent: near });
        radius = Math.max(radius, Math.hypot(x - mid, y - mid));
        break;
      }
    }
  }
  return points;
}

// ---------- garden model ----------

function demoDays(today) {
  const themes = [
    ['walk', 'river', 'quiet'], ['deadline', 'design', 'tired'], ['mother', 'call', 'cooking'],
    ['rain', 'reading'], ['friend', 'coffee', 'laugh'], ['prototype', 'pond', 'solder'],
    ['sleep', 'morning'], ['gallery', 'colour', 'light'], ['doubt', 'presentation'],
    ['garden', 'seeds'], ['music', 'train'], ['bread', 'patience'],
  ];
  const result = [];
  const base = new Date(`${today}T12:00:00`);
  for (let age = 24; age >= 1; age -= 1) {
    if (age % 5 === 3) continue;
    const day = new Date(base.getTime() - age * 86400000).toISOString().slice(0, 10);
    const topics = themes[age % themes.length];
    result.push({ date: day, age, turns: 1 + (age * 7) % 4, topics, lines: [`I kept thinking about ${topics[0]}.`] });
  }
  result.push({
    date: today, age: 0, turns: 4,
    topics: ['garden', 'memory', 'flowers', 'friends', 'tired'],
    lines: ['I spent the afternoon drawing trees that grow from conversations.'],
  });
  return result;
}

function build(days, previousKeys) {
  const nodes = [];
  const leaves = [];
  const flowers = [];
  const labels = [];
  const dust = [];
  let clock = 0;

  const add = (parent, props) => {
    const node = {
      parent, angle: 0, length: 40, width: 2, age: 0, day: -1, depth: 0,
      phase: nodes.length * 0.37, born: clock, x: 0, y: 0, a: 0, ...props,
    };
    if (previousKeys.has(node.key)) node.born = -100;
    nodes.push(node);
    return node;
  };

  const past = days.filter((day) => day.age > 0).slice(-28);
  const today = days.find((day) => day.age === 0);
  const ordered = [...past, ...(today ? [today] : [])];
  const root = add(null, { key: 'root', length: 0, x: W / 2, y: 940, born: -100 });
  const stemStep = clamp(430 / Math.max(past.length, 1), 10, 70);
  let stem = root;
  let bend = 0;
  let lean = 0;

  // L-system flavour: X -> F[+X][-X], depth limited by how abstracted the day is.
  const branch = (parent, day, dayIndex, rand, depth, maxDepth, key) => {
    const age = day.age;
    const spread = lerp(0.62, 0.35, abstraction(age));
    const forks = depth === 0 ? 1 : 2 + (rand() < 0.25 && age < 5 ? 1 : 0);
    for (let k = 0; k < forks; k += 1) {
      const side = forks === 1 ? 0 : (k / (forks - 1) - 0.5) * 2;
      clock += 0.05;
      const node = add(parent, {
        key: `${key}.${k}`, day: dayIndex, age, depth: parent.depth + 1,
        angle: side * spread + (rand() - 0.5) * 0.25,
        length: parent.length * lerp(0.62, 0.78, rand()),
        width: Math.max(parent.width * 0.62, 0.6),
      });
      if (depth + 1 < maxDepth) {
        branch(node, day, dayIndex, rand, depth + 1, maxDepth, node.key);
      } else if (age <= 4) {
        leaves.push({ node, size: lerp(18, 26, rand()), side: rand() < 0.5 ? -1 : 1, age });
      } else if (age <= 12) {
        dust.push({ node, points: null, age, berry: true });
      }
    }
  };

  past.forEach((day, index) => {
    const rand = random(day.date);
    bend = (rand() - 0.5) * 0.07 - lean * 0.35;
    lean += bend;
    clock += 0.12;
    stem = add(stem, {
      key: `stem.${day.date}`, length: stemStep, angle: bend, age: day.age,
      width: lerp(9, 4, index / Math.max(past.length, 1)), day: index,
    });
    const side = index % 2 ? 1 : -1;
    const level = abstraction(day.age);
    const turns = Math.min(day.turns || 1, 5);
    const arm = add(stem, {
      key: `arm.${day.date}`, day: index, age: day.age, depth: 1,
      angle: side * lerp(0.75, 1.15, rand()) - lean * 0.5,
      length: (60 + turns * 22) * lerp(1.05, 0.8, index / Math.max(past.length, 1)),
      width: lerp(3.4, 1.6, level),
    });
    const maxDepth = day.age > 14 ? 1 : day.age > 4 ? 2 : 3;
    branch(arm, day, index, rand, 1, maxDepth + 1, arm.key);
    if (day.age > 14) dust.push({ node: arm, points: dla(day.date, 50 + turns * 25), age: day.age });
    labels.push({ node: arm, day: index, text: day.topics?.[0] || '', side });
  });

  // Today: the stem lifts into a crown of topic branches with a flower on top.
  const todayIndex = ordered.length - 1;
  clock += 0.3;
  const neck = add(stem, { key: 'today.neck', length: 110, angle: -lean * 0.8, width: 4, day: today ? todayIndex : -1, age: 0 });
  const topics = today?.topics?.length ? today.topics.slice(0, 5) : [];
  topics.forEach((topic, t) => {
    const rand = random(`${today.date}:${topic}`);
    const side = topics.length === 1 ? 0.6 : (t / (topics.length - 1) - 0.5) * 2;
    clock += 0.15;
    // level 1: topic, bending outward in several segments like grass blades
    let tip = neck;
    for (let s = 0; s < 4; s += 1) {
      tip = add(tip, {
        key: `today.${topic}.${s}`, day: todayIndex, age: 0, depth: 1 + s * 0.3,
        angle: s === 0 ? side * 0.95 : side * 0.16 + (rand() - 0.5) * 0.08,
        length: lerp(42, 58, rand()) * (1 - s * 0.12), width: 2.6 - s * 0.4,
      });
    }
    labels.push({ node: tip, day: todayIndex, text: topic, side: Math.sign(side) || 1, today: true });
    // levels 2 and 3: facets of the topic
    for (let k = 0; k < 2; k += 1) {
      const facet = add(tip, {
        key: `today.${topic}.f${k}`, day: todayIndex, age: 0, depth: 2,
        angle: (k ? 1 : -1) * 0.5 + side * 0.15, length: 46, width: 1.5,
      });
      for (let j = 0; j < 2; j += 1) {
        const twig = add(facet, {
          key: `today.${topic}.f${k}.${j}`, day: todayIndex, age: 0, depth: 3,
          angle: (j ? 1 : -1) * 0.42, length: 26, width: 1,
        });
        if ((k + j + t) % 2) leaves.push({ node: twig, size: 16, side: j ? 1 : -1, age: 0 });
        else flowers.push({ node: twig, size: 11, hue: petalHue(topic), open: 0.35, seed: hash(twig.key), born: clock + 0.6, bud: true });
      }
    }
  });
  clock += 0.5;
  const pedicel = add(neck, { key: 'today.flower', length: 95, angle: 0.03, width: 3, day: today ? todayIndex : -1, age: 0 });
  flowers.push({
    node: pedicel, size: today ? 82 + Math.min(today.turns, 6) * 5 : 26,
    hue: petalHue(topics[0]), open: today ? 1 : 0.12, seed: hash(today?.date || 'bud'),
    born: clock + 0.4, main: true,
  });
  // whole garden grows in about seven seconds, however many days it holds
  const pace = Math.min(1, 7 / clock);
  nodes.forEach((node) => { node.born *= pace; });
  flowers.forEach((flower) => {
    flower.born = previousKeys.has(flower.node.key) ? -100 : flower.born * pace;
  });
  return { nodes, leaves, flowers, labels, dust, days: ordered, todayIndex: today ? todayIndex : -1 };
}

// ---------- drawing ----------

const time0 = performance.now();
let model = build([], new Set());
let buildAt = 0;
let focus = null;
let lastInput = 0;
let demo = false;

function grownAt(node, now) {
  return ease(clamp((now - buildAt - node.born) / 0.9));
}

function layout(now) {
  const t = now;
  for (const node of model.nodes) {
    if (!node.parent) { node.a = 0; node.g = 1; continue; }
    const p = node.parent;
    node.g = grownAt(node, now) * (p.g > 0.98 ? 1 : p.g);
    const sway = Math.sin(t * 0.55 + node.phase) * 0.012 * (1 + node.depth) +
      Math.sin(t * 0.13) * 0.006;
    node.a = p.a + node.angle + sway;
    const len = node.length * node.g;
    node.x = p.x + Math.sin(node.a) * len;
    node.y = p.y - Math.cos(node.a) * len;
  }
}

function dim(node) {
  if (focus === null) return 1;
  return node.day === focus ? 1.25 : 0.28;
}

function drawBranches() {
  ctx.lineCap = 'round';
  for (const node of model.nodes) {
    if (!node.parent || node.g <= 0) continue;
    const p = node.parent;
    const level = abstraction(node.age);
    ctx.strokeStyle = stemColor(node.age, clamp(dim(node)));
    ctx.lineWidth = node.width * lerp(1, 0.7, level);
    ctx.setLineDash(level > 0.75 && node.depth > 0 ? [2, 4] : []);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    const mx = (p.x + node.x) / 2 + Math.cos(node.a) * node.length * 0.06;
    const my = (p.y + node.y) / 2 + Math.sin(node.a) * node.length * 0.06;
    ctx.quadraticCurveTo(mx, my, node.x, node.y);
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

function drawLeaf(leaf) {
  const { node } = leaf;
  if (node.g < 0.6) return;
  const size = leaf.size * (node.g - 0.6) / 0.4;
  ctx.save();
  ctx.translate(node.x, node.y);
  ctx.rotate(node.a + leaf.side * 0.6);
  ctx.globalAlpha = clamp(dim(node));
  ctx.beginPath();
  for (let i = 0; i <= 12; i += 1) {
    const t = i / 12;
    ctx.lineTo(Math.sin(Math.PI * t) * size * 0.3 + t * t * leaf.side * 2, -t * size);
  }
  for (let i = 12; i >= 0; i -= 1) {
    const t = i / 12;
    ctx.lineTo(-Math.sin(Math.PI * t) * size * 0.3 + t * t * leaf.side * 2, -t * size);
  }
  const gradient = ctx.createLinearGradient(0, 0, 0, -size);
  gradient.addColorStop(0, `hsla(${92 + leaf.age * 8}, 45%, 38%, .9)`);
  gradient.addColorStop(1, `hsla(${78 + leaf.age * 8}, 60%, 62%, .85)`);
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.strokeStyle = 'rgba(30, 45, 20, .35)';
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(leaf.side * 2, -size * 0.92);
  ctx.stroke();
  ctx.restore();
}

function drawDust(item) {
  const { node } = item;
  if (node.g < 0.95) return;
  const alpha = clamp(dim(node)) * lerp(0.75, 0.45, abstraction(item.age));
  ctx.fillStyle = stemColor(item.age, alpha);
  if (item.berry) {
    for (let i = 0; i < 3; i += 1) {
      ctx.beginPath();
      ctx.arc(node.x + Math.sin(i * 2.1 + node.phase) * 4, node.y + Math.cos(i * 2.1) * 4, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    return;
  }
  // abstracted memory: the day's branch dissolves into an aggregate
  ctx.strokeStyle = stemColor(item.age, alpha * 0.6);
  ctx.lineWidth = 0.6;
  const scale = 2.3;
  for (const point of item.points) {
    const x = node.x + point.x * scale;
    const y = node.y + point.y * scale;
    if (point.parent >= 0) {
      const parent = item.points[point.parent];
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(node.x + parent.x * scale, node.y + parent.y * scale);
      ctx.stroke();
    }
    ctx.fillRect(x - 0.8, y - 0.8, 1.6, 1.6);
  }
}

// nonflowers-style petal: a noisy width profile filled base-dark to tip-light
function petal(rand, length, width, [h, s, l], alpha) {
  const outline = [];
  for (let i = 0; i <= 16; i += 1) {
    const t = i / 16;
    const w = width * Math.sin(Math.PI * t ** 0.65) ** 0.8 * (1 + (rand() - 0.5) * 0.1);
    outline.push([t * length, w]);
  }
  ctx.beginPath();
  outline.forEach(([x, w]) => ctx.lineTo(x, w));
  outline.slice().reverse().forEach(([x, w]) => ctx.lineTo(x, -w));
  const gradient = ctx.createLinearGradient(0, 0, length, 0);
  gradient.addColorStop(0, `hsla(${h - 12}, ${s}%, ${l - 30}%, ${alpha})`);
  gradient.addColorStop(0.55, `hsla(${h}, ${s}%, ${l - 6}%, ${alpha})`);
  gradient.addColorStop(1, `hsla(${h + 8}, ${s - 10}%, ${l + 10}%, ${alpha})`);
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.strokeStyle = `hsla(${h - 20}, ${s}%, ${l - 35}%, ${alpha * 0.35})`;
  ctx.lineWidth = 0.5;
  for (let v = -1; v <= 1; v += 1) {
    ctx.beginPath();
    ctx.moveTo(length * 0.05, 0);
    ctx.quadraticCurveTo(length * 0.5, v * width * 0.3, length * 0.85, v * width * 0.45);
    ctx.stroke();
  }
}

function drawFlower(flower, now) {
  const { node } = flower;
  const grow = ease(clamp((now - buildAt - flower.born) / 2.2));
  if (grow <= 0 || node.g < 0.9) return;
  const rand = random(flower.seed);
  const breathe = 1 + Math.sin(now * 0.4 + flower.seed) * 0.04;
  const open = flower.open * grow * breathe;
  const size = flower.size * lerp(0.35, 1, grow);
  const alpha = clamp(dim(node)) * 0.95;
  ctx.save();
  ctx.translate(node.x, node.y);
  ctx.rotate(node.a * 0.6);
  const rings = flower.bud ? [[5, 1, 0]] : [[8, 1, 0], [6, 0.68, 0.4], [5, 0.42, 0.2]];
  const petals = [];
  rings.forEach(([count, scale, offset], ring) => {
    for (let i = 0; i < count; i += 1) {
      const phi = ((i + offset) / count) * Math.PI * 2 + rand() * 0.2;
      const elevation = lerp(1.35, lerp(0.2, 0.75, ring / 2), open);
      const vx = Math.cos(phi) * Math.cos(elevation);
      const vy = Math.sin(phi) * Math.cos(elevation) * 0.45 - Math.sin(elevation);
      petals.push({ depth: Math.sin(phi) - ring * 0.5, vx, vy, scale, phi, ring, r: rand() });
    }
  });
  petals.sort((a, b) => a.depth - b.depth);
  for (const p of petals) {
    const length = Math.hypot(p.vx, p.vy) * size * p.scale;
    ctx.save();
    ctx.rotate(Math.atan2(p.vy, p.vx));
    const shade = p.depth < 0 ? -8 : 0;
    const [h, s, l] = flower.hue;
    petal(random(flower.seed + p.phi * 1000), length, size * p.scale * 0.32, [h + p.ring * 6, s, l + shade - p.ring * 4], alpha);
    ctx.restore();
  }
  if (!flower.bud && open > 0.4) {
    ctx.globalAlpha = alpha * clamp((open - 0.4) * 2);
    for (let i = 0; i < 26; i += 1) {
      const angle = rand() * Math.PI * 2;
      const r = rand() * size * 0.16;
      const x = Math.cos(angle) * r;
      const y = Math.sin(angle) * r * 0.45 - size * 0.08;
      ctx.strokeStyle = 'rgba(90, 60, 20, .5)';
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.fillStyle = `hsl(${44 + rand() * 12}, 85%, ${60 + rand() * 15}%)`;
      ctx.beginPath();
      ctx.arc(x, y, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function dateText(day) {
  const date = new Date(`${day.date}T12:00:00`);
  const label = date.toLocaleDateString('en', { month: 'short', day: 'numeric' });
  return day.age === 0 ? `today · ${label}` : `${label} · ${day.age}d ago`;
}

function drawLabels() {
  ctx.textBaseline = 'middle';
  for (const label of model.labels) {
    const { node } = label;
    if (node.g < 0.98 || !label.text) continue;
    const day = model.days[label.day];
    const focused = focus === label.day;
    const visible = label.today ? (focus === null || focused) : focused || (focus === null && day.age <= 6);
    if (!visible) continue;
    const align = label.side > 0 ? 'left' : 'right';
    ctx.textAlign = align;
    const x = node.x + label.side * 8;
    if (label.today) {
      ctx.font = 'italic 21px "Iowan Old Style", Georgia, serif';
      ctx.fillStyle = 'rgba(236, 232, 190, .92)';
      ctx.fillText(label.text, x, node.y - 8);
    } else {
      ctx.font = '12px ui-monospace, Menlo, monospace';
      ctx.fillStyle = stemColor(day.age, focused ? 1 : 0.8);
      ctx.fillText(`${day.date.slice(5).replace('-', '/')} ${label.text}`, x, node.y);
    }
  }
}

function drawCaption() {
  const index = focus ?? model.todayIndex;
  const day = model.days[index];
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  if (!day) {
    ctx.font = 'italic 22px "Iowan Old Style", Georgia, serif';
    ctx.fillStyle = 'rgba(230, 228, 200, .75)';
    ctx.fillText('a bud, waiting for today’s pond', W / 2, 860);
    return;
  }
  ctx.font = '13px ui-monospace, Menlo, monospace';
  ctx.fillStyle = 'rgba(230, 228, 200, .6)';
  ctx.fillText(dateText(day).toUpperCase() + (demo ? '  ·  SAMPLE' : ''), W / 2, 838);
  ctx.font = 'italic 25px "Iowan Old Style", Georgia, serif';
  ctx.fillStyle = 'rgba(240, 236, 205, .92)';
  ctx.fillText((day.topics || []).slice(0, 3).join(' · ') || `${day.turns} conversation${day.turns === 1 ? '' : 's'}`, W / 2, 872);
  const line = day.lines?.[day.lines.length - 1];
  if (focus !== null && line) {
    ctx.font = '15px "Iowan Old Style", Georgia, serif';
    ctx.fillStyle = 'rgba(230, 228, 200, .6)';
    ctx.fillText(`“${line.length > 58 ? `${line.slice(0, 56)}…` : line}”`, W / 2, 900);
  }
}

// ---------- the round window ----------

const blobs = [
  [0.18, 0.25, 0.5, '#6b6a34'], [0.82, 0.2, 0.42, '#2b3a2a'], [0.75, 0.75, 0.5, '#8c8a4a'],
  [0.2, 0.85, 0.45, '#c2b66a'], [0.5, 0.45, 0.35, '#3c4b33'], [0.95, 0.5, 0.3, '#1a221c'],
];

function drawBackground(now) {
  ctx.fillStyle = '#1b231b';
  ctx.fillRect(0, 0, W, W);
  blobs.forEach(([x, y, r, color], i) => {
    const cx = (x + Math.sin(now * 0.03 + i * 1.7) * 0.04) * W;
    const cy = (y + Math.cos(now * 0.025 + i) * 0.04) * W;
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * W);
    gradient.addColorStop(0, `${color}cc`);
    gradient.addColorStop(1, `${color}00`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, W, W);
  });
}

function offscreen(draw) {
  const layer = document.createElement('canvas');
  layer.width = layer.height = 500;
  const c = layer.getContext('2d');
  c.scale(0.5, 0.5);
  draw(c);
  return layer;
}

const grassLayer = offscreen((c) => {
  const rand = random('grass');
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

const grain = (() => {
  const layer = document.createElement('canvas');
  layer.width = layer.height = 256;
  const c = layer.getContext('2d');
  const image = c.createImageData(256, 256);
  for (let i = 0; i < image.data.length; i += 4) {
    const v = Math.random() * 255;
    image.data[i] = image.data[i + 1] = image.data[i + 2] = v;
    image.data[i + 3] = 255;
  }
  c.putImageData(image, 0, 0);
  return layer;
})();

function drawWindow(now) {
  ctx.drawImage(grassLayer, 0, 0, W, W);
  ctx.globalAlpha = 0.07;
  ctx.globalCompositeOperation = 'overlay';
  const pattern = ctx.createPattern(grain, 'repeat');
  ctx.save();
  ctx.translate((now * 37) % 256, (now * 53) % 256);
  ctx.fillStyle = pattern;
  ctx.fillRect(-256, -256, W + 512, W + 512);
  ctx.restore();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  const vignette = ctx.createRadialGradient(W / 2, W / 2, W * 0.32, W / 2, W / 2, W / 2);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(0.85, 'rgba(0,0,0,.35)');
  vignette.addColorStop(1, 'rgba(0,0,0,.9)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, W, W);
}

function frame() {
  const now = (performance.now() - time0) / 1000;
  if (focus !== null && now - lastInput > 25) focus = null;
  ctx.save();
  ctx.scale(canvas.width / W, canvas.height / W);
  ctx.clearRect(0, 0, W, W);
  ctx.beginPath();
  ctx.arc(W / 2, W / 2, W / 2, 0, Math.PI * 2);
  ctx.clip();
  drawBackground(now);
  layout(now);
  drawBranches();
  model.dust.forEach(drawDust);
  model.leaves.forEach(drawLeaf);
  model.flowers.forEach((flower) => drawFlower(flower, now));
  drawLabels();
  drawWindow(now);
  drawCaption();
  ctx.restore();
  requestAnimationFrame(frame);
}

// ---------- effects: data, size, touch ----------

let signature = '';

async function refresh() {
  let payload;
  try {
    const response = await fetch('/api/garden', { cache: 'no-store' });
    payload = await response.json();
  } catch {
    payload = { today: new Date().toISOString().slice(0, 10), days: [] };
  }
  demo = params.has('demo') || !payload.days.length;
  const days = demo ? demoDays(payload.today) : payload.days;
  const next = JSON.stringify(days);
  if (next === signature) return;
  const keys = new Set(signature ? [...model.nodes.map((node) => node.key)] : []);
  signature = next;
  model = build(days, keys);
  buildAt = (performance.now() - time0) / 1000;
  focus = null;
}

function resize() {
  const size = Math.min(innerWidth, innerHeight);
  canvas.style.width = canvas.style.height = `${size}px`;
  canvas.width = canvas.height = Math.round(size * Math.min(devicePixelRatio || 1, 2));
}

function step(delta) {
  const count = model.days.length;
  if (!count) return;
  const current = focus ?? count - 1;
  focus = clamp(current + delta, 0, count - 1);
  lastInput = (performance.now() - time0) / 1000;
}

function toGarden(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: (event.clientX - rect.left) / rect.width * W, y: (event.clientY - rect.top) / rect.height * W };
}

let drag = null;
canvas.addEventListener('pointerdown', (event) => {
  drag = { y: event.clientY, start: toGarden(event), moved: 0 };
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove', (event) => {
  if (!drag) return;
  const delta = event.clientY - drag.y;
  if (Math.abs(delta) > 26) {
    step(delta > 0 ? -1 : 1);
    drag.y = event.clientY;
    drag.moved += 1;
  }
});
canvas.addEventListener('pointerup', () => {
  if (drag && !drag.moved) {
    let best = null;
    let distance = 40;
    for (const node of model.nodes) {
      const d = Math.hypot(node.x - drag.start.x, node.y - drag.start.y);
      if (node.day >= 0 && d < distance) { best = node; distance = d; }
    }
    focus = best ? best.day : null;
    lastInput = (performance.now() - time0) / 1000;
  }
  drag = null;
});
addEventListener('wheel', (event) => step(event.deltaY > 0 ? -1 : 1), { passive: true });
addEventListener('keydown', (event) => {
  if (event.key === 'ArrowDown') step(-1);
  if (event.key === 'ArrowUp') step(1);
  if (event.key === 'Escape') focus = null;
});
addEventListener('resize', resize);

resize();
refresh();
setInterval(refresh, 8000);
requestAnimationFrame(frame);
