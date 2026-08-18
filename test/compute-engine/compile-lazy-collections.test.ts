/**
 * Compiling STATICALLY INFINITE collections (JS target).
 *
 * An infinite pipeline — `Range(1, ∞)` under `Map`/`Filter`/`Drop`/`Rest` —
 * has no array representation, so it compiles to a lazy `_SYS` iterator
 * stream, materialized by a bounding consumer (`Take`/`TakeWhile`). An
 * infinite pipeline that never reaches a bounding consumer fails closed at
 * COMPILE time (D6) — previously `Range(1, ∞)` emitted
 * `Array.from({length: Infinity})`, which compiled cleanly and threw a
 * RangeError the first time it ran.
 *
 * Every expected value below is the interpreter's own result (probed
 * empirically before the handlers were written).
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

let ce: ComputeEngine;
let warnSpy: jest.SpyInstance;

beforeAll(() => {
  ce = new ComputeEngine();
  // The fallback path intentionally warns; silence it for clean test output.
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterAll(() => warnSpy.mockRestore());

const SUM_TAKE_MAP = String.raw`\mathrm{Sum}(\mathrm{Take}(\mathrm{Map}(\_ \mapsto \_^2, 1..\infty), 10))`;

describe('COMPILE lazy infinite collections', () => {
  it('Sum(Take(Map(x → x², 1..∞), 10)) compiles to a lazy stream (parse route)', () => {
    // `constantFold: false`: the pipeline has no free variables, so
    // compile-time constant folding would emit the literal `385` and the
    // `_SYS` stream emission this test pins would not appear in the code.
    const r = compile(ce.parse(SUM_TAKE_MAP), { constantFold: false });
    expect(r?.success).toBe(true);
    expect(r?.code).toBe(
      '(_SYS.takeIter(_SYS.mapIter(_SYS.rangeIter(1, 1), ((_) => (_ * _))), 10)).reduce((_a, _b) => _a + _b, 0)'
    );
    expect(r?.run?.({})).toBe(385); // 1+4+9+…+100, the interpreter's result
  });

  it('box route matches the parse route', () => {
    const e = ce.box([
      'Sum',
      [
        'Take',
        [
          'Map',
          ['Function', ['Square', 'x'], 'x'],
          ['Range', 1, { num: '+Infinity' }],
        ],
        10,
      ],
    ]);
    const r = compile(e);
    expect(r?.success).toBe(true);
    expect(r?.run?.({})).toBe(385);
  });

  it('the take count may be a runtime variable', () => {
    ce.pushScope();
    ce.declare('n', 'integer');
    const r = compile(
      ce.parse(
        String.raw`\mathrm{Sum}(\mathrm{Take}(\mathrm{Map}(\_ \mapsto \_^2, 1..\infty), n))`
      )
    );
    ce.popScope();
    expect(r?.success).toBe(true);
    expect(r?.run?.({ n: 10 })).toBe(385);
    expect(r?.run?.({ n: 0 })).toBe(0);
    expect(r?.run?.({ n: -3 })).toBe(0); // negative count → Take is []
  });

  it('Filter over an infinite range stays lazy', () => {
    const r = compile(
      ce.parse(
        String.raw`\mathrm{Take}(\mathrm{Filter}(1..\infty, \_ \mapsto \_ > 4), 3)`
      )
    );
    expect(r?.success).toBe(true);
    expect(r?.run?.({})).toEqual([5, 6, 7]);
  });

  it('Drop and Rest over an infinite pipeline stay lazy', () => {
    const drop = compile(
      ce.parse(
        String.raw`\mathrm{Take}(\mathrm{Drop}(\mathrm{Map}(\_ \mapsto \_^2, 1..\infty), 2), 3)`
      )
    );
    expect(drop?.run?.({})).toEqual([9, 16, 25]);
    const rest = compile(
      ce.parse(String.raw`\mathrm{Take}(\mathrm{Rest}(1..\infty), 3)`)
    );
    expect(rest?.run?.({})).toEqual([2, 3, 4]);
  });

  it('an explicit step and a descending infinite range work', () => {
    const stepped = compile(
      ce.parse(String.raw`\mathrm{Take}(\mathrm{Range}(1, \infty, 3), 4)`)
    );
    expect(stepped?.run?.({})).toEqual([1, 4, 7, 10]);
    const desc = compile(
      ce.parse(String.raw`\mathrm{Take}(\mathrm{Range}(10, -\infty), 3)`)
    );
    expect(desc?.run?.({})).toEqual([10, 9, 8]);
  });

  it('TakeWhile bounds an infinite pipeline', () => {
    const r = compile(
      ce.parse(
        String.raw`\mathrm{TakeWhile}(\mathrm{Map}(\_ \mapsto \_^2, 1..\infty), \_ \mapsto \_ < 20)`
      )
    );
    expect(r?.success).toBe(true);
    expect(r?.run?.({})).toEqual([1, 4, 9, 16]);
  });

  it('a fractional take count ROUNDS, matching the interpreter', () => {
    // Interpreter count normalization is Math.round (2.5 → 3 elements) —
    // the eager lowering previously truncated via `slice`.
    const lazy = compile(ce.parse(String.raw`\mathrm{Take}(1..\infty, 2.5)`));
    expect(lazy?.run?.({})).toEqual([1, 2, 3]);
    const eager = compile(
      ce.parse(String.raw`\mathrm{Take}(\mathrm{List}(1,2,3,4), 2.5)`)
    );
    expect(eager?.run?.({})).toEqual([1, 2, 3]);
    const eagerDrop = compile(
      ce.parse(String.raw`\mathrm{Drop}(\mathrm{List}(1,2,3,4), 2.5)`)
    );
    expect(eagerDrop?.run?.({})).toEqual([4]);
  });

  it('the range start may be a runtime variable', () => {
    ce.pushScope();
    ce.declare('n_0', 'integer');
    const r = compile(
      ce.parse(
        String.raw`\mathrm{Take}(\mathrm{Map}(\_ \mapsto \_^2, \mathrm{Range}(n_0, \infty)), 3)`
      )
    );
    ce.popScope();
    expect(r?.success).toBe(true);
    expect(r?.run?.({ n_0: 5 })).toEqual([25, 36, 49]);
  });

  it('a scan that can never terminate throws the iteration-limit error, not a hang', () => {
    // The interpreter caps Filter/TakeWhile walks at `ce.iterationLimit` and
    // throws `iteration-limit-exceeded` (`library/collections.ts`); the
    // compiled stream helpers enforce the same cap, read at CALL time.
    const prev = ce.iterationLimit;
    ce.iterationLimit = 500;
    try {
      const filter = compile(
        ce.parse(
          String.raw`\mathrm{Take}(\mathrm{Filter}(1..\infty, \_ \mapsto \_ < 0), 1)`
        )
      );
      expect(() => filter?.run?.({})).toThrow(/Iteration limit of 500/);
      const takeWhile = compile(
        ce.parse(String.raw`\mathrm{TakeWhile}(1..\infty, \_ \mapsto \_ > 0)`)
      );
      expect(() => takeWhile?.run?.({})).toThrow(/Iteration limit of 500/);
    } finally {
      ce.iterationLimit = prev;
    }
  });

  it('a PRODUCTIVE Filter is not capped — the cap counts rejections, not pulls', () => {
    // The cap is for a filter that can never finish: a predicate that never
    // matches over an infinite source. A filter that keeps emitting is bounded
    // by whatever consumes it — here a `Take` — so counting its productive
    // pulls capped a walk that rejects nothing, at the default limit of 1024.
    // The interpreter answers 1025 elements for this; so does the compiled
    // form now. (The never-matching case above still throws.)
    const r = compile(
      ce.parse(
        String.raw`\mathrm{Take}(\mathrm{Filter}(1..\infty, \_ \mapsto \_ > 0), 1025)`
      ),
      { constantFold: false }
    );
    expect((r?.run?.({}) as number[]).length).toBe(1025);
  });

  it('a COUNTED Take/Drop is not capped — the count is the caller’s explicit request', () => {
    // The cap belongs to the two scans whose walk can never finish (above).
    // `Take(…, k)` pulls at most `k` and `Drop(…, k)` skips exactly `k`, with
    // `k` a resolved safe integer, so both provably terminate — capping them
    // turned a legitimate count larger than `ce.iterationLimit` (1024 by
    // default) into an error the interpreter never raises.
    const sum = compile(
      ce.parse(
        String.raw`\mathrm{Sum}(\mathrm{Take}(\mathrm{Map}(\_ \mapsto \_^2, 1..\infty), 2000))`
      ),
      // Otherwise the closed pipeline folds to the literal at compile time and
      // the `_SYS` stream under test never runs.
      { constantFold: false }
    );
    expect(sum?.run?.({})).toBe(2668667000); // the interpreter's own result

    const drop = compile(
      ce.parse(String.raw`\mathrm{Take}(\mathrm{Drop}(1..\infty, 2000), 3)`),
      { constantFold: false }
    );
    expect(drop?.run?.({})).toEqual([2001, 2002, 2003]);
  });

  it('an invalid runtime count is an indeterminate (empty) walk, per the interpreter contract', () => {
    // `toInteger` (`boxed-expression/numerics.ts`) rejects non-finite and
    // non-safe-integer counts; the interpreter routes an unresolved count to
    // an EMPTY walk (`integerParam`, `library/collections.ts`) — it never
    // substitutes a default.
    ce.pushScope();
    ce.declare('m_0', 'real');
    const take = compile(ce.parse(String.raw`\mathrm{Take}(1..\infty, m_0)`));
    expect(take?.run?.({ m_0: NaN })).toEqual([]);
    expect(take?.run?.({ m_0: 1e100 })).toEqual([]);
    const drop = compile(
      ce.parse(String.raw`\mathrm{Take}(\mathrm{Drop}(1..\infty, m_0), 3)`)
    );
    ce.popScope();
    // An invalid drop count contributes NO elements (empty walk) — not
    // "drops nothing".
    expect(drop?.run?.({ m_0: NaN })).toEqual([]);
    expect(drop?.run?.({ m_0: 2 })).toEqual([3, 4, 5]);
  });

  describe('fail closed (D6) when the pipeline is never bounded', () => {
    it('a statically non-finite take count does not compile', () => {
      const r = compile(ce.parse(String.raw`\mathrm{Take}(1..\infty, \infty)`));
      expect(r?.success).toBe(false);
    });

    it('a statically non-finite drop count keeps the pipeline out of the lazy algebra', () => {
      // `constantFold: false`: the pipeline is closed (no free variables), so
      // compile-time constant folding would evaluate it to the empty list and
      // emit `[]` instead of reaching the D6 gate under test.
      const r = compile(
        ce.parse(
          String.raw`\mathrm{Take}(\mathrm{Drop}(1..\infty, \infty), 3)`
        ),
        { constantFold: false }
      );
      expect(r?.success).toBe(false);
    });

    it('Sum over an unbounded infinite Map does not compile', () => {
      const r = compile(
        ce.parse(
          String.raw`\mathrm{Sum}(\mathrm{Map}(\_ \mapsto \_^2, 1..\infty))`
        )
      );
      expect(r?.success).toBe(false);
    });

    it('an array-materializing consumer (Reverse) does not compile', () => {
      expect(() =>
        compile(
          ce.parse(
            String.raw`\mathrm{Reverse}(\mathrm{Map}(\_ \mapsto \_^2, 1..\infty))`
          ),
          { fallback: false }
        )
      ).toThrow(/infinite collection/);
    });

    it('a bare infinite Range does not compile', () => {
      expect(() =>
        compile(ce.parse(String.raw`\mathrm{Sum}(1..\infty)`), {
          fallback: false,
        })
      ).toThrow(/non-finite bound|infinite/);
    });

    it('a sign-mismatched step (inert in the interpreter) does not compile', () => {
      // `constantFold: false`: the pipeline is closed (no free variables), so
      // compile-time constant folding would evaluate it to the empty list and
      // emit `[]` instead of reaching the D6 gate under test.
      const r = compile(
        ce.parse(String.raw`\mathrm{Take}(\mathrm{Range}(1, \infty, -2), 4)`),
        { constantFold: false }
      );
      expect(r?.success).toBe(false);
    });

    it('DropWhile over an infinite source (inert in the interpreter) does not compile', () => {
      const r = compile(
        ce.parse(
          String.raw`\mathrm{Take}(\mathrm{DropWhile}(1..\infty, \_ \mapsto \_ < 4), 3)`
        )
      );
      expect(r?.success).toBe(false);
    });

    it('the Python target fails closed on a non-finite Range bound', () => {
      // `constantFold: false`: the pipeline is closed (no free variables), so
      // compile-time constant folding would emit the literal `[1, 2, 3]` and
      // the Python target's non-finite-bound gate would never run.
      const r = compile(ce.parse(String.raw`\mathrm{Take}(1..\infty, 3)`), {
        to: 'python',
        constantFold: false,
      });
      expect(r?.success ?? false).toBe(false);
    });
  });
});

//
// TYCHO ITEM 187 — a `Range` with a COMPUTED bound must not fold to a literal.
//
// The javascript target constant-folds a `Range` whose bounds are numeric
// literals. The guard used `parseFloat` on the COMPILED BOUND SOURCE, and
// `parseFloat` reads a leading numeric PREFIX and ignores the rest — so a
// symbolic bound whose compiled form merely starts with a number was accepted
// as a constant, and its prefix was used as the bound.
//
// `Length(L)/3` compiles to `0.3333333333333333 * (_.L).length`. Read as
// 0.333 against a start of 1, that is a DESCENDING range of length
// `floor(|0.333 - 1|) + 1 = 1`, so the whole range was emitted as `[1]` and
// every element past the first silently vanished — a wrong VALUE behind
// `success: true`, which is the worst failure shape for a compile target.
//
// The witness needed BOTH an arithmetic wrapper around the range AND a bound
// the constant folder could not see: a literal bound folds before the guard
// is reached, and an unwrapped range takes a different lowering. `Number`
// requires the whole string to be numeric, so every computed bound now falls
// through to the runtime-length branch.
//
describe('Tycho item 187 — computed Range bounds keep every element', () => {
  function run(iter: unknown): unknown {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<number>');
    ce.declare('n', 'number');
    const js = ce._getCompilationTarget('javascript')!;
    const expr = ce.box([
      'Comprehension',
      ['Tuple', 'i', 'i'],
      ['Element', 'i', iter],
    ] as never);
    const r = js.compile(expr, { realOnly: true } as never);
    expect(r?.success).toBe(true);
    return r!.run!({ L: [1, 2, 3, 4, 5, 6, 7, 8, 9], n: 3 } as never);
  }

  test('the witness: an arithmetic-shifted range over a computed bound', () => {
    // Was [[0,0]] — one element instead of three.
    expect(run(['Subtract', ['Range', 1, ['Divide', ['Length', 'L'], 3]], 1])).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
    ]);
  });

  test('the same range UNSHIFTED (was already correct)', () => {
    expect(run(['Range', 1, ['Divide', ['Length', 'L'], 3]])).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
  });

  test('a LITERAL shifted range still constant-folds correctly', () => {
    expect(run(['Subtract', ['Range', 1, 3], 1])).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
    ]);
  });

  test('a plain symbolic bound was never affected', () => {
    expect(run(['Range', 1, 'n'])).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
  });

  test('a DESCENDING literal range keeps auto-descending', () => {
    // The folded branch still runs for genuinely literal bounds, so the
    // implicit ±1 step must survive the guard change.
    expect(run(['Range', 5, 1])).toEqual([
      [5, 5],
      [4, 4],
      [3, 3],
      [2, 2],
      [1, 1],
    ]);
  });

  test('compiled agrees with interpreted on the witness', () => {
    const ce = new ComputeEngine();
    const L = ['List', 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const interpreted = ce
      .box([
        'Comprehension',
        ['Tuple', 'i', 'i'],
        ['Element', 'i', ['Subtract', ['Range', 1, ['Divide', ['Length', L], 3]], 1]],
      ] as never)
      .evaluate();
    expect(interpreted.toString()).toBe('[(0, 0),(1, 1),(2, 2)]');
  });
});
