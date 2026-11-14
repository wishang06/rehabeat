# Rehabeat interface system: Attract Mode

Read [`PRODUCT.md`](../PRODUCT.md) first. This file is the rulebook the screens are built to.

## Feel

An arcade cabinet's screen in a dark room. Slanted panels, neon light, LED digits. Read from two metres.

## Colour

Tokens live in `src/styles/theme.css` and are exposed to Tailwind (`bg-deck`, `text-gold`, ...).

| Token | Value | Use |
| --- | --- | --- |
| `--color-void` | `#05060c` | The ground |
| `--color-deck` | `#0c1020` | Panels: the first tone step up |
| `--color-deck-2` | `#151c36` | Selected or hovered panels |
| `--color-deck-3` | `#242d50` | Quiet buttons, tracks, unlit segments |
| `--color-gold` | `#ffd23f` | The figure, the primary action, the selected thing, Hold, Perfect |
| `--color-cyan` | `#27e0f0` | Labels, information, XP, Reach, Good |
| `--color-pink` | `#ff2e88` | Miss and warnings |
| `--color-white` | `#eef2ff` | Text |
| `--color-dim` / `--color-faint` | white at 68% / 44% | Supporting text, and text that can be missed |
| `--color-gold-ink` | `#1b1300` | Text on gold |
| `--color-cam` | `#020308` | Behind the camera picture |

Rules:

- Surfaces are separated by a step in tone, never by a line.
- One colour, one meaning. Gold is never decoration, and pink is never anything but a miss or a warning.
- Light glows; panels do not. A glow is a soft shadow in the element's own colour (`0 0 22px` to `0 0 70px`). Only the primary button, the selected thing and lit indicators glow.
- Text is at least 4.5:1. `--color-faint` is for text nobody needs to read to play.
- The canvas colours (gold figure, green on target, limb colours) belong to `src/ui/overlay.ts` and are not part of this system.

## Type

| Role | Face | Class | Notes |
| --- | --- | --- | --- |
| Display | Barlow Condensed 800 Italic | `display` | Uppercase, line-height 0.92 to 0.96. Headlines, phase words, names, buttons. |
| Label | Barlow Condensed 700 | `label` | Uppercase, tracking 0.12em, 15 to 17 px. Cabinet labels: "Level", "Now", "Points". |
| Text | Barlow 400 to 600 | (default) | 16 to 26 px, line-height 1.35 to 1.5. |
| Digits | Doto 900 | `led` | Every number that counts: tempo, score, combo, XP, the countdown. Never for sentences. |

Display sizes are fluid. On the landing page they follow the viewport (`--text-headline`, `--text-section`); on the play HUD they follow the stage (`cqw`), so the HUD scales with the camera picture.

The headline stays on two lines at laptop width.

## Shape and depth

- **The slant.** Panels and buttons lean -10 degrees (`--slant`); large panels -4 to -6. The skew goes on a pseudo-element (`.slab`) so the content stays upright. The italic display face matches the lean.
- **Lit edges.** A panel that matters carries a lit bar along its top edge (`.slab-edge`) in its colour.
- **LED segments.** Bars and meters are rows of slanted segments (`.segments`).
- Corners are square. Lamps are the only circles.
- Focus ring: 3 px cyan, offset 4 px. On a gold-edged card the ring sits outside the edge.

## Space

Base unit 4 px. Page gutter `clamp(18px, 3vw, 44px)`. Sections are 80 to 160 px apart on the landing page. Buttons are 58 px tall, 90 px for the one primary action on a screen. Hit areas are never under 44 px. Slanted panels in a row get 14 to 18 px of side room so the lean does not clip.

## Motion: the lane

- **Enter:** ride in along the slant (40 to 70 px, skewed about 20 degrees) in about 100 ms, then flash to about 2.4 times brightness for a frame and settle.
- **Exit:** leave the other way, faster.
- **On the beat:** in play, anything that pulses reads the audio clock. The Play screen writes `--pulse` (1 on the beat, falling to 0) on the HUD once per frame and CSS does the rest. No timers. The landing page has no music; it keeps time with a GSAP timeline at the default song's tempo.
- **Lamps:** marquee bulbs chase one step per beat; a song's lamp blinks at its own tempo.
- **Reduced motion:** nothing travels and nothing blinks. Things appear in place, and the landing page rests in the hold.
- Only `transform`, `opacity` and short `filter` flashes animate. Nothing from an animation library touches the canvas.

