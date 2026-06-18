/* ============================================================
   THE CLIMB — synchronized NBA all-time leaders race engine.
   One shared clock (calendar year) drives four bar-chart races.
   Every animation frame we interpolate each player's running
   career total to a fractional year, rank, take the top N, and
   ease bar positions toward their target rank for smooth overtakes.
   ============================================================ */

const DISPLAY = 12;            // bars shown per race
const MAX_BAR = 80;            // leader bar caps here (%) leaving a gutter for the value
const SECONDS_PER_YEAR = 1.45; // base pace; scaled by speed control
const HOLD_END = 2.6;          // seconds to linger on the final frame
const EASE = 0.16;             // row-position easing toward target rank

const fmt = new Intl.NumberFormat('en-US');
const $ = (s, r = document) => r.querySelector(s);

// stable color per player id -> consistent hue as they climb
const colorCache = new Map();
function playerColor(id){
  if (colorCache.has(id)) return colorCache.get(id);
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  const sat = 62 + (h >> 3) % 22;     // 62-84
  const lit = 52 + (h >> 7) % 12;     // 52-64
  const c = `hsl(${hue} ${sat}% ${lit}%)`;
  colorCache.set(id, c);
  return c;
}

const seasonLabel = (y) => `${y - 1}–${String(y % 100).padStart(2, '0')}`;

class Race {
  constructor(stat, mount){
    this.stat = stat;                 // {label,short,accent,firstYear,lastYear,players,series}
    this.ids = Object.keys(stat.series);
    this.firstYear = stat.firstYear;
    this.lastYear  = stat.lastYear;
    this.rows = new Map();            // id -> {el, track, name, val, rank, y(displayed)}
    this.build(mount);
  }

