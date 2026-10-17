import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';

// The two value shields — `simplifyValueBlind` (`boxed-expression/simplify.ts`)
// and `withValueShield` (`boxed-expression/utils.ts`) — shadow-declare an
// assigned variable as valueless in a temporary scope. Two arrangements keep
// a shield from retiring the caches of the whole engine, and from sharing a
// cache across its boundary:
//
// - the shield scope is a SCRATCH scope (`scratch-scopes.ts`): its
//   declarations advance no engine-wide cache version and its pop is clean;
// - the shielded work runs under a cache key of its own
//   (`ComputeEngine._withValueShieldKey`): a symbol finds its binding by name
//   through the current scope chain, so the expressions that existed before
//   the shield read the shadow binding inside it, and a `_sgn`/`_type` answer
//   derived from the value outside must not be served inside, nor a
//   value-blind answer after the pop.
//
// Before, each shielded simplification advanced the `any` cache axis twice
// (one declaration, one dirty pop) and retired the `_type`/`_sgn` cache of
// every expression in the engine. A sign check inside a type derivation
// reaches `simplify()` through `exactOrder()`, and the retired caches made the
// derivation re-type its operands once per read, exponentially in the depth
// of the body (Tycho ledger row 381, `art/mavxszbvzk`, 2026-10-17: one
// application of a two-level user function did not finish in a minute).

const cacheGeneration = (ce: ComputeEngine): number =>
  (ce as unknown as { _cacheGeneration(): number })._cacheGeneration();

