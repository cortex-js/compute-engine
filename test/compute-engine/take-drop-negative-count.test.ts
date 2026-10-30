import * as fs from 'fs';
import { execFileSync } from 'child_process';
import { ComputeEngine } from '../../src/compute-engine';
import { TEST_PYTHON } from './test-python';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { isFunction } from '../../src/compute-engine/boxed-expression/type-guards';

/**
 * A negative `Take`/`Drop` count counts from the end (GitHub issue #414):
 * `Take(xs, -n)` is the last `n` elements of `xs`, and `Drop(xs, -n)` is `xs`
 * without its last `n` elements. A count past the length is clamped in both
 * directions. A negative count needs the length of the source, so when that
 * length is not known or not finite the expression stays unevaluated: every
 * collection facet answers its indeterminate value, and none answers the
 * empty collection.
 */

const ce = new ComputeEngine();

const L5 = ['List', 1, 2, 3, 4, 5];

const show = (json: unknown): string =>
  ce
    .box(json as any)
    .evaluate()
    .toString();

describe('Take and Drop with a negative count: the list arm', () => {
  test.each([
    [-2, '[4,5]', '[1,2,3]'],
    [-5, '[1,2,3,4,5]', '[]'],
    [-10, '[1,2,3,4,5]', '[]'],
    [0, '[]', '[1,2,3,4,5]'],
    [2, '[1,2]', '[3,4,5]'],
    [10, '[1,2,3,4,5]', '[]'],
    // A count that is not an integer is rounded with `Math.round`, as before.
    [-2.5, '[4,5]', '[1,2,3]'],
    [2.5, '[1,2,3]', '[4,5]'],
  ])('n = %p', (n, take, drop) => {
    expect(show(['Take', L5, n])).toBe(take);
    expect(show(['Drop', L5, n])).toBe(drop);
  });

  test('a Range source', () => {
    expect(show(['Take', ['Range', 1, 10], -3])).toBe('[8,9,10]');
    expect(show(['Drop', ['Range', 1, 10], -3])).toBe('[1,2,3,4,5,6,7]');
  });

  test('an empty source', () => {
    expect(show(['Take', ['List'], -2])).toBe('[]');
    expect(show(['Drop', ['List'], -2])).toBe('[]');
  });

  test('a lazy source whose count is known', () => {
    expect(show(['Take', ['Reverse', ['List', 1, 2, 3, 4]], -2])).toBe('[2,1]');
    expect(show(['Drop', ['Take', ['List', 1, 2, 3, 4, 5, 6], -4], -1])).toBe(
      '[3,4,5]'
    );
  });
});

describe('Take and Drop with a negative count: the string arm', () => {
  test.each([
    [-2, '"lo"', '"hel"'],
    [-5, '"hello"', '""'],
    [-10, '"hello"', '""'],
    [0, '""', '"hello"'],
    [10, '"hello"', '""'],
  ])('n = %p', (n, take, drop) => {
    expect(show(['Take', "'hello'", n])).toBe(take);
    expect(show(['Drop', "'hello'", n])).toBe(drop);
  });
});

describe('every facet agrees with the walk', () => {
  test.each([-10, -5, -2, -1, 0, 2, 10])('n = %p', (n) => {
    for (const op of ['Take', 'Drop']) {
      const lazy = ce.box([op, L5, n]);
      const walked = [...lazy.each()].map((x) => x.toString());
      const materialized = lazy.evaluate();
      expect(lazy.count).toBe(walked.length);
      expect(materialized.count).toBe(walked.length);
      expect(lazy.isEmptyCollection).toBe(walked.length === 0);
      expect(lazy.isFiniteCollection).toBe(true);
      expect(lazy.isEnumerableCollection).toBe(true);
      expect(show(['Length', [op, L5, n]])).toBe(`${walked.length}`);
      // `at` with positive and negative indexes, inside and outside the
      // selection.
      for (let i = 1; i <= walked.length; i++) {
        expect(lazy.at(i)?.toString()).toBe(walked[i - 1]);
        expect(lazy.at(-i)?.toString()).toBe(walked[walked.length - i]);
      }
      expect(lazy.at(walked.length + 1)).toBeUndefined();
      expect(lazy.at(-walked.length - 1)).toBeUndefined();
    }
  });

  test('At on the lazy result', () => {
    expect(show(['At', ['Take', L5, -3], 1])).toBe('3');
    expect(show(['At', ['Take', L5, -3], 2])).toBe('4');
    expect(show(['At', ['Take', L5, -3], -1])).toBe('5');
    expect(show(['At', ['Take', L5, -3], -3])).toBe('3');
    expect(show(['At', ['Take', L5, -3], 4])).toBe('NaN');
    expect(show(['At', ['Drop', L5, -3], 1])).toBe('1');
    expect(show(['At', ['Drop', L5, -3], -1])).toBe('2');
    expect(show(['At', ['Drop', L5, -3], 3])).toBe('NaN');
  });
});

