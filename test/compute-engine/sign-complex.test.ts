/**
 * `Sign` on the complex plane is `z/|z|`, the point of the unit circle in
 * the direction of `z` — the reading Fungrim (entry 09c107, `Sign(i) = i`),
 * SymPy and Mathematica share. On the extended real line it stays exactly
 * {−1, 0, 1}, with its ranged integer type; `~oo` has no direction and stays
 * a boxing error; `NaN` propagates.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const ce = new ComputeEngine();

describe('off the real line', () => {
  test('the imaginary unit is its own sign', () => {
    const e = ce.box(['Sign', 'ImaginaryUnit']);
    expect(e.isValid).toBe(true);
    expect(e.evaluate().toString()).toBe('i');
    expect(ce.box(['Equal', ['Sign', 'ImaginaryUnit'], 'ImaginaryUnit']).evaluate().toString()).toBe(
      '"True"'
    );
  });

  test('a Gaussian integer with a rational modulus is exact', () => {
    const e = ce.box(['Sign', ['Complex', 3, 4]]);
    expect(e.evaluate().toString()).toBe('(3/5 + 4/5i)');
    expect(e.N().toString()).toBe('(0.6 + 0.8i)');
    expect(String(e.type)).toBe('complex');
  });

  test('a negative real stays -1, zero stays 0, infinities are ±1', () => {
    expect(ce.box(['Sign', -2]).evaluate().toString()).toBe('-1');
    expect(ce.box(['Sign', 0]).evaluate().toString()).toBe('0');
    expect(ce.box(['Sign', { num: '+Infinity' }]).evaluate().toString()).toBe('1');
    expect(ce.box(['Sign', { num: '-Infinity' }]).evaluate().toString()).toBe('-1');
  });

  test('complex infinity has no direction', () => {
    expect(ce.box(['Sign', 'ComplexInfinity']).isValid).toBe(false);
  });

  test('NaN propagates', () => {
    expect(ce.box(['Sign', { num: 'NaN' }]).evaluate().toString()).toBe('NaN');
  });
});

describe('the result type', () => {
  test('keeps the ranged tier for a proven extended real', () => {
    ce.declare('r', 'real');
    ce.declare('n', 'integer');
    expect(String(ce.box(['Sign', 'r']).type)).toBe('integer<-1..1>');
    expect(String(ce.box(['Sign', 'n']).type)).toBe('integer<-1..1>');
    expect(String(ce.box(['Sign', -2]).type)).toBe('integer<-1..1>');
  });

  test('a maybe-NaN real operand keeps the ranged tier beside the nan arm', () => {
    // `Fract(x)` types `real<0..1> | nan`: the NaN member must not read as
    // "may be complex".
    ce.declare('t', 'number');
    expect(String(ce.box(['Fract', 't']).type)).toBe('(real<0..1>) | nan');
    expect(String(ce.box(['Sign', ['Fract', 't']]).type)).toBe('(integer<-1..1>) | nan');
  });

  test('the compiled lane follows the operand, so a parent reads the right shape', () => {
    ce.declare('v', 'number');
    const r = compile(ce.box(['Add', ['Sign', 'v'], 1]), { to: 'javascript', fallback: false });
    expect(r.run!({ v: -3 })).toBe(0);
    expect(r.run!({ v: 5 })).toBe(2);
  });

  test('is complex off the real line, with the nan arm where the operand may carry one', () => {
    ce.declare('z', 'complex');
    ce.declare('u', 'number');
    expect(String(ce.box(['Sign', 'z']).type)).toBe('complex');
    expect(String(ce.box(['Sign', 'u']).type)).toBe('complex | nan');
  });
});

describe('the javascript target', () => {
  test('a complex operand takes the complex sign, a real one Math.sign', () => {
    ce.declare('w', 'complex');
    const c = compile(ce.box(['Sign', 'w']), { to: 'javascript', fallback: false });
    expect(c.code).toBe('_SYS.csign(_.w)');
    expect(c.run!({ w: { re: 3, im: 4 } })).toEqual({ re: 0.6, im: 0.8 });
    const big = c.run!({ w: { re: Number.MAX_VALUE, im: Number.MAX_VALUE } }) as { re: number; im: number };
    expect(big.re).toBeCloseTo(Math.SQRT1_2, 12);
    expect(c.run!({ w: { re: -7, im: 0 } })).toBe(-1);
    // A zero imaginary part is unwrapped to the plain number at the boundary.
    expect(c.run!({ w: { re: 0, im: 0 } })).toBe(0);
    ce.declare('x', 'real');
    expect(compile(ce.box(['Sign', 'x']), { to: 'javascript' }).code).toBe('Math.sign(_.x)');
  });
});
