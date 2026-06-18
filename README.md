# The Climb — NBA all-time leaders race

Four smoothly animated bar-chart races that run simultaneously on one page, showing the NBA's **all-time leaders** in points, rebounds, assists and steals as their career totals accumulate season by season, 1946–47 through 2024–25.

A single shared clock drives all four races. Each bar is a player's **cumulative career total** at the end of that season; a consistent color follows each athlete up the board, and retired players hold their place until someone climbs past them. Rebounds join the race in 1950–51 and steals in 1973–74 — the first seasons the NBA recorded them.

**Live:** https://joshgreenman1973.github.io/nba-leaders-horserace/

## Data
- Source: [Basketball-Reference.com](https://www.basketball-reference.com/) season totals (regular season, NBA/BAA).
- `scrape.mjs` / `scrape_baa.mjs` pull each season's totals page → `data/raw_seasons.json` (25,171 player-seasons).
- `build.mjs` reduces those to cumulative keyframes → `data/data.json`.
- Full method and caveats: [methodology.html](methodology.html).

Static HTML/CSS/JS, no build step, no dependencies beyond web fonts. Built with AI assistance; the pipeline is open and reproducible.
