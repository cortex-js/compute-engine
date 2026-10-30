/**
 * A block that assigns a function to a name the engine also assigns a
 * function to. Inside the block, a call of the name applies the block's
 * function, as the interpreter does. The constant folder evaluated the call
 * through the engine, applied the engine's function, and baked its value
 * into the code: with the engine `gg = t ↦ t + 1`, `Block(gg := t ↦ t + 10,
 * gg(1))` compiled to `return 2`, where the interpreter gives 11.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

function setup(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.assign('gg', ce.box(['Function', ['Add', 't', 1], 't'] as any));
  ce.declare('n', 'real');
  ce.declare('m', 'real');
  return ce;
}

/** The interpreter's value, with `n = 20` and `m = 5`. The block assigns
 * `gg` in the engine when it runs, so a fresh engine is used. */
function interpreted(json: unknown): string {
  const ce = setup();
  ce.assign('n', 20);
  ce.assign('m', 5);
  return ce
    .box(json as any)
    .evaluate()
    .toString();
}

const ADD10 = ['Assign', 'gg', ['Function', ['Add', 't', 10], 't']];

const CASES: Array<[string, unknown, unknown]> = [
  ['a call with a constant argument', ['Block', ADD10, ['gg', 1]], 11],
  [
    'a call in a comparison',
    [
      'Block',
      ['Assign', 'gg', ['Function', ['Add', 't', 'n'], 't']],
      ['Less', ['gg', 1], 'm'],
    ],
    false,
  ],
  ['a call applied with Apply', ['Block', ADD10, ['Apply', 'gg', 1]], 11],
  ['two calls in a sum', ['Block', ADD10, ['Add', ['gg', 1], ['gg', 2]]], 23],
  [
    'a call in a Sum',
    ['Block', ADD10, ['Sum', ['gg', 'k'], ['Limits', 'k', 1, 3]]],
    36,
  ],
  ['a call with a variable argument', ['Block', ADD10, ['gg', 'm']], 15],
];

describe('a call of a function that the enclosing block assigns', () => {
  test.each(CASES)('%s (JavaScript)', (_label, json, expected) => {
    const ce = setup();
    const r = compile(ce.box(json as any), { fallback: false }) as any;
    expect(r.run({ n: 20, m: 5 })).toBe(expected);
    const interp = interpreted(json);
    expect(interp).toBe(
      typeof expected === 'boolean'
        ? JSON.stringify(expected ? 'True' : 'False')
        : String(expected)
    );
  });

  test('interval-js uses the block function', () => {
    const ce = setup();
    const r = compile(ce.box(['Block', ADD10, ['gg', 1]] as any), {
      to: 'interval-js',
      fallback: false,
    }) as any;
    expect(r.run({})).toEqual({ kind: 'interval', value: { lo: 11, hi: 11 } });
  });

  test('Python uses the block function', () => {
    const ce = setup();
    const code = String(
      compile(ce.box(['Block', ADD10, ['gg', 1]] as any), {
        to: 'python',
        fallback: false,
      }).code
    );
    expect(code).toContain('return 11');
  });
});
