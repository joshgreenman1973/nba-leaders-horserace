/* ============================================================
   THE CLIMB — synchronized NBA leaders race engine.
   One shared clock (calendar year) drives four bar-chart races.
   Two modes, toggled live:
     totals — running CAREER total at the end of each season (cumulative climb)
     avg    — that SEASON's per-game average (resets + reshuffles each year)
   Every frame we interpolate each player's value to a fractional year,
   rank, take the top N, and ease bar positions for smooth overtakes.
   ============================================================ */

const DISPLAY = 20;            // bars shown per race
const ROW = 28;               // px height of each bar row (keep in sync with --row-h)
const MAX_BAR = 80;            // leader bar caps here (%) leaving a gutter for the value
const SECONDS_PER_YEAR = 1.45; // base seconds per season; scaled by speed control
// per-mode pace: the season per-game board reshuffles hard every year, so give
// it more time per season to breathe; the cumulative views stay brisk.
const PACE = { totals: 1.45, avg: 2.6, cavg: 1.45 };
const HOLD_END = 2.6;          // seconds to linger on the final frame
const EASE = 0.16;             // row-position easing toward target rank

const fmt = new Intl.NumberFormat('en-US');
const $ = (s, r = document) => r.querySelector(s);

// stable color per player id -> consistent hue across years and modes
const colorCache = new Map();
function playerColor(id){
  if (colorCache.has(id)) return colorCache.get(id);
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const c = `hsl(${h % 360} ${62 + (h >> 3) % 22}% ${52 + (h >> 7) % 12}%)`;
  colorCache.set(id, c);
  return c;
}

const seasonLabel = (y) => `${y - 1}–${String(y % 100).padStart(2, '0')}`;

class Race {
  constructor(stat, mount, mode){
    this.stat = stat;                 // {label,short,accent,firstYear,lastYear, totals:{}, avg:{}}
    this.firstYear = stat.firstYear;
    this.lastYear  = stat.lastYear;
    this.rows = new Map();
    this.visibleIds = new Set();       // players currently in this race's top N
    this.build(mount);
    this.applyMode(mode);
  }

  build(mount){
    const card = document.createElement('section');
    card.className = 'card';
    card.style.setProperty('--accent', this.stat.accent);
    card.innerHTML = `
      <div class="card-head">
        <div class="card-title">
          <span class="card-short">${this.stat.short}</span>
          <span class="card-label"></span>
        </div>
        <div class="card-leader">
          <div class="leader-name">&mdash;</div>
          <div class="leader-tag"></div>
        </div>
      </div>
      <div class="race"></div>
      <div class="gate" hidden>
        <div class="gate-stat">${this.stat.short}</div>
        <div class="gate-msg"></div>
      </div>`;
    mount.appendChild(card);
    this.raceEl = $('.race', card);
    this.leaderName = $('.leader-name', card);
    this.leaderTag = $('.leader-tag', card);
    this.cardLabel = $('.card-label', card);
    this.gate = $('.gate', card);
    this.raceEl.style.height = (DISPLAY * ROW) + 'px';
    if (this.firstYear > 1947){
      const word = this.stat.short === 'STL' ? 'Steals' : 'Rebounds';
      $('.gate-msg', card).textContent =
        `${word} were first recorded by the NBA in the ${seasonLabel(this.firstYear)} season.`;
    }
  }

  applyMode(mode){
    this.mode = mode;
    const d = this.stat[mode];          // {players, series}
    this.players = d.players;
    this.series = d.series;
    this.ids = Object.keys(d.series);
    const sub = { totals: 'all-time', avg: 'per game · season', cavg: 'per game · career' }[mode];
    const tag = { totals: 'career total', avg: 'season per game', cavg: 'career per game' }[mode];
    this.cardLabel.innerHTML = `${this.stat.label} &middot; ${sub}`;
    this.leaderTag.textContent = tag;
    this.raceEl.innerHTML = '';
    this.rows = new Map();
    this.leaderName.textContent = '—';
  }

  // totals are whole numbers; both per-game views show one decimal
  fmtVal(v){ return this.mode === 'totals' ? fmt.format(Math.round(v)) : v.toFixed(1); }

