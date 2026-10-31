# Vantage

An original first-person strategy game about energy, height and line of sight, built for the
browser. It runs fully locally, with no server.

**Play it: https://brew-your-own.github.io/vantage-the-game/**

## How to play

You are a Wisp on a hex landscape watched by the Keeper, whose lamp sweeps a beam across
the land. Standing in the beam drains your energy. Harvest energy from the land, build
Shards to gain height, and transfer into Husks to move. Drain every Relay to put the
Keeper's lamp out, then transfer onto the Keeper's plinth to win.

| Key | Action |
| --- | --- |
| Mouse / arrows | look around (click locks the mouse, Esc releases it) |
| Click or H | harvest the targeted tile, or drain a Relay |
| 1 / 2 / 3 | place a Shard / Husk / Seed |
| F | feed a Spire |
| R | transfer into the targeted Husk |
| X | scatter (escape to a random tile) |
| V / K | your view / the Keeper's sight overlay |
| O | orbit view |
| P | pause |
| U / J | all sound / music on or off |
| N | random new level |
| M | menu: levels, level code, settings, key remapping |

All game keys can be remapped in the menu. Progress and settings are saved in the browser.

## Development

```sh
npm install
npm run dev      # dev server
npm test         # unit tests
npm run build    # static build in dist/ (GitHub Pages-ready)
npm run curate   # re-pick the campaign levels (writes src/core/campaignData.ts)
npm run balance  # Moth pressure on an idle Wisp, per campaign level
```

In dev builds, the backquote key opens a panel for auditioning the adaptive music.

## Deployment

Every push to `main` runs `.github/workflows/deploy.yml`: tests, build, then publish `dist/`
to GitHub Pages (repo Settings → Pages → Source: GitHub Actions).

See [docs/PLAN.md](docs/PLAN.md) for the design and implementation plan.
