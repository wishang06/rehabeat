# Stats panel with an estimated calorie counter

Date: 2026-11-14. Size: a small change (short design).

## Intent

A fun side feature. A player can see the routines they have done over time as a chart, and an estimated calorie number for each run and in total. It is a score-like extra, not a health tool.

## Goals

- Every finished run with at least one scored move is logged with its date, length, moves and estimated calories.
- The results screen shows the run's estimated calories.
- A Stats panel shows lifetime totals and a chart of the last 14 days, switchable between runs and calories.
- The player can optionally enter their body weight to make the estimate fit them.

## Non-goals

- Per-move calorie rates or a live counter during play (approach B below). The run log leaves room to add it.
- Syncing history or weight to an account. Nothing here goes to Supabase.
- Diet, weight-loss targets, goals or reminders.

## Anti-goals

- It must not read as a health app or make an outcome claim (`PRODUCT.md`). The number is always labelled as an estimate, and no copy mentions losing weight.
- Body weight must never leave the browser.

## Constraints

- `PRODUCT.md` and `.interface-design/system.md`: Attract Mode look, LED digits for numbers, cyan for information, gold only for the figure, the primary action and selection. No chart library: bars are built from the existing LED segment style.
- Progress lives in `localStorage` and must survive blocked or full storage, as `src/progress/store.ts` does today.
- Stats must work with accounts off (no Supabase configured).

## Approaches

| | Approach | Trade-off |
| --- | --- | --- |
| A | **By time.** kcal = MET x weight (kg) x hours played, with one published rate. | Simple and citable. Counts the whole run, so standing still while the song plays still earns calories. |
| B | **By move.** Each move gets an intensity tier and only moves landed as Good or Perfect earn calories; the counter ticks up in the HUD. | More game-like, but there are no published per-pose rates, so tiers would be guesses. Touches move data, scoring and the HUD. |
| C | From measured body movement in the pose stream. | No sound basis for turning joint motion into energy. Dropped. |

**Chosen: A**, picked by the user. It is honest about being an estimate and about a third of the work of B, which can be added later on the same run log.

## Decided by the user

- Track routines over time in a chart, with an estimated calorie counter.
- An optional body weight field (rather than a fixed weight for everyone).
- Calories by time (approach A).

## Design (calls made by Claude unless listed above)

**The estimate.** `kcal = 2.3 x weightKg x durationSec / 3600`. 2.3 MET is the 2024 Adult Compendium of Physical Activities value for both "yoga, Hatha" (02150) and "stretching, mild" (02101). This is gross energy, the usual convention. With no weight entered, 70 kg is used. A three-minute song at 70 kg is about 8 kcal. Shown rounded to a whole number.

**The run log.** A new `localStorage` key, separate from `rehabeat.progress.v1` so existing progress is untouched:

- `weightKg`: number or null.
- `totals`: runs, seconds and kcal over all time.
- `runs`: one entry per run (finish time, local day key, seconds, moves, kcal), newest last, capped at the most recent 1,000. Totals are kept separately so they do not shrink when old runs drop off.

Calories are worked out and stored when the run ends, with the weight set at that time. Changing the weight later affects new runs only. A run with no scored moves is not logged, matching XP and the streak. History starts from when this ships: runs already counted in `progress.runs` have no dates or durations and are not back-filled.

**Results screen.** One more tile beside Best combo and XP: label "Est. kcal", the number in LED digits, counting up like the others. A run restored after the sign-in redirect shows the tile from its duration without logging it twice.

**Stats panel.** A dialog like the leaderboard one, opened by a "Stats" button in the top bar (every screen except Play) and on the title screen. It is there whether or not accounts are on.

```
 STATS                                          [Close]
 RUNS 23     MINUTES 71     EST. KCAL 186
 [ Runs ] [ Kcal ]                     last 14 days
            ▄           █
    ▄   █   █       ▄   █   ▄
 ▄  █   █   █   ▄   █   █   █   ▄
 1  2 3 4 5 6 7 8 9 10 11 12 13 14
 Weight [ 70 ] [kg|lb]   Estimate from time played and body weight.
```

- Three totals in LED digits.
- A 14-day bar chart, one bar per local day ending today, cyan bars, today's bar one tone brighter. A two-way switch chooses runs or kcal. Each bar has a text label for screen readers ("Tuesday 10 November: 2 runs, 17 kcal"). With no runs yet the chart area says "Finish a run to start your chart."
- The weight field: a number input with a kg / lb switch, stored in kg, accepted between 30 and 200 kg, empty meaning the 70 kg default. A line under it says the weight stays in this browser.

**Docs.** README (Playing, architecture), the privacy paragraph in `PRODUCT.md`, and the component and screen tables in `system.md` are updated.

**Tests.** Unit tests for the calorie formula, the log (parsing bad data, appending, the cap, totals) and the 14-day bucketing across month ends and missing days. The smoke check opens Stats and checks the results tile.

## Left to the builder

File and component names, CSS details within the design system, and the exact copy, kept short and readable.

## Changes after the code review (2026-11-14)

- **A run counts for at most 30 minutes.** The routine loops until Finish run is pressed, so a game left running would have logged hours and flattened the chart. `MAX_RUN_SECONDS` in `src/progress/history.ts`.
- **The unit switch reads an unsaved number in the unit chosen.** Typing 154 and then choosing lb is 154 lb. A saved weight is converted. The field saves when focus leaves the field and its unit switch, or on Enter, and writes nothing if it was not typed in.
- **The refusal line always has its space**, so the message does not move the dialog.
- **The results tiles**: Best combo and Est. kcal stack in the first column so the XP bar keeps its width.
- **Bars** fill whole LED segments (12 per column) instead of a continuous height.
