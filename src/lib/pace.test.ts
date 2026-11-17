import { describe, expect, it } from 'vitest';
import {
  PACE_PRESETS,
  calcDistanceFromMinutes,
  calcMinutesFromDistance,
  calcSecondsFromDistance,
  formatEstimatedMinutes,
  paceById,
  type PaceId,
} from './pace';

describe('PACE_PRESETS', () => {
  it('keeps km/h and m/s consistent', () => {
    for (const p of PACE_PRESETS) expect(p.mps).toBeCloseTo(p.kmh / 3.6, 9);
  });

  it('paceText matches the speed (min/km)', () => {
    for (const p of PACE_PRESETS) {
      const sec = Math.round(1000 / p.mps);
      const text = `${Math.floor(sec / 60)}'${String(sec % 60).padStart(2, '0')}"/km`;
      expect(p.paceText).toBe(text);
    }
  });
});

describe('paceById', () => {
  it('finds each preset', () => {
    for (const p of PACE_PRESETS) expect(paceById(p.id)).toBe(p);
  });

  it('falls back to normal walking for an unknown id', () => {
    expect(paceById('fly' as PaceId).id).toBe('walk');
  });
});

describe('distance/time conversions', () => {
  it('30 minutes of walking is 2.4 km', () => {
    expect(calcDistanceFromMinutes(30, 'walk')).toBe(2400);
  });

  it('never returns less than 50 m', () => {
    expect(calcDistanceFromMinutes(0, 'slow')).toBe(50);
  });

  it('2.4 km of walking is 30 minutes / 1800 seconds', () => {
    expect(calcMinutesFromDistance(2400, 'walk')).toBe(30);
    expect(calcSecondsFromDistance(2400, 'walk')).toBe(1800);
  });

  it('never returns less than 1 minute / 1 second', () => {
    expect(calcMinutesFromDistance(0, 'jog')).toBe(1);
    expect(calcSecondsFromDistance(0, 'jog')).toBe(1);
  });

  it('round-trips minutes -> distance -> minutes for every preset', () => {
    for (const p of PACE_PRESETS) {
      for (const min of [10, 15, 20, 30, 45, 60]) {
        expect(calcMinutesFromDistance(calcDistanceFromMinutes(min, p.id), p.id)).toBe(min);
      }
    }
  });
});

describe('formatEstimatedMinutes', () => {
  it('formats minutes and hours', () => {
    expect(formatEstimatedMinutes(0)).toBe('1분');
    expect(formatEstimatedMinutes(45)).toBe('45분');
    expect(formatEstimatedMinutes(60)).toBe('1시간');
    expect(formatEstimatedMinutes(95)).toBe('1시간 35분');
    expect(formatEstimatedMinutes(59.6)).toBe('1시간');
  });
});
