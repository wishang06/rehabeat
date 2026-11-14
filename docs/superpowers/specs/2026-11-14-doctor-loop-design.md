# Doctor loop: design

Date: 2026-11-14. Status: awaiting approval.

Mock-ups of the screens described here: https://claude.ai/artifact/CqQepUM71DdkN8D6dC7GQR (desk look chosen).

## Intent

Rehabeat is a game with nothing clinical behind it: every player gets the same loop of moves, and a finished run keeps only totals. This project adds the doctor's side, so the game sits inside a real rehab routine:

**prescribe → play → measure → adjust**, and round again.

A doctor gives a patient a program, the game builds the patient's sessions from it, every hold is measured and recorded, and the doctor reads how consistently and how well the patient is doing it, then changes the program and sends a note.

This is the first of two projects. The second (not designed here) adds an AI-drafted summary that the doctor edits and approves before the patient sees it. It will read the same findings this project computes, so those findings must be clean, structured and tested.

## Who it is for

- **The first user is a demo**: one person showing both sides on one laptop. Sample patients with history make the charts look alive.
- It is built on real, private tables so that a doctor on one device and a patient on another also works.

## Goals

1. A doctor's page at `/doctor` where a doctor can add patients, write a program, set limits, send a note, and read consistency, quality and problem spots for each patient.
2. A program controls what the patient plays: which moves, how many rounds, how long each hold, and which movements are restricted.
3. Every hold of a program session is recorded with enough detail to say where the patient goes wrong.
4. The patient sees their program and the doctor's note in the game, and sees what was sent after a session.
5. The whole loop can be shown on one laptop with no sign-in and no dependence on the database.

## Non-goals (this project)

- The AI draft and the approval step (next project).
- A full feedback page for the patient (planned later; this project adds one card and one strip).
- Chat or messaging beyond the one note attached to a program.
- More than one doctor per patient, or handing a patient to another doctor.
- Doctors authoring new moves. Programs pick from `src/moves/moves.json`.
- Doctors choosing the song or tempo.
- Editing, deleting or exporting recorded sessions. Removing a patient.
- Reminders or notifications.
- Landing-page copy about doctors, beyond one link to `/doctor`.
- Clinical validation or regulatory compliance of any kind.

## Anti-goals (these make it a failure even if it works)

- Anything shown to a patient that reads as a medical or safety guarantee. Webcam angles are estimates. The "ease off" prompt is guidance and is worded that way.
- A patient's sessions, program or joint data being readable by anyone but that patient and their doctor.
- Sample data in the real tables.
- The game feeling different for a player who has no program.
- Changing the locked types `Move`, `PoseFrame` or `BeatResult`, or the `moves.json` format.
- Storing video, images or body landmarks. Only scores and joint angles are kept.

## Approaches considered

1. **Supabase only.** Real from the start, but nothing works until the migration is applied, the demo depends on wifi and Google sign-in, and the loop cannot be tested end to end without a signed-in browser.
2. **Browser storage only.** Quick and offline, but not the real tables, and a doctor could never see a patient on another device.
3. **One data layer with two homes (chosen).** All screens talk to one interface. Signed out, it is a demo clinic kept in the browser. Signed in, it is private Supabase tables. More code than either alone, but the demo cannot be broken by the network, the loop is testable in the smoke check, and the real version is the same screens.

Chosen by Claude; the user handed over the how.

## Decisions made with the user

- Demo first, on real tables.
- A program holds: moves in order, rounds per session, hold length, sessions per week, number of weeks, restrictions, and a note to the patient.
- All three kinds of restriction: leave a move out, switch a joint off, set a range limit on a joint.
- The doctor's advice is written by the doctor from computed findings. No AI in this project.
- The doctor's page uses the **desk look**: the game's colours and typefaces, upright and flat, plain numerals. The game keeps Attract Mode.
- Recorded per hold: score and label, each joint's error and direction, form flags, limit breaches, timing, and how much of the hold each joint was in view.

## Design

### Words

The UI says **Doctor**, **Patient**, **Program**, **Session**, **Limit**. In code a program is a `Prescription`.

### Prescription

A prescription is an immutable version. Saving a change creates the next version; the newest is the one in force. A session records which version it was played under.

