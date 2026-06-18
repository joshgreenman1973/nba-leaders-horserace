#!/usr/bin/env node
// Fetch the 3 BAA seasons (1947-1949) which live at /leagues/BAA_YYYY_totals.html
// and merge them into data/raw_seasons.json. Same parser as scrape.mjs.
import fs from 'node:fs';
const OUT = new URL('./data/raw_seasons.json', import.meta.url);
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function cell(row, stat){ const re=new RegExp(`data-stat="${stat}"[^>]*>(.*?)</t[dh]>`,'s'); const m=row.match(re); return m?m[1].replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').trim():null; }
function parse(html, year){
  const tm=html.match(/id="totals_stats"[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/); if(!tm) return [];
  const rows=tm[1].match(/<tr[^>]*>[\s\S]*?<\/tr>/g)||[]; const byP=new Map();
  for(const row of rows){
    if(row.includes('class="thead"')||!row.includes('name_display'))continue;
    const idm=row.match(/data-append-csv="([^"]+)"/); if(!idm)continue;
    const id=idm[1]; const name=(cell(row,'name_display')||'').replace(/&nbsp;/g,' ').trim();
    const team=(cell(row,'team_name_abbr')||cell(row,'team_id')||'').trim();
    const n=s=>{const v=parseInt(s,10);return Number.isFinite(v)?v:0;};
    const rec={year,id,name,team,pts:n(cell(row,'pts')),trb:n(cell(row,'trb')),ast:n(cell(row,'ast')),stl:n(cell(row,'stl'))};
    const comb=/^\d+TM$|^TOT$/.test(team);
    if(!byP.has(id))byP.set(id,rec); else if(comb)byP.set(id,rec);
  }
  return [...byP.values()];
}

const all = JSON.parse(fs.readFileSync(OUT));
const have = new Set(all.map(r=>r.year));
for (const y of [1947,1948,1949]){
  if (have.has(y)){ console.log(`${y} already present, skip`); continue; }
  const url=`https://www.basketball-reference.com/leagues/BAA_${y}_totals.html`;
  const res=await fetch(url,{headers:{'User-Agent':UA}});
  console.log(`${y}: HTTP ${res.status}`);
  if(res.ok){ const recs=parse(await res.text(), y); all.push(...recs); console.log(`  +${recs.length} players`); }
  await sleep(3500);
}
all.sort((a,b)=>a.year-b.year || b.pts-a.pts);
fs.writeFileSync(OUT, JSON.stringify(all));
console.log(`Total player-seasons now: ${all.length}, years ${Math.min(...all.map(r=>r.year))}-${Math.max(...all.map(r=>r.year))}`);
