# Rehabeat: product and design direction

## What it is

Rehabeat is an arcade rhythm game for home stretching and rehab exercises. You stand about two metres from a laptop, a gold target figure shows the pose, and you match it on the beat. The melody only plays while your form holds.

It should feel like the menus of a rhythm game, not like a health app.

## Who it is for

Someone who has been given a home exercise routine and finds it hard to keep doing it. They are standing in a living room, two metres from a 13 to 15 inch screen, with their arms busy. They cannot read small text and cannot reach the keyboard mid-song.

## What every screen has to do

1. **Be readable from two metres.** The current instruction is the largest thing on the screen. Nothing the player needs mid-move is smaller than about 40 px.
2. **Keep the gold figure as the hero.** Gold is the figure, the primary action, the selected thing and a Perfect. Nothing else is gold.
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

## Privacy

Rehabeat runs in the browser. The camera video never leaves the laptop. Progress (XP, level, daily streak), the run log behind Stats and the optional body weight are kept in `localStorage`. Signing in is optional and only saves scores to the leaderboard; the run log and the weight are never sent anywhere.
