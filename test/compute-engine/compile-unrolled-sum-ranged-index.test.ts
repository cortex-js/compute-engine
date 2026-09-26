/**
 * The index of a `Sum`/`Product` over a `Limits` clause with integer-literal
 * bounds is typed with its range (`integer<1..40>`), so a body such as
 * `√(1 − ((i − 0.5)/40)²)` types `real` instead of `complex`.
 *
 * The JavaScript target must lower such a radical with the real kernel. The
 * compiler's sign test for a radicand did not read ranged types: the `Sqrt`
 * promoted to the complex lane (`{re, im}`) while its parent, which reads the
 * node's `real` type, emitted real arithmetic around it — `k·(1 − √…)`
 * compiled to `_.k * (_SYS.cneg({re, im}) + 1)`, which is NaN.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const ce = new ComputeEngine();
ce.declare('k', 'real');

/** `√(1 − ((i − 0.5)/40)²)` */
const ROOT = [
  'Sqrt',
  ['Subtract', 1, ['Square', ['Divide', ['Subtract', 'i', 0.5], 40]]],
];

function compiled(json: unknown) {
  const r = compile(ce.box(json as never), { fallback: false });
  if (r === undefined) throw new Error('compile() returned undefined');
  expect(r.success).toBe(true);
  return { source: (r.preamble ?? '') + r.code, run: r.run! };
}

function interpreted(json: unknown, vars: Record<string, number>): number {
  const substitution = Object.fromEntries(
    Object.entries(vars).map(([name, v]) => [name, ce.number(v)])
  );
  return ce
    .box(json as never)
    .subs(substitution)
    .N()
    .valueOf() as number;
}

describe('A Sum index typed with its literal range', () => {
  test('the radical body types real', () => {
    const sum = ce.box(['Sum', ROOT, ['Limits', 'i', 1, 40]] as never);
    expect(sum.op1.type.toString()).toBe('real');
  });

  test('a body that assigns the index keeps the unranged integer index', () => {
    // `j = 2` becomes `3` inside the body: a value outside `1..2`.
    const sum = ce.box([
      'Sum',
      ['Block', ['Assign', 'j', ['Add', 'j', 1]], ['Square', 'j']],
      ['Limits', 'j', 1, 2],
    ] as never);
    expect(sum.evaluate().json).toBe(13);
  });
});

describe('An unrolled Sum with a constant radical inside real arithmetic', () => {
  test('a product with the radical lowers real', () => {
    const json = [
      'Sum',
      ['Multiply', 'k', ['Subtract', 1, ROOT]],
      ['Limits', 'i', 1, 40],
    ];
    const { source, run } = compiled(json);
    expect(source).not.toContain('_SYS.c');
    expect(source).not.toContain('re:');
    expect(run({ k: 0.6 })).toBeCloseTo(interpreted(json, { k: 0.6 }), 12);
  });

  test('a sum with the radical lowers real', () => {
    const json = ['Sum', ['Add', 'k', ROOT], ['Limits', 'i', 1, 3]];
    const { source, run } = compiled(json);
    expect(source).not.toContain('re:');
    expect(run({ k: 0.5 })).toBeCloseTo(interpreted(json, { k: 0.5 }), 12);
  });
});