  build(mount){
    const card = document.createElement('section');
    card.className = 'card';
    card.style.setProperty('--accent', this.stat.accent);
    card.innerHTML = `
      <div class="card-head">
        <div class="card-title">
          <span class="card-short">${this.stat.short}</span>
          <span class="card-label">${this.stat.label} &middot; all-time</span>
        </div>
        <div class="card-leader">
          <div class="leader-name">&mdash;</div>
          <div class="leader-tag">career total</div>
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
    this.gate = $('.gate', card);
    this.gateMsg = $('.gate-msg', card);
    this.raceEl.style.height = (DISPLAY * 30) + 'px';
    if (this.stat.firstYear > 1947){
      const word = this.stat.short === 'STL' ? 'Steals' : 'Rebounds';
      this.gateMsg.textContent = `${word} were first recorded by the NBA in the ${seasonLabel(this.firstYear)} season.`;
    }
  }

  // value for a player at fractional year yf
  valueAt(id, Y, frac){
    const arr = this.stat.series[id];
    const i = Y - this.firstYear;
    if (i < 0 || i >= arr.length) return 0;
    const a = arr[i];
    const b = (i + 1 < arr.length) ? arr[i + 1] : a;
    if (a == null && b == null) return 0;
    if (a == null) return (b || 0) * frac;     // debut season: grow from 0
    if (b == null) return a;                   // (carry-forward means this is rare)
    return a + (b - a) * frac;
  }

  ensureRow(id){
    let row = this.rows.get(id);
    if (row) return row;
    const el = document.createElement('div');
    el.className = 'bar';
    const c = playerColor(id);
    el.style.setProperty('--c', c);
    el.innerHTML =
      `<span class="bar-rank"></span>` +
      `<div class="bar-area"><div class="bar-track"></div><span class="bar-name">${this.stat.players[id].name}</span></div>` +
      `<span class="bar-val"></span>`;
    this.raceEl.appendChild(el);
    row = { el, area: $('.bar-area', el), track: $('.bar-track', el), name: $('.bar-name', el),
            rank: $('.bar-rank', el), val: $('.bar-val', el), y: (DISPLAY - 1) * 30, vis: false };
    el.style.transform = `translate3d(0, ${row.y}px, 0)`;
    this.rows.set(id, row);
    return row;
  }

  // Y = integer year, frac in [0,1). active = chart has started.
  render(Y, frac, active){
    if (!active){ this.gate.hidden = false; return; }
    this.gate.hidden = true;

    // compute values, rank
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
      const targetY = r * 30;
      row.y += (targetY - row.y) * EASE;
      if (Math.abs(targetY - row.y) < 0.4) row.y = targetY;
      const w = Math.max(0.6, (v / maxV) * MAX_BAR);
      row.el.style.transform = `translate3d(0, ${row.y}px, 0)`;
      row.el.style.opacity = '1';
      row.area.style.setProperty('--w', w + '%');
      row.rank.textContent = r + 1;
      row.val.textContent = fmt.format(Math.round(v));
      // name inside the bar, or outside (light text) if the bar is too short to hold it
      row.name.classList.toggle('outside', w < 30);
      row.vis = true;
    }
    // fade out rows that dropped off
    for (const [id, row] of this.rows){
      if (!visible.has(id) && row.vis){
        row.el.style.opacity = '0';
        row.vis = false;
      }
    }
    if (top.length){
      const [id, v] = top[0];
      this.leaderName.textContent = `${this.stat.players[id].name} · ${fmt.format(Math.round(v))}`;
      this.leaderName.style.color = playerColor(id);
    }
  }
}

/* ---------------- clock / orchestration ---------------- */
let DATA, races = [], FIRST, LAST, SPAN;
let T = 0;                 // fractional year offset from FIRST (0..SPAN)
let playing = true, speed = 1, last = 0, endHold = 0;

const yearEl = $('#year'), seasonEl = $('#season'), scrub = $('#scrub'),
      playBtn = $('#play'), restartBtn = $('#restart');

function frame(now){
  const dt = last ? (now - last) / 1000 : 0;
  last = now;
  if (playing){
    if (T < SPAN){
      T += (dt / SECONDS_PER_YEAR) * speed;
      if (T >= SPAN){ T = SPAN; endHold = HOLD_END; }
    } else if (endHold > 0){
      endHold -= dt;
      if (endHold <= 0){ T = 0; }   // loop
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
}

function setPlaying(p){
  playing = p;
  playBtn.innerHTML = p ? '&#10073;&#10073;' : '&#9654;';
  playBtn.classList.toggle('paused', !p);
}

async function init(){
  DATA = await (await fetch('data/data.json')).json();
  FIRST = DATA.timeline.first; LAST = DATA.timeline.last; SPAN = LAST - FIRST;
  const grid = $('#grid');
  // order: points, rebounds, assists, steals
  for (const key of ['pts','trb','ast','stl']){
    races.push(new Race(DATA.stats[key], grid));
  }

  playBtn.addEventListener('click', () => setPlaying(!playing));
  restartBtn.addEventListener('click', () => { T = 0; endHold = 0; setPlaying(true); });
  scrub.addEventListener('input', () => {
    T = (scrub.value / 1000) * SPAN; endHold = 0;
    paint();
  });
  scrub.addEventListener('pointerdown', () => setPlaying(false));
  for (const b of document.querySelectorAll('.speed')){
    b.addEventListener('click', () => {
      speed = parseFloat(b.dataset.speed);
      document.querySelectorAll('.speed').forEach(x => x.classList.toggle('is-active', x === b));
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space'){ e.preventDefault(); setPlaying(!playing); }
  });

  // AI caution popover
  const cautionBullets = [
    'Every number is a sum of official Basketball-Reference season totals — nothing is estimated or invented.',
    'Bars are cumulative CAREER totals at the end of each season, not single-season figures.',
    'Players traded mid-season are counted once, using their combined league total for that year.',
    'Rebounds begin at 1950–51 and steals at 1973–74 — the first seasons the NBA tracked them. Earlier years are intentionally blank, not zero-filled.',
    'Spot-check any career total against Basketball-Reference; verify the latest season is complete before citing current standings.'
  ];
  $('#cautionList').innerHTML = cautionBullets.map(b => `<li>${b}</li>`).join('');
  const pop = $('#caution');
  $('#aiCaution').addEventListener('click', () => pop.hidden = false);
  $('#cautionClose').addEventListener('click', () => pop.hidden = true);
  pop.addEventListener('click', (e) => { if (e.target === pop) pop.hidden = true; });

  requestAnimationFrame(frame);
}

init();