describe('a negative count over a source of unknown or infinite length', () => {
  const ce2 = new ComputeEngine();
  const unknownLength: [string, unknown][] = [
    ['an infinite Range', ['Range', 1, 'PositiveInfinity']],
    ['a symbol with no value', 'xs'],
    [
      'a lazy source with an unknown count',
      ['Filter', ['Range', 1, 'PositiveInfinity'], 'IsPrime'],
    ],
  ];

  test.each(unknownLength)('%s stays unevaluated', (_label, source) => {
    for (const op of ['Take', 'Drop']) {
      const e = ce2.box([op, source, -2] as any);
      expect(e.count).toBeUndefined();
      expect(e.isEmptyCollection).toBeUndefined();
      expect(e.isFiniteCollection).toBeUndefined();
      expect(e.isEnumerableCollection).toBe(false);
      expect(e.at(1)).toBeUndefined();
      expect(e.at(-1)).toBeUndefined();
      expect(e.evaluate().operator).toBe(op);
    }
  });

  test('a consumer does not read the empty walk as an empty collection', () => {
    const p = ['Function', ['Greater', 'x', 0], 'x'];
    const inf = ['Range', 1, 'PositiveInfinity'];
    expect(ce2.box(['Any', ['Take', inf, -2], p]).evaluate().operator).toBe(
      'Any'
    );
    expect(ce2.box(['All', ['Drop', inf, -2], p]).evaluate().operator).toBe(
      'All'
    );
    expect(ce2.box(['Length', ['Take', inf, -2]]).evaluate().operator).toBe(
      'Length'
    );
  });

  test('a symbolic count is not enumerable either', () => {
    // The walk over a symbolic count yields nothing; answering the source's
    // enumerability let `Any` answer `False` and `All` answer `True`.
    const p = ['Function', ['Greater', 'x', 0], 'x'];
    const src = ['List', 1, 2, 3];
    expect(ce2.box(['Take', src, 'n']).isEnumerableCollection).toBe(false);
    expect(ce2.box(['Drop', src, 'n']).isEnumerableCollection).toBe(false);
    expect(ce2.box(['Any', ['Take', src, 'n'], p]).evaluate().operator).toBe(
      'Any'
    );
    expect(ce2.box(['All', ['Drop', src, 'n'], p]).evaluate().operator).toBe(
      'All'
    );
  });
});

describe('a symbolic count over an infinite source', () => {
  // `Drop(Range(1, ∞), n)` is empty or not, finite or not, depending on `n`:
  // every facet answers its indeterminate value together.
  const ce2 = new ComputeEngine();
  const inf = ['Range', 1, 'PositiveInfinity'];

  test.each(['Take', 'Drop'])('%s', (op) => {
    const e = ce2.box([op, inf, 'n'] as any);
    expect(e.count).toBeUndefined();
    expect(e.isEmptyCollection).toBeUndefined();
    expect(e.isFiniteCollection).toBeUndefined();
    expect(e.isEnumerableCollection).toBe(false);
    expect(ce2.box(['Length', [op, inf, 'n']]).evaluate().operator).toBe(
      'Length'
    );
  });

  test('a known count keeps the infinite count', () => {
    const e = ce2.box(['Drop', inf, 2]);
    expect(e.count).toBe(Infinity);
    expect(e.isFiniteCollection).toBe(false);
    expect(e.isEnumerableCollection).toBe(true);
  });
});

