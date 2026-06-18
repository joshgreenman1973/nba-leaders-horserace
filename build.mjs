#!/usr/bin/env node
// Transform raw per-season player totals -> cumulative career-total keyframes
// for four synchronized bar-chart races (points, rebounds, assists, steals).
//
// For each stat we compute every player's RUNNING CAREER total at the end of
// each season, carrying the total forward through years they didn't play (so
// retired legends stay on the board and get chased down). We keep only players
// who ever cracked the top KEEP of the all-time list (bounds payload), and emit
// a dense per-year array from the stat's first-tracked season to LAST.
//
// Output: data/data.json

import fs from 'node:fs';

const RAW  = JSON.parse(fs.readFileSync(new URL('./data/raw_seasons.json', import.meta.url)));
const OUT  = new URL('./data/data.json', import.meta.url);

const FIRST = Math.min(...RAW.map(r => r.year));
const LAST  = Math.max(...RAW.map(r => r.year));

const KEEP = 18; // keep anyone who ever reached top-18 all-time (we display 12)

// Stat definitions. firstTracked: first season the NBA recorded the stat.
const STATS = [
  { key: 'pts', field: 'pts', label: 'Points',   short: 'PTS', accent: '#ffb01f', firstTracked: 1947 },
  { key: 'trb', field: 'trb', label: 'Rebounds', short: 'REB', accent: '#a06bff', firstTracked: 1951 },
  { key: 'ast', field: 'ast', label: 'Assists',  short: 'AST', accent: '#2fd4c8', firstTracked: 1947 },
  { key: 'stl', field: 'stl', label: 'Steals',   short: 'STL', accent: '#ff5470', firstTracked: 1974 },
];

// index raw by year for ordered accumulation
const byYear = new Map();
for (const r of RAW) {
  if (!byYear.has(r.year)) byYear.set(r.year, []);
  byYear.get(r.year).push(r);
}

// latest display name + debut per player id
const nameOf = new Map();
const debutOf = new Map();
for (let y = FIRST; y <= LAST; y++) {
  for (const r of (byYear.get(y) || [])) {
    nameOf.set(r.id, r.name);                 // last write wins -> most recent name
    if (!debutOf.has(r.id)) debutOf.set(r.id, y);
  }
}

const out = { generated: new Date().toISOString().slice(0,10), source: 'Basketball-Reference.com (season totals)', timeline: { first: FIRST, last: LAST }, stats: {} };

for (const S of STATS) {
  const start = S.firstTracked;
  const span = LAST - start + 1;

  // running cumulative per player, snapshotted each year into a dense array
  const cum = new Map();          // id -> current running total
  const series = new Map();       // id -> dense array length `span` (null before debut)
  const everTop = new Set();

  for (let y = start; y <= LAST; y++) {
    // add this season's production
    for (const r of (byYear.get(y) || [])) {
      const v = r[S.field] || 0;
      cum.set(r.id, (cum.get(r.id) || 0) + v);
    }
    const idx = y - start;
    // snapshot every player who has debuted (carry-forward handled by persistent cum)
    for (const [id, total] of cum) {
      if (!series.has(id)) series.set(id, new Array(span).fill(null));
      // only record from this player's first appearance within the tracked window
      const deb = Math.max(debutOf.get(id), start);
      if (y >= deb) series.get(id)[idx] = total;
    }
    // who is top-KEEP this year
    const ranked = [...cum.entries()].filter(([,v]) => v > 0).sort((a,b) => b[1]-a[1]).slice(0, KEEP);
    for (const [id] of ranked) everTop.add(id);
  }

  // emit only kept players
  const players = {};
  const ser = {};
  for (const id of everTop) {
    players[id] = { name: nameOf.get(id), debut: debutOf.get(id) };
    ser[id] = series.get(id).map(v => v == null ? null : Math.round(v));
  }

  out.stats[S.key] = {
    label: S.label, short: S.short, accent: S.accent,
    firstYear: start, lastYear: LAST,
    players, series: ser,
    kept: everTop.size,
  };

  // sanity: final all-time top 5
  const finalTop = [...everTop].map(id => [nameOf.get(id), series.get(id)[span-1]])
    .sort((a,b)=>b[1]-a[1]).slice(0,5);
  console.log(`${S.label.padEnd(9)} start=${start} kept=${everTop.size}  final top5: ` +
    finalTop.map(([n,v])=>`${n} ${v}`).join(' | '));
}

fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`\nWrote ${OUT.pathname}  (${(fs.statSync(OUT).size/1024).toFixed(0)} KB)`);
