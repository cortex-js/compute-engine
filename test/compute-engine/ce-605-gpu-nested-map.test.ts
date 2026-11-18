/**
 * CE-605 (Tycho ledger row 475): a `Map` inside the lambda of another `Map`.
 * The GLSL code of the pipeline is checked by the `ir-glsl` tests; this file
 * keeps the JavaScript value of nested anonymous parameters.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const ce = new ComputeEngine();

const SAMPLES = [-1.5, 0, 0.7, 2];

describe('CE-605 — a Map inside the lambda of another Map on the GPU', () => {

  it('nested anonymous parameters: no wrong code on any target', () => {
    // Both lambdas are written with the parameter `_1`. `subs` does not
    // treat a name that starts with `_` as a binder, so writing out the
    // outer `Map` with `subs` would also replace the parameter and the body
    // of the inner lambda. The JavaScript target gives the interpreter value.
    const list = (n: number) => [
      'List',
      ...Array.from({ length: n }, (_, i) => i + 1),
    ];
    for (const n of [2, 6]) {
      const expr = ce.box([
        'Min',
        [
          'Map',
          [
            'Function',
            [
              'Add',
              '_1',
              ['Max', ['Map', ['Function', ['Multiply', '_1', 'x'], '_1'], list(n)]],
            ],
            '_1',
          ],
          list(n),
        ],
      ] as never);
      const js = compile(expr, { to: 'javascript', fallback: false } as never) as {
        run: (v: object) => number;
      };
      for (const x of SAMPLES)
        expect([n, x, js.run({ x })]).toEqual([
          n,
          x,
          expect.closeTo(expr.subs({ x }).N().re, 9),
        ]);
    }
  });

  it('an inner source of unknown length: the decline stays', () => {
    const latex = String.raw`\min\left(\mathrm{Map}\left(k\mapsto \max\left(\mathrm{Map}\left(j\mapsto j\cdot k, L\right)\right)+x, \left[1,2\right]\right)\right)`;
    for (const to of ['glsl'] as const)
      expect(() =>
        compile(ce.parse(latex, { strict: false }), {
          to,
          fallback: false,
        } as never)
      ).toThrow(/the input L of type/);
  });

  it('an element that an inner binder would capture: the decline stays', () => {
    // `j` is an input of no type: the pipeline refuses it.
    const latex = String.raw`\min\left(\mathrm{Map}\left(k\mapsto \max\left(\mathrm{Map}\left(j\mapsto j+k, \left[1,3\right]\right)\right), \left[j,2\right]\right)\right)+x`;
    for (const to of ['glsl'] as const)
      expect(() =>
        compile(ce.parse(latex, { strict: false }), {
          to,
          fallback: false,
        } as never)
      ).toThrow(/the input `j` has no type/);
  });
});
