# Stats Panel and Calorie Estimate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Log every scored run, show its estimated calories on the results screen, and add a Stats panel with lifetime totals, a 14-day chart and an optional body weight field.

**Architecture:** Two new pure modules in `src/progress/` (the calorie estimate and the run log), with a small `localStorage` store built the same way as `src/progress/store.ts`. `App.tsx` logs the run in `finish()` and owns a Stats `<dialog>` like the leaderboard one. The chart is plain DOM and CSS.

**Tech Stack:** TypeScript (strict), React 19, Vitest (node environment, `src/**/*.test.ts`), Playwright smoke script, plain CSS on the tokens in `src/styles/theme.css`.

**Spec:** `docs/superpowers/specs/2026-11-14-calorie-stats-design.md`

## Global Constraints

- `kcal = 2.3 x weightKg x durationSec / 3600`. Default weight 70 kg. Accepted weight 30 to 200 kg.
- New `localStorage` key `rehabeat.history.v1`. `rehabeat.progress.v1` is not changed.
- Nothing in this feature is sent to Supabase.
- Copy says "Est. kcal" or "estimate". No copy mentions losing weight, goals or health outcomes.
- Numbers use the `led` class, labels the `label` class. Bars are cyan; gold is not used. No chart library, no new dependency.
- A run with `moves === 0` is not logged and shows 0 kcal.
- Storage that is blocked, full or corrupt must never throw.

## Review Focus

1. A weight typed as `72,5`, ` 72.5 ` or `abc`: a comma is a decimal point, spaces are trimmed, anything else is refused with a message and the saved weight is kept. (Task 1)
2. A weight shown in lb after being saved in kg: 154 lb must read back as `154`, not `153.9`. (Task 1)
3. Hand-edited or corrupt history (runs not an array, `NaN` kcal, negative seconds, a bad day key): bad entries are dropped, the rest is kept. (Task 2)
4. A clock that moved, so runs are dated in the future or before the window: the chart skips them, totals still count them, nothing crashes. (Task 2)
5. Two tabs open: a run finished in one tab must not erase a run finished in the other. The store re-reads storage before each write. (Task 2)

---

### Task 1: Calorie estimate and weight input

**Files:**
- Create: `src/progress/calories.ts`
- Test: `src/progress/calories.test.ts`

**Interfaces:**
- Produces:
  - `STRETCH_MET = 2.3`, `DEFAULT_WEIGHT_KG = 70`, `MIN_WEIGHT_KG = 30`, `MAX_WEIGHT_KG = 200`
  - `type WeightUnit = 'kg' | 'lb'`
  - `estimateKcal(durationSec: number, weightKg: number | null): number` (unrounded; `null` weight means the default; 0 for a non-finite or non-positive duration)
  - `readWeight(text: string, unit: WeightUnit): { ok: true; kg: number | null } | { ok: false }` (empty text is `{ ok: true, kg: null }`; out of range or not a number is `{ ok: false }`)
  - `showWeight(kg: number, unit: WeightUnit): string` (one decimal at most, no trailing `.0`)
  - `isWeightKg(value: unknown): value is number` (finite and within 30 to 200)

- [ ] **Step 1: Write the failing tests** in `src/progress/calories.test.ts`