describe('value shields are scratch scopes with their own cache key', () => {
  test('simplify() of an expression that mentions an assigned variable advances no cache generation', () => {
    const ce = new ComputeEngine();
    ce.assign('x', 5);
    // Warm the engine: the first simplification of a shape may declare
    // library entries of its own.
    ce.parse('(x+1)^2 - x^2').simplify();
    const before = cacheGeneration(ce);
    const result = ce.parse('(x+1)^2 - x^2').simplify();
    expect(result.toString()).toBe('2x + 1');
    expect(cacheGeneration(ce) - before).toBe(0);
  });

  test('the shielded symbol in the result is the caller’s symbol, not the dead shield binding', () => {
    const ce = new ComputeEngine();
    ce.assign('x', 5);
    const result = ce.parse('(x+1)^2 - x^2').simplify();
    // `rebindEscaping` rebinds the escaping result after the shield pops, so
    // the symbol it holds evaluates with the caller's value.
    expect(result.evaluate().toString()).toBe('11');
    expect(result.isSame(ce.parse('2x+1'))).toBe(true);
  });

  test('a sign cached from the assigned value before the shield is not used inside it', () => {
    const ce = new ComputeEngine();
    ce.assign('x', 5);
    const e = ce.parse('|x+1|');
    // A read of the operand's sign outside the shield caches `positive`, from
    // the value. The simplification is value-blind: with the cache served
    // inside the shield, `|x+1|` became `x+1`, which is wrong once `x := -5`.
    expect(e.op1.sgn).toBe('positive');
    expect(e.simplify().toString()).toBe('|x + 1|');
    expect(ce.parse('|x+1|').simplify().toString()).toBe('|x + 1|');
    ce.assign('x', -5);
    expect(e.simplify().evaluate().toString()).toBe('4');
  });

  test('a value-blind answer cached inside the shield is not used after it', () => {
    const ce = new ComputeEngine();
    ce.assign('x', 5);
    const e = ce.parse('|x+1|');
    expect(e.simplify().toString()).toBe('|x + 1|');
    // Inside the shield the operand `x+1` is read with `x` valueless and its
    // sign is undecided; after the pop the value is visible again.
    expect(e.op1.sgn).toBe('positive');
    expect(e.op1.isPositive).toBe(true);
    expect(e.evaluate().toString()).toBe('6');
  });

  test('the binder shield (Solve) stays value-blind after a warm sign read, and the value returns after it', () => {
    const ce = new ComputeEngine();
    ce.assign('t', 3);
    const abs = ce.parse('|t+1|');
    expect(abs.op1.sgn).toBe('positive');
    const solutions = ce
      .function('Solve', [ce.function('Equal', [abs, 2]), 't'])
      .evaluate();
    expect(solutions.toString()).toBe('[-3,1]');
    expect(abs.op1.sgn).toBe('positive');
  });

  test('a write inside a shield retires what was cached earlier in the same shield', () => {
    // Inside a shield the cache key is the shield's, not the `any` axis; a
    // write inside the shield advances the axis, and the key must move with
    // it, or the sign cached before the write would be served after it.
    const ce = new ComputeEngine();
    const withShieldKey = (
      ce as unknown as { _withValueShieldKey<T>(f: () => T): T }
    )._withValueShieldKey.bind(ce);
    const e = ce.parse('2y');
    ce.assign('y', 1);
    const [before, after] = withShieldKey(() => {
      const first = e.sgn;
      ce.assign('y', -3);
      return [first, e.sgn];
    });
    expect(before).toBe('positive');
    expect(after).toBe('negative');
    expect(e.sgn).toBe('negative');
  });

  test('HoldValues: a write in the held body is seen by a later read of the same node', () => {
    const ce = new ComputeEngine();
    ce.assign('x', 5);
    ce.assign('y', 1);
    const n = ce.parse('y+1');
    const body = ce.function('Block', [
      ce.function('Sign', [n]),
      ce.box(['Assign', 'y', -3]),
      ce.function('Sign', [n]),
    ]);
    // The shield is restricted to `x`; `y` keeps its value inside the body.
    const result = ce
      .function('HoldValues', [body, ce.box(['List', 'x'])])
      .evaluate();
    expect(result.toString()).toBe('-1');
  });

  test('nested user functions that share a parameter name evaluate in bounded time', () => {
    // `f_b2full50(x)` applies `f_b2(x)` several times; `f_b2`'s body ranges
    // over `Floor(Log(Max(x, 1), 2))`, whose sign the `Range` type handler
    // asks for. The outer call binds `x := 5` in its call frame, so the inner
    // sign check shields `x` and simplifies. With the shield advancing the
    // cache generation, this application made more than six thousand sign
    // reads and ran past a one-minute limit; it takes about 15 ms now.
    const ce = new ComputeEngine();
    const fb2 = [
      'Mod',
      [
        'Floor',
        [
          'Multiply',
          ['Power', 2, ['Negate', ['Range', ['Floor', ['Log', ['Max', 'x', 1], 2]], 0]]],
          'x',
        ],
      ],
      2,
    ];
    const count = ['Count', ['f_b2', 'x']];
    const padding = [
      'Repeat',
      0,
      ['Subtract', ['If', ['Equal', ['At', ['f_b2', 'x'], 1], 0], 51, 50], count],
    ];
    const fb2full50 = [
      'If',
      ['LessEqual', count, 50],
      ['Join', padding, ['f_b2', 'x']],
      ['Rest', ['f_b2', 'x']],
    ];
    ce.declare('f_b2', '(nan|real|signed_infinity) -> unknown');
    ce.assign('f_b2', ce.box(['Function', ['Block', fb2], 'x']));
    ce.declare('f_b2full50', '(nan|real|signed_infinity) -> unknown');
    ce.assign('f_b2full50', ce.box(['Function', ['Block', fb2full50], 'x']));

    const before = cacheGeneration(ce);
    const result = ce.withTimeLimit(10_000, () =>
      ce.box(['f_b2full50', 5]).evaluate()
    ) as Expression & { ops: ReadonlyArray<Expression> };
    // 5 = 101₂: `f_b2(5)` is `[1, 0, 1]`, padded with 47 zeros to 50 bits.
    expect(result.operator).toBe('List');
    expect(result.ops.length).toBe(50);
    expect(result.ops.slice(-3).map((op) => op.toString())).toEqual(['1', '0', '1']);
    // The application declares its parameters and locals, nothing more: the
    // defect moved the generation by tens of thousands.
    expect(cacheGeneration(ce) - before).toBeLessThan(100);
  });
});
