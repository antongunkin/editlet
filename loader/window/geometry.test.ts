import { describe, expect, it } from 'vitest';

import { BAR_HEIGHT, dialogStyle, drag, fitRect, MARGIN, pillStyle, sheetHeight, sheetStyle } from './geometry';

const V = { w: 1440, h: 900 };

describe('fitRect', () => {
  it('opens at 600×800, top right, with the margin', () => {
    expect(fitRect({}, V)).toEqual({ w: 600, h: 800, x: 1440 - MARGIN - 600, y: MARGIN });
  });

  it('shrinks to the screen minus the margins', () => {
    expect(fitRect({}, { w: 500, h: 600 })).toEqual({ w: 460, h: 560, x: 20, y: 20 });
  });

  it('never goes below the minimum size', () => {
    expect(fitRect({ x: 5, y: 5, w: 10, h: 10 }, V)).toEqual({ x: 5, y: 5, w: 320, h: 320 });
  });

  it('may hang off the sides by half its width and sink until only its bar shows, never off the top', () => {
    const r = { w: 600, h: 400 };
    expect(fitRect({ ...r, x: -5000, y: -5000 }, V)).toEqual({ ...r, x: -300, y: 0 });
    expect(fitRect({ ...r, x: 5000, y: 5000 }, V)).toEqual({ ...r, x: 1440 - 600 + 300, y: 900 - BAR_HEIGHT });
  });
});

describe('drag', () => {
  const start = { x: 100, y: 100, w: 600, h: 400 };
  it('moves by the deltas, up to half off screen', () => {
    expect(drag(start, 'move', 50, -500, V)).toEqual({ ...start, x: 150, y: 0 });
    expect(drag(start, 'move', -900, 0, V)).toEqual({ ...start, x: -300 });
  });
  it('resizes by the right and bottom edges, kept inside the limits', () => {
    expect(drag(start, 'se', 100, 900, V)).toEqual({ x: 100, y: 100, w: 700, h: 860 });
    expect(drag(start, 'e', 100, 900, V)).toEqual({ ...start, w: 700 });
    expect(drag(start, 's', 100, -900, V)).toEqual({ ...start, h: 320 });
  });
  it('resizes by the left and top edges with the opposite edges kept in place', () => {
    expect(drag(start, 'nw', -50, -30, V)).toEqual({ x: 50, y: 70, w: 650, h: 430 });
    expect(drag(start, 'w', 500, 0, V)).toEqual({ ...start, x: 380, w: 320 });
    expect(drag(start, 'n', 0, -500, V)).toEqual({ ...start, y: 0, h: 500 });
  });
  it('pulls the other two corners on both axes', () => {
    expect(drag(start, 'ne', 40, -40, V)).toEqual({ x: 100, y: 60, w: 640, h: 440 });
    expect(drag(start, 'sw', -40, 40, V)).toEqual({ x: 60, y: 100, w: 640, h: 440 });
  });
});

describe('dialogStyle', () => {
  it('places the dialog at its rect', () => {
    const r = { x: 10, y: 20, w: 600, h: 400 };
    expect(dialogStyle(r)).toMatchObject({ left: '10px', top: '20px', width: '600px', height: '400px' });
  });
});

describe('pillStyle', () => {
  it('centres the pill 20px above the bottom edge, rounded by half its height, never wider than the screen', () => {
    expect(pillStyle({ w: 140, h: 40 }, V)).toEqual({
      left: '650px',
      top: 'auto',
      right: 'auto',
      bottom: '20px',
      width: '140px',
      height: '40px',
      'border-radius': '20px',
    });
    expect(pillStyle({ w: 500, h: 40 }, { w: 300, h: 600 })).toMatchObject({ left: '0px', width: '300px' });
  });
});

describe('the bottom sheet', () => {
  const phone = { w: 390, h: 800 };
  it('grows when its top edge is pulled up, shrinks when pulled down, within the screen less the margin', () => {
    expect(sheetHeight(560, -100, phone)).toBe(660);
    expect(sheetHeight(560, 100, phone)).toBe(460);
    expect(sheetHeight(560, -1000, phone)).toBe(800 - MARGIN);
    expect(sheetHeight(560, 1000, phone)).toBe(320);
  });

  it('is the loader’s CSS until pulled, then only its height is set', () => {
    expect(Object.values(sheetStyle(null)).every((v) => v === '')).toBe(true);
    expect(sheetStyle(500)).toMatchObject({ height: '500px', top: '', left: '', width: '' });
  });
});
