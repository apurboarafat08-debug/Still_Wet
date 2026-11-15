// One shore of an island, cut in half: rock, sand and water on a row of columns.
// Water flows by virtual pipes (each column pushes into its neighbour by the difference in height);
// sand slumps past its angle of repose, lower under water, and fast water carries it off.
// Every number is ours, tuned by eye.

const N = 200; // columns
const G = 600,
  DAMP = 0.999,
  DT = 0.02,
  STEPS = 2;
const TALUS_DRY = 0.6,
  TALUS_WET = 0.28,
  SLUMP = 0.25;
const SCOUR = 0.05,
  SCOUR_FLOW = 1.2;
const SEA = 13,
  WAVE_EVERY = 12,
  FIRST_WAVE = 10,
  RISE = 0.012,
  SOAK = 0.2;
const HUT = 0.84,
  HUT_HALF = 4; // the hut's place and half width, in columns
const TOP = 27; // height units shown from the floor to the top of the canvas

const rock = new Float64Array(N),
  sand = new Float64Array(N),
  water = new Float64Array(N),
  flow = new Float64Array(N);

function shore() {
  for (let i = 0; i < N; i++) {
    const x = i / (N - 1);
    const floor = 3 + 3 * x;
    // the bay's floor, a beach, then land that falls away gently so a flood runs off the far side
    const beach =
      x < 0.38
        ? 0
        : x < 0.66
        ? 15 * smooth((x - 0.38) / 0.28)
        : 15 - 9 * (x - 0.66);
    rock[i] =
      floor +
      beach +
      (x < 0.66
        ? 0.35 * Math.sin(i * 0.31) + 0.25 * Math.sin(i * 0.83 + 1)
        : 0);
    sand[i] = x > 0.3 && x < 0.7 ? 1.4 : 0.4;
    water[i] = Math.max(0, SEA - rock[i] - sand[i]);
    flow[i] = 0;
  }
}
const smooth = (t) => t * t * (3 - 2 * t);
const ground = (i) => rock[i] + sand[i];

let t = 0,
  wave = 0,
  waveAt = FIRST_WAVE,
  rise = 0,
  held = 0,
  wetFor = 0,
  washed = 0;
let best = +(localStorage.getItem("shore-best") || 0);
const pour = { on: false, x: 0, y: 0 };

function sea() {
  const since = t - (waveAt - WAVE_EVERY);
  const a = 3 + 0.9 * wave;
  const pulse =
    since > 0 && since < 1.6 && wave > 0
      ? Math.sin((Math.PI * since) / 1.6)
      : 0;
  return SEA + rise + a * pulse;
}

function step(dt) {
  t += dt;
  if (t >= waveAt) {
    // the wave before this one is held if the hut is still dry when this one rises
    if (washed <= 0 && wave > held) {
      held = wave;
      if (held > best) {
        best = held;
        localStorage.setItem("shore-best", best);
      }
    }
    wave++;
    waveAt += WAVE_EVERY;
  }
  rise += RISE * dt;

  // the sea holds the left edge at its level
  water[0] = Math.max(0, sea() - ground(0));

  // pipes between i and i+1
  for (let i = 0; i < N - 1; i++) {
    const dh = ground(i) + water[i] - ground(i + 1) - water[i + 1];
    flow[i] = flow[i] * DAMP + dt * G * dh;
    if (flow[i] > 0 && water[i] <= 0) flow[i] = 0;
    if (flow[i] < 0 && water[i + 1] <= 0) flow[i] = 0;
  }
  flow[N - 1] = water[N - 1] > 0 ? Math.min(water[N - 1] / dt, 2) : 0; // the land's far side drains
  // no column gives more than it holds
  for (let i = 0; i < N; i++) {
    const out = Math.max(0, flow[i]) + (i > 0 ? Math.max(0, -flow[i - 1]) : 0);
    if (out * dt > water[i] && out > 0) {
      const k = water[i] / (out * dt);
      if (flow[i] > 0) flow[i] *= k;
      if (i > 0 && flow[i - 1] < 0) flow[i - 1] *= k;
    }
  }
  for (let i = 0; i < N; i++) {
    water[i] += dt * ((i > 0 ? flow[i - 1] : 0) - flow[i]);
    if (ground(i) > SEA + rise) water[i] = Math.max(0, water[i] - SOAK * dt); // dry land drinks a puddle
    if (water[i] < 1e-6) water[i] = 0;
  }

  // fast water scours sand and drops it where it slows
  for (let i = 0; i < N - 1; i++) {
    const f = Math.abs(flow[i]);
    if (f <= SCOUR_FLOW) continue;
    const from = flow[i] > 0 ? i : i + 1,
      to = flow[i] > 0 ? i + 1 : i;
    if (water[from] <= 0.05) continue;
    const take = Math.min(sand[from], SCOUR * (f - SCOUR_FLOW) * dt);
    sand[from] -= take;
    sand[to] += take;
  }

  // sand slumps past its angle of repose
  for (let i = 0; i < N - 1; i++) {
    const d = ground(i) - ground(i + 1);
    const wet = water[i] > 0.05 || water[i + 1] > 0.05;
    const talus = wet ? TALUS_WET : TALUS_DRY;
    if (Math.abs(d) <= talus) continue;
    const from = d > 0 ? i : i + 1,
      to = d > 0 ? i + 1 : i;
    const move = Math.min(sand[from], SLUMP * (Math.abs(d) - talus));
    sand[from] -= move;
    sand[to] += move;
  }

  // the hand pours
  if (pour.on) {
    const c = Math.round(pour.x * (N - 1)),
      hand = (base - pour.y * H) / unit;
    for (let k = -4; k <= 4; k++) {
      const j = c + k; // sand never piles above the hand
      if (j > 0 && j < N && ground(j) < hand)
        sand[j] += dt * 7 * Math.exp(-(k * k) / 5);
    }
  }

  // the hut
  const h = Math.round(HUT * (N - 1));
  let deep = 0;
  for (let k = -HUT_HALF; k <= HUT_HALF; k++)
    deep = Math.max(deep, water[h + k]);
  if (washed > 0) {
    washed -= dt;
    if (washed <= 0) {
      rise = 0;
      held = 0;
      wave = 0;
      waveAt = t + FIRST_WAVE;
    }
  } else if (deep > 0.25) {
    wetFor += dt;
    if (wetFor > 0.3) {
      washed = 2.4;
      wetFor = 0;
    }
  } else wetFor = 0;
}