```ts
it('estimates 2.3 MET for the time played', () => {
  expect(estimateKcal(180, 70)).toBeCloseTo(8.05, 5);
  expect(estimateKcal(3600, 100)).toBeCloseTo(230, 5);
});
it('uses 70 kg when no weight is set', () => expect(estimateKcal(180, null)).toBeCloseTo(8.05, 5));
it('is zero for no time or a bad duration', () => {
  for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) expect(estimateKcal(bad, 70)).toBe(0);
});
it('reads a weight in kg', () => {
  expect(readWeight('72.5', 'kg')).toEqual({ ok: true, kg: 72.5 });
  expect(readWeight(' 72,5 ', 'kg')).toEqual({ ok: true, kg: 72.5 });
});
it('reads a weight in lb as kg', () => {
  const read = readWeight('154', 'lb');
  expect(read.ok && read.kg).toBeCloseTo(69.85, 1);
});
it('treats an empty field as no weight', () => expect(readWeight('  ', 'kg')).toEqual({ ok: true, kg: null }));
it('refuses text and weights outside 30 to 200 kg', () => {
  for (const bad of ['abc', '7o', '29', '201', '-70', '1e3']) expect(readWeight(bad, 'kg')).toEqual({ ok: false });
  expect(readWeight('60', 'lb')).toEqual({ ok: false }); // 27 kg
});
it('shows a saved weight back in the unit it was typed in', () => {
  const read = readWeight('154', 'lb');
  expect(read.ok && read.kg !== null && showWeight(read.kg, 'lb')).toBe('154');
  expect(showWeight(72.5, 'kg')).toBe('72.5');
  expect(showWeight(70, 'kg')).toBe('70');
});
```

- [ ] **Step 2: Run** `npx vitest run src/progress/calories.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement `src/progress/calories.ts`.** `readWeight` accepts only `^\d+([.,]\d+)?$` after trimming. lb to kg uses `0.45359237`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat: calorie estimate and weight input parsing`.

### Task 2: The run log

