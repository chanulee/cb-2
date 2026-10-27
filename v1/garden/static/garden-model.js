// Garden skeleton, shared by every style: conversation data -> plant -> shapes.
//
// The plant grows like a plant instead of a fork-at-the-tip tree:
// - each branch is a turtle path of short steps whose heading is pulled up by
//   tropism and out by droop (weight), plus smooth noise, after "The
//   Algorithmic Beauty of Plants" (Prusinkiewicz & Lindenmayer)
// - laterals sprout from nodes along their parent, alternating sides
// - thickness follows the pipe model: as thick as the tips it feeds
//
// Data mapping:
// - time is the stem: one node per day, oldest lowest, today at the top
// - fidelity is the number of generations a day keeps (nylki/lindenmayer):
//   raw = thread > facet > turn, summary = thread > facet, gist = threads,
//   keywords = the branch ends in a DLA cluster (fogleman/dlaf)
// - hue comes from the long-term memory a thread belongs to, so recurring
//   patterns rhyme across days; today ends in a procedural flower
//   (LingDong-/nonflowers) coloured by its strongest memory
//
// Styles only ever see the flat shape list from collect().

const W = 1000;

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

function hash1(n) {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
}

// smooth 1D value noise in [-1, 1]
function noise1(seed, x) {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return lerp(hash1(i + seed * 57.3), hash1(i + 1 + seed * 57.3), u) * 2 - 1;
}

// 0 = today (vivid), 1 = long compressed (pale, sparse)
function abstraction(age) {
  return clamp(age / 3);
}

const STEM_HUE = 95;
const MEMORY_HUES = [32, 152, 205, 340, 52, 268, 182, 8];

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

// ---------- growing the plant ----------

const PER_DAY = 4;

