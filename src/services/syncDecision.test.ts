import { describe, expect, it } from 'vitest';
import { decideSync } from './syncDecision';
describe('decideSync', () => {
  it('accepts identical local and cloud copies', () => expect(decideSync('a','a',null)).toBe('equal'));
  it('requires a decision for different copies without a baseline', () => expect(decideSync('a','b',null)).toBe('conflict'));
  it('downloads when only cloud changed', () => expect(decideSync('a','b','a')).toBe('download'));
  it('uploads when only local changed', () => expect(decideSync('b','a','a')).toBe('upload'));
  it('stops when both changed', () => expect(decideSync('b','c','a')).toBe('conflict'));
  it('stops for an inconsistent baseline', () => expect(decideSync('b','c','b')).toBe('download'));
});
