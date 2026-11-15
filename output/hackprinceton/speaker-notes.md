# Rehabeat: two-minute HackPrinceton pitch

Open the HTML deck in a browser. Use arrow keys or Space to advance, F for fullscreen, N for notes, and T to start the timer. The deck works offline. The PDF has the same six slides.

## 1. Rehabeat (0:00–0:12)

What if your home exercise routine felt like a rhythm game? This is Rehabeat. You stand in front of your laptop, match a pose to the beat, and keep the music playing with your movement.

## 2. The gap between appointments (0:12–0:30)

Home exercises ask people to repeat movements on their own. Between appointments, staying motivated and checking your form can be difficult. We built Rehabeat to make practice rewarding and give a clinician something concrete to review.

## 3. Your form keeps the music playing (0:30–1:00)

Pick a song, calibrate, and follow the gold figure through reach, hold, and release. The webcam compares your joint angles with the target. Hold the pose and the melody comes in. Lose it and the melody fades, while the beat continues. Each hold earns Perfect, Good, or Miss, with hints about what to adjust. Combos and progress reward another attempt.

## 4. A webcam and one shared clock (1:00–1:22)

MediaPipe tracks body landmarks in the browser. We align camera frames to the Web Audio clock, so movement and music share one timeline. Eight yoga poses come from a landmark dataset, alongside three general exercises. Camera video stays on the laptop.

## 5. Practice the clinician can review (1:22–1:44)

A clinician chooses movements, rounds, and joint limits. After a linked program session, they can review completion, joint errors, and timing, then adjust the routine. This dashboard uses sample patients. These webcam estimates support review, not a clinical assessment.

## 6. One more song. One more rep. (1:44–2:00)

We have a working browser prototype that connects movement, music, and a clinician review workflow. Our next step is to test usability with patients and clinicians and improve the pose guidance. Rehabeat makes the next rep feel like the next beat. Thank you.

## Source references

1. PRODUCT.md; src/scoring/melodyGate.ts
2. PRODUCT.md, intended patient and doctor workflows; motivation is product rationale, not a measured outcome.
3. src/ui/PlayScreen.tsx; src/scoring/frameScore.ts; src/scoring/melodyGate.ts; src/audio/beatEngine.ts; docs/screenshots/hud-hold.png is a HUD preview, not a patient session.
4. src/pose/poseTracker.ts; src/pose/angles.ts; src/session.ts; src/audio/clock.ts; src/moves/moves.json; tools/moves/dataset.ts; PRODUCT.md privacy.
5. src/care/prescription.ts; src/care/session.ts; src/care/analysis/findings.ts; src/doctor/ProgramEditor.tsx; docs/screenshots/doctor.png is the demo clinic with sample data.
6. PRODUCT.md; src/App.tsx; usability testing is a proposed next step, not completed research.