| Field | Meaning |
| --- | --- |
| `moveIds` | Moves from `moves.json`, in play order. At least one must survive the limits. |
| `rounds` | Times through the routine in one session. |
| `holdBeats` | Hold length in beats for every move, or null to keep each move's own. |
| `sessionsPerWeek` | 1 to 7. |
| `weeks`, `startDate` | Length of the program and its first day. Carried forward when a new version is saved unless the doctor changes them. |
| `limits` | Per joint (the eight in `JOINT_NAMES`): none, **off**, or **up to N°**. |
| `note` | Text for the patient, shown before they play. |

### Limits

Doctors set a limit as **movement from the resting position**, which is how it is said in practice ("raise up to 90°", "bend up to 60°"). The game converts:

- shoulder: movement = the game's angle (0 is arm at the side);
- elbow, hip, knee: movement = 180 minus the game's angle (180 is straight).

Before play, the prescription is applied to the move list by one pure function that returns the moves to play and a list of what it changed:

- a move not in `moveIds` is left out;
- a move that scores a joint marked **off** is removed;
- a move whose target on a limited joint goes beyond the limit has that target set to the limit;
- `holdBeats`, when set, replaces each move's hold.

The output is ordinary `Move` objects, so the routine, scoring and target figure work unchanged. The same function drives the doctor's live preview ("Overhead Arm Raise plays as a raise to 90°", "Standing Knee Raise removed: left knee is off").

During a session every limited joint is watched in every phase of every move, not only the moves that score it. Going past the limit by more than a margin, held for about half a second, shows an "ease off" prompt naming the joint and marks the hold as a breach. The margin exists because a scaled target sits exactly at the limit and the camera's reading wobbles.

A patient's limits also apply when they free-play, since a restricted joint is restricted whatever mode they chose. Free play is not recorded for the doctor. (Claude's call.)

### A program session

- Starts from a new program card on the title screen.
- The patient still picks a song and calibrates as now.
- The routine is the applied prescription. The session ends by itself after the last round and goes to the results screen.
- "Finish run" still works. A session ended early is saved as partial if at least one hold was scored.
- Points, XP, the daily streak and the leaderboard behave as they do today.

### What is recorded

One record per session: when, which prescription version, song, rounds done and prescribed, whether it was completed, the existing run summary, and a list of holds.

One entry per hold: the move, the round, score and label, timing offset, the form-rule ids flagged, the limited joints that were breached, and for each scored joint its target, its mean signed error over the hold, and the fraction of the hold it was visible.

`BeatResult` is not changed; the detail is a new type produced alongside it.

### Analysis

Pure functions over prescriptions and sessions, with unit tests. They return structured values (numbers, ids, trend) plus a plain sentence built from a template, so the later AI step and the doctor's page read the same thing.

- **Consistency.** Weeks are seven-day blocks from `startDate`. Each week shows completed sessions against the number prescribed by the version in force at the end of that week, and a lamp per day: done, partial or empty. A patient's status is one of: not started, on track, behind (this week's count can no longer be reached), no sessions for N days (three or more), finished.
- **Quality.** Mean score per move per session, and this week's average against last week's.
- **Problem spots.** Recent sessions compared with the ones before them:
  - a joint that stops short of, or goes past, its target on a move ("right shoulder stops 14° short, was 25°");
  - a form rule flagged on a share of holds ("trunk leans on 4 of 10 holds");
  - limit breaches;
  - arriving late;
  - a scored joint often out of view.
  
  Each has a trend (better, worse, same). Breaches come first, then the rest by size.

A session counts toward consistency only when completed. Partial sessions still feed quality and problem spots.

### Data layer

One interface used by both the doctor's page and the game:

- doctor: list patients with status, read one patient's prescriptions and sessions, add a patient, save a prescription;
- patient: read my program and my doctor's name, save a session, read my sessions, join with a code.

**Demo clinic (signed out, or Supabase not configured).** Kept in `localStorage`. It holds four sample patients with about three weeks of history that always ends relative to today, and a patient called **You**, who is whoever plays in this browser. Sample patients can be edited like real ones. A "Reset demo clinic" control restores it. A banner says the data is sample data kept in this browser.

**Real clinic (signed in).** Three new tables, no public read:

- patients of a doctor: doctor, the patient's account once joined, display name, condition, join code;
- prescriptions: insert-only versions per patient;
- sessions: insert-only, written by the patient, holds stored as JSON on the row.