**Files:**
- Create: `src/progress/history.ts`
- Test: `src/progress/history.test.ts`
- Modify: `src/progress/index.ts` (export everything below and Task 1's names)

**Interfaces:**
- Consumes: Task 1's `estimateKcal`, `isWeightKg`, `WeightUnit`; `dayKey`, `isDayKey` from `./streak`.
- Produces:
  - `HISTORY_KEY = 'rehabeat.history.v1'`, `MAX_LOGGED_RUNS = 1000`, `CHART_DAYS = 14`
  - `interface LoggedRun { at: number; day: string; seconds: number; moves: number; kcal: number }` (`at` is epoch ms, `kcal` rounded to 2 decimals)
  - `interface HistoryTotals { runs: number; seconds: number; kcal: number }`
  - `interface History { weightKg: number | null; unit: WeightUnit; totals: HistoryTotals; runs: LoggedRun[] }`
  - `NEW_HISTORY: History`
  - `parseHistory(raw: unknown): History`
  - `logRun(history: History, run: { moves: number; durationSec: number }, now: Date): { history: History; kcal: number }` (returns the same `history` object and `kcal: 0` when `run.moves <= 0`)
  - `interface DayTotal { day: string; date: Date; runs: number; seconds: number; kcal: number }`
  - `lastDays(history: History, today: Date, days?: number): DayTotal[]` (oldest first, last entry is today)
  - `loadHistory(storage?)`, `saveHistory(history, storage?)` with the same `StorageLike` shape as `store.ts`
  - `recordRunStats(run: { moves: number; durationSec: number }, now?: Date): number` (logs, saves, notifies, returns the run's kcal)
  - `setWeight(kg: number | null, unit: WeightUnit): void`
  - `useHistory(): History`

- [ ] **Step 1: Write the failing tests** in `src/progress/history.test.ts`. Use `const noon = (day: number) => new Date(2026, 10, day, 12)` and a `fakeStorage` like the one in `store.test.ts`.

```ts
it('logs a scored run with its day, time and calories', () => {
  const { history, kcal } = logRun(NEW_HISTORY, { moves: 6, durationSec: 180 }, noon(14));
  expect(kcal).toBeCloseTo(8.05, 2);
  expect(history.runs).toEqual([{ at: noon(14).getTime(), day: '2026-11-14', seconds: 180, moves: 6, kcal: 8.05 }]);
  expect(history.totals).toEqual({ runs: 1, seconds: 180, kcal: 8.05 });
});
it('uses the weight that is set when the run ends', () => {
  const heavy = { ...NEW_HISTORY, weightKg: 100 };
  expect(logRun(heavy, { moves: 1, durationSec: 3600 }, noon(14)).kcal).toBeCloseTo(230, 2);
});
it('does not log a run with no scored moves', () => {
  const result = logRun(NEW_HISTORY, { moves: 0, durationSec: 180 }, noon(14));
  expect(result.history).toBe(NEW_HISTORY);
  expect(result.kcal).toBe(0);
});
it('keeps the newest 1,000 runs and does not shrink the totals', () => {
  let history = NEW_HISTORY;
  for (let i = 0; i < MAX_LOGGED_RUNS + 5; i++) history = logRun(history, { moves: 1, durationSec: 60 }, new Date(2026, 0, 1, 0, i)).history;
  expect(history.runs).toHaveLength(MAX_LOGGED_RUNS);
  expect(history.runs[0].at).toBe(new Date(2026, 0, 1, 0, 5).getTime());
  expect(history.totals.runs).toBe(MAX_LOGGED_RUNS + 5);
});
it('buckets the last 14 days, oldest first, across a month end', () => {
  let history = logRun(NEW_HISTORY, { moves: 1, durationSec: 180 }, new Date(2026, 9, 30, 9)).history;
  history = logRun(history, { moves: 1, durationSec: 180 }, new Date(2026, 10, 3, 9)).history;
  history = logRun(history, { moves: 1, durationSec: 60 }, new Date(2026, 10, 3, 21)).history;
  const days = lastDays(history, new Date(2026, 10, 5, 12));
  expect(days).toHaveLength(14);
  expect(days[0].day).toBe('2026-10-23');
  expect(days[13].day).toBe('2026-11-05');
  expect(days.find((d) => d.day === '2026-10-30')).toMatchObject({ runs: 1, seconds: 180 });
  expect(days.find((d) => d.day === '2026-11-03')).toMatchObject({ runs: 2, seconds: 240 });
  expect(days[13]).toMatchObject({ runs: 0, seconds: 0, kcal: 0 });
});
it('leaves runs outside the window out of the chart but in the totals', () => {
  let history = logRun(NEW_HISTORY, { moves: 1, durationSec: 60 }, new Date(2026, 10, 20, 12)).history; // the future
  history = logRun(history, { moves: 1, durationSec: 60 }, new Date(2026, 8, 1, 12)).history; // long ago
  expect(lastDays(history, noon(14)).every((d) => d.runs === 0)).toBe(true);
  expect(history.totals.runs).toBe(2);
});
it('drops what is not valid and keeps the rest', () => {
  const good = { at: 1, day: '2026-11-14', seconds: 60, moves: 2, kcal: 2.68 };
  const parsed = parseHistory({
    weightKg: 500, unit: 'stone', totals: { runs: -3, seconds: 'x', kcal: Number.NaN },
    runs: [good, null, { ...good, day: '2026-13-40' }, { ...good, kcal: Number.NaN }, { ...good, seconds: -1 }],
  });
  expect(parsed).toEqual({ weightKg: null, unit: 'kg', totals: { runs: 0, seconds: 0, kcal: 0 }, runs: [good] });
  for (const junk of [null, 'x', 7, [], { runs: 'none' }]) expect(parseHistory(junk)).toEqual(NEW_HISTORY);
});
it('survives storage that is missing, blocked or holds bad JSON', () => {
  expect(loadHistory(null)).toEqual(NEW_HISTORY);
  expect(loadHistory(fakeStorage({ [HISTORY_KEY]: '{oops' }))).toEqual(NEW_HISTORY);
  const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('full'); } };
  expect(loadHistory(blocked)).toEqual(NEW_HISTORY);
  expect(() => saveHistory(NEW_HISTORY, blocked)).not.toThrow();
});
it('round-trips through storage', () => {
  const storage = fakeStorage();
  const { history } = logRun({ ...NEW_HISTORY, weightKg: 82, unit: 'lb' }, { moves: 3, durationSec: 200 }, noon(14));
  saveHistory(history, storage);
  expect(loadHistory(storage)).toEqual(history);
});
```

- [ ] **Step 2: Run** `npx vitest run src/progress/history.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement `src/progress/history.ts`.** `lastDays` builds each day as `new Date(year, month, date - offset)` and keys it with `dayKey`, so month ends and clock changes are handled by `Date`. `parseHistory` keeps only the last `MAX_LOGGED_RUNS` valid runs. The live store follows `store.ts` (`useSyncExternalStore`, module-level `current`), with one difference: `recordRunStats` and `setWeight` call `loadHistory()` first and apply the change to that, so a second tab's runs are not overwritten.
- [ ] **Step 4: Export** the new names from `src/progress/index.ts`.
- [ ] **Step 5: Run** `npx vitest run src/progress && npm run typecheck`. Expected: PASS.
- [ ] **Step 6: Commit** `feat: run log with daily totals in localStorage`.

### Task 3: Log the run and show its calories on the results screen

**Files:**
- Modify: `src/App.tsx` (`finish()`, the `run` state initialiser, the `<ResultsScreen>` props)
- Modify: `src/ui/ResultsScreen.tsx`, `src/ui/screens.css` (`.res__meta`)

**Interfaces:**
- Consumes: `recordRunStats`, `estimateKcal`, `loadHistory` from `../progress`.
- Produces: `ResultsScreen` takes a new required prop `kcal: number`.

- [ ] **Step 1:** In `App.tsx` add `const [kcal, setKcal] = useState(...)`. In `finish()` call `setKcal(recordRunStats(summary))` next to `recordRun(summary)`. For a run restored by `takePendingRun()` the initial value is `run.moves > 0 ? estimateKcal(run.durationSec, loadHistory().weightKg) : 0`: it was logged before the redirect and must not be logged again.
- [ ] **Step 2:** In `ResultsScreen.tsx` add a third tile in `.res__meta`, between Best combo and XP: label `Est. kcal`, value `Math.round(kcal)` in `res__num led` with `data-count` and `data-testid="run-kcal"`. Change `.res__meta` to three columns (`1fr 1fr 1.4fr`); it already collapses to one column under 36rem.
- [ ] **Step 3: Run** `npm run typecheck && npm test`. Expected: PASS.
- [ ] **Step 4: Commit** `feat: log each run and show its estimated calories on the results`.

### Task 4: The Stats panel

**Files:**
- Create: `src/ui/StatsPanel.tsx`, `src/ui/stats.css`
- Modify: `src/App.tsx` (dialog, top-bar button), `src/ui/TitleScreen.tsx` (button, new `onStats` prop)

**Interfaces:**
- Consumes: `useHistory`, `lastDays`, `setWeight`, `readWeight`, `showWeight`, `DEFAULT_WEIGHT_KG`, `MIN_WEIGHT_KG`, `MAX_WEIGHT_KG`, `CHART_DAYS`, `type DayTotal`, `type WeightUnit`.
- Produces: `StatsPanel()` (no props; the content of the dialog), `TitleScreen` prop `onStats: () => void`.

- [ ] **Step 1: `StatsPanel.tsx`.** Three parts, top to bottom:
  - Totals: `Runs`, `Minutes` (`Math.round(seconds / 60)`), `Est. kcal` (`Math.round`), each a label over an LED number. `data-testid="stats-runs" | "stats-minutes" | "stats-kcal"`.
  - Chart: a two-button switch (`Runs` / `Kcal`, `aria-pressed`, `data-testid="stats-mode-runs" | "stats-mode-kcal"`), then a list (`<ol data-testid="stats-chart">`) of 14 `<li>`, each with the value above the bar when it is above zero, the bar (`--share` = value / the window's maximum), and the day of the month under it. Each `<li>` carries `aria-label` such as `Tuesday 10 November: 2 runs, 17 kcal` (`toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })`) and `data-today="true"` on the last one. When every day is zero the list is replaced by `Finish a run to start your chart.` (`data-testid="stats-empty"`).
  - Weight: `<label>` "Body weight", a text input (`inputMode="decimal"`, `data-testid="stats-weight"`, placeholder the default weight in the chosen unit), a kg / lb switch (`data-testid="stats-unit-kg" | "stats-unit-lb"`). It saves on blur and on Enter through `readWeight` then `setWeight`. A refused value keeps the saved weight and shows `Enter a weight between 30 and 200 kg.` (or `66 and 440 lb`) in a `role="alert"` line (`data-testid="stats-weight-error"`). Switching unit re-shows the saved weight in the new unit and saves the unit. Under it: `Estimate from time played and body weight (2.3 MET). Your weight stays in this browser.`
- [ ] **Step 2: `stats.css`.** Bars are cyan on a `--color-deck-3` track, 9rem tall, today's bar at full brightness and the others at 70% opacity, bar height by `transform: scaleY(var(--share))` from the bottom, horizontal segment gaps by `mask: repeating-linear-gradient(0deg, #000 0 8px, transparent 8px 11px)`. The switch buttons reuse `.button button--quiet`; the pressed one is one tone up (`--color-deck-2`) with cyan text. The input is square-cornered, `--color-deck-3`, LED digits, at least 44px tall. Focus ring 3px cyan offset 4px.
- [ ] **Step 3: `App.tsx`.** Add `statsRef` and a `<dialog className="board-dialog stats-dialog">` beside the leaderboard dialog (outside the `supabase &&` condition), with the heading `Stats`, a Close button and `<StatsPanel />`. It is a little wider than the board (`min(40rem, ...)`). Add a quiet `Stats` button (`data-testid="stats-button"`) to the top bar on every screen except `play` and `title`, also outside the `supabase &&` condition. The Esc handler must also leave the screen alone while `statsRef.current?.open`.
- [ ] **Step 4: `TitleScreen.tsx`.** Add a quiet `Stats` button (`data-testid="title-stats"`) under the progress meters, calling `onStats`. `App` passes `() => statsRef.current?.showModal()`.
- [ ] **Step 5: Run** `npm run typecheck && npm test`. Expected: PASS.
- [ ] **Step 6: Look at it.** `npm run dev`, open `/play`, seed `rehabeat.history.v1` with a few runs across the last two weeks from the console, and check the panel in both modes, with no runs, with a refused weight, in lb, at 1440px and at 390px wide, and with reduced motion.
- [ ] **Step 7: Commit** `feat: Stats panel with totals, a 14-day chart and a weight field`.

### Task 5: Smoke check, screenshots and docs

**Files:**
- Modify: `scripts/smoke.mjs`, `scripts/screens.mjs`, `README.md`, `PRODUCT.md`, `.interface-design/system.md`
- Create: `docs/screenshots/stats.png` (written by `scripts/screens.mjs`)

- [ ] **Step 1: `scripts/smoke.mjs`.** After the existing results checks: `run-kcal` holds a whole number; when `run-points` is not `0`, `rehabeat.history.v1` holds one run. Then click `stats-button`: the dialog opens, `stats-runs` matches the stored total, typing `abc` in `stats-weight` and pressing Enter shows `stats-weight-error`, typing `80` clears it and stores `weightKg: 80`. Close the dialog before `change-song`.
- [ ] **Step 2: `scripts/screens.mjs`.** After the results shot, seed a believable two weeks of history, reload `/play`, open Stats from the title screen and write `stats.png`.
- [ ] **Step 3: Docs.** README: the Playing section (the results tile and the Stats panel), the Progress bullet in Architecture, Layout, and Current limits (history and weight are per browser; the estimate is by time). `PRODUCT.md`: add the run history and optional weight to the Privacy paragraph, and one line under "What it does not say" that the calorie figure is always labelled an estimate. `system.md`: a "Stats chart" row in Components and the results row in Screens.
- [ ] **Step 4: Run** `npm test && npm run build && npm run smoke`. Expected: all pass; smoke prints every check passed.
- [ ] **Step 5: Commit** `test: smoke check covers the calorie tile and Stats; docs`.
