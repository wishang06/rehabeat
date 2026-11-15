# Rehabeat: product and design direction

## What it is

Rehabeat is an arcade rhythm game for home stretching and rehab exercises. You stand about two metres from a laptop, a target figure shows the pose, and you match it on the beat. The melody only plays while your form holds.

It should feel like the menus of a rhythm game, not like a health app.

## Who it is for

**The patient.** Someone who has been given a home exercise routine and finds it hard to keep doing it. They are standing in a living room, two metres from a 13 to 15 inch screen, with their arms busy. They cannot read small text and cannot reach the keyboard mid-song.

**The doctor.** Whoever gave them the routine. They are sitting at a desk between appointments. They want to know two things about each patient, quickly: are they doing it, and where is it going wrong. Then they want to change the program and say something to the patient.

## The loop

Prescribe, play, measure, adjust, and round again. The doctor writes a program; the game builds the patient's sessions from it; every hold is measured; the doctor reads the result, changes the program and sends a note. The game is the middle of the loop, not the whole of it.

## Two rooms

The game and the doctor's page are for two different rooms, so they are set differently.

- **The game is Attract Mode**, read from two metres. A patient with a program gets one card on the title screen and one strip on the results screen, in the game's own style. A player with no program sees no difference.
- **The doctor's page is the desk look**: the same colours and typefaces, upright and flat, at reading size, with plain numerals. It should feel like a working tool that belongs to the same product, not like the game and not like a hospital system.

## What every screen has to do

1. **Be readable from two metres.** The current instruction is the largest thing on the screen. Nothing the player needs mid-move is smaller than about 40 px.
2. **Keep the gold figure as the hero.** Gold is the figure, the primary action, the selected thing and a Perfect. Nothing else is gold. The one exception is the target figure drawn over the camera on the Play screen: it is black, or the colour the player picks, because gold over a moving picture was hard to read.
3. **Stay out of the way of the camera.** The play HUD is DOM laid over the canvas, never drawn on it, and never covers the middle of the picture for longer than a pop.
4. **Move on the beat.** Anything that pulses in play reads the audio clock.

## Direction: Attract Mode

Three directions were explored as static mock-ups: Capsule (warm and calm), Block Party (flat colour fields) and Attract Mode. Attract Mode was chosen.

The page is an arcade cabinet's screen.

- **Dark ground, light as the material.** A near-black void with panels that step up in tone. Colour only appears as light: gold, cyan and pink, each with a soft glow.
- **Everything leans.** Panels and buttons are slanted 10 degrees, and the display type is a heavy italic at the same lean.
- **Numbers are LED digits.** Tempo, score, combo, XP and the countdown are set in a dot-matrix face.
- **Each colour means one thing.** Gold: the figure, the primary action, selection, Hold and Perfect. Cyan: labels, information, Reach and Good. Pink: Miss and warnings.
- **Motion rides the lane.** Things arrive along the slant and flash for a frame as they land. Marquee bulbs chase and lamps blink in time.

The full token set, type scale and component rules are in [`.interface-design/system.md`](.interface-design/system.md).

## What it does not say

No testimonials, user counts or outcome numbers. No claims such as "clinically proven" or "physio-approved". The calorie figure is always labelled an estimate ("Est. kcal"), is shown like a score, and comes with no targets and no talk of losing weight. The one statistic on the landing page ("Up to 70% of patients don't stick with their home exercises") links to its source.

The doctor loop adds a rule: **nothing shown to a patient reads as a medical or safety guarantee.** The angles are estimates from a webcam. A limit prompt says "Ease off", never "unsafe" or "stop"; a finding says what was measured ("right shoulder stops 14° short"), never what it means for the injury. The advice is the doctor's, in the doctor's own words. The page does not say the doctor is verified, because it does not check.

## Privacy

Rehabeat runs in the browser. The camera video never leaves the laptop. Progress (XP, level, daily streak), the run log behind Stats and the optional body weight are kept in `localStorage`; the run log and the weight are never sent anywhere. Signing in is optional. Signed in, a finished run's score goes on the leaderboard.

A patient who has joined a doctor also sends that doctor each program session: scores, joint angles, form flags and timing. Never the picture, and never body positions. Only that patient and that doctor can read them. The results screen says what was sent, every time.

The demo clinic on the doctor's page (sample patients, and "You") is kept in this browser only and is sent nowhere.