// drawing
const cv = document.getElementById("c"),
  cx = cv.getContext("2d");
let W = 0,
  H = 0,
  dpr = 1,
  unit = 1,
  base = 0,
  paper,
  hatch,
  grain;
const css = (v) =>
  getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const C = {};

function resize() {
  dpr = Math.min(2, window.devicePixelRatio || 1);
  W = cv.clientWidth;
  H = cv.clientHeight;
  cv.width = Math.round(W * dpr);
  cv.height = Math.round(H * dpr);
  cx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // a narrow screen keeps the slopes' true steepness: a height unit is at most seven columns tall
  unit = Math.min((H * 0.8) / TOP, (W / N) * 7);
  base = Math.min(H - 8, H * 0.5 + TOP * unit * 0.5 + 40);
  for (const k of ["paper", "ink", "pencil", "sand", "wash", "lava"])
    C[k] = css("--" + k);
  paper = makePaper();
  hatch = makeHatch();
  grain = makeGrain();
}

function makePaper() {
  const p = document.createElement("canvas");
  p.width = 256;
  p.height = 256;
  const g = p.getContext("2d");
  g.fillStyle = C.paper;
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1800; i++) {
    g.fillStyle = `rgba(43,38,34,${Math.random() * 0.05})`;
    g.fillRect(
      Math.random() * 256,
      Math.random() * 256,
      1,
      1 + Math.random() * 2
    );
  }
  return cx.createPattern(p, "repeat");
}
function makeHatch() {
  const p = document.createElement("canvas");
  p.width = 9;
  p.height = 9;
  const g = p.getContext("2d");
  g.fillStyle = "#e3d9c2";
  g.fillRect(0, 0, 9, 9);
  g.strokeStyle = "rgba(43,38,34,0.35)";
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(-1, 10);
  g.lineTo(10, -1);
  g.stroke();
  return cx.createPattern(p, "repeat");
}
function makeGrain() {
  const p = document.createElement("canvas");
  p.width = 64;
  p.height = 64;
  const g = p.getContext("2d");
  g.fillStyle = C.sand;
  g.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 220; i++) {
    g.fillStyle =
      Math.random() < 0.5 ? "rgba(43,38,34,0.22)" : "rgba(244,238,221,0.35)";
    g.beginPath();
    g.arc(Math.random() * 64, Math.random() * 64, 0.5 + Math.random(), 0, 7);
    g.fill();
  }
  return cx.createPattern(p, "repeat");
}

const X = (i) => (i / (N - 1)) * W;
const Y = (h) => base - h * unit;

function band(lower, upper, fill) {
  cx.beginPath();
  cx.moveTo(X(0), Y(upper(0)));
  for (let i = 1; i < N; i++) cx.lineTo(X(i), Y(upper(i)));
  for (let i = N - 1; i >= 0; i--) cx.lineTo(X(i), Y(lower(i)));
  cx.closePath();
  cx.fillStyle = fill;
  cx.fill();
}
function line(top, style, width) {
  cx.beginPath();
  cx.moveTo(X(0), Y(top(0)));
  for (let i = 1; i < N; i++) cx.lineTo(X(i), Y(top(i)));
  cx.strokeStyle = style;
  cx.lineWidth = width;
  cx.lineJoin = "round";
  cx.stroke();
}