describe('a count that is not a safe integer, or is infinite', () => {
  const E20 = ['Power', 10, 20];
  const L3 = ['List', 1, 2, 3];
  const cases: [string, unknown, string, string][] = [
    ['10^20', E20, '[1,2,3]', '[]'],
    ['-10^20', ['Negate', E20], '[1,2,3]', '[]'],
    ['+oo', 'PositiveInfinity', '[1,2,3]', '[]'],
    ['-oo', 'NegativeInfinity', '[1,2,3]', '[]'],
    // A float count larger than every safe integer is clamped too, as the
    // compiled Python code clamps it.
    ['1e20', 1e20, '[1,2,3]', '[]'],
    ['-1e20', -1e20, '[1,2,3]', '[]'],
  ];

  test.each(cases)('n = %s is clamped', (_label, n, take, drop) => {
    expect(show(['Take', L3, n])).toBe(take);
    expect(show(['Drop', L3, n])).toBe(drop);
    for (const [op, expected] of [
      ['Take', take],
      ['Drop', drop],
    ]) {
      const e = ce.box([op, L3, n] as any);
      const length = expected === '[]' ? 0 : 3;
      expect(e.count).toBe(length);
      expect(e.isEmptyCollection).toBe(length === 0);
      expect(e.isFiniteCollection).toBe(true);
      expect(e.isEnumerableCollection).toBe(true);
      expect([...e.each()].length).toBe(length);
    }
  });

  test('the string arm', () => {
    expect(show(['Take', "'hello'", E20])).toBe('"hello"');
    expect(show(['Drop', "'hello'", 'NegativeInfinity'])).toBe('""');
  });

  test('a source whose length is not known stays unevaluated', () => {
    const ce2 = new ComputeEngine();
    const inf = ['Range', 1, 'PositiveInfinity'];
    expect(ce2.box(['Take', inf, E20]).evaluate().operator).toBe('Take');
    expect(
      ce2.box(['Drop', 'xs', 'PositiveInfinity']).evaluate().operator
    ).toBe('Drop');
  });

  test('NaN stays unevaluated', () => {
    expect(ce.box(['Take', L3, 'NaN']).evaluate().operator).toBe('Take');
    expect(ce.box(['Drop', L3, 'NaN']).evaluate().operator).toBe('Drop');
  });

  test('compiled JavaScript gives no value for a NaN count', () => {
    // The interpreter has no value for `Take(xs, NaN)`; compiled code gives
    // `undefined`, the value of a list with no value (it gave `[]` for
    // `Take` and the whole list for `Drop`). A non-integer count rounds as
    // in the interpreter: `Take([1, 2, 3], 0.75)` is `[1]`.
    const ce3 = new ComputeEngine();
    ce3.declare('xs', 'list<number>');
    ce3.declare('c', 'real');
    ce3.declare('w', 'number');
    ce3.declare('k', 'integer');
    for (const op of ['Take', 'Drop']) {
      const r = compile(ce3.box([op, 'xs', 'w'] as any), {
        fallback: false,
      }) as any;
      expect(String(r.code)).toContain('Number.isNaN(_n) ? undefined :');
      expect(r.run({ xs: [1, 2, 3], w: NaN })).toBeUndefined();
      expect(r.run({ xs: [1, 2, 3], w: 0.75 })).toEqual(
        op === 'Take' ? [1] : [2, 3]
      );
      expect(r.run({ xs: [1, 2, 3], w: Infinity })).toEqual(
        op === 'Take' ? [1, 2, 3] : []
      );
      // A count typed `integer` is tested too: an unsupplied `k` reads as
      // `undefined`, and `Math.round(undefined)` is NaN. It gave `[]` for
      // `Take` and the whole list for `Drop`; the interpreter has no value.
      const integer = compile(ce3.box([op, 'xs', 'k'] as any), {
        fallback: false,
      }) as any;
      expect(integer.run({ xs: [1, 2, 3] })).toBeUndefined();
      expect(integer.run({ xs: [1, 2, 3], k: 1 })).toEqual(
        op === 'Take' ? [1] : [2, 3]
      );
      // A consumer of the slice tests it first: `Count` of a list with no
      // value is `NaN` (it gave 0).
      const count = compile(ce3.box(['Count', [op, 'xs', 'k']] as any), {
        fallback: false,
      }) as any;
      expect(count.run({ xs: [1, 2, 3] })).toBeNaN();
      expect(count.run({ xs: [1, 2, 3], k: 1 })).toBe(op === 'Take' ? 1 : 2);
      // A literal count is chosen at compile time, with no test.
      const literal = compile(ce3.box([op, 'xs', 2] as any), {
        fallback: false,
      }) as any;
      expect(String(literal.code)).not.toContain('isNaN');
    }
    // The interpreter has no value with `k` unassigned.
    const ce4 = new ComputeEngine();
    ce4.declare('xs', 'list<number>');
    ce4.declare('k', 'integer');
    ce4.assign('xs', ce4.box(['List', 1, 2, 3] as any));
    expect(ce4.box(['Take', 'xs', 'k']).evaluate().operator).toBe('Take');
    expect(ce4.box(['Drop', 'xs', 'k']).evaluate().operator).toBe('Drop');
    expect(ce4.box(['Count', ['Take', 'xs', 'k']]).evaluate().operator).toBe(
      'Count'
    );
    // A NaN reaches a parameter typed `integer` of a user function (a user
    // function with one clause accepts NaN at a numeric parameter): the
    // interpreter leaves the body's `Take` unevaluated, compiled code gives
    // `undefined`.
    const ce5 = new ComputeEngine();
    ce5.declare('h', '(integer) -> list');
    ce5.assign(
      'h',
      ce5.box(['Function', ['Take', ['List', 1, 2, 3], 'n'], 'n'] as any)
    );
    ce5.declare('y', 'number');
    const h = compile(ce5.box(['h', 'y'] as any), { fallback: false }) as any;
    expect(h.run({ y: NaN })).toBeUndefined();
    expect(h.run({ y: 2 })).toEqual([1, 2]);
    expect(ce5.box(['h', 'NaN']).evaluate().operator).toBe('Take');
    ce3.assign('xs', ce3.box(['List', 1, 2, 3] as any));
    ce3.assign('c', 0.75);
    expect(ce3.box(['Take', 'xs', 'c']).evaluate().toString()).toBe('[1]');
    expect(ce3.box(['Drop', 'xs', 'c']).evaluate().toString()).toBe('[2,3]');
  });

  test('compiled JavaScript agrees with the interpreter', () => {
    for (const [, n, take, drop] of cases) {
      for (const [op, expected] of [
        ['Take', take],
        ['Drop', drop],
      ]) {
        const r = compile(ce.box([op, L3, n] as any), {
          constantFold: false,
          fallback: false,
        });
        expect(JSON.stringify(r.run!())).toBe(expected.replace(/ /g, ''));
      }
    }
  });
});

