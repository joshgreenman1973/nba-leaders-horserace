#!/usr/bin/env node
// Transform raw per-season player totals into keyframes for two views:
//
//   totals — running CAREER total at the end of each season (the cumulative
//            climb; retired players carry their total forward).
//   avg    — that SEASON's per-game average (PTS/G, TRB/G, AST/G, STL/G) for
//            players who met a minimum games-played qualifier. This view resets
//            each year, so it's a year-by-year reshuffle of season leaders.
//
// For each stat we keep only players who ever reached the top KEEP of that
// view, to bound payload. Output: data/data.json

import fs from 'node:fs';

const RAW  = JSON.parse(fs.readFileSync(new URL('./data/raw_seasons.json', import.meta.url)));
const OUT  = new URL('./data/data.json', import.meta.url);

const FIRST = Math.min(...RAW.map(r => r.year));
const LAST  = Math.max(...RAW.map(r => r.year));
const KEEP = 24;          // keep anyone who ever reached top-24 (we display 20, +buffer for smooth enter/exit)
const QUAL = 0.70;        // per-game qualifier: games >= 70% of the season's schedule

const STATS = [
  { key: 'pts', field: 'pts', label: 'Points',   short: 'PTS', accent: '#ffb01f', firstTracked: 1947 },
  { key: 'trb', field: 'trb', label: 'Rebounds', short: 'REB', accent: '#a06bff', firstTracked: 1951 },
  { key: 'ast', field: 'ast', label: 'Assists',  short: 'AST', accent: '#2fd4c8', firstTracked: 1947 },
  { key: 'stl', field: 'stl', label: 'Steals',   short: 'STL', accent: '#ff5470', firstTracked: 1974 },
];

const byYear = new Map();
for (const r of RAW) {
  if (!byYear.has(r.year)) byYear.set(r.year, []);
  byYear.get(r.year).push(r);
}
// schedule length proxy = most games any player logged that season
const schedule = new Map();
for (const [y, recs] of byYear) schedule.set(y, Math.max(...recs.map(r => r.g || 0)));

const nameOf = new Map(), debutOf = new Map(), lastOf = new Map();
for (let y = FIRST; y <= LAST; y++) {
  for (const r of (byYear.get(y) || [])) {
    nameOf.set(r.id, r.name);
    if (!debutOf.has(r.id)) debutOf.set(r.id, y);
    lastOf.set(r.id, y);   // final season the player appears in the data
  }
}

const out = { generated: new Date().toISOString().slice(0,10),
  source: 'Basketball-Reference.com (season totals)', qualifier: QUAL,
  timeline: { first: FIRST, last: LAST }, stats: {} };

for (const S of STATS) {
  const start = S.firstTracked;
  const span = LAST - start + 1;

  /* ---------- TOTALS (cumulative career) ---------- */
  const cum = new Map(), tSeries = new Map(), tEver = new Set();
  for (let y = start; y <= LAST; y++) {
    for (const r of (byYear.get(y) || [])) cum.set(r.id, (cum.get(r.id) || 0) + (r[S.field] || 0));
    const idx = y - start;
    for (const [id, total] of cum) {
      if (!tSeries.has(id)) tSeries.set(id, new Array(span).fill(null));
      if (y >= Math.max(debutOf.get(id), start)) tSeries.get(id)[idx] = total;
    }
    for (const [id] of [...cum.entries()].filter(([,v]) => v > 0).sort((a,b)=>b[1]-a[1]).slice(0, KEEP)) tEver.add(id);
  }

  /* ---------- AVG (per-game, per season) ---------- */
  const aSeries = new Map(), aEver = new Set();
  for (let y = start; y <= LAST; y++) {
    const idx = y - start;
    const minG = Math.max(8, Math.round(QUAL * (schedule.get(y) || 0)));
    const qualified = [];
    for (const r of (byYear.get(y) || [])) {
      const g = r.g || 0;
      if (g >= minG) {
        const avg = Math.round(((r[S.field] || 0) / g) * 10) / 10;
        qualified.push([r.id, avg]);
        if (!aSeries.has(r.id)) aSeries.set(r.id, new Array(span).fill(null));
        aSeries.get(r.id)[idx] = avg;
      }
    }
    for (const [id] of qualified.sort((a,b)=>b[1]-a[1]).slice(0, KEEP)) aEver.add(id);
  }

  // emit
  const mk = (everSet, series, withDebut) => {
    const players = {}, ser = {};
    for (const id of everSet) {
      players[id] = withDebut ? { name: nameOf.get(id), debut: debutOf.get(id), last: lastOf.get(id) } : { name: nameOf.get(id) };
      ser[id] = series.get(id);
    }
    return { players, series: ser, kept: everSet.size };
  };

  out.stats[S.key] = {
    label: S.label, short: S.short, accent: S.accent, firstYear: start, lastYear: LAST,
    totals: mk(tEver, tSeries, true),
    avg:    mk(aEver, aSeries, false),
  };

  const t5 = [...tEver].map(id => [nameOf.get(id), tSeries.get(id)[span-1]]).sort((a,b)=>b[1]-a[1]).slice(0,3);
  console.log(`${S.label.padEnd(9)} totals kept=${tEver.size} (${t5.map(([n,v])=>`${n} ${v}`).join(', ')}) | avg kept=${aEver.size}`);
}

fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`\nWrote ${OUT.pathname}  (${(fs.statSync(OUT).size/1024).toFixed(0)} KB)`);
