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
    ).toThrow(/which is not a boolean/);
    e.assign('xs', e.box(['List', 1, 2]));
    e.assign('n', 2);
    expect(() => expr.evaluate()).toThrow(/predicate/);
  });

  it.each(sources)('over %s, a predicate whose result type is not known is checked at each call', (_label, src, vars) => {
    const e = engine();
    const r = compile(e.box(['Count', src, ['Function', 'x', 'x']] as any), {
      to: 'javascript',
      fallback: false,
    } as any) as any;
    expect(r.code).toContain('_SYS.predicateResult(');
    expect(() => r.run(vars)).toThrow(/must return "True" or "False"/);
  });

  it.each(sources)('over %s, a boolean predicate is not checked', (_label, src, vars) => {
    const e = engine();
    const r = compile(
      e.box(['Count', src, ['Function', ['Greater', 'x', 1], 'x']] as any),
      { to: 'javascript', fallback: false } as any
    ) as any;
    expect(r.code).not.toContain('_SYS.predicateResult(');
    expect(r.run(vars)).toBe(1);
  });

  it('a predicate checked at each call skips an absent value', () => {
    const e = engine();
    e.declare('u', '(integer) -> unknown');
    const r = compile(e.box(['Count', 'xs', 'u'] as any), {
      to: 'javascript',
      fallback: false,
    } as any) as any;
    const u = (x: number) => (x === 1 ? true : x === 2 ? undefined : false);
    expect(r.run({ xs: [1, 2, 3], u })).toBe(1);
  });
});

// Every operator that takes a predicate tests its result as the interpreter
// does, on the array lowering and on the range walk. The compiled lowerings
// read the result with the truthiness of JavaScript, so `1` selected an
// element: `Filter(xs, x ↦ If(x > 1, True, 1))` over `[1, 2]` answered
// `[1, 2]`, where the interpreter throws. A predicate whose result type does
// not prove a boolean is now checked at each call (`_SYS.predicateResult`):
// - `Filter`, `Count`, `CountIf`, `Find`, `IndexWhere`, `Position`,
//   `Partition` throw for a value that is not a boolean, as the interpreter
//   does;
// - `Any` and `All` throw too: the interpreter leaves the quantifier
//   unevaluated, which compiled code cannot give;
// - `TakeWhile` and `DropWhile` end the prefix, as the interpreter does.
describe('Predicate operators with a result that is not provably a boolean', () => {
  // `x ↦ If(x > 1, True, 1)` and `x ↦ If(x > 1, False, 1)`: typed
  // `boolean | integer`, and `1` at `x = 1`.
  const T1 = ['Function', ['If', ['Greater', 'x', 1], 'True', 1], 'x'];
  const F1 = ['Function', ['If', ['Greater', 'x', 1], 'False', 1], 'x'];
  const BOOL = ['Function', ['Greater', 'x', 1], 'x'];
  function engine(): ComputeEngine {
    const e = new ComputeEngine();
    e.declare('xs', 'list<integer>');
    e.declare('n', 'integer');
    return e;
  }
  const RANGE = ['Range', 1, 'n'];
  const VARS = { xs: [1, 2], n: 2 };
  function compiled(e: ComputeEngine, json: unknown) {
    return compile(e.box(json as any), {
      to: 'javascript',
      fallback: false,
    } as any) as any;
  }
  /** The interpreter's value with `xs = [1, 2]`, `n = 2`, materialized. */
  function interpreted(e: ComputeEngine, json: unknown) {
    e.assign('xs', e.box(['List', 1, 2]));
    e.assign('n', 2);
    const v = e.box(json as any).evaluate();
    return v.isCollection && v.operator !== 'List'
      ? e.function('ListFrom', [v]).evaluate()
      : v;
  }

  const THROWING: [string, unknown][] = [
    ['Filter', ['Filter', 'xs', T1]],
    ['Filter over a range', ['Filter', RANGE, T1]],
    ['Count(Filter) over a range', ['Count', ['Filter', RANGE, T1]]],
    ['CountIf', ['CountIf', 'xs', T1]],
    ['CountIf over a range', ['CountIf', RANGE, T1]],
    ['Count', ['Count', 'xs', T1]],
    ['Count over a range', ['Count', RANGE, T1]],
    ['Find', ['Find', 'xs', T1]],
    ['IndexWhere', ['IndexWhere', 'xs', T1]],
    ['Position', ['Position', 'xs', T1]],
    ['Partition', ['Partition', 'xs', T1]],
  ];
  it.each(THROWING)('%s throws, as the interpreter does', (_label, json) => {
    const e = engine();
    const r = compiled(e, json);
    expect(r.code).toContain('_SYS.predicateResult(');
    expect(() => r.run(VARS)).toThrow(/predicate must return "True" or "False"/);
    expect(() => interpreted(e, json)).toThrow(
      /predicate must return "True" or "False"/
    );
  });

  const QUANTIFIERS: [string, unknown][] = [
    ['Any', ['Any', 'xs', F1]],
    ['Any over a range', ['Any', RANGE, F1]],
    ['All', ['All', 'xs', T1]],
    ['All over a range', ['All', RANGE, T1]],
  ];
  it.each(QUANTIFIERS)('%s throws where the interpreter stays unevaluated', (_label, json) => {
    const e = engine();
    const r = compiled(e, json);
    expect(r.code).toContain('_SYS.predicateResult(');
    expect(() => r.run(VARS)).toThrow(/predicate must return "True" or "False"/);
    expect(interpreted(e, json).operator).toBe((json as any[])[0]);
  });

  it.each([
    ['TakeWhile', ['TakeWhile', 'xs', T1], []],
    ['DropWhile', ['DropWhile', 'xs', T1], [1, 2]],
  ])('%s ends the prefix at a value that is not True, as the interpreter does', (_label, json, expected) => {
    const e = engine();
    const r = compiled(e, json);
    expect(r.code).toContain('_SYS.predicateResult(');
    expect(r.run(VARS)).toEqual(expected);
    expect(interpreted(e, json).json).toEqual(['List', ...expected]);
  });

  it.each([
    ['Filter', [2]],
    ['CountIf', 1],
    ['Count', 1],
    ['Find', 2],
    ['IndexWhere', 2],
    ['Position', [2]],
    ['Partition', [[2], [1]]],
    ['Any', true],
    ['All', false],
    ['TakeWhile', []],
    ['DropWhile', [1, 2]],
  ])('%s with a boolean predicate is not checked', (op, expected) => {
    const e = engine();
    const r = compiled(e, [op, 'xs', BOOL]);
    expect(r.code).not.toContain('_SYS.predicateResult(');
    expect(r.run(VARS)).toEqual(expected);
  });
});
