/**
 * Issue #387: a compiled `Range` is built in a counted loop, and a `Map`,
 * `Fold`/`Reduce` or `Sum(Map(…))` over a finite `Range` walks the range
 * without building it, on the JavaScript target.
 *
 * The `Range` handler emitted `Array.from({length: n}, (_e, i) => a + i * s)`,
 * which is about 18 times slower on V8 than a preallocated array filled by a
 * loop (720 ns against about 20 ns for 17 elements). It now calls the
 * run-time helper `_SYS.range` (`materializeRange`,
 * `compilation/javascript-target.ts`). A `Map`, a `Reduce` (`Fold` is its
 * canonical form) and the `Sum`/`Product` of a `Map` over a finite range use
 * the counted walk of issue #373 (`emitPredicateRangeWalk`), so they build
 * no range array at all.
 *
 * The values must be the array lowering's, element for element, so each
 * case is compared against the interpreter: an empty, reversed,
 * negative-step and float-step range, a range with a NaN bound, and a
 * non-commutative combiner, which shows the fold order.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const ce = new ComputeEngine();
ce.declare('n', 'integer');
ce.declare('m', 'integer');
ce.declare('r', 'real');

type Vars = Record<string, number>;

function compileJs(expr: any): { code: string; run: (vars?: Vars) => any } {
  const r = compile(ce.box(expr), {
    to: 'javascript',
    fallback: false,
  } as any) as any;
  return { code: r.code as string, run: (vars: Vars = {}) => r.run(vars) };
}

/** The interpreter's answer with `vars` substituted, as a JS value. */
function interpret(expr: any, vars: Vars = {}): number | number[] {
  const sub = Object.fromEntries(
    Object.entries(vars).map(([k, v]) => [k, ce.number(v)])
  );
  let v = ce.box(expr).subs(sub).evaluate();
  if (v.isCollection) v = ce.function('ListFrom', [v]).evaluate();
  const json = v.json as unknown;
  if (Array.isArray(json) && json[0] === 'List')
    return json.slice(1).map((x) => x as number);
  const x = v.re;
  if (typeof x !== 'number') throw new Error(`not a number: ${v.toString()}`);
  return x;
}

const LOOP = /for \(let _tv\d+ = 0; _tv\d+ < _tv\d+; _tv\d+\+\+\)/;

/** `k ↦ k²` */
const SQUARE = ['Function', ['Square', 'k'], 'k'];
/** `(acc, k) ↦ acc + k` */
const ADD = ['Function', ['Add', 'acc', 'k'], 'acc', 'k'];
/** `(acc, k) ↦ 10·acc + k`: the result depends on the order of the elements. */
const DIGITS = ['Function', ['Add', ['Multiply', 10, 'acc'], 'k'], 'acc', 'k'];

describe('Issue #387: a compiled Range is built in a loop', () => {
  test('the Range handler calls `_SYS.range`, not `Array.from`', () => {
    for (const expr of [
      ['Range', 1, 'n'],
      ['Range', 'n', 1],
      ['Range', 0, 'n', 2],
      ['Range', 1, 100],
    ]) {
      const { code } = compileJs(expr);
      expect(code).toContain('_SYS.range(');
      expect(code).not.toContain('Array.from');
    }
  });

  test.each([
    ['ascending', ['Range', 1, 'n'], { n: 6 }],
    ['descending (two operands)', ['Range', 'n', 1], { n: 6 }],
    ['descending stop below start', ['Range', 1, 'n'], { n: -3 }],
    ['one element', ['Range', 1, 'n'], { n: 1 }],
    ['negative step', ['Range', 'n', 0, -2], { n: 9 }],
    ['step pointing away', ['Range', 1, 'n', -1], { n: 5 }],
    ['float step', ['Range', 0, 'r', 0.1], { r: 0.3 }],
    ['real stop off the grid', ['Range', 1, 'r', 2], { r: 7.5 }],
    ['literal bounds over the inline cap', ['Range', 1, 60], {}],
    ['literal descending bounds', ['Range', 60, 1], {}],
  ] as const)(
    '%s: the compiled list is the interpreted one',
    (_l, expr, vars) => {
      const compiled = compileJs(expr).run(vars as Vars);
      expect(compiled).toEqual(interpret(expr, vars as Vars));
    }
  );

  test('a NaN bound at run time gives an empty list', () => {
    expect(compileJs(['Range', 1, 'n']).run({ n: NaN })).toEqual([]);
    expect(compileJs(['Range', 1, 'n', 1]).run({ n: NaN })).toEqual([]);
  });

  test('an infinite step at run time gives the start, as the interpreter does', () => {
    // `0 × ∞` is NaN, so element 0 must be the start itself, not
    // `start + 0 × step`.
    const range = ['Range', 0, 1, 'r'];
    expect(compileJs(range).run({ r: Infinity })).toEqual([0]);
    expect(interpret(range, { r: Infinity })).toEqual([0]);
    const mapped = [
      'Map',
      ['Function', ['Add', 'k', 1], 'k'],
      ['Range', 0, 1, 'r'],
    ];
    expect(compileJs(mapped).run({ r: Infinity })).toEqual([1]);
    expect(interpret(mapped, { r: Infinity })).toEqual([1]);
  });

  test('an infinite bound at run time throws the array-length RangeError', () => {
    // `Array.from({length: Infinity})` threw this error before.
    expect(() => compileJs(['Range', 1, 'n', 1]).run({ n: Infinity })).toThrow(
      RangeError
    );
  });
});