  // value for a player at fractional year (Y + frac), interpolated between the
  // two bracketing seasons so bars flow continuously like a real horserace chart.
  // Values are exact at every whole season (frac === 0); the scrubber snaps to
  // whole seasons so a paused/inspected frame always reads a real figure.
  valueAt(id, Y, frac){
    const arr = this.series[id];
    const i = Y - this.firstYear;
    if (i < 0 || i >= arr.length) return 0;
    const a = arr[i];
    const b = (i + 1 < arr.length) ? arr[i + 1] : a;
    if (a == null && b == null) return 0;
    if (a == null) return (b || 0) * frac;                          // enter: grow from 0
    if (b == null) return this.mode === 'avg' ? a * (1 - frac) : a; // avg: fade out; totals: carry
    return a + (b - a) * frac;
  }

  ensureRow(id){
    let row = this.rows.get(id);
    if (row) return row;
    const el = document.createElement('div');
    el.className = 'bar';
    el.style.setProperty('--c', playerColor(id));
    el.innerHTML =
      `<span class="bar-rank"></span>` +
      `<div class="bar-area"><div class="bar-track"><span class="bar-flag" aria-hidden="true">✦</span></div><span class="bar-name">${this.players[id].name}</span></div>` +
      `<span class="bar-val"></span>`;
    this.raceEl.appendChild(el);
    row = { el, area: $('.bar-area', el), track: $('.bar-track', el), name: $('.bar-name', el),
            rank: $('.bar-rank', el), val: $('.bar-val', el), y: (DISPLAY - 1) * ROW, vis: false };
    el.style.transform = `translate3d(0, ${row.y}px, 0)`;
    this.rows.set(id, row);
    return row;
  }

  render(Y, frac, active){
    if (!active){ this.gate.hidden = false; this.visibleIds = new Set(); return; }
    this.gate.hidden = true;

    const scored = [];
    for (const id of this.ids){
      const v = this.valueAt(id, Y, frac);
      if (v > 0) scored.push([id, v]);
    }
    scored.sort((p, q) => q[1] - p[1]);
    const top = scored.slice(0, DISPLAY);
    const maxV = top.length ? top[0][1] : 1;

    const visible = new Set();
    for (let r = 0; r < top.length; r++){
      const [id, v] = top[r];
      visible.add(id);
      const row = this.ensureRow(id);
      const targetY = r * ROW;
      row.y += (targetY - row.y) * EASE;
      if (Math.abs(targetY - row.y) < 0.4) row.y = targetY;
      const w = Math.max(0.6, (v / maxV) * MAX_BAR);
      // In the cumulative views (career totals / career per-game), dim a player
      // once the clock passes their final season — their figure is now fixed.
      const retired = this.mode !== 'avg' && this.players[id].last != null && this.players[id].last < Y;
      row.el.style.transform = `translate3d(0, ${row.y}px, 0)`;
      row.el.style.opacity = retired ? '0.55' : '1';
      row.el.classList.toggle('retired', retired);
      row.area.style.setProperty('--w', w + '%');
      row.rank.textContent = r + 1;
      row.val.textContent = this.fmtVal(v);
      row.name.classList.toggle('outside', w < 30);
      row.vis = true;
    }
    for (const [id, row] of this.rows){
      if (!visible.has(id) && row.vis){ row.el.style.opacity = '0'; row.vis = false; }
    }
    if (top.length){
      const [id, v] = top[0];
      this.leaderName.textContent = `${this.players[id].name} · ${this.fmtVal(v)}`;
      this.leaderName.style.color = playerColor(id);
    }
    this.visibleIds = visible;
  }

  // Highlight players who are simultaneously on another chart right now.
  applyMulti(multi){
    for (const [id, row] of this.rows){
      row.el.classList.toggle('multi', this.visibleIds.has(id) && multi.has(id));
    }
  }
}

/* ---------------- clock / orchestration ---------------- */
let DATA, races = [], FIRST, LAST, SPAN, mode = 'totals';
let T = 0;
let playing = true, speed = 1, last = 0, endHold = 0;

const yearEl = $('#year'), seasonEl = $('#season'), scrub = $('#scrub'),
      playBtn = $('#play'), restartBtn = $('#restart');

const HINTS = {
  totals: 'running career sum, season by season',
  avg: 'each season’s per-game leaders, reshuffled yearly',
  cavg: 'running career per-game average, climbs slowly',
};
const FOOT = {
  totals: 'Bars show each player’s <strong>running career total</strong> at the end of every season. Retired players hold their place and get chased down. A consistent color follows each athlete up the board.',
  avg: 'Bars show each player’s <strong>per-game average for that single season</strong> (season total ÷ games played), among players meeting a minimum games-played qualifier. The board reshuffles every year. A consistent color follows each athlete.',
  cavg: 'Bars show each player’s <strong>running career per-game average</strong> (career total ÷ career games to date), updated every season, for players with at least 400 career games. Cumulative, so it climbs slowly and holds after retirement.',
};