function build(data, previousKeys) {
  const branches = [];
  const leaves = [];
  const flowers = [];
  const labels = [];
  const dust = [];
  const hueOf = hues(data.memory || []);
  const threadHue = (thread) => hueOf[(thread.memory || [])[0]] ?? STEM_HUE;
  let clock = 0;

  // One shoot: a turtle path bent by tropism (up), droop (out) and noise.
  const sprout = (parent, at, props, shape) => {
    const n = shape.segments;
    const attach = parent ? Math.round(clamp(at) * parent.n) : 0;
    let h = (parent ? parent.nh[attach] : 0) + props.angle;
    const seed = hash(props.key) % 1000;
    const steps = [];
    const nh = [h];
    for (let i = 0; i < n; i += 1) {
      const t = i / n;
      const turn = (-shape.tropism + shape.droop * t) * Math.sin(h) + noise1(seed, i * 0.4) * shape.wiggle;
      h += turn;
      steps.push({ turn, len: shape.length / n });
      nh.push(h);
    }
    const born = parent ? Math.max(clock, parent.born + parent.dur * (attach / parent.n)) : clock;
    const branch = {
      parent, attach, steps, nh, n, day: -1, age: 0, mem: [], hue: STEM_HUE, kind: 'branch',
      depth: parent ? parent.depth + 1 : 0, born, dur: 0.5 + n * 0.06, phase: branches.length * 0.37,
      tips: 0, thickness: 1, px: new Float32Array(n + 1), py: new Float32Array(n + 1), hd: new Float32Array(n + 1),
      g: 0, ...props,
    };
    if (previousKeys.has(branch.key)) branch.born = -100;
    branches.push(branch);
    return branch;
  };

  const days = (data.days || []).slice(-28);
  const past = days.filter((day) => day.age > 0);
  const todayIndex = days.findIndex((day) => day.age === 0);
  const today = days[todayIndex];
  const todayThreads = today?.threads || [];
  const turns = today?.turns_detail || [];
  const crown = Math.max(todayThreads.length * 2, 6);
  const stemSegments = 2 + past.length * PER_DAY + crown + 2;
  const stem = sprout(null, 0, { key: 'stem', angle: 0, day: todayIndex, kind: 'stem', thickness: 1.5 }, {
    segments: stemSegments, length: 230 + clamp(past.length * 90, 0, 330), tropism: 0.05, droop: 0, wiggle: 0.05,
  });
  stem.dayAt = (k) => {
    const index = Math.floor((k - 2) / PER_DAY);
    return index >= past.length || k > 2 + past.length * PER_DAY ? todayIndex : clamp(index, 0, past.length - 1);
  };

  past.forEach((day, index) => {
    const rand = random(day.date);
    const a = abstraction(day.age);
    const side = (past.length - index) % 2 ? -1 : 1;
    const threads = day.threads || [];
    const mem = [...new Set(threads.flatMap((thread) => thread.memory || []))];
    clock += 0.3;
    const arm = sprout(stem, (2 + index * PER_DAY + 1) / stem.n, {
      key: `arm.${day.date}`, angle: side * lerp(0.95, 1.3, rand()), day: index, age: day.age, mem,
    }, {
      segments: 10, length: 80 + Math.min(day.turns || 1, 6) * 14,
      tropism: lerp(0.13, 0.04, a), droop: lerp(0, 0.12, a), wiggle: 0.05,
    });
    labels.push({ branch: arm, day: index, side, text: day.date.slice(5).replace('-', '/'), kind: 'date' });
    if (day.age <= 2) leaves.push({ branch: stem, at: 2 + index * PER_DAY + 3, side: -side, size: 18 - day.age * 3, age: day.age });
    const level = day.compression || 'keywords';
    if (level === 'keywords') {
      dust.push({ branch: arm, points: dla(day.date, 40 + (day.turns || 1) * 22), age: day.age });
      labels.push({ branch: arm, day: index, side, text: mem.join(' · '), kind: 'keywords' });
      return;
    }
    threads.forEach((thread, t) => {
      const last = t === threads.length - 1;
      const turnSide = t % 2 ? -side : side;
      const branch = sprout(arm, lerp(0.45, 1, (t + 1) / threads.length), {
        key: `${arm.key}.${t}`, angle: last ? side * 0.1 : turnSide * lerp(0.55, 0.8, rand()) - side * 0.2,
        day: index, age: day.age, mem: thread.memory || [], hue: threadHue(thread),
      }, { segments: 7, length: level === 'summary' ? 66 : 46, tropism: 0.16, droop: 0.02, wiggle: 0.07 });
      labels.push({ branch, day: index, side: Math.sign(Math.sin(branch.nh[branch.n])) || side, text: thread.topic, kind: 'thread' });
      if (level === 'gist') {
        dust.push({ branch, berry: true, age: day.age });
        return;
      }
      (thread.facets || []).forEach((facet, f) => {
        const facetSide = f % 2 ? 1 : -1;
        const twig = sprout(branch, lerp(0.5, 1, (f + 1) / thread.facets.length), {
          key: `${branch.key}.${f}`, angle: facetSide * 0.6, day: index, age: day.age, mem: branch.mem, hue: branch.hue,
        }, { segments: 4, length: 30, tropism: 0.2, droop: 0, wiggle: 0.08 });
        leaves.push({ branch: twig, at: twig.n, side: facetSide, size: 15, age: day.age });
        labels.push({ branch: twig, day: index, side: facetSide, text: facet.label, kind: 'facet' });
      });
      leaves.push({ branch, at: 3, side: -turnSide, size: 13, age: day.age });
    });
  });

  // Today, raw: topic shoots arch out of the crown like a fountain grass,
  // facets curl up from them and every turn ends in a bud.
  const crownStart = 2 + past.length * PER_DAY + 1;
  todayThreads.forEach((thread, t) => {
    const rand = random(`${today.date}:${thread.topic}`);
    const side = t % 2 ? 1 : -1;
    const low = 1 - t / Math.max(todayThreads.length - 1, 1);
    const hue = threadHue(thread);
    const mem = thread.memory || [];
    clock += 0.35;
    const shoot = sprout(stem, (crownStart + t * 2) / stem.n, {
      key: `today.${t}`, angle: side * lerp(0.5, 1.0, low), day: todayIndex, mem, hue, kind: 'today',
    }, { segments: 12, length: lerp(140, 200, low) + rand() * 20, tropism: 0.04, droop: 0.32, wiggle: 0.04 });
    labels.push({ branch: shoot, day: todayIndex, side, text: thread.topic, kind: 'today' });
    leaves.push({ branch: shoot, at: 3, side: -side, size: 22, age: 0 });
    leaves.push({ branch: shoot, at: 7, side, size: 18, age: 0 });
    const facets = thread.facets || [];
    const threadTurns = turns.filter((turn) => turn.thread === t);
    facets.forEach((facet, f) => {
      const twig = sprout(shoot, lerp(0.4, 0.92, (f + 1) / facets.length), {
        key: `today.${t}.f${f}`, angle: -side * lerp(0.5, 0.8, rand()), day: todayIndex, mem, hue,
      }, { segments: 6, length: 46, tropism: 0.22, droop: 0, wiggle: 0.06 });
      labels.push({ branch: twig, day: todayIndex, side: -side, text: facet.label, kind: 'facet' });
      const mine = threadTurns.filter((_, k) => k % facets.length === f);
      if (!mine.length) leaves.push({ branch: twig, at: twig.n, side: -side, size: 16, age: 0 });
      mine.forEach((turn, j) => {
        const bud = sprout(twig, lerp(0.55, 1, (j + 1) / mine.length), {
          key: `today.${t}.f${f}.${j}`, angle: (j % 2 ? 1 : -1) * 0.5, day: todayIndex, mem, hue,
        }, { segments: 3, length: 22, tropism: 0.25, droop: 0, wiggle: 0.05 });
        flowers.push({ branch: bud, size: 12, hue: [hue, 70, 70], open: 0.3, seed: hash(bud.key), born: clock + 0.8, bud: true });
      });
    });
  });

  clock += 0.6;
  const todayMemory = (data.memory || []).find((item) => todayThreads.some((thread) => (thread.memory || []).includes(item.key)));
  flowers.push({
    branch: stem, size: today ? 62 + Math.min(turns.length, 6) * 4 : 24,
    hue: [todayMemory ? hueOf[todayMemory.key] : 350, 72, 70], open: today ? 1 : 0.12,
    seed: hash(today?.date || 'bud'), born: clock + 0.6, main: true, memory: todayMemory,
  });

  // pipe model: a branch is as thick as the tips it carries
  for (let i = branches.length - 1; i >= 0; i -= 1) {
    const branch = branches[i];
    branch.tips = Math.max(branch.tips, 1);
    if (branch.parent) branch.parent.tips += branch.tips;
  }
  branches.forEach((branch) => {
    branch.w0 = clamp(1.25 * Math.sqrt(branch.tips) * branch.thickness, 1, 13);
    branch.w1 = branch.kind === 'stem' ? 2.4 : Math.max(branch.w0 * 0.3, 0.6);
  });

  // the whole garden grows in about eight seconds, however many days it holds
  const end = Math.max(...branches.map((b) => b.born + b.dur), clock, 1);
  const pace = Math.min(1, 8 / end);
  branches.forEach((branch) => { if (branch.born > 0) { branch.born *= pace; branch.dur *= Math.max(pace, 0.6); } });
  flowers.forEach((flower) => {
    flower.born = previousKeys.has(flower.branch.key) && !flower.main ? -100 : flower.born * pace;
  });

  return {
    branches, leaves, flowers, labels, dust, days, todayIndex, stem, hueOf,
    memory: data.memory || [], mood: today?.mood, sample: data.sample, root: { x: W / 2, y: 805 }, buildAt: 0,
  };
}

