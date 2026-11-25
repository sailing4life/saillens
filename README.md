# SailLens

Boat-first sailing analysis runs in the browser. The hosted app can synchronize a session across devices when its owner enables online storage.

## Session workflow

1. **Log** — choose a boat, import logs/events/polars, inspect the map and channels. Source files are retained; duplicate imports are skipped and conflicting measurements rejected.
2. **Events** — place starts, finishes, marks and sail changes at the map/time cursor. Mark selected intervals as races, training or motoring. Edit, undo deletion and export events.
3. **Fases** — explicitly generate using race, sail, mode, tack, time selection and stability criteria. Saved boundaries remain fixed through calibration. Changes to event timing, race or sail context and source settings require regeneration before publishing. Editing an event note preserves generated phases.
4. **Manoeuvreparen** — review tacks/gybes one at a time, with suggested stable before/after windows, draggable boundaries and aligned BSP, AWA, TWD and heel traces. Add or move a missed manoeuvre at the map/time cursor. Reserve pairs for independent wind validation; overlapping fitting windows are excluded. Coverage, stability, opposite tacks, sail changes and invalid data govern eligibility. Approval or skipping for calibration does not remove poor performance from analysis.
5. **Kalibratie** — compare logged, active and proposed values on identical references, then apply or revert. The readiness summary shows phase freshness, approved pairs and instrument consistency. Unapplied drafts must be applied or explicitly replaced by the active calibration before **Sessie opslaan & analyseren** creates a frozen input version.
6. **Analyse** — separate workspace with shared filters, overview, day charts, speed/VMG, XY/correlations, insights, manoeuvres, prestart, distributions, wind, tables, polar and sails. For prestart, enter the two line endpoints for the selected gun to see distance and a projected crossing time based on COG/SOG. Slow periods can be paired with a faster reference under comparable sail, tack, mode, TWS and TWA.
7. **Report** — add chosen cards, annotate and reorder. Chart images and table results retain their filters, settings and session version. Recalibration never silently refreshes them; explicit refresh preserves the previous result in history, restores the working analysis filters afterwards, and offers an undo button. Export standalone HTML or print/PDF.

Each boat owns channel mapping, units/sign conversion, phase defaults, polars, sails, calibration history and custom formulas. Every session snapshots a profile version. Updating a boat does not silently change its old sessions. New logs start with zero additional calibration, avoiding double correction after an instrument setting was already changed onboard.

## Persistence and backup

IndexedDB stores the workspace index and complete sessions in atomic transactions. Save status changes only when a transaction commits. Session IDs are independent of boat name/date, so multiple sessions on one day remain separate. Autosave includes source text, processed-grid raw arrays, events, active/draft calibration, reviews, formulas, notes, selections and view state, plus saved analysis versions and report snapshots. The legacy season database remains separate and is restored without losing existing entries.

**Projectbackup** exports all boats and sessions, plus the season database. **Project importeren** validates the whole file and restores boats/sessions as new copies. Restored analysis versions and report references are remapped together to the new boat/session IDs.

### Open the same session on another computer

Open the session on the first computer and choose **Online sessie → Sessie online zetten**. Once the first upload finishes, choose **Privélink kopiëren**. Open that link on the other computer. Both devices retain the session in their local session list and synchronize subsequent edits. Each private link grants read and edit access to one complete session, including its original logs, boat settings, calibration and reports.

SailLens saves locally first and uploads changed data in the background. The online status shows when you can switch devices. If both computers edit the same revision, **Online versie ophalen en lokale kopie bewaren** opens the newer online revision and keeps that computer's work as a separate local session.

## Custom variables

The restricted expression parser does not execute JavaScript. Use channel names, `[VMG%]` for names with punctuation, or `raw.BSP` for an original logged channel. Examples:

- `BSP * cosD(TWA)` — signed wind-axis velocity, unit `kn`.
- `100 * BSP / Target_BSP` — relative target speed, unit `%`.
- `angleDiff(TWD, raw.TWD)` — change in wind direction, unit `deg`.

Functions: `abs`, `sqrt`, `min`, `max`, `clamp`, `sinD`, `cosD`, `tanD`, `atan2D`, `wrap180`, `wrap360`, `angleDiff`, `if`, `coalesce`. Arithmetic, comparisons and boolean operators are supported. Dependencies are ordered; cycles, duplicate/reserved names and malformed expressions are rejected. Missing input, non-finite results and division by zero remain missing. Units are explicit metadata, with angle/boolean type checks; arbitrary formulas do not have automatic dimensional inference.

## Data conventions and limits

- The analysis grid is one second. Subsecond observations are averaged, circularly for angular channels. The manoeuvre review also plots original timestamped observations for one source channel at a time.
- Canonical speeds use knots, angles degrees and positions decimal degrees. Boat mappings specify source channel, target channel, scale and offset. No arbitrary-header unit guessing occurs.
- Explicit timestamp zones and Unix/FILETIME timestamps become UTC. Timezone-free clocks retain their source clock; log/event offsets align them. The additional event shift is in seconds. Display offset changes labels, not measurements.
- Imported gaps retain sample age and observation count. Maximum held age defaults to two seconds. Invalid intervals affect all downstream performance/calibration calculations without modifying the source.
- Calibration review and performance review are independent. Re-detection does not transfer approvals to different phase boundaries. Old exclusions remain visible and reversible.
- Without an independent polar or logged targets, absolute data remains available but target percentages are unavailable. Learned polars are opt-in engine functionality and are not independent evidence of performance.
- Instrument-calibration changes during a session are flagged explicitly and block applying one whole-session correction. Split/select a constant-configuration session and record the baseline. Inspect BSP residuals by speed, heel and tack, compare an extra speedo on common windows, and export the candidate additive heel corrections as CSV. Entering corrections in the instruments is a separate step.
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

The Dockerfile runs the Python HTTP service on `$PORT`. It serves the built HTML and stores online sessions in SQLite on the persistent `/data` volume. Railway follows `main`. Commit `SailLens.html` together with its sources. GitHub Actions runs the regression suite and checks that the generated file is current.
