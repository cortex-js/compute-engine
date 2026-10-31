/**
 * A callback `Function` literal whose parameter carries a type ascription is
 * admissible to CSE and to the loop-invariant hoist.
 *
 * Canonicalization writes the inferred element type of a callback parameter
 * as the ascription `Typed(j, "integer")`. The parameters of a `Function`
 * literal stay non-canonical, so this `Typed` parameter has no bound operator
 * definition, and the CSE eligibility test refuses every application without
 * one. A parameter declares a name and emits no code, so the eligibility test
 * checks only the body of a `Function` literal, and not its parameters. This
 * applies to the check of an inline callback and to the check of the body of
 * a user-defined function. If the parameters were checked, a `Map` whose
 * callback has a typed parameter would never be admissible, and a `Map` that
 * does not depend on the parameter of an enclosing callback would be built
 * again for every element of the enclosing collection.
 *
 * Reported as GitHub issue 497.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { isCseAdmissible } from '../../src/compute-engine/compilation/cse';

const ce = new ComputeEngine();
ce.declare('n', 'integer');

// `u` does not depend on `k`, and the callback over `k` reads it twice.
const u = [
  'Map',
  ['Function', ['Mod', ['Multiply', 'j', 'j'], 7], 'j'],
  ['Range', 1, 'n', 1],
];
const expr = ce.box([
  'Sum',
  [
    'Map',
    ['Function', ['Add', ['At', u, 'k'], ['Length', u]], 'k'],
    ['Range', 1, ['Length', u]],
  ],
] as never);

/** How many times `needle` occurs in `text`. */
function count(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

describe('a callback with a typed parameter', () => {
  test('the canonical literal carries the ascription and is admissible', () => {
    const inner = ce.box(u as never);
    expect(inner.ops[0].ops[1].operator).toBe('Typed');
    expect(isCseAdmissible(inner)).toBe(true);
  });

  test('an invariant Map inside a callback is built once, not per element', () => {
    const r = compile(expr, { to: 'javascript' });
    expect(r.success).toBe(true);
    const code = (r.preamble ?? '') + r.code!;
    // One copy for the `Range` bound outside the callback over `k`, one
    // bound on the first call of that callback. Before the fix the callback
    // held two copies, one for `At` and one for `Length`.
    expect(count(code, '_SYS.floorMod(j * j, 7)')).toBe(2);
  });

  test('the value agrees with the interpreter and with CSE turned off', () => {
    const r = compile(expr, { to: 'javascript' });
    const plain = compile(expr, { to: 'javascript', cse: false });
    expect(plain.success).toBe(true);
    for (const n of [0, 1, 5, 32]) {
      const expected = expr.subs({ n }).evaluate().re;
      expect(r.run!({ n })).toBe(expected);
      expect(plain.run!({ n })).toBe(expected);
    }
  });

  test('two copies of the Map in one body are built once', () => {
    const e = ce.box(['Add', ['Length', u], ['Max', u]] as never);
    const r = compile(e, { to: 'javascript' });
    expect(r.success).toBe(true);
    const code = (r.preamble ?? '') + r.code!;
    expect(count(code, '_SYS.floorMod(j * j, 7)')).toBe(1);
    for (const n of [1, 6])
      expect(r.run!({ n })).toBe(e.subs({ n }).evaluate().re);
  });

  test('a user-defined function whose body holds a typed callback is admissible', () => {
    const ce2 = new ComputeEngine();
    ce2.declare('n', 'integer');
    ce2.assign(
      'g',
      ce2.box([
        'Function',
        [
          'Sum',
          ['Map', ['Function', ['Multiply', 'j', 'j'], 'j'], ['Range', 1, 'm']],
        ],
        'm',
      ] as never)
    );
    expect(
      isCseAdmissible(ce2.box(['g', 'n'] as never), {
        admitPureUserFunctions: true,
      })
    ).toBe(true);

    // The callback over `k` reads `g(n)` twice, and `g(n)` does not depend
    // on `k`, so it is computed once.
    const e = ce2.box([
      'Sum',
      [
        'Map',
        ['Function', ['Add', ['Multiply', ['g', 'n'], 'k'], ['g', 'n']], 'k'],
        ['Range', 1, 'n'],
      ],
    ] as never);
    const r = compile(e, { to: 'javascript' });
    expect(r.success).toBe(true);
    expect(count(r.code!, '_fn_g(_.n)')).toBe(1);
    for (const n of [1, 4, 7])
      expect(r.run!({ n })).toBe(e.subs({ n }).evaluate().re);
  });

  test('a Map that reads the callback parameter stays inside the callback', () => {
    // `v` reads `k`, so it changes with every element and must not be
    // hoisted.
    const v = [
      'Map',
      ['Function', ['Mod', ['Multiply', 'j', 'k'], 7], 'j'],
      ['Range', 1, 'n', 1],
    ];
    const e = ce.box([
      'Sum',
      [
        'Map',
        ['Function', ['Add', ['At', v, 'k'], ['Length', v]], 'k'],
        ['Range', 1, 'n'],
      ],
    ] as never);
    const r = compile(e, { to: 'javascript' });
    expect(r.success).toBe(true);
    for (const n of [1, 4, 9])
      expect(r.run!({ n })).toBe(e.subs({ n }).evaluate().re);
  });
});