describe('Issue #387: Map, Fold/Reduce and Sum(Map) over a finite Range walk it', () => {
  const shapes: Record<string, any> = {
    'Fold(f, seed, range)': ['Fold', ADD, 0, ['Range', 1, 'n', 1]],
    'Reduce(range, f, seed)': ['Reduce', ['Range', 1, 'n'], ADD, 0],
    'Reduce(range, Min)': ['Reduce', ['Range', 1, 'n'], 'Min'],
    'Reduce(range, Max)': ['Reduce', ['Range', 1, 'n'], 'Max'],
    'Map(f, range)': ['Map', SQUARE, ['Range', 1, 'n']],
    'Sum(Map(f, range))': ['Sum', ['Map', SQUARE, ['Range', 1, 'n']]],
    'Product(Map(f, range))': ['Product', ['Map', SQUARE, ['Range', 1, 'n']]],
  };

  test.each(Object.entries(shapes))(
    '%s compiles to a counted loop with no range array',
    (_label, expr) => {
      const { code } = compileJs(expr);
      expect(code).toMatch(LOOP);
      expect(code).not.toContain('_SYS.range(');
      expect(code).not.toContain('Array.from');
      expect(code).not.toContain('.reduce(');
      expect(code).not.toContain('.map(');
    }
  );

  test.each(Object.entries(shapes))(
    '%s agrees with the interpreter',
    (_label, expr) => {
      for (const n of [5, 1, 0, -2]) {
        const compiled = compileJs(expr).run({ n });
        const expected = interpret(expr, { n });
        expect(compiled).toEqual(expected);
      }
    }
  );

  test.each([
    ['ascending', ['Range', 1, 'n'], 5],
    ['descending', ['Range', 'n', 1], 5],
    ['explicit negative step', ['Range', 'n', 1, -2], 7],
  ] as const)(
    'a non-commutative fold keeps the range order (%s)',
    (_label, range, n) => {
      const expr = ['Fold', DIGITS, 0, range];
      expect(compileJs(expr).run({ n })).toBe(interpret(expr, { n }));
    }
  );

  test('a seedless fold over an empty range is NaN, and the sole element of a one-element range', () => {
    // A custom combiner compiles only with a seed, so the seedless fold is
    // one of the built-in combiners.
    const expr = ['Reduce', ['Range', 1, 'n', 1], 'Max'];
    expect(compileJs(expr).run({ n: 0 })).toBeNaN();
    expect(compileJs(expr).run({ n: 1 })).toBe(1);
    expect(compileJs(expr).run({ n: 4 })).toBe(4);
  });

  test('a fold seed is answered for an empty range', () => {
    const expr = ['Fold', DIGITS, 7, ['Range', 1, 'n', 1]];
    expect(compileJs(expr).run({ n: 0 })).toBe(7);
  });

  test('a Map over a float-step range agrees with the interpreter', () => {
    const expr = ['Map', SQUARE, ['Range', 0, 'r', 0.1]];
    const compiled = compileJs(expr).run({ r: 0.3 }) as number[];
    // The interpreter keeps the squares as decimal numbers, so compare the
    // values numerically.
    const expected = (interpret(expr, { r: 0.3 }) as unknown[]).map((x) =>
      Number(typeof x === 'object' && x !== null ? (x as any).num : x)
    );
    expect(compiled).toHaveLength(4);
    expect(expected).toHaveLength(4);
    compiled.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 12));
  });

  test('a fold that mentions an outer variable named like a loop index reads the variable', () => {
    // Every name the loop declares is a fresh temporary, so a user variable
    // named `i` is not captured (the issue #367 lesson).
    ce.declare('i', 'integer');
    const expr = [
      'Fold',
      ['Function', ['Add', 'acc', ['Multiply', 'i', 'k']], 'acc', 'k'],
      0,
      ['Range', 1, 'n', 1],
    ];
    const compiled = compileJs(expr).run({ n: 4, i: 3 });
    expect(compiled).toBe(interpret(expr, { n: 4, i: 3 }));
    expect(compiled).toBe(30);
  });
});
