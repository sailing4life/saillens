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

Run `npm test` (Node 20+) for the data regression checks and `python build.py --check` to verify that the committed HTML matches the sources. CI runs both checks.

## Data conventions and limits

- Speeds are assumed to be knots, angles degrees, latitude/longitude decimal degrees. Units are not inferred or converted from arbitrary CSV headers.
- Explicit timestamp offsets and Unix/FILETIME timestamps are converted to UTC. Timezone-free calendar and Excel timestamps retain their file clock; configure the log/event UTC offsets. Mixed clock conventions in one log are rejected. Calendar dates use year-month-day or day-month-year.
- The analysis grid is one second. Multiple measurements in the same second are averaged, with circular averaging for headings and wind angles. Original subsecond observations are not retained. This limits the time resolution of manoeuvre analysis; keep the original logs.
- Import quality lists observed, held and missing seconds per channel. Held values have a recorded age. Processing uses a maximum age of two seconds by default (configurable from zero to ten); older values are excluded. This threshold is a processing choice, not a guarantee that a sensor reading is accurate.
- Calculated channels use separate arrays. Invalid windows/settings fail explicitly. Phases cannot cross a race, leg, mode, tack, testing-state or sail transition, or an unacceptable gap in the required BSP/TWA/TWS channels.
- A complete calibration score requires valid BSP/heading, wind-angle, up/down wind-speed and AWA estimates. Missing estimates produce no overall score. A score is a diagnostic heuristic, not a calibrated confidence probability.
- Season schema v2 stores separate sessions with their processing configuration, calibration, polar rows, event data and source filenames. It stores aggregate phases and manoeuvres, not raw logs; the saved recipe does not by itself reproduce a session without the source files. Existing v1 season files remain readable.
- Exact reimports are skipped. Conflicting IDs and overlapping time ranges for the same boat reject the whole import, preserving the existing season. Export a backup and explicitly remove the old session before replacing it. Imported files are not automatically opened for writing; a file becomes a save target only after **Save season file**.
- Browser storage is local to the browser and origin. Clearing browser data or changing the website address can make it unavailable. Export season files as independent backups. Save status is updated only after the browser transaction or file write completes.
- RaceReplay phases with no recognised sailing mode are labelled **Unknown** instead of being treated as upwind. Review imports before pooling them. Select sessions from one boat when comparing performance or deriving calibration.

## Validation still needed before release

The automated fixtures cover timestamp offsets, 25 Hz aggregation, sparse Expedition rows, CSV quoting, missing values, phase boundaries, repeatable processing, calibration coverage, session conflicts and storage failures. The built-in demo also runs through the full processing pipeline.

Validate representative real Expedition logs together with their event and polar files against known times and a few hand-calculated phase averages before merging. Native high-frequency storage, automatic source-file matching, cross-device recovery and independent validation of the calibration/ML models remain separate work.

## Deploy

The `Dockerfile` serves `SailLens.html` with Caddy on `$PORT`. On Railway, connect this repository to a service; every push to `main` redeploys. Commit the rebuilt `SailLens.html` together with the source change.