// ---------- per frame: sway and grow ----------

function layout(model, now, wind) {
  for (const b of model.branches) {
    let x = model.root.x;
    let y = model.root.y;
    let h = b.angle;
    if (b.parent) {
      const k = Math.min(b.attach, b.parent.n);
      x = b.parent.px[k];
      y = b.parent.py[k];
      h += b.parent.hd[k];
    }
    h += wind * (Math.sin(now * 0.55 + b.phase) * 0.008 * (1 + b.depth) + Math.sin(now * 0.13) * 0.004);
    b.g = ease(clamp((now - model.buildAt - b.born) / b.dur));
    b.px[0] = x;
    b.py[0] = y;
    b.hd[0] = h;
    for (let i = 0; i < b.n; i += 1) {
      const step = b.steps[i];
      h += step.turn + wind * Math.sin(now * 0.9 + b.phase + i * 0.3) * 0.002 * (i / b.n);
      x += Math.sin(h) * step.len * b.g;
      y -= Math.cos(h) * step.len * b.g;
      b.px[i + 1] = x;
      b.py[i + 1] = y;
      b.hd[i + 1] = h;
    }
  }
}

// ---------- shapes: what every style draws ----------

function ribbon(b, from, to) {
  const left = [];
  const right = [];
  const grow = Math.min(1, b.g * 1.4);
  for (let i = from; i <= to; i += 1) {
    const a = Math.max(i - 1, 0);
    const c = Math.min(i + 1, b.n);
    const dx = b.px[c] - b.px[a];
    const dy = b.py[c] - b.py[a];
    const length = Math.hypot(dx, dy) || 1;
    const w = lerp(b.w0, b.w1, (i / b.n) ** 0.8) * grow / 2;
    left.push([b.px[i] - dy / length * w, b.py[i] + dx / length * w]);
    right.push([b.px[i] + dy / length * w, b.py[i] - dx / length * w]);
  }
  return left.concat(right.reverse());
}

