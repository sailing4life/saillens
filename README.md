# SailLens

Sailing log analysis in one HTML file. Open `SailLens.html` in Chrome or Edge, or use the hosted copy; logs, events, polars and the season database are processed in the browser and never uploaded.

## What it does

- Home dashboard: the day in a few sentences, time given away against target per leg, track.
- Reads Expedition logs (`.csv`), RaceReplay / OnboardAssistant event files (`.ev.xml`), Expedition polars and RaceReplay crossover charts.
- Phases, bin report, leg averages, distributions, map replay, performance against targets, XY graphs with selectable trend lines, polar.
- Events editor that saves `.ev.xml`; start analysis.
- Manoeuvres: every tack and gybe lined up on the turn, losses by direction, wind and sail.
- Wind: trend, swing, gusts and shifts through the day.
- Calibration models: BSP factor, heading, current before and after each tack, leeway, TWA (upwash) table, TWS up/down, masthead offset; a calibration file that is applied to the log.
- Sail chart: compare the sails used with the crossover chart, edit it, save it.
- Season database of phases across days, with sail crossovers and day-by-day trends.
- Report for printing to PDF.

## Build

    python3 build.py

joins `src/index.html` and the scripts in `src/` into `SailLens.html`. There are no dependencies.

## Deploy

The `Dockerfile` serves `SailLens.html` with Caddy on `$PORT`. On Railway, connect this repository to a service; every push to `main` redeploys. Commit the rebuilt `SailLens.html` together with the source change.