Row Level Security: a doctor reads and writes only their own patients and those patients' prescriptions, and reads their sessions. A patient reads their own patient row, its prescriptions and their own sessions, and inserts their own sessions. A patient joins by entering the doctor's code; a small database function claims the code for the signed-in account. An account is a patient of at most one doctor. Anyone signed in can use `/doctor`; a doctor is simply someone who has added patients.

Which home is used follows sign-in state. There is no switch between them.

The migration is a file in `supabase/migrations/`. Someone on the team has to apply it to the project; until then the signed-in pages show a clear "not set up yet" message, and the demo clinic is unaffected. `database.types.ts` is updated by hand to match.

### The doctor's page (`/doctor`)

As in the mock-up, in the desk look:

- **Patients** down the left with a status pill, and an "Add patient" form (name, condition). In the real clinic a new patient shows a join code until they join.
- **Header** with the patient's name, condition and program week.
- **Three tiles**: sessions this week, average score with change, limit breaches.
- **Consistency**: the week grid.
- **Problem spots**: the findings, each with a small trend line.
- **Program**: tick and reorder moves, rounds, hold beats, sessions per week, weeks; with the live "what the patient will play" preview.
- **Limits**: for each joint, none, off, or a slider in degrees of movement.
- **Note** and **Save and send**, which creates the next version. Unsaved changes are indicated.
- **Earlier versions**: date and note of each, read only.

It is a separate lazy-loaded route and does not load the pose model. It has its own stylesheet built on the existing theme tokens. It is laid out for a laptop and stacks to one column on a phone. The landing page gets one link to it.

One change from the mock-up: the day lamps show done, partial or empty, and the week shows "4/5". The mock-up's "missed" and "rest day" lamps are dropped, because "five a week" does not say which days.

### The patient's side

- **Title screen**: when the player has a program, a card shows the doctor's name, the moves, rounds, limits in words, sessions done this week against prescribed, the note, and **Start today's session**, which becomes the primary action. Starting free play stays available.
- **Joining**: in the real clinic, a signed-in player without a program can enter a code from their doctor.
- **Play**: the ease-off prompt, and the round shown alongside the move count.
- **Results**: a strip saying what was sent to the doctor (average, holds, sessions this week), the one thing to work on from this session, and the line that only scores and joint angles are sent. If saving fails it says so and offers a retry.

A player with no program sees none of this.

### Documents

- `PRODUCT.md`: who it is for now includes the doctor; privacy says a patient's scores and joint angles go to their doctor; wording rules for limits and prompts (guidance, no guarantees, no clinical claims).
- `.interface-design/system.md`: the desk look and where it applies.
- `README.md`: the new route, the loop, the data layer, the tables, how to apply the migration, current limits.

### Testing

- Unit tests for: limit conversion, applying a prescription, the limit watcher, hold recording, every analysis function, and the demo clinic.
- The smoke check gains the demo loop: on `/doctor` give You a one-round program; on `/play` see the card, play the session with the synthetic camera until it ends by itself, see the results strip; back on `/doctor` see the session.
- The Supabase path is covered by types and by reading the SQL. It cannot be exercised end to end in the smoke check, which has no Google sign-in. It needs a manual check by a signed-in person after the migration is applied.

## Build order

Each step leaves the app working.

1. Prescription types, limit conversion, applying a prescription, the limit watcher, hold recording.
2. Analysis functions.
3. The data-layer interface and the demo clinic with sample patients.
4. The patient's side: program card, program sessions, ease-off prompt, results strip.
5. The doctor's page.
6. The Supabase tables, policies, join function and the real-clinic implementation.
7. Documents, screenshots, smoke check.

## Left to the builder

- File and component layout, names, and where state lives.
- Thresholds and windows: the breach margin and persistence, how many sessions count as "recent", the cut-offs for reporting a joint error, a form flag, lateness and out-of-view. Pick sensible defaults, name them as constants, and say in the README that they are untuned.
- Slider ranges per joint, bounds on rounds and weeks, note length.
- Exact wording of findings, statuses and prompts, within the wording rules above.
- How sample history is generated, provided it is deterministic and always current.
- The shape of the join code and of the SQL.
- Whether the program card shows an estimated duration.