function leafShape(x, y, angle, size, side) {
  const dx = Math.sin(angle);
  const dy = -Math.cos(angle);
  const bx = x + dx * size * 0.12;
  const by = y + dy * size * 0.12;
  const left = [];
  const right = [];
  for (let i = 0; i <= 10; i += 1) {
    const t = i / 10;
    const u = t * size;
    const bend = side * size * 0.14 * t * t;
    const w = size * 0.3 * Math.sin(Math.PI * t ** 0.75);
    left.push([bx + dx * u - dy * (bend + w), by + dy * u + dx * (bend + w)]);
    right.push([bx + dx * u - dy * (bend - w), by + dy * u + dx * (bend - w)]);
  }
  return { pts: [[x, y], ...left, ...right.reverse()], axis: [bx, by, bx + dx * size, by + dy * size] };
}

// nonflowers-style petal: a noisy width profile, in local coordinates
function petalOutline(rand, length, width) {
  const side = [];
  for (let i = 0; i <= 14; i += 1) {
    const t = i / 14;
    side.push([t * length, width * Math.sin(Math.PI * t ** 0.65) ** 0.8 * (1 + (rand() - 0.5) * 0.12)]);
  }
  return side.concat(side.slice().reverse().map(([x, w]) => [x, -w]));
}

function flowerShapes(model, flower, now, alpha, out) {
  const b = flower.branch;
  const grow = ease(clamp((now - model.buildAt - flower.born) / 2.2));
  if (grow <= 0 || b.g < 0.9) return;
  const x = b.px[b.n];
  const y = b.py[b.n];
  const rand = random(flower.seed);
  const open = flower.open * grow * (1 + Math.sin(now * 0.4 + flower.seed) * 0.04);
  const size = flower.size * lerp(0.35, 1, grow);
  const tilt = b.hd[b.n] * 0.6;
  const rings = flower.bud ? [[5, 1, 0]] : [[8, 1, 0], [6, 0.68, 0.4], [5, 0.42, 0.2]];
  const petals = [];
  rings.forEach(([count, scale, offset], ring) => {
    for (let i = 0; i < count; i += 1) {
      const phi = ((i + offset) / count) * Math.PI * 2 + rand() * 0.2;
      const elevation = lerp(1.35, lerp(0.2, 0.75, ring / 2), open);
      const vx = Math.cos(phi) * Math.cos(elevation);
      const vy = Math.sin(phi) * Math.cos(elevation) * 0.45 - Math.sin(elevation);
      petals.push({ depth: Math.sin(phi) - ring * 0.5, vx, vy, scale, phi, ring });
    }
  });
  petals.sort((p, q) => p.depth - q.depth);
  const [h, s, l] = flower.hue;
  petals.forEach((p, index) => {
    const length = Math.hypot(p.vx, p.vy) * size * p.scale;
    const rot = tilt + Math.atan2(p.vy, p.vx);
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    const local = petalOutline(random(flower.seed + Math.round(p.phi * 1000)), length, size * p.scale * 0.32);
    out.push({
      kind: 'petal', key: flower.seed + index, alpha,
      pts: local.map(([u, v]) => [x + u * cos - v * sin, y + u * sin + v * cos]),
      axis: [x, y, x + cos * length, y + sin * length],
      color: [h + p.ring * 6, s, l + (p.depth < 0 ? -8 : 0) - p.ring * 4],
    });
  });
  if (!flower.bud && open > 0.4) {
    const a = alpha * clamp((open - 0.4) * 2);
    for (let i = 0; i < 22; i += 1) {
      const angle = rand() * Math.PI * 2;
      const r = rand() * size * 0.16;
      out.push({
        kind: 'dot', key: flower.seed + 100 + i, alpha: a, r: 1.6, tone: 'stamen',
        x: x + Math.cos(angle + tilt) * r, y: y + Math.sin(angle) * r * 0.45 - size * 0.08,
        color: [44 + rand() * 12, 85, 60 + rand() * 15],
      });
    }
  }
}

