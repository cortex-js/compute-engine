/**
 * `Limits` with a step (GitHub #517): `["Limits", "i", 1, 4, 2]` is the
 * Wolfram iterator `{i, 1, 4, 2}`. A big operator reads it as
 * `Element(i, Range(1, 4, 2))`; before, the step was dropped and
 * `Sum(i, Limits(i, 1, 4, 2))` was 10.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const ce = new ComputeEngine();

type Json = Parameters<typeof ce.box>[0];

function stepped(
  op: 'Sum' | 'Product',
  body: Json,
  lo: Json,
  hi: Json,
  step: Json
) {
  return ce.box([op, body, ['Limits', 'i', lo, hi, step]] as Json);
}

function ranged(
  op: 'Sum' | 'Product',
  body: Json,
  lo: Json,
  hi: Json,
  step: Json
) {
  return ce.box([op, body, ['Element', 'i', ['Range', lo, hi, step]]] as Json);
}

describe('LIMITS WITH A STEP', () => {
  test('the step is kept by boxing', () => {
    expect(ce.box(['Limits', 'i', 1, 4, 2]).json).toEqual([
      'Limits',
      'i',
      1,
      4,
      2,
    ]);
    expect(ce.box(['Sum', 'i', ['Limits', 'i', 1, 4, 2]]).json).toEqual([
      'Sum',
      'i',
      ['Element', 'i', ['Range', 1, 4, 2]],
    ]);
  });

  // [lower, upper, step, sum of i, product of i]
  const cases: [Json, Json, Json, string, string][] = [
    [1, 4, 2, '4', '3'],
    [4, 1, -2, '6', '8'],
    [1, 10, 3, '22', '280'],
    // The step does not divide the span: 1, 5, 9.
    [1, 10, 4, '15', '45'],
    [10, 1, -4, '18', '120'],
    // An empty range: the sum is 0 and the product is 1.
    [5, 1, 2, '0', '1'],
    [1, 5, -1, '0', '1'],
    // A step of 0 gives the empty range, as `Range(1, 4, 0)` does.
    [1, 4, 0, '0', '1'],
    // A step that is not an integer gives the values of `Range`.
    [1, 4, 0.5, '17.5', '315'],
    [1, 4, ['Rational', 1, 2], '35/2', '315'],
  ];

  test.each(cases)(
    'Sum and Product over Limits(i, %j, %j, %j)',
    (lo, hi, step, sum, product) => {
      const s = stepped('Sum', 'i', lo, hi, step);
      expect(s.evaluate().toString()).toBe(sum);
      expect(s.N().re).toBeCloseTo(ce.parse(sum).N().re, 12);
      const r = ranged('Sum', 'i', lo, hi, step);
      expect(s.evaluate().isSame(r.evaluate())).toBe(true);

      const p = stepped('Product', 'i', lo, hi, step);
      expect(p.evaluate().toString()).toBe(product);
      expect(p.N().re).toBeCloseTo(ce.parse(product).N().re, 12);
    }
  );

  test('a body that uses the index', () => {
    const s = stepped('Sum', ['Power', 'i', 2], 1, 4, 2);
    expect(s.evaluate().toString()).toBe('10');
    expect(s.N().re).toBe(10);
  });

  test('a stepped clause with a second clause', () => {
    const s = ce.box([
      'Sum',
      ['Multiply', 'i', 'j'],
      ['Limits', 'i', 1, 4, 2],
      ['Limits', 'j', 1, 2],
    ]);
    expect(s.evaluate().toString()).toBe('12');
  });

  test('a symbolic upper bound stays symbolic until it is known', () => {
    const s = ce.box(['Sum', 'i', ['Limits', 'i', 1, 'm', 2]]);
    expect(s.evaluate().operator).toBe('Sum');
    expect(s.subs({ m: 7 }).evaluate().toString()).toBe('16');
  });

  test('a stepped Tuple accepts a step that is not an integer; a Set is no iterator', () => {
    // These threw a type error: the index was declared `integer`.
    expect(
      ce.box(['Sum', 'i', ['Tuple', 'i', 1, 4, 0.5]]).evaluate().toString()
    ).toBe('17.5');
    expect(
      ce
        .box(['Sum', 'i', ['Tuple', 'i', 1, 4, ['Rational', 1, 2]]])
        .evaluate()
        .toString()
    ).toBe('35/2');
    expect(
      JSON.stringify(
        ce
          .box(['Sum', 'i', ['Set', 'i', 1, 4, ['Rational', 1, 2]]])
          .evaluate().json
      )
    ).toContain('"Error"');
  });

  test('compilation declines a stepped clause; the fallback works', () => {
    const s = compile(stepped('Sum', 'i', 1, 4, 2));
    expect(s.success).toBe(false);
    expect(s.run!()).toBe(4);
    const p = compile(stepped('Product', 'i', 1, 10, 4));
    expect(p.success).toBe(false);
    expect(p.run!()).toBe(45);
  });

  test('NDSolve does not read a step: it stays unevaluated', () => {
    const ode = (limits: Json) =>
      ce.box([
        'NDSolve',
        ['Equal', ['D', ['y', 't'], 't'], ['y', 't']],
        'y',
        limits,
        1,
      ] as Json);
    expect(ode(['Limits', 't', 0, 1]).evaluate().operator).toBe('List');
    expect(ode(['Limits', 't', 0, 1, 0.5]).evaluate().operator).toBe(
      'NDSolve'
    );
  });

  test('LaTeX round trip', () => {
    const s = ce.box(['Sum', 'i', ['Limits', 'i', 1, 4, 2]]);
    expect(s.latex).toBe(String.raw`\sum_{i\in 1..3..4}i`);
    expect(ce.parse(s.latex).json).toEqual(s.json);
    expect(ce.parse(s.latex).evaluate().toString()).toBe('4');

    // A non-canonical stepped clause is written as its canonical form.
    const raw = ce.box(['Product', 'i', ['Limits', 'i', 1, 10, 4]], {
      canonical: false,
    });
    expect(raw.latex).toBe(String.raw`\prod_{i\in 1..5..10}i`);
    expect(ce.parse(raw.latex).evaluate().toString()).toBe('45');

    // A `Limits` that is not in a big operator.
    const limits = ce.box(['Limits', 'i', 1, 4, 2]);
    expect(ce.parse(limits.latex).json).toEqual(limits.json);
  });
});
