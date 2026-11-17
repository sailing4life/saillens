# SailLens

Boat-first sailing analysis. The standalone `SailLens.html` and the Railway service process sailing files entirely in the browser. No sailing logs are uploaded to a server.

## Session workflow

1. **Gegevens** — choose a boat, start an independently identified session, import one or several logs/events/polars, inspect time and channel coverage. Original source files are retained. Duplicate content is skipped; conflicting overlapping measurements reject the import.
2. **Beoordelen** — select time intervals on the track/chart or with precise time fields. Review phases and tacks/gybes separately for calibration and performance. Invalid measurements are masked rather than deleted, and exclusions can be restored.
3. **Kalibratie** — use explicitly approved references. Edit a draft, compare logged/active/proposed values on the same timestamps, apply a version, or revert. BSP, heading, MHU/AWA, AWS, TWA tables, downwind TWS, heel, rudder and leeway corrections reuse the existing models.
4. **Analyse** — speed/VMG, XY, manoeuvres, wind, tables, polars and sail charts remain available. Slow time uses valid sailing time, including poor sailing; target coverage and manoeuvre/recovery windows are stated. A/B selections and notes support the debrief.

Each boat owns channel mapping, units/sign conversion, phase defaults, polars, sails, calibration history and custom formulas. Every session snapshots a profile version. Updating a boat does not silently change its old sessions. New logs start with zero additional calibration, avoiding double correction after an instrument setting was already changed onboard.

## Persistence and backup

IndexedDB stores the workspace index and complete sessions in atomic transactions. Save status changes only when a transaction commits. Session IDs are independent of boat name/date, so multiple sessions on one day remain separate. Autosave includes source text, processed-grid raw arrays, events, active/draft calibration, reviews, formulas, notes, selections and view state. The legacy season database remains separate and is restored without losing existing entries.

**Projectbackup** exports all boats and sessions, plus the season database. **Project importeren** validates the whole file and restores boats/sessions as new copies. Existing projects are not overwritten. Keep an export for device changes or browser-data cleanup: there is no account or cross-device sync.

## Custom variables

The restricted expression parser does not execute JavaScript. Use channel names, `[VMG%]` for names with punctuation, or `raw.BSP` for an original logged channel. Examples:

- `BSP * cosD(TWA)` — signed wind-axis velocity, unit `kn`.
- `100 * BSP / Target_BSP` — relative target speed, unit `%`.
- `angleDiff(TWD, raw.TWD)` — change in wind direction, unit `deg`.

Functions: `abs`, `sqrt`, `min`, `max`, `clamp`, `sinD`, `cosD`, `tanD`, `atan2D`, `wrap180`, `wrap360`, `angleDiff`, `if`, `coalesce`. Arithmetic, comparisons and boolean operators are supported. Dependencies are ordered; cycles, duplicate/reserved names and malformed expressions are rejected. Missing input, non-finite results and division by zero remain missing. Units are explicit metadata, with angle/boolean type checks; arbitrary formulas do not have automatic dimensional inference.

## Data conventions and limits

- The analysis grid is one second. Subsecond observations are averaged, circularly for angular channels. Full-resolution source files remain in the project, but the analysis engine itself is not a native-frequency engine.
- Canonical speeds use knots, angles degrees and positions decimal degrees. Boat mappings specify source channel, target channel, scale and offset. No arbitrary-header unit guessing occurs.
- Explicit timestamp zones and Unix/FILETIME timestamps become UTC. Timezone-free clocks retain their source clock; log/event offsets align them. The additional event shift is in seconds. Display offset changes labels, not measurements.
- Imported gaps retain sample age and observation count. Maximum held age defaults to two seconds. Invalid intervals affect all downstream performance/calibration calculations without modifying the source.
- Calibration review and performance review are independent. Re-detection does not transfer approvals to different phase boundaries. Old exclusions remain visible and reversible.
- Without an independent polar or logged targets, absolute data remains available but target percentages are unavailable. Learned polars are opt-in engine functionality and are not independent evidence of performance.
- Instrument-calibration changes during a session are flagged explicitly and block applying one whole-session correction. Split/select a constant-configuration session and record the baseline. Automatic calibration epochs and new multisensor/heel-table fitting are not included.
- Calibration estimates depend on suitable references, current assumptions, heading/leeway conventions and sufficiently varied conditions. A calibration score is a diagnostic heuristic. A/B and model associations do not prove causality.
- Legacy season import validates conflicts and never silently replaces a different record. Original season summaries alone do not reconstruct raw logs. Whole projects do.

## Build and test

```sh
npm ci
python3 build.py
npm test
node tests/smoke.js
python3 build.py --check
```

Production has no JavaScript dependencies. Development dependencies support DOM workflow tests with IndexedDB. The regression suite covers timezones, CSV variants, sample aggregation/gaps, calibration, session isolation, formulas/dependencies, review purpose, slow-time denominators, imports, backup/restore, save failures, navigation and reload. DOM tests mock canvas rendering and therefore do not replace a visual browser check. Synthetic fixtures and the built-in demo are used; real-boat calibration accuracy still needs representative logs and hand-checked references.

## Deploy

The Dockerfile serves the built HTML with Caddy on `$PORT`. Railway follows `main`. Commit `SailLens.html` together with its sources. GitHub Actions runs the regression suite and checks that the generated file is current.
