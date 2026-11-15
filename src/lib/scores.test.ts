import { describe, expect, it } from 'vitest';
import { toLeaderboardRow } from './scores';

describe('toLeaderboardRow', () => {
  it('maps a leaderboard view row', () => {
    expect(
      toLeaderboardRow({
        user_id: 'u1',
        display_name: 'Maya R.',
        avatar_url: null,
        avatar_id: 'crown',
        is_sample: true,
        best_points: 4380,
        total_points: '8290',
        runs: 2,
        rank: 1,
      }),
    ).toEqual({
      userId: 'u1',
      displayName: 'Maya R.',
      avatarUrl: null,
      avatarId: 'crown',
      isSample: true,
      bestPoints: 4380,
      totalPoints: 8290,
      runs: 2,
      rank: 1,
    });
  });

  it('reads a row from before the avatar migration as a real player with no avatar chosen', () => {
    const row = toLeaderboardRow({ user_id: 'u2', display_name: 'Jonas', best_points: 3240, total_points: 3240, runs: 1, rank: 4 });
    expect(row.isSample).toBe(false);
    expect(row.avatarId).toBeNull();
    expect(row.avatarUrl).toBeNull();
  });

  it('fills the nullable view columns with safe values', () => {
    expect(toLeaderboardRow({})).toMatchObject({ userId: '', displayName: 'Player', bestPoints: 0, totalPoints: 0, runs: 0, rank: 0 });
  });
});
