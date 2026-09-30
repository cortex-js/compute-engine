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

const LOOP = /for \(let _tv\d+ = 0; _tv\d+ < _tv\d+; _tv\d+\+\+\)/;

describe('Issue #373: predicate consumers over a finite Range compile to a counted loop', () => {
  describe('code shape', () => {
    const shapes: Record<string, any> = {
      'Count(Filter(range, p))': [
        'Count',
        ['Filter', ['Range', 1, 'n', 1], DIV3],
      ],
      'Count(range, p)': ['Count', ['Range', 1, 'n', 1], DIV3],
      'CountIf(range, p)': ['CountIf', ['Range', 1, 'n', 1], DIV3],
      'Length(Filter(range, p))': [
        'Length',
        ['Filter', ['Range', 1, 'n', 1], DIV3],
      ],
      'Sum(Filter(range, p))': ['Sum', ['Filter', ['Range', 1, 'n', 1], DIV3]],
      'Product(Filter(range, p))': [
        'Product',
        ['Filter', ['Range', 1, 'n', 1], DIV3],
      ],
      'Any(range, p)': ['Any', ['Range', 1, 'n', 1], DIV3],
      'All(range, p)': ['All', ['Range', 1, 'n', 1], DIV3],
      'Filter(range, p)': ['Filter', ['Range', 1, 'n', 1], DIV3],
    };
    for (const [name, expr] of Object.entries(shapes)) {
      it(`${name} walks the range without materializing it`, () => {
        const { code } = compileJs(expr);
        expect(code).not.toContain('Array.from');
        expect(code).not.toContain('.filter(');
        expect(code).toContain('_SYS.rangeCount(');
        expect(code).toMatch(LOOP);
      });
    }

    it("the count is the interpreter's at n = 10⁶", () => {
      const { run } = compileJs([
        'Count',
        ['Filter', ['Range', 1, 'n', 1], DIV3],
      ]);
      expect(run({ n: 1_000_000 })).toBe(333333);
    });

    it('Any stops at the first selected element; All at the first rejected one', () => {
      expect(compileJs(['Any', ['Range', 1, 'n'], DIV3]).code).toMatch(
        /if \(_tv\d+\(_tv\d+\)\) return true;/
      );
      expect(compileJs(['All', ['Range', 1, 'n'], DIV3]).code).toMatch(
        /if \(!\(_tv\d+\(_tv\d+\)\)\) return false;/
      );
    });

    it('a bare Filter pushes the selected elements into one list', () => {
      const { code, run } = compileJs(['Filter', ['Range', 1, 'n'], DIV3]);
      expect(code).toContain('.push(');
      expect(run({ n: 10 })).toEqual([3, 6, 9]);
    });
  });

  describe('values agree with the interpreter on every edge of the Range contract', () => {
    const cases: [string, any, Vars][] = [
      [
        'empty range (n = 0)',
        ['Count', ['Filter', ['Range', 1, 'n', 1], DIV3]],
        { n: 0 },
      ],
      [
        'reversed bounds with a positive step (n = -3)',
        ['Count', ['Filter', ['Range', 1, 'n', 1], DIV3]],
        { n: -3 },
      ],
      [
        'real stop below the first step (r = 2.5)',
        ['Count', ['Filter', ['Range', 1, 'r', 1], DIV3]],
        { r: 2.5 },
      ],
      [
        'real stop off the grid (r = 7.9)',
        ['Count', ['Filter', ['Range', 1, 'r'], DIV3]],
        { r: 7.9 },
      ],
      [
        'two-operand range auto-descends (9..1)',
        ['Count', ['Filter', ['Range', 'n', 1], DIV3]],
        { n: 9 },
      ],
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
        'explicit negative step (9..1..-2)',
        ['Count', ['Filter', ['Range', 'n', 1, -2], DIV3]],
        { n: 9 },
      ],
      [
        'run-time zero step is empty',
        ['Count', ['Filter', ['Range', 1, 'n', 'm'], DIV3]],
        { n: 9, m: 0 },
      ],
      [
        'float step counts the end point (0..0.3..0.1)',
        [
          'Count',
          [
            'Filter',
            ['Range', 0, 'r', 0.1],
            ['Function', ['Less', 'k', 0.25], 'k'],
          ],
        ],
        { r: 0.3 },
      ],
      [
        'one-operand range Range(n)',
        ['Count', ['Filter', ['Range', 'n'], DIV3]],
        { n: 10 },
      ],
      ['literal bounds', ['Count', ['Filter', ['Range', 1, 10], DIV3]], {}],
      ['CountIf', ['CountIf', ['Range', 1, 'n'], DIV3], { n: 10 }],
      ['Count(range, p)', ['Count', ['Range', 1, 'n'], DIV3], { n: 10 }],
      [
        'Length(Filter)',
        ['Length', ['Filter', ['Range', 1, 'n'], DIV3]],
        { n: 10 },
      ],
      ['Any, none selected', ['Any', ['Range', 1, 'n'], DIV3], { n: 2 }],
      ['Any, one selected', ['Any', ['Range', 1, 'n'], DIV3], { n: 3 }],
      [
        'All, every element selected',
        ['All', ['Range', 3, 'n', 3], DIV3],
        { n: 9 },
      ],
      ['All, one rejected', ['All', ['Range', 1, 'n'], DIV3], { n: 3 }],
      [
        'All over an empty range is true',
        ['All', ['Range', 1, 'n'], DIV3],
        { n: 0 },
      ],
      [
        'Any over an empty range is false',
        ['Any', ['Range', 1, 'n'], DIV3],
        { n: 0 },
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

  describe('the loop inside a larger expression', () => {
    it('as the body of a mapped function literal', () => {
      const expr = [
        'Map',
        [
          'Function',
          ['Add', ['Count', ['Filter', ['Range', 1, 'm'], DIV3]], 1],
          'm',
        ],
        ['List', 3, 6, 10],
      ];
      expect(compileJs(expr).run()).toEqual([2, 3, 4]);
    });

    it('as an operand of arithmetic', () => {
      const expr = [
        'Multiply',
        2,
        ['Count', ['Filter', ['Range', 1, 'n'], DIV3]],
      ];
      expect(compileJs(expr).run({ n: 10 })).toBe(6);
    });

    it('two walks in one expression keep their own temporaries', () => {
      const expr = [
        'Add',
        ['Count', ['Filter', ['Range', 1, 'n'], DIV3]],
        [
          'Count',
          [
            'Filter',
            ['Range', 1, 'm'],
            ['Function', ['Equal', ['Mod', 'k', 2], 0], 'k'],
          ],
        ],
      ];
      expect(compileJs(expr).run({ n: 10, m: 10 })).toBe(3 + 5);
    });
  });

  describe('run-time bounds the array lowering refused', () => {
    it('an infinite run-time bound throws, as `Array.from` threw, instead of looping', () => {
      const { code, run } = compileJs([
        'Count',
        ['Filter', ['Range', 1, 'n'], DIV3],
      ]);
      expect(code).toContain('4294967295');
      expect(() => run({ n: Infinity })).toThrow(RangeError);
      expect(() => run({ n: -Infinity })).toThrow(RangeError);
    });

    it('a NaN run-time bound walks nothing, as `Array.from` built nothing', () => {
      const { run } = compileJs(['Count', ['Filter', ['Range', 1, 'n'], DIV3]]);
      expect(run({ n: NaN })).toBe(0);
    });

    it('a bound on the complex lane is read through its real part', () => {
      ce.declare('z', 'complex');
      const { code, run } = compileJs([
        'Count',
        ['Filter', ['Range', 1, 'z'], DIV3],
      ]);
      expect(code).toContain('_SYS.realPart(');
      expect(run({ z: 9 } as any)).toBe(3);
    });
  });

  describe('the loop as the value of a statement', () => {
    it('assigned to a declared local inside a block', () => {
      const expr = [
        'Block',
        ['Declare', 'c', 'boolean'],
        ['Assign', 'c', ['Any', ['Range', 1, 'n'], DIV3]],
        ['If', 'c', 1, 0],
      ];
      const { run } = compileJs(expr);
      expect(run({ n: 3 })).toBe(1);
      expect(run({ n: 2 })).toBe(0);
    });

    it('a range read by several consumers gives each its own value', () => {
      const expr = [
        'Add',
        ['Count', ['Filter', ['Range', 1, 'n'], DIV3]],
        ['Sum', ['Filter', ['Range', 1, 'n'], DIV3]],
        ['Length', ['Range', 1, 'n']],
      ];
      expect(compileJs(expr).run({ n: 10 })).toBe(3 + 18 + 10);
    });
  });

  describe('the loop declines where the array lowering must run', () => {
    it('an infinite range still fails closed', () => {
      expect(() =>
        compileJs(['Count', ['Filter', ['Range', 1, 'PositiveInfinity'], DIV3]])
      ).toThrow(/infinite/);
    });

    it("a range the caller re-mapped keeps the caller's lowering", () => {
      const r = compile(
        ce.box(['Count', ['Filter', ['Range', 1, 'n'], DIV3]]),
        {
          to: 'javascript',
          fallback: false,
          functions: { Range: 'myRange' },
        } as any
      ) as any;
      expect(r.code).toContain('myRange(');
      expect(r.code).toContain('.filter(');
      expect(r.code).not.toMatch(LOOP);
    });

    it('a list source keeps the array lowering', () => {
      ce.declare('L', 'list<integer>');
      const { code, run } = compileJs(['Count', ['Filter', 'L', DIV3]]);
      expect(code).toContain('.filter(');
      expect(code).not.toMatch(LOOP);
      expect(run({ L: [1, 2, 3, 4, 5, 6] } as any)).toBe(2);
    });
  });
});
