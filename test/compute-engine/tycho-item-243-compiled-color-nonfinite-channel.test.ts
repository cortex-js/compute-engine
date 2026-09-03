/**
 * A compiled color constructor with a NON-FINITE channel answers the `NaN`
 * triple, as the interpreter's `incompatible-type` rejection projects.
 *
 * The `javascript` target represents `~oo` as `Infinity`, and the sRGB
 * conversion inside `_SYS.hsv` clamped an infinite saturation or value into
 * `[0, 1]`: `Hsv(90, 1, ~oo)` compiled to the same finite color as
 * `Hsv(90, 1, 1)` while `AsRgb(Hsv(90, 1, +oo))` evaluates to an error (Tycho
 * item 243). A finite out-of-range channel still clamps on both routes, and a
 * non-finite alpha reads as opaque on both.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const ce = new ComputeEngine();

function run(latex: string): unknown {
  const r = compile(ce.parse(latex), { to: 'javascript' });
  expect(r.success).toBe(true);
  return r.run!();
}

const NAN3 = [NaN, NaN, NaN];

describe('a non-finite channel', () => {
  test.each([
    ['infinite value', '\\operatorname{Hsv}(90,1,1/0)'],
    ['infinite saturation', '\\operatorname{Hsv}(90,1/0,1)'],
    ['infinite hue', '\\operatorname{Hsv}(1/0,1,1)'],
    ['NaN value', '\\operatorname{Hsv}(90,1,0/0)'],
    ['Hsl infinite lightness', '\\operatorname{Hsl}(90,1,1/0)'],
    ['Rgb infinite channel', '\\operatorname{Rgb}(1/0,0,0)'],
    ['Oklab infinite a', '\\operatorname{Oklab}(0.5,1/0,0)'],
    ['Oklch infinite chroma', '\\operatorname{Oklch}(0.5,1/0,90)'],
  ])('%s is the NaN triple, and the interpreter rejects it', (_label, latex) => {
    expect(run(latex)).toEqual(NAN3);
    expect(String(ce.parse(`\\operatorname{AsRgb}(${latex})`).evaluate())).toBe(
      'Error("incompatible-type")'
    );
  });

  test('keeps the alpha slot', () => {
    expect(run('\\operatorname{Hsv}(90,1,1/0,0.5)')).toEqual([NaN, NaN, NaN, 0.5]);
  });

  test('a free variable bound to Infinity at run time', () => {
    const r = compile(ce.parse('\\operatorname{Hsv}(90,1,v)'), { to: 'javascript' });
    expect(r.run!({ v: Infinity })).toEqual(NAN3);
    expect(r.run!({ v: 1 })).toEqual(r.run!({ v: 2 }));
  });
});

describe('finite channels are unchanged', () => {
  test('an out-of-range value clamps on both routes', () => {
    expect(run('\\operatorname{AsRgb}(\\operatorname{Hsv}(90,1,2))')).toEqual(
      run('\\operatorname{AsRgb}(\\operatorname{Hsv}(90,1,1))')
    );
    expect(String(ce.parse('\\operatorname{AsRgb}(\\operatorname{Hsv}(90,1,2))').evaluate())).toBe(
      'Rgb(0.5, 1, 0)'
    );
  });

  test('a non-finite alpha is opaque', () => {
    expect(run('\\operatorname{Hsv}(90,1,1,1/0)')).toEqual(run('\\operatorname{Hsv}(90,1,1)'));
  });
});