describe('the parse route', () => {
  test('a list', () => {
    expect(
      ce
        .parse(String.raw`\mathrm{Take}([1,2,3,4,5], -2)`)
        .evaluate()
        .toString()
    ).toBe('[4,5]');
    expect(
      ce
        .parse(String.raw`\mathrm{Drop}([1,2,3,4,5], -2)`)
        .evaluate()
        .toString()
    ).toBe('[1,2,3]');
    expect(
      ce
        .parse(String.raw`\operatorname{Take}([1,2,3,4,5], -10)`)
        .evaluate()
        .toString()
    ).toBe('[1,2,3,4,5]');
  });

  test('a string', () => {
    expect(
      ce
        .parse(String.raw`\mathrm{Take}(\text{hello}, -2)`)
        .evaluate()
        .toString()
    ).toBe('"lo"');
    expect(
      ce
        .parse(String.raw`\mathrm{Drop}(\text{hello}, -2)`)
        .evaluate()
        .toString()
    ).toBe('"hel"');
  });

  test('an infinite source stays unevaluated', () => {
    expect(
      ce
        .parse(String.raw`\mathrm{Take}(\mathrm{Range}(1, \infty), -2)`)
        .evaluate().operator
    ).toBe('Take');
  });
});

describe('compiled JavaScript matches the interpreter', () => {
  const COUNTS = [-8, -5, -3, -1, 0, 1, 3, 5, 8, 2.5, -2.5, 0.4, -0.4];

  const interpreted = (op: string, n: number): number[] =>
    [...ce.box([op, L5, n]).evaluate().each()].map((x) => x.re);

  test.each(COUNTS)('a literal count: n = %p', (n) => {
    for (const op of ['Take', 'Drop']) {
      const r = compile(ce.box([op, L5, n]), {
        constantFold: false,
        fallback: false,
      });
      expect(r.success).toBe(true);
      expect(r.run!()).toEqual(interpreted(op, n));
    }
  });

  test.each(COUNTS)('a run-time count: n = %p', (n) => {
    for (const op of ['Take', 'Drop']) {
      const r = compile(ce.box([op, L5, 'n']), { fallback: false });
      expect(r.success).toBe(true);
      expect(r.run!({ n })).toEqual(interpreted(op, n));
    }
  });

  test('the string arm', () => {
    const ce2 = new ComputeEngine();
    ce2.declare('s', 'string');
    const take = compile(ce2.box(['Take', 's', 'n']), { fallback: false });
    const drop = compile(ce2.box(['Drop', 's', 'n']), { fallback: false });
    expect(take.run!({ s: 'hello', n: -2 })).toBe('lo');
    expect(drop.run!({ s: 'hello', n: -2 })).toBe('hel');
    expect(take.run!({ s: 'hello', n: 0 })).toBe('');
    expect(drop.run!({ s: 'hello', n: -10 })).toBe('');
  });

  test('a negative count over an infinite stream fails instead of answering', () => {
    const inf = ['Range', 1, 'PositiveInfinity'];
    // A constant count fails at compile time.
    expect(() =>
      compile(ce.box(['Take', inf, -2]), { fallback: false })
    ).toThrow(/negative count/);
    // A constant negative drop count keeps the pipeline off the lazy-stream
    // lowering, so the infinite source fails closed.
    expect(() =>
      compile(ce.box(['Take', ['Drop', inf, -2], 3]), { fallback: false })
    ).toThrow(/infinite collection/);
  });

  test('a negative run-time count over an infinite stream throws', () => {
    const inf = ['Range', 1, 'PositiveInfinity'];
    const sq = ['Map', ['Function', ['Square', 'x'], 'x'], inf];
    const take = compile(ce.box(['Take', sq, 'n']), { fallback: false });
    expect(take.run!({ n: 3 })).toEqual([1, 4, 9]);
    expect(take.run!({ n: 0 })).toEqual([]);
    expect(() => take.run!({ n: -2 })).toThrow(/negative count/);
    const drop = compile(ce.box(['Take', ['Drop', inf, 'm'], 3]), {
      fallback: false,
    });
    expect(drop.run!({ m: 2 })).toEqual([3, 4, 5]);
    expect(drop.run!({ m: 0 })).toEqual([1, 2, 3]);
    expect(() => drop.run!({ m: -2 })).toThrow(/negative count/);
  });
});