Libraries: GSAP (with ScrollTrigger) for the landing page loop and reveals and the results count-ups; Motion for screen transitions and HUD pops.

## Components

| Component | Rule |
| --- | --- |
| Button | Slanted panel, display type. `deck` (default) or `gold` (the primary action, the only one that glows). 58 px; `xl` 90 px. In the app shell the same look is `.button` / `.button--primary`. |
| Catalogue tab | Slanted deck panel on the tempo rod; selected is gold with gold-ink text. |
| Tempo rod | A column with an LED mark at each catalogue boundary, a cyan notch per song and a gold diamond on the selected song's tempo. |
| Song card | Slanted panel. Tempo in LED digits is the largest thing on it. Selected: one tone up, gold edge, glow. Its lamp blinks at the song's tempo. |
| XP bar | LED segments, cyan fill, level label before and the count in LED digits after. |
| Streak | The day count in gold LED digits and seven lamps for the week. |
| Stats chart | Fourteen upright columns of 12 LED segments, one per day, cyan on an unlit track; today's column is at full brightness and the rest dimmed. The value sits above a lit column in LED digits. Never gold. |
| Switch | Two quiet buttons side by side; the pressed one is a tone up with cyan text and a cyan bar along its bottom edge. |
| Phase word | Display type, top centre: Ready white, Reach cyan, Hold gold, Release white. |
| Beat pips | One slanted segment per beat of the move, grouped by phase; the current one is lit in its phase colour. |
| Match ring | A ring with marks at 60 (Good) and 85 (Perfect). White under 60, cyan from 60, gold from 85. The number is in LED digits. |
| Pop | PERFECT gold, GOOD cyan, MISS pink, in display type with the score under it. Up for the release, gone when the next move starts. |
| Combo | The count in gold LED digits, dim until it reaches 2. |
| Move card | Now: slanted panel, gold top edge, the figure as a gold tube. Next: smaller, cyan. |
| Step back | Two words on a pink slab, large enough to read from two metres. |
| Grade | One display letter filling a slanted panel, with three stars under it. |

## Desk look

The doctor's page (`/doctor`, `src/doctor/doctor.css`) is read at a desk, not from two metres, so it keeps the palette and the typefaces and drops the cabinet.

- **Upright and flat.** No slant: no `.slab`, no skewed buttons. Barlow Condensed 700, upright, for names and headings. No italic display type.
- **Plain numerals.** Barlow 600 with `tabular-nums`. No LED digits: the doctor reads numbers in sentences and tables, not at a glance across a room.
- **Reading size.** Text at 15 to 16 px, headings to 30 px. Hit areas still at least 44 px on the controls that are used most.
- **The same colours, meaning the same things.** Gold is the one primary action ("Save and send"), the selected patient, and a limit that is set. Cyan is labels, information, a session done, and a finding that is improving. Pink is a warning: a limit breach, a week that ended short, a patient gone quiet, a finding getting worse.
- **Tone steps, not lines**, as everywhere. Panels are `--color-deck` on `--color-void`; inputs are `--color-void` on a panel.
- **Lamps are still the only circles**: one per day in the week grid. Lit cyan for a session done, a cyan ring for one that ended early, a dashed gold outline for today.
- **Nothing glows** except a lit lamp. There is no motion on the page.
- Two columns from 860 px wide, one below. No horizontal scroll at 390 px.

The patient-facing pieces of the doctor loop (the program card on the title screen, the "Sent to" strip on the results screen, the "Ease off" banner on the HUD) are in the game, so they are Attract Mode, not the desk look.

## Screens

| Route | Screen | Notes |
| --- | --- | --- |
| `/` | Landing | The cabinet in attract mode: marquee, hero loop, the instruction card ("How it works"), the statistic, privacy, the song lanes, credits |
| `/play` | Title | Name, Start, level and daily streak |
| `/play` | Song select | The markup and behaviour of `src/ui/menu`; only its CSS changed |
| `/play` | Calibrate | A slanted strip along the bottom of the camera picture |
| `/play` | Play | The HUD (`src/ui/hud`) over the camera and canvas |
| `/play` | Results | Grade, stars, points, Perfect / Good / Miss, best combo, estimated calories, XP |
| `/play` | Stats (dialog) | All-time runs, minutes and estimated calories, the 14-day chart, the optional body weight |
| `/hud` | HUD preview | The HUD fed by a mock frame, for design work and screenshots |
| `/doctor` | Doctor | Desk look. Patients, consistency, problem spots, the program and limits editors, the note |
