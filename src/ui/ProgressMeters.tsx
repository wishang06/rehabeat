import { useMemo, type CSSProperties } from 'react';
import { currentStreak, dayKey, levelFor, useProgress, weekOfStreak } from '../progress';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** Level and XP as a row of LED segments. `fraction` overrides the fill, for the results screen's animation. */
export function XpBar({ xp, className }: { xp: number; className?: string }) {
  const level = levelFor(xp);
  return (
    <div
      className={className ? `xp ${className}` : 'xp'}
      role="img"
      aria-label={`Level ${level.level}, ${level.into} of ${level.span} XP`}
      data-testid="xp-bar"
    >
      <span className="xp__level label">Level {level.level}</span>
      <span className="xp__track segments">
        <span className="xp__fill" style={{ '--fill': level.fraction } as CSSProperties} />
      </span>
      <span className="xp__count led">
        {level.into} / {level.span} XP
      </span>
    </div>
  );
}

/** The daily streak: the count, and a lamp for each day of this week that is part of it. */
export function StreakLamps({ className }: { className?: string }) {
  const progress = useProgress();
  // The date is read once per mount: a screen left open over midnight is not worth a timer.
  const today = useMemo(() => new Date(), []);
  const count = currentStreak(progress.streak, dayKey(today));
  const week = weekOfStreak(progress.streak, today);
  return (
    <div
      className={className ? `streak ${className}` : 'streak'}
      role="img"
      aria-label={`${count} day streak`}
      data-testid="streak-meter"
    >
      <span className="streak__count led">{count}</span>
      <span className="streak__label label">day streak</span>
      <span className="streak__week">
        {week.map((lit, index) => (
          <i key={DAYS[index]} data-on={lit} title={DAYS[index]} />
        ))}
      </span>
    </div>
  );
}

/** XP and streak together, as they sit in the marquee and on the title screen. */
export function ProgressMeters({ className }: { className?: string }) {
  const progress = useProgress();
  return (
    <div className={className ? `meters ${className}` : 'meters'}>
      <XpBar xp={progress.xp} />
      <StreakLamps />
    </div>
  );
}
