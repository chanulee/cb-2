// Garden idle display: a round window onto a plant grown from Pond conversations.
//
// How the data maps to the plant:
// - time is the stem: one node per day, oldest lowest, today at the top
// - fidelity is the number of L-system generations a day keeps
//   (nylki/lindenmayer): raw = thread > facet > turn, summary = thread > facet,
//   gist = threads only, keywords = the branch dissolves into a DLA cluster
//   (fogleman/dlaf), the visual form of a compressed memory
// - memory keywords give colour: branches tied to the same long-term memory
//   share a hue across days, so recurring patterns rhyme; colour also fades
//   with age
// - the strongest memories sit on the window rim, today blooms one
//   procedural flower (LingDong-/nonflowers) in its strongest memory's colour
// - the background light follows today's mood

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


// Abstraction: 0 = today (vivid), 1 = long compressed (pale, cool, sparse).
function abstraction(age) {
  return clamp(age / 4);
}

const STEM_HUE = 95;
const MEMORY_HUES = [32, 152, 205, 340, 52, 268, 182, 8];

function stemColor(age, alpha = 1, hue = STEM_HUE) {
  const a = abstraction(age);
  return `hsla(${lerp(hue, 200, a * 0.55)}, ${lerp(hue === STEM_HUE ? 45 : 62, 14, a)}%, ${lerp(62, 74, a)}%, ${alpha * lerp(0.95, 0.5, a)})`;
}