describe('compiled Python', () => {
  const ce2 = new ComputeEngine();
  ce2.declare('xs', 'list<number>');
  const py = (json: unknown) =>
    compile(ce2.box(json as any), { to: 'python', fallback: false }).code;

  test('a literal count chooses the slice at compile time', () => {
    expect(py(['Take', 'xs', 2])).toBe('xs[:2]');
    expect(py(['Take', 'xs', -2])).toBe('xs[-2:]');
    expect(py(['Take', 'xs', 0])).toBe('xs[:0]');
    expect(py(['Drop', 'xs', 2])).toBe('xs[2:]');
    expect(py(['Drop', 'xs', -2])).toBe('xs[:-2]');
    expect(py(['Drop', 'xs', 0])).toBe('xs[0:]');
  });

  test('a count past every length clamps without overflow', () => {
    // A run-time count is clipped before `int()`: `int(inf)` raises
    // `OverflowError`. A literal `±∞` count cannot be NaN, so it has no NaN
    // test.
    expect(py(['Take', 'xs', 'PositiveInfinity'])).toBe(
      '(lambda _l, _n: _l[_n:] if _n < 0 else _l[:_n])(xs, int(np.clip(np.floor((np.inf) + 0.5), -9007199254740991, 9007199254740991)))'
    );
    // A literal float count past every length is clamped at compile time,
    // as the interpreter clamps it.
    expect(py(['Take', 'xs', 1e20])).toBe('xs[:]');
    expect(py(['Drop', 'xs', 1e20])).toBe('xs[:0]');
    expect(py(['Take', 'xs', -1e20])).toBe('xs[:]');
    expect(py(['Drop', 'xs', -1e20])).toBe('xs[:0]');
    expect(py(['Drop', 'xs', ['Power', 10, 20]])).toBe(
      '(lambda _l, _n: _l[:_n] if _n < 0 else _l[_n:])(xs, int(np.clip(np.floor((100000000000000000000) + 0.5), -9007199254740991, 9007199254740991)))'
    );
  });

  test('a run-time count chooses the slice at run time', () => {
    // A count that can be NaN gives `None`, the Python value of a list with
    // no value, as the interpreter leaves `Take(xs, NaN)` unevaluated. The
    // `int()` of a NaN raised `ValueError` before.
    expect(py(['Take', 'xs', 'n'])).toBe(
      '(lambda _l, _c: None if _c != _c else (lambda _n: _l[_n:] if _n < 0 else _l[:_n])(int(np.clip(np.floor(_c + 0.5), -9007199254740991, 9007199254740991))))(xs, n)'
    );
    expect(py(['Drop', 'xs', 'n'])).toBe(
      '(lambda _l, _c: None if _c != _c else (lambda _n: _l[:_n] if _n < 0 else _l[_n:])(int(np.clip(np.floor(_c + 0.5), -9007199254740991, 9007199254740991))))(xs, n)'
    );
    // A count typed `integer` is tested too: it can be NaN through a
    // parameter of a user function, which accepts NaN.
    ce2.declare('k', 'integer');
    expect(py(['Take', 'xs', 'k'])).toBe(
      '(lambda _l, _c: None if _c != _c else (lambda _n: _l[_n:] if _n < 0 else _l[:_n])(int(np.clip(np.floor(_c + 0.5), -9007199254740991, 9007199254740991))))(xs, k)'
    );
  });

  // The NaN test is `_c != _c`, not `np.isnan(_c)`: `np.isnan` raises a
  // `TypeError` for a Python int too large for int64, such as `2 ** 100`.
  const runPython =
    TEST_PYTHON !== undefined && fs.existsSync(TEST_PYTHON) ? test : test.skip;
  runPython(
    'the generated slice runs for a NaN and a large integer count',
    () => {
      const fn = (op: string) =>
        compile(ce2.box([op, ['List', 1, 2, 3], ['Power', 2, 'w']] as any), {
          to: 'python',
          fallback: false,
        }).code;
      const source =
        'import numpy as np, json, math\n' +
        `def take(w): return ${fn('Take')}\n` +
        `def drop(w): return ${fn('Drop')}\n` +
        'print(json.dumps([take(100), drop(100), take(1), take(math.nan)]))\n';
      const out = execFileSync(TEST_PYTHON!, ['-c', source], {
        encoding: 'utf8',
      });
      expect(JSON.parse(out)).toEqual([[1, 2, 3], [], [1, 2], null]);
    }
  );
});

