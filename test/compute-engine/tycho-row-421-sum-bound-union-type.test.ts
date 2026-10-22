/**
 * Tycho ledger row 421 (`~/dev/tycho/docs/COMPUTE_ENGINE.md`, filed
 * 2026-10-22 on CE 0.161.0): a `Sum` or `Product` bound refused a symbol
 * whose type is a union with a number arm (`broadcastable<number | tuple>`,
 * `number | string`): `checkBound` (`library/utils.ts`) accepted only a
 * type that matches `number`, although its comment said it rejects only a
 * bound that is provably not a number. The bound of an integral, and the
 * operands of `Mod` and `Max`, accepted the same declaration.
 *
 * The cases follow Tycho's instrument
 * (`scripts/repros/2026-10-22-ce421-sum-bound-union-type-repro.mts`).
 */

import { ComputeEngine, compile } from '../../src/compute-engine';

const ce = new ComputeEngine();

/** Parse `latex` with `x` declared `type`, in a scope of its own. */
const parseWith = (type: string, latex: string) => {
  ce.pushScope();
  try {
    ce.declare('x', { type });
    return ce.parse(latex);
  } finally {
    ce.popScope();
  }
};

describe('row 421: a bound that could be a number', () => {
  for (const type of [
    'broadcastable<number | tuple>',
    'broadcastable<number>',
    'number | tuple',
    'number | string',
  ])
    for (const latex of [
      '\\sum_{n=1}^{x}n^2',
      '\\sum_{n=x}^{5}n',
      '\\prod_{n=1}^{x}n',
      '\\sum_{n=1}^{\\lfloor x\\rfloor}n',
    ])
      test(`${latex} over x: ${type} is valid`, () => {
        expect(parseWith(type, latex).isValid).toBe(true);
      });

  test('a function over such a parameter: a number, and a list that broadcasts', () => {
    ce.pushScope();
    ce.declare('a', { type: 'broadcastable<number | tuple>' });
    const body = ce.parse('\\sum_{k=1}^{a}k');
    ce.popScope();
    expect(body.isValid).toBe(true);
    ce.declare('sBroad', 'function');
    ce.assign('sBroad', ce.expr(['Function', body.json, 'a']));
    expect(ce.expr(['sBroad', 3]).evaluate().re).toBe(6);
    expect(ce.expr(['sBroad', ['List', 1, 2, 3]]).evaluate().json).toEqual([
      'List',
      1,
      3,
      6,
    ]);
  });
});

describe('row 421: a bound that cannot be a number is still refused', () => {
  for (const type of [
    'string',
    'boolean',
    'list<integer>',
    'tuple<integer, integer>',
  ])
    test(`x: ${type}`, () => {
      const e = parseWith(type, '\\sum_{n=1}^{x}n');
      expect(e.isValid).toBe(false);
      expect(JSON.stringify(e.json)).toContain('incompatible-type');
    });

  test('a literal string or Missing bound', () => {
    expect(
      ce.box(['Sum', 'n', ['Limits', 'n', { str: 'lo' }, 10]] as any).isValid
    ).toBe(false);
    expect(
      ce.box(['Sum', 'n', ['Limits', 'n', 1, 'Missing']] as any).isValid
    ).toBe(false);
  });

  test('a union bound whose value is not a number leaves the sum unevaluated', () => {
    ce.pushScope();
    ce.declare('y', { type: 'number | string' });
    ce.assign('y', ce.string('abc'));
    const v = ce.parse('\\sum_{n=1}^{y}n').evaluate();
    ce.popScope();
    expect(v.operator).toBe('Sum');
  });
});

describe('row 421: a bound that may not be a number (the cases of the review)', () => {
  test('a top type such as value or expression is accepted too', () => {
    for (const type of ['value', 'expression'])
      expect(parseWith(type, '\\sum_{n=1}^{x}n').isValid).toBe(true);
  });

  test('two equal bounds that may not be numbers are not folded to one term', () => {
    ce.pushScope();
    ce.declare('x', { type: 'number | string' });
    const e = ce.box(['Sum', 1, ['Limits', 'n', 'x', 'x']] as any);
    ce.popScope();
    expect(e.operator).toBe('Sum');
  });

  test('a product over a tuple value stays unevaluated (no Factorial closed form)', () => {
    ce.pushScope();
    ce.declare('y', { type: 'number | tuple' });
    ce.assign('y', ce.parse('(3,4)'));
    const p = ce.parse('\\prod_{n=1}^{y}n').evaluate().evaluate();
    const s = ce.parse('\\sum_{n=1}^{y}n').evaluate();
    ce.popScope();
    expect(p.operator).toBe('Product');
    expect(s.operator).toBe('Sum');
  });

  test('a number value evaluates', () => {
    ce.pushScope();
    ce.declare('w', { type: 'number | string' });
    ce.assign('w', 4);
    const s = ce.parse('\\sum_{n=1}^{w}n').evaluate();
    const p = ce.parse('\\prod_{n=1}^{w}n').evaluate();
    ce.popScope();
    expect(s.re).toBe(10);
    expect(p.re).toBe(24);
  });

  test('the compiled loop answers NaN for a bound that is not a number', () => {
    ce.pushScope();
    ce.declare('z', { type: 'number | string' });
    const r = compile(ce.parse('\\sum_{n=1}^{z}n'), {
      to: 'javascript',
    }) as any;
    ce.popScope();
    expect(r.success).toBe(true);
    expect(r.run({ z: 3 })).toBe(6);
    // `Math.floor` read "3" as 3, true as 1 and [3] as 3.
    for (const z of ['3', true, [3]]) expect(r.run({ z })).toBeNaN();
  });

  test('a bound typed as a number still compiles to Math.floor', () => {
    ce.pushScope();
    ce.declare('u', { type: 'real' });
    const r = compile(ce.parse('\\sum_{n=1}^{u}n'), {
      to: 'javascript',
    }) as any;
    ce.popScope();
    expect(r.code).toContain('Math.floor(_.u)');
  });
});