function hues(memory) {
  return Object.fromEntries(memory.map((item, index) => [item.key, MEMORY_HUES[index % MEMORY_HUES.length]]));
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

function build(data, previousKeys) {
  const nodes = [];
  const leaves = [];
  const flowers = [];
  const labels = [];
  const dust = [];
  const hueOf = hues(data.memory || []);
  const threadHue = (thread) => hueOf[(thread.memory || [])[0]] ?? STEM_HUE;
  let clock = 0;

  const add = (parent, props) => {
    const node = {
      parent, angle: 0, length: 40, width: 2, age: 0, day: -1, depth: 0, mem: [], hue: STEM_HUE,
      phase: nodes.length * 0.37, born: clock, x: 0, y: 0, a: 0, ...props,
    };
    if (previousKeys.has(node.key)) node.born = -100;
    nodes.push(node);
    return node;
  };

  // One L-system generation: a parent forks into its children, fanned out.
  const fan = (parent, items, spread, length, width, extra) => items.map((item, index) => {
    clock += 0.06;
    const side = items.length === 1 ? 0 : (index / (items.length - 1) - 0.5) * 2;
    return add(parent, { angle: side * spread + (extra.jitter?.() ?? 0), length, width, depth: parent.depth + 1, ...extra.props(item, index) });
  });

  const days = (data.days || []).slice(-28);
  const past = days.filter((day) => day.age > 0);
  const todayIndex = days.findIndex((day) => day.age === 0);
  const today = days[todayIndex];
  const root = add(null, { key: 'root', length: 0, x: W / 2, y: 790, born: -100 });
  const stemStep = clamp(300 / Math.max(past.length, 1), 10, 75);
  let stem = root;
  let lean = 0;

  past.forEach((day, index) => {
    const rand = random(day.date);
    const turn = (rand() - 0.5) * 0.07 - lean * 0.35;
    lean += turn;
    clock += 0.15;
    stem = add(stem, { key: `stem.${day.date}`, length: stemStep, angle: turn, age: day.age, day: index, width: lerp(9, 5, index / Math.max(past.length, 1)) });
    const side = (past.length - index) % 2 ? -1 : 1;
    const threads = day.threads || [];
    const mem = [...new Set(threads.flatMap((thread) => thread.memory || []))];
    const arm = add(stem, {
      key: `arm.${day.date}`, day: index, age: day.age, depth: 1, mem,
      angle: side * lerp(0.95, 1.2, rand()) - lean * 0.5,
      length: 70 + Math.min(day.turns || 1, 6) * 12, width: lerp(3.2, 1.6, abstraction(day.age)),
    });
    labels.push({ node: arm, day: index, side, text: day.date.slice(5).replace('-', '/'), kind: 'date' });
    const level = day.compression || 'keywords';
    if (level === 'keywords') {
      dust.push({ node: arm, points: dla(day.date, 40 + (day.turns || 1) * 22), age: day.age });
      labels.push({ node: arm, day: index, side, text: mem.join(' · '), kind: 'keywords' });
      return;
    }
    const tips = fan(arm, threads, level === 'summary' ? 0.9 : 0.55, level === 'summary' ? 84 : 50, 1.6, {
      jitter: () => (rand() - 0.5) * 0.2,
      props: (thread, t) => ({ key: `${arm.key}.${t}`, day: index, age: day.age, mem: thread.memory || [], hue: threadHue(thread) }),
    });
    tips.forEach((tip, t) => {
      const thread = threads[t];
      labels.push({ node: tip, day: index, side, text: thread.topic, kind: 'thread' });
      if (level === 'gist') {
        dust.push({ node: tip, berry: true, age: day.age });
        return;
      }
      const facets = fan(tip, thread.facets || [], 0.6, 40, 1, {
        props: (facet, f) => ({ key: `${tip.key}.${f}`, day: index, age: day.age, mem: tip.mem, hue: tip.hue }),
      });
      facets.forEach((facet, f) => {
        leaves.push({ node: facet, size: 16, side: f % 2 ? 1 : -1, age: day.age });
        labels.push({ node: facet, day: index, side, text: thread.facets[f].label, kind: 'facet' });
      });
    });
  });

  // Today, raw: thread > facet > turn, three generations, and the flower.
  clock += 0.3;
  const neck = add(stem, { key: 'today.neck', length: 120, angle: -lean * 0.8, width: 4.5, day: todayIndex, age: 0 });
  const threads = today?.threads || [];
  const turns = (today?.turns_detail || []);
  threads.forEach((thread, t) => {
    const rand = random(`${today.date}:${thread.topic}`);
    const side = threads.length === 1 ? 0.6 : (t / (threads.length - 1) - 0.5) * 2;
    const hue = threadHue(thread);
    const mem = thread.memory || [];
    clock += 0.2;
    let tip = neck;
    for (let s = 0; s < 4; s += 1) {
      tip = add(tip, {
        key: `today.${t}.${s}`, day: todayIndex, age: 0, depth: 1 + s * 0.3, mem, hue,
        angle: s === 0 ? side * 1.0 : side * 0.15 + (rand() - 0.5) * 0.08,
        length: lerp(40, 54, rand()) * (1 - s * 0.12), width: 2.8 - s * 0.4,
      });
    }
    labels.push({ node: tip, day: todayIndex, side: Math.sign(side) || 1, text: thread.topic, kind: 'today' });
    const facets = thread.facets || [];
    const threadTurns = turns.filter((turn) => turn.thread === t);
    facets.forEach((facet, f) => {
      const facetNode = add(tip, {
        key: `today.${t}.f${f}`, day: todayIndex, age: 0, depth: 2, mem, hue,
        angle: (facets.length === 1 ? 0 : (f / (facets.length - 1) - 0.5) * 1.1) + side * 0.15, length: 44, width: 1.5,
      });
      labels.push({ node: facetNode, day: todayIndex, side: Math.sign(side) || 1, text: facet.label, kind: 'facet' });
      // third generation: the turns themselves, spread across the facets
      const mine = threadTurns.filter((_, n) => n % facets.length === f);
      const twigs = mine.length ? mine : [null];
      twigs.forEach((turn, j) => {
        const twig = add(facetNode, {
          key: `today.${t}.f${f}.${j}`, day: todayIndex, age: 0, depth: 3, mem, hue,
          angle: (twigs.length === 1 ? 0.3 * (f % 2 ? 1 : -1) : (j - 0.5) * 0.8), length: 26, width: 1,
        });
        if (turn) flowers.push({ node: twig, size: 12, hue: [hue, 70, 70], open: 0.3, seed: hash(twig.key), born: clock + 0.6, bud: true });
        else leaves.push({ node: twig, size: 15, side: j ? 1 : -1, age: 0 });
      });
    });
  });
  clock += 0.5;
  const pedicel = add(neck, { key: 'today.flower', length: 100, angle: 0.03, width: 3, day: todayIndex, age: 0 });
  const todayMemory = (data.memory || []).find((item) => threads.some((thread) => (thread.memory || []).includes(item.key)));
  const flowerHue = todayMemory ? hueOf[todayMemory.key] : 350;
  flowers.push({
    node: pedicel, size: today ? 64 + Math.min(turns.length, 6) * 4 : 26,
    hue: [flowerHue, 72, 70], open: today ? 1 : 0.12, seed: hash(today?.date || 'bud'),
    born: clock + 0.4, main: true, memory: todayMemory,
  });

  // whole garden grows in about seven seconds, however many days it holds
  const pace = Math.min(1, 7 / clock);
  nodes.forEach((node) => { node.born *= pace; });
  flowers.forEach((flower) => {
    flower.born = previousKeys.has(flower.node.key) ? -100 : flower.born * pace;
  });
  return { nodes, leaves, flowers, labels, dust, days, todayIndex, memory: data.memory || [], hueOf, mood: today?.mood, sample: data.sample };
}

// ---------- drawing ----------

const time0 = performance.now();
let model = build({ days: [], memory: [] }, new Set());
let buildAt = 0;
let focus = null; // null, { day }, or { memory }
let lastInput = 0;
let rimHits = [];

function grownAt(node, now) {
  return ease(clamp((now - buildAt - node.born) / 0.9));
}

function layout(now) {
  for (const node of model.nodes) {
    if (!node.parent) { node.a = 0; node.g = 1; continue; }
    const p = node.parent;
    node.g = grownAt(node, now) * (p.g > 0.98 ? 1 : p.g);
    const sway = Math.sin(now * 0.55 + node.phase) * 0.012 * (1 + node.depth) + Math.sin(now * 0.13) * 0.006;
    node.a = p.a + node.angle + sway;
    const len = node.length * node.g;
    node.x = p.x + Math.sin(node.a) * len;
    node.y = p.y - Math.cos(node.a) * len;
  }
}

function dim(node) {
  if (focus === null) return 1;
  if (focus.memory) return node.mem.includes(focus.memory) ? 1.3 : 0.22;
  return node.day === focus.day ? 1.25 : 0.28;
}

function drawBranches() {
  ctx.lineCap = 'round';
  for (const node of model.nodes) {
    if (!node.parent || node.g <= 0) continue;
    const p = node.parent;
    const level = abstraction(node.age);
    ctx.strokeStyle = stemColor(node.age, clamp(dim(node)), node.hue);
    ctx.lineWidth = node.width * lerp(1, 0.7, level);
    ctx.setLineDash(level >= 1 && node.depth > 0 ? [2, 4] : []);
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
  ctx.fillStyle = stemColor(item.age, alpha, node.hue);
  if (item.berry) {
    for (let i = 0; i < 3; i += 1) {
      ctx.beginPath();
      ctx.arc(node.x + Math.sin(i * 2.1 + node.phase) * 4, node.y + Math.cos(i * 2.1) * 4, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    return;
  }
  // abstracted memory: the day's branch dissolves into an aggregate
  ctx.strokeStyle = stemColor(item.age, alpha * 0.6, node.hue);
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
  return day.age === 0 ? `today · ${label}` : `${label} · ${day.age}d ago · ${day.compression}`;
}

function labelVisible(label) {
  const focusedDay = focus?.day === label.day;
  if (focus?.memory) return label.node.mem.includes(focus.memory) && label.kind !== 'facet' && label.kind !== 'date';
  if (label.kind === 'today') return focus === null || focusedDay;
  if (label.kind === 'date') return true;
  if (label.kind === 'facet') return focusedDay;
  return focusedDay || (focus === null && label.kind === 'thread' && model.days[label.day].age <= 1);
}

function drawLabels() {
  ctx.textBaseline = 'middle';
  for (const label of model.labels) {
    const { node } = label;
    if (node.g < 0.98 || !label.text || !labelVisible(label)) continue;
    const day = model.days[label.day];
    ctx.textAlign = label.side > 0 ? 'left' : 'right';
    const x = node.x + label.side * 8;
    const alpha = clamp(dim(node));
    if (label.kind === 'today') {
      ctx.font = 'italic 21px "Iowan Old Style", Georgia, serif';
      ctx.fillStyle = `rgba(240, 236, 200, ${0.95 * alpha})`;
      ctx.fillText(label.text, x, node.y - 8);
    } else if (label.kind === 'facet') {
      ctx.font = '13px "Iowan Old Style", Georgia, serif';
      ctx.fillStyle = `rgba(235, 232, 205, ${0.8 * alpha})`;
      ctx.fillText(label.text, x, node.y);
    } else if (label.kind === 'date') {
      ctx.font = '11px ui-monospace, Menlo, monospace';
      ctx.textAlign = label.side > 0 ? 'right' : 'left';
      ctx.fillStyle = stemColor(day.age, alpha * 0.9);
      ctx.fillText(label.text, label.node.parent.x - label.side * 12, label.node.parent.y);
    } else {
      ctx.font = `${label.kind === 'keywords' ? 'italic ' : ''}14px "Iowan Old Style", Georgia, serif`;
      ctx.fillStyle = stemColor(day.age, alpha, node.hue);
      ctx.fillText(label.text, x, node.y + (label.kind === 'keywords' ? 34 : 0));
    }
  }
}

// Strongest memories sit on the rim of the window, like notes on a lens.
function drawRim() {
  rimHits = [];
  const items = model.memory.slice(0, 7);
  const top = items[0]?.weight || 1;
  ctx.textBaseline = 'middle';
  items.forEach((item, index) => {
    const side = index % 2 ? 1 : -1;
    const step = Math.floor(index / 2);
    const angle = -Math.PI / 2 + side * (0.62 + step * 0.3);
    const x = W / 2 + Math.cos(angle) * W * 0.425;
    const y = W / 2 + Math.sin(angle) * W * 0.425;
    const strength = item.weight / top;
    const active = focus?.memory === item.key;
    const alpha = focus && !active ? 0.35 : lerp(0.55, 1, strength);
    ctx.font = `${Math.round(lerp(13, 19, strength))}px "Iowan Old Style", Georgia, serif`;
    ctx.textAlign = side > 0 ? 'right' : 'left';
    ctx.fillStyle = `hsla(${model.hueOf[item.key]}, 60%, ${active ? 82 : 74}%, ${alpha})`;
    ctx.fillText(item.label, x, y);
    ctx.beginPath();
    ctx.arc(x - side * 10 * -1 + (side > 0 ? 8 : -8), y, lerp(2, 4, strength), 0, Math.PI * 2);
    ctx.fill();
    const width = ctx.measureText(item.label).width;
    rimHits.push({ key: item.key, x: side > 0 ? x - width : x, y: y - 14, w: width + 16, h: 28 });
  });
}

function wrap(text, width) {
  const lines = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    if (ctx.measureText(`${line} ${word}`).width > width && line) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function caption(day) {
  if (day.compression === 'raw') return `“${day.lines?.[day.lines.length - 1] || ''}”`;
  if (day.compression === 'summary') return day.summary || '';
  if (day.compression === 'gist') return day.gist || '';
  return [...new Set((day.threads || []).flatMap((thread) => thread.memory || []))]
    .map((key) => model.memory.find((item) => item.key === key)?.label || key).join(' · ');
}

function drawCaption() {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const sample = model.sample ? '  ·  SAMPLE' : '';
  if (focus?.memory) {
    const item = model.memory.find((m) => m.key === focus.memory);
    ctx.font = '13px ui-monospace, Menlo, monospace';
    ctx.fillStyle = 'rgba(230, 228, 200, .6)';
    ctx.fillText(`${item.kind} · ${item.days.length} day${item.days.length === 1 ? '' : 's'}`.toUpperCase() + sample, W / 2, 800);
    ctx.font = 'italic 26px "Iowan Old Style", Georgia, serif';
    ctx.fillStyle = `hsla(${model.hueOf[item.key]}, 60%, 80%, .95)`;
    ctx.fillText(item.label, W / 2, 834);
    ctx.font = '16px "Iowan Old Style", Georgia, serif';
    ctx.fillStyle = 'rgba(230, 228, 200, .7)';
    wrap(item.note || '', 470).slice(0, 3).forEach((line, i) => ctx.fillText(line, W / 2, 864 + i * 21));
    return;
  }
  const index = focus?.day ?? model.todayIndex;
  const day = model.days[index];
  if (!day) {
    ctx.font = 'italic 22px "Iowan Old Style", Georgia, serif';
    ctx.fillStyle = 'rgba(230, 228, 200, .75)';
    ctx.fillText('a bud, waiting for today’s pond', W / 2, 860);
    return;
  }
  ctx.font = '13px ui-monospace, Menlo, monospace';
  ctx.fillStyle = 'rgba(230, 228, 200, .6)';
  ctx.fillText(dateText(day).toUpperCase() + sample, W / 2, 810);
  if (focus === null) {
    const bloom = model.flowers.find((flower) => flower.main)?.memory;
    ctx.font = 'italic 26px "Iowan Old Style", Georgia, serif';
    ctx.fillStyle = 'rgba(240, 236, 205, .92)';
    wrap(day.gist || `${day.turns} conversations`, 560).slice(0, 2).forEach((line, i) => ctx.fillText(line, W / 2, 846 + i * 30));
    if (bloom) {
      ctx.font = '15px "Iowan Old Style", Georgia, serif';
      ctx.fillStyle = `hsla(${model.hueOf[bloom.key]}, 60%, 78%, .85)`;
      ctx.fillText(`blooming from: ${bloom.label}`, W / 2, 912);
    }
    return;
  }
  ctx.font = `${day.compression === 'keywords' ? 'italic ' : ''}17px "Iowan Old Style", Georgia, serif`;
  ctx.fillStyle = `rgba(240, 236, 205, ${lerp(0.92, 0.6, abstraction(day.age))})`;
  wrap(caption(day), 500).slice(0, 4).forEach((line, i) => ctx.fillText(line, W / 2, 840 + i * 22));
}

// ---------- the round window ----------

// Background light follows today's mood: valence warms or cools the hue,
// energy lifts the brightness. Blurred blobs stand in for an out-of-focus garden.
const BLOB_SHAPE = [[0.18, 0.25, 0.5, 0], [0.82, 0.2, 0.42, 40], [0.75, 0.75, 0.5, -10], [0.2, 0.85, 0.45, -25], [0.5, 0.45, 0.35, 20], [0.95, 0.5, 0.3, 60]];

function blobColor(mood, offset, index) {
  const valence = mood?.valence ?? 0;
  const energy = mood?.energy ?? 0.4;
  const hue = 70 - valence * 25 + offset;
  const light = lerp(14, 38, energy) + (index === 3 ? 14 : 0);
  return `hsla(${hue}, ${lerp(20, 42, (valence + 1) / 2)}%, ${light}%,`;
}

function drawBackground(now) {
  ctx.fillStyle = '#161d17';
  ctx.fillRect(0, 0, W, W);
  BLOB_SHAPE.forEach(([x, y, r, offset], i) => {
    const cx = (x + Math.sin(now * 0.03 + i * 1.7) * 0.04) * W;
    const cy = (y + Math.cos(now * 0.025 + i) * 0.04) * W;
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * W);
    const color = blobColor(model.mood, offset, i);
    gradient.addColorStop(0, `${color} .8)`);
    gradient.addColorStop(1, `${color} 0)`);
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
  drawRim();
  drawCaption();
  ctx.restore();
  requestAnimationFrame(frame);
}

// ---------- effects: data, size, touch ----------

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
  const keys = new Set(signature ? model.nodes.map((node) => node.key) : []);
  signature = next;
  model = build(data, keys);
  buildAt = (performance.now() - time0) / 1000;
  focus = null;
}

function resize() {
  const size = Math.min(innerWidth, innerHeight);
  canvas.style.width = canvas.style.height = `${size}px`;
  canvas.width = canvas.height = Math.round(size * Math.min(devicePixelRatio || 1, 2));
}

function touched() {
  lastInput = (performance.now() - time0) / 1000;
}

function step(delta) {
  const count = model.days.length;
  if (!count) return;
  const current = focus?.day ?? count - 1;
  focus = { day: clamp(current + delta, 0, count - 1) };
  touched();
}

function toGarden(event) {
  const rect = canvas.getBoundingClientRect();
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
  let distance = 40;
  for (const node of model.nodes) {
    const d = Math.hypot(node.x - point.x, node.y - point.y);
    if (node.day >= 0 && d < distance) { best = node; distance = d; }
  }
  focus = best ? { day: best.day } : null;
  touched();
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
  if (drag && !drag.moved) tap(drag.start);
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