function frame(now){
  const dt = last ? (now - last) / 1000 : 0;
  last = now;
  if (playing){
    if (T < SPAN){
      T += (dt / (PACE[mode] || SECONDS_PER_YEAR)) * speed;
      if (T >= SPAN){ T = SPAN; endHold = HOLD_END; }
    } else if (endHold > 0){
      endHold -= dt;
      if (endHold <= 0){ T = 0; }
    }
    scrub.value = Math.round((T / SPAN) * 1000);
  }
  paint();
  requestAnimationFrame(frame);
}

function paint(){
  const yf = FIRST + Math.min(T, SPAN);
  const Y = Math.floor(yf);
  const frac = yf - Y;
  yearEl.textContent = Y;
  seasonEl.textContent = seasonLabel(Y);
  for (const race of races) race.render(Y, frac, Y >= race.firstYear);
  // cross-chart pass: who is on two or more boards at the same moment
  const count = new Map();
  for (const race of races)
    for (const id of race.visibleIds) count.set(id, (count.get(id) || 0) + 1);
  const multi = new Set();
  for (const [id, c] of count) if (c >= 2) multi.add(id);
  for (const race of races) race.applyMulti(multi);
}

function setPlaying(p){
  playing = p;
  playBtn.innerHTML = p ? '&#10073;&#10073;' : '&#9654;';
  playBtn.classList.toggle('paused', !p);
}

function setMode(m){
  if (m === mode) return;
  mode = m;
  for (const race of races) race.applyMode(m);
  document.querySelectorAll('.mode').forEach(b => b.classList.toggle('is-active', b.dataset.mode === m));
  $('#modeHint').textContent = HINTS[m];
  $('#footLede').innerHTML = FOOT[m];
  paint();
}

async function init(){
  DATA = await (await fetch('data/data.json')).json();
  FIRST = DATA.timeline.first; LAST = DATA.timeline.last; SPAN = LAST - FIRST;
  const grid = $('#grid');
  for (const key of ['pts','trb','ast','stl']) races.push(new Race(DATA.stats[key], grid, mode));

  playBtn.addEventListener('click', () => setPlaying(!playing));
  restartBtn.addEventListener('click', () => { T = 0; endHold = 0; setPlaying(true); });
  scrub.addEventListener('input', () => {
    T = (scrub.value / 1000) * SPAN;
    if (mode === 'avg') T = Math.round(T);   // land on a real season so per-game figures are exact
    endHold = 0; paint();
  });
  scrub.addEventListener('pointerdown', () => setPlaying(false));
  for (const b of document.querySelectorAll('.speed')){
    b.addEventListener('click', () => {
      speed = parseFloat(b.dataset.speed);
      document.querySelectorAll('.speed').forEach(x => x.classList.toggle('is-active', x === b));
    });
  }
  for (const b of document.querySelectorAll('.mode')){
    b.addEventListener('click', () => setMode(b.dataset.mode));
  }
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space'){ e.preventDefault(); setPlaying(!playing); }
  });

  const cautionBullets = [
    'Every number comes from official Basketball-Reference season totals — nothing is estimated or invented.',
    'Three views: “Career totals” is cumulative; “Per game · season” is one season’s total ÷ its games; “Per game · career” is career total ÷ career games to date.',
    'Per-game (season) leaders need 70% of the season’s schedule in games; per-game (career) leaders need 400 career games — so small samples can’t top either board, like the NBA’s own rate-stat rules.',
    'Players traded mid-season are counted once, using their combined league total for that year.',
    'Rebounds begin at 1950–51 and steals at 1973–74 — the first seasons the NBA tracked them. Earlier years are intentionally blank, not zero-filled.',
    'Spot-check any figure against Basketball-Reference; current standings shift as active players keep accumulating.'
  ];
  $('#cautionList').innerHTML = cautionBullets.map(b => `<li>${b}</li>`).join('');
  const pop = $('#caution');
  $('#aiCaution').addEventListener('click', () => pop.hidden = false);
  $('#cautionClose').addEventListener('click', () => pop.hidden = true);
  pop.addEventListener('click', (e) => { if (e.target === pop) pop.hidden = true; });

  requestAnimationFrame(frame);
}

init();
