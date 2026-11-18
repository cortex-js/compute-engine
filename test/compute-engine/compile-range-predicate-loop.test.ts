/**
 * Issue #373: a predicate consumer over a finite `Range` compiles to a
 * counted loop on the JavaScript target, with no array built.
 *
 * `Count(Filter(Range(1, n), p))` used to allocate the whole range with
 * `Array.from`, filter it into a second array, and read the length: about
 * 27 ms at n = 10⁶ where a loop that counts runs in under 2 ms. The same
 * walk now serves `Length(Filter(…))`, `Count(range, p)`, `CountIf`, `Any`,
 * `All`, the collection form of `Sum`/`Product` over a filtered range, and a
 * bare `Filter` over a range (`emitPredicateRangeWalk`,
 * `compilation/javascript-target.ts`).
 *
 * The values must be the array lowering's, element for element, so every
 * edge of the `Range` contract is compared against the interpreter: an
 * empty, reversed, negative-step, zero-step and float-step range, the
 * one-operand form, literal bounds, and a real stop that is not on the grid.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const ce = new ComputeEngine();
ce.declare('n', 'integer');
ce.declare('m', 'integer');
ce.declare('r', 'real');

/** `k ↦ k mod 3 = 0` */
const DIV3 = ['Function', ['Equal', ['Mod', 'k', 3], 0], 'k'];

type Vars = Record<string, number>;

function compileJs(expr: any): { code: string; run: (vars?: Vars) => any } {
  const r = compile(ce.box(expr), {
    to: 'javascript',
    fallback: false,
  } as any) as any;
  return { code: r.code as string, run: (vars: Vars = {}) => r.run(vars) };
}

/** The interpreter's answer with `vars` substituted, as a JS value. */
function interpret(expr: any, vars: Vars = {}): number | boolean | number[] {
  const sub = Object.fromEntries(
    Object.entries(vars).map(([k, v]) => [k, ce.number(v)])
  );
  let v = ce.box(expr).subs(sub).evaluate();
  if (v.symbol === 'True') return true;
  if (v.symbol === 'False') return false;
  // A filtered range stays a LAZY collection in the interpreter; read it out.
  if (v.isCollection) v = ce.function('ListFrom', [v]).evaluate();
  const json = v.json as unknown;
  if (Array.isArray(json) && json[0] === 'List')
    return json.slice(1).map((x) => x as number);
  const n = v.re;
  if (typeof n !== 'number') throw new Error(`not a number: ${v.toString()}`);
  return n;
}

describe('Issue #373: predicate consumers over a finite Range compile to a counted loop', () => {
  describe('code shape', () => {

    it('a bare Filter pushes the selected elements into one list', () => {
      const { code, run } = compileJs(['Filter', ['Range', 1, 'n'], DIV3]);
      expect(code).toContain('.push(');
      expect(run({ n: 10 })).toEqual([3, 6, 9]);
    });
  });

  describe('the loop declines where the array lowering must run', () => {
    it('an infinite range still fails closed', () => {
      expect(() =>
        compileJs(['Count', ['Filter', ['Range', 1, 'PositiveInfinity'], DIV3]])
      ).toThrow(/a Range of an operand that is a constant infinity or NaN/);
    });
  });

  describe('values agree with the interpreter on every edge of the Range contract', () => {
    const cases: [string, any, Vars][] = [
      [
        'Sum over a descending range',
        ['Sum', ['Filter', ['Range', 'n', 1], DIV3]],
        { n: 9 },
      ],
      [
        'Product over a filtered range',
        ['Product', ['Filter', ['Range', 1, 'n'], DIV3]],
        { n: 9 },
      ],
      [
        'Length(Filter)',
        ['Length', ['Filter', ['Range', 1, 'n'], DIV3]],
        { n: 10 },
      ],
      [
        'Filter over a descending range keeps its order',
        ['Filter', ['Range', 'n', 1], DIV3],
        { n: 9 },
      ],
    ];
    for (const [name, expr, vars] of cases) {
      it(name, () => {
        expect(compileJs(expr).run(vars)).toEqual(interpret(expr, vars));
      });
    }

    it('a float-step Sum folds in the range order', () => {
      // 0 + 0.1 + 0.2 + 0.30000000000000004 in this order; the array
      // lowering folded left to right too.
      const expr = [
        'Sum',
        [
          'Filter',
          ['Range', 0, 'r', 0.1],
          ['Function', ['Less', 'k', 0.35], 'k'],
        ],
      ];
      expect(compileJs(expr).run({ r: 0.3 })).toBe(
        0 + 0.1 + 0.2 + 0.30000000000000004
      );
    });
  });

});

// The predicate of `Count(xs, p)` must return a boolean, as in the
// interpreter, on the array lowering and on the range walk. Before, every
// truthy value was counted: `Count(xs, x ↦ 1)` over `[1, 2]` answered 2,
// where the interpreter throws.
describe('Count with a predicate that does not return a boolean', () => {
  const sources: [string, unknown, Record<string, unknown>][] = [
    ['a list', 'xs', { xs: [1, 2] }],
    ['a range', ['Range', 1, 'n'], { n: 2 }],
  ];
  function engine(): ComputeEngine {
    const e = new ComputeEngine();
    e.declare('xs', 'list<integer>');
    e.declare('n', 'integer');
    return e;
  }

  it.each(sources)('over %s, a predicate typed to return a number is refused', (_label, src) => {
    const e = engine();
    const expr = e.box(['Count', src, ['Function', 1, 'x']] as any);
    expect(() =>
      compile(expr, { to: 'javascript', fallback: false } as any)
    ).toThrow(/a predicate that is not a boolean/);
    e.assign('xs', e.box(['List', 1, 2]));
    e.assign('n', 2);
    expect(() => expr.evaluate()).toThrow(/predicate/);
  });

});