describe('an operand that is the absent collection at run time', () => {
  // `Take(xs, k)` with `k: integer` unsupplied has no value: the compiled
  // slice is `undefined`. An operator that reads it as an array must test
  // it first, also one that handles a `missing` operand itself (`First`,
  // `Max`) or passes it through (`Flatten`).
  const ce5 = new ComputeEngine();
  ce5.declare('xs', 'list<real>');
  ce5.declare('k', 'integer');
  const run = (json: unknown, vars: Record<string, unknown>) =>
    compile(ce5.box(json as any), { fallback: false }).run!(vars as any);
  const interpret = (json: unknown, vars: Record<string, unknown>) => {
    const subs: Record<string, any> = {};
    for (const [name, v] of Object.entries(vars))
      subs[name] = Array.isArray(v)
        ? ce5.box(['List', ...v])
        : ce5.box(v as number);
    return ce5
      .box(json as any)
      .subs(subs)
      .N().json;
  };
  const take = ['Take', 'xs', 'k'];

  test.each(['First', 'Last', 'Max', 'Min', 'Mean', 'Median', 'Length'])(
    '%s of an absent slice has no value',
    (h) => {
      const json = [h, take];
      const c = run(json, { xs: [1, 2, 3] });
      expect(c === undefined || Number.isNaN(c)).toBe(true);
      // The interpreter has no value either.
      expect(typeof interpret(json, { xs: [1, 2, 3] })).not.toBe('number');
      expect(run(json, { xs: [1, 2, 3], k: 2 })).toEqual(
        interpret(json, { xs: [1, 2, 3], k: 2 })
      );
    }
  );

  test.each([
    ['Second', [take]],
    ['GCD', [take]],
    ['Covariance', [take, ['List', 1, 2]]],
    ['Quartiles', [take]],
  ])(
    '%s of an absent slice has no value, and run() does not throw',
    (h, ops) => {
      const json = [h, ...(ops as unknown[])];
      const c = run(json, { xs: [1, 3, 5, 7] });
      expect(c === undefined || Number.isNaN(c)).toBe(true);
      expect(typeof interpret(json, { xs: [1, 3, 5, 7] })).not.toBe('number');
      const k = h === 'Covariance' ? 2 : 4;
      const present = run(json, { xs: [1, 3, 5, 7], k });
      const i = ce5
        .box(json as any)
        .subs({ xs: ce5.box(['List', 1, 3, 5, 7]), k: ce5.box(k) })
        .N();
      expect(present).toEqual(
        isFunction(i) && i.operator === 'Tuple' ? i.ops.map((x) => x.re) : i.re
      );
    }
  );

  test('Flatten of an absent slice has no value', () => {
    expect(run(['Flatten', take], { xs: [1, 2, 3] })).toBeUndefined();
    expect(run(['Length', ['Flatten', take]], { xs: [1, 2, 3] })).toBeNaN();
  });

  test('a string source keeps the absent value', () => {
    for (const op of ['Take', 'Drop']) {
      const json = [op, { str: 'abc' }, 'k'];
      expect(run(json, {})).toBeUndefined();
      expect(run(json, { k: 2 })).toBe(op === 'Take' ? 'ab' : 'c');
      expect(run(json, { k: -1 })).toBe(op === 'Take' ? 'c' : 'ab');
    }
  });

  test('a collection built from shared subtrees is checked in linear time', () => {
    let e: any = ce5.box(take as any);
    for (let i = 0; i < 20; i++)
      e = ce5._fn('Reverse', [ce5._fn('Join', [e, e])]);
    const start = Date.now();
    const r = compile(ce5._fn('Length', [e]), { fallback: false });
    // The time depends on the load of the machine, so it is checked only
    // in a `CE_PERF=1` run (`npm run test:perf`). Without the memo of
    // `mayBeAbsentCollection` the compile did not end in a normal run.
    if (process.env.CE_PERF === '1')
      expect(Date.now() - start).toBeLessThan(3000);
    expect(r.run!({ xs: [1, 2] } as any)).toBeNaN();
  });

  test('the index of a Sum is not tested as a count', () => {
    // An unrolled term reads its index as a number literal, and a loop
    // counter is a safe integer at every iteration.
    for (const upper of [3, 1000]) {
      const json = [
        'Sum',
        ['Length', ['Take', 'xs', 'i']],
        ['Limits', 'i', 1, upper],
      ];
      const r = compile(ce5.box(json as any), { fallback: false });
      expect(r.code).not.toContain('Number.isNaN');
      expect(r.run!({ xs: [1, 2, 3, 4] } as any)).toBe(
        upper === 3 ? 6 : 4 * (upper - 4) + 10
      );
    }
  });
});
