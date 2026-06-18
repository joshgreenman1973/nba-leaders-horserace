#!/usr/bin/env node
// Scrape per-season player TOTALS from Basketball-Reference for every NBA/BAA
// season, extracting points (pts), total rebounds (trb), assists (ast), steals
// (stl). One authoritative source for consistency + currency. We keep the
// COMBINED row for traded players (team abbr matches /^\dTM$|^TOT$/) so a
// player's season is counted once. Each player is keyed by Basketball-Reference's
// unique slug (data-append-csv, e.g. "doncilu01") so accumulation is exact even
// for identical names or accented spellings.
//
// Output: data/raw_seasons.json  -> [{year, id, name, pts, trb, ast, stl}, ...]
//
// Polite: sequential, ~3.5s between requests, retry/backoff on 429/5xx.

import fs from 'node:fs';

const FIRST = 1947;            // first BAA season on BBRef
const LAST  = 2025;           // most recent completed season
const OUT   = new URL('./data/raw_seasons.json', import.meta.url);
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchSeason(year, attempt = 1) {
  const url = `https://www.basketball-reference.com/leagues/NBA_${year}_totals.html`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html' } });
  if (res.status === 429 || res.status >= 500) {
    if (attempt > 5) throw new Error(`${year}: giving up after ${attempt} tries (HTTP ${res.status})`);
    const wait = 8000 * attempt;
    console.error(`  ${year}: HTTP ${res.status}, backoff ${wait}ms (attempt ${attempt})`);
    await sleep(wait);
    return fetchSeason(year, attempt + 1);
  }
  if (res.status === 404) { console.error(`  ${year}: 404 (no season page)`); return null; }
  if (!res.ok) throw new Error(`${year}: HTTP ${res.status}`);
  return res.text();
}

// Extract the value of a data-stat cell from a row's HTML.
function cell(row, stat) {
  // matches <td ... data-stat="pts" ...>VALUE</td>, value may contain tags (strip them)
  const re = new RegExp(`data-stat="${stat}"[^>]*>(.*?)</t[dh]>`, 's');
  const m = row.match(re);
  if (!m) return null;
  return m[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim();
}

function parseSeason(html, year) {
  const tm = html.match(/id="totals_stats"[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/);
  if (!tm) { console.error(`  ${year}: no totals_stats table`); return []; }
  const body = tm[1];
  const rows = body.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || [];

  // group rows by player id; prefer combined (multi-team) row
  const byPlayer = new Map();
  for (const row of rows) {
    if (row.includes('class="thead"') || !row.includes('name_display')) continue;
    const idm = row.match(/data-append-csv="([^"]+)"/);
    if (!idm) continue;
    const id = idm[1];
    const nameRaw = cell(row, 'name_display') || '';
    const name = nameRaw.replace(/&nbsp;/g, ' ').trim();
    const team = (cell(row, 'team_name_abbr') || cell(row, 'team_id') || '').trim();
    const num = (s) => { const v = parseInt(s, 10); return Number.isFinite(v) ? v : 0; };
    const rec = {
      id, name, team,
      pts: num(cell(row, 'pts')),
      trb: num(cell(row, 'trb')),
      ast: num(cell(row, 'ast')),
      stl: num(cell(row, 'stl')),
    };
    const combined = /^\d+TM$|^TOT$/.test(team);
    if (!byPlayer.has(id)) {
      byPlayer.set(id, rec);
    } else if (combined) {
      byPlayer.set(id, rec); // overwrite per-team rows with the combined total
    }
    // if already have a record and this is a per-team row, ignore it
  }
  return [...byPlayer.values()].map(r => ({ year, ...r }));
}

async function main() {
  const all = [];
  for (let y = FIRST; y <= LAST; y++) {
    process.stdout.write(`Fetching ${y} ... `);
    let html;
    try { html = await fetchSeason(y); }
    catch (e) { console.error(`FAILED ${e.message}`); await sleep(3500); continue; }
    if (html) {
      const recs = parseSeason(html, y);
      all.push(...recs);
      console.log(`${recs.length} players`);
    }
    await sleep(3500); // be polite
  }
  fs.writeFileSync(OUT, JSON.stringify(all));
  console.log(`\nWrote ${all.length} player-seasons to ${OUT.pathname}`);
}

main();
