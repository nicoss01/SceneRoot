import { describe, expect, it } from 'vitest';
import { nextInDirection, type Box } from './spatial';

const box = (left: number, top: number, width = 200, height = 120): Box => ({ left, top, width, height });

describe('nextInDirection', () => {
  const grid = [
    { item: 'a1', box: box(0, 0) }, { item: 'a2', box: box(220, 0) }, { item: 'a3', box: box(440, 0) },
    { item: 'b1', box: box(0, 140) }, { item: 'b2', box: box(220, 140) },
  ];
  it('moves to the neighbour on the same row, not to the row below', () => {
    expect(nextInDirection(box(0, 0), grid.filter(c => c.item !== 'a1'), 'ArrowRight')).toBe('a2');
  });
  it('moves straight down within the same column', () => {
    expect(nextInDirection(box(220, 0), grid.filter(c => c.item !== 'a2'), 'ArrowDown')).toBe('b2');
  });
  it('walks a row one step at a time', () => {
    expect(nextInDirection(box(220, 0), grid.filter(c => c.item !== 'a2'), 'ArrowRight')).toBe('a3');
  });
  it('reaches a misaligned element when nothing overlaps, such as a search field above a grid', () => {
    const field = [{ item: 'field', box: box(40, -90, 600, 60) }];
    expect(nextInDirection(box(440, 0), field, 'ArrowUp')).toBe('field');
  });
  it('returns nothing at the edge', () => {
    expect(nextInDirection(box(440, 0), grid.filter(c => c.item !== 'a3'), 'ArrowRight')).toBeUndefined();
  });
  it('ignores an element stacked on the current one', () => {
    expect(nextInDirection(box(0, 0), [{ item: 'same', box: box(0, 0) }], 'ArrowRight')).toBeUndefined();
  });
});