function dimmer(focus) {
  return (b) => {
    if (!focus) return 1;
    if (focus.memory) return b.mem.includes(focus.memory) ? 1 : 0.22;
    return b.day === focus.day ? 1 : 0.28;
  };
}

function collect(model, now, focus) {
  const out = [];
  const dim = dimmer(focus);
  for (const b of model.branches) {
    if (b.g <= 0) continue;
    if (b.kind === 'stem') {
      // the stem is drawn day by day so its lower part ages with its days
      let from = 0;
      for (let k = 1; k <= b.n; k += 1) {
        if (k === b.n || b.dayAt(k + 1) !== b.dayAt(from + 1)) {
          const day = model.days[b.dayAt(from + 1)];
          out.push({ kind: 'ribbon', key: `stem${from}`, pts: ribbon(b, from, k), hue: STEM_HUE, age: day?.age ?? 0, alpha: dim({ ...b, day: b.dayAt(from + 1) }), w: b.w0 });
          from = k;
        }
      }
      continue;
    }
    out.push({ kind: 'ribbon', key: b.key, pts: ribbon(b, 0, b.n), hue: b.hue, age: b.age, alpha: dim(b), w: b.w0 });
  }
  for (const item of model.dust) {
    const b = item.branch;
    if (b.g < 0.95) continue;
    const x = b.px[b.n];
    const y = b.py[b.n];
    if (item.berry) {
      for (let i = 0; i < 3; i += 1) {
        out.push({ kind: 'dot', key: `${b.key}.b${i}`, x: x + Math.sin(i * 2.1 + b.phase) * 4, y: y + Math.cos(i * 2.1) * 4, r: 2.4, hue: b.hue, age: item.age, alpha: dim(b) });
      }
      continue;
    }
    const scale = 2.3;
    const links = [];
    item.points.forEach((point) => {
      if (point.parent < 0) return;
      const parent = item.points[point.parent];
      links.push([x + point.x * scale, y + point.y * scale, x + parent.x * scale, y + parent.y * scale]);
    });
    out.push({ kind: 'dust', key: b.key, links, hue: b.hue, age: item.age, alpha: dim(b) });
  }
  for (const leaf of model.leaves) {
    const b = leaf.branch;
    const k = Math.min(leaf.at, b.n);
    const g = clamp((b.g * b.n - k) / 2 + 0.3);
    if (g <= 0 || b.g < 0.3) continue;
    const shape = leafShape(b.px[k], b.py[k], b.hd[k] + leaf.side * 0.85, leaf.size * g, leaf.side);
    out.push({ kind: 'leaf', key: `${b.key}.l${k}`, ...shape, age: leaf.age, alpha: dim(b) });
  }
  for (const flower of model.flowers) flowerShapes(model, flower, now, dim(flower.branch), out);
  return out;
}