function draw() {
  cx.fillStyle = paper;
  cx.fillRect(0, 0, W, H);
  band(
    () => -H / unit,
    (i) => rock[i],
    hatch
  );
  band((i) => rock[i], ground, grain);
  line(ground, C.ink, 1.6);

  // water: a wash over the ground, its surface inked, foam where it runs fast
  cx.globalAlpha = 0.55;
  band(ground, (i) => ground(i) + water[i], C.wash);
  cx.globalAlpha = 1;
  cx.beginPath();
  let on = false;
  for (let i = 0; i < N; i++) {
    if (water[i] > 0.03) {
      const x = X(i),
        y = Y(ground(i) + water[i]);
      on ? cx.lineTo(x, y) : cx.moveTo(x, y);
      on = true;
    } else on = false;
  }
  cx.strokeStyle = C.wash;
  cx.lineWidth = 1.4;
  cx.stroke();
  cx.fillStyle = C.paper;
  for (let i = 1; i < N - 1; i++) {
    if (Math.abs(flow[i]) > 2.5 && water[i] > 0.1) {
      const x = X(i) + (Math.random() - 0.5) * 4,
        y = Y(ground(i) + water[i]) + Math.random() * 3;
      cx.fillRect(x, y, 2, 1.4);
    }
  }

  drawHut();

  // the hand's stream of sand
  if (pour.on) {
    const c = Math.round(pour.x * (N - 1)),
      gy = Y(ground(c) + water[c]);
    cx.fillStyle = C.sand;
    for (let y = pour.y * H; y < gy; y += 5) {
      cx.fillRect(
        pour.x * W + (Math.random() - 0.5) * 6,
        y + Math.random() * 5,
        2,
        2
      );
    }
    cx.strokeStyle = C.ink;
    cx.lineWidth = 1.2;
    cx.beginPath();
    cx.arc(pour.x * W, pour.y * H, 9, 0, 7);
    cx.stroke();
  }
}

// seconds of the page, not of the sea: the sea runs STEPS * DT * 60 of its seconds in one of ours
function nextWave() {
  if (washed > 0) return "";
  const left = Math.max(0, waveAt - t) / (STEPS * DT * 60);
  return left < 0.6
    ? " · here it comes"
    : ` · wave ${wave + 1} in ${Math.ceil(left)}`;
}

function drawHut() {
  const h = Math.round(HUT * (N - 1));
  const x = X(h),
    y = Y(ground(h)),
    s = Math.max(18, Math.min(28, W / 40));
  cx.save();
  cx.translate(x, y);
  if (washed > 0) {
    const k = 1 - washed / 2.4;
    cx.translate(k * s * 3, -k * s);
    cx.rotate(k * 0.9);
  }
  cx.fillStyle = C.paper;
  cx.strokeStyle = C.ink;
  cx.lineWidth = 1.5;
  cx.beginPath();
  cx.rect(-s / 2, -s * 0.7, s, s * 0.7);
  cx.fill();
  cx.stroke();
  cx.fillStyle = C.lava;
  cx.beginPath();
  cx.moveTo(-s * 0.7, -s * 0.66);
  cx.lineTo(0, -s * 1.3);
  cx.lineTo(s * 0.7, -s * 0.66);
  cx.closePath();
  cx.fill();
  cx.stroke();
  cx.fillStyle = C.ink;
  cx.fillRect(-s * 0.12, -s * 0.36, s * 0.24, s * 0.36);
  cx.restore();
  if (washed > 0) {
    cx.fillStyle = C.ink;
    cx.font = "italic 16px " + getComputedStyle(document.body).fontFamily;
    cx.textAlign = "center";
    cx.fillText("the hut is wet. again.", x - s * 3, Y(TOP * 0.95));
    cx.textAlign = "left";
  }
}

const heldEl = document.getElementById("held"),
  bestEl = document.getElementById("best"),
  nextEl = document.getElementById("next"),
  wavesEl = document.getElementById("waves");
function frame() {
  for (let k = 0; k < STEPS; k++) step(DT);
  draw();
  heldEl.textContent = held;
  bestEl.textContent = best;
  nextEl.textContent = nextWave();
  wavesEl.textContent = held === 1 ? "wave" : "waves";
  requestAnimationFrame(frame);
}

function at(e) {
  const r = cv.getBoundingClientRect();
  pour.x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  pour.y = (e.clientY - r.top) / r.height;
}
cv.addEventListener("pointerdown", (e) => {
  pour.on = true;
  at(e);
  cv.setPointerCapture(e.pointerId);
});
cv.addEventListener("pointermove", (e) => {
  if (pour.on) at(e);
});
for (const ev of ["pointerup", "pointercancel"])
  cv.addEventListener(ev, () => {
    pour.on = false;
  });
window.addEventListener("resize", resize);

shore();
resize();
window.shore = {
  step,
  water,
  sand,
  rock,
  get wave() {
    return wave;
  },
  get held() {
    return held;
  },
  get washed() {
    return washed;
  },
  HUT,
  N
};
requestAnimationFrame(frame);
