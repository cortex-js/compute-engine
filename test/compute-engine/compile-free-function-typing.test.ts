/**
 * TYPE-LEVEL pin for the root `compile` export (`free-functions.ts`).
 *
 * The wrapper re-declares `compileExpr`'s signature so its own type parameter
 * flows into the result. Spelling the return as `ReturnType<typeof
 * compileExpr>` instead instantiates the generic at its constraint — every
 * call types as `CompilationResult<string>` no matter the `to:` — which makes
 * `run` OPTIONAL even for executable targets, because the
 * `T extends ExecutableTarget` conditional never sees a concrete target. A
 * consumer migrating from the internal target route
 * (`ce._getCompilationTarget(...).compile(...)`, which had it right) then
 * loses type precision at every executing call site — reported by the Tycho
 * consumer at 0.116.0 adoption, the release that told them to migrate to this
 * export.
 *
 * ts-jest typechecks this file, so the type assertions run with the suite: a
 * regression turns the `@ts-expect-error` lines into transform errors.
 */
import { ComputeEngine, compile } from '../../src/compute-engine';

const ce = new ComputeEngine();

describe('root compile() export typing', () => {
  test('default target: run is non-optional and executes', () => {
    const r = compile(ce.parse('x + 1'));
    // Would be `Cannot invoke an object which is possibly 'undefined'` if the
    // generic collapsed and `run` typed optional.
    expect(r.run({ x: 1 })).toEqual(2);
  });

  test('explicit executable target keeps run non-optional', () => {
    const r = compile(ce.parse('x + 1'), { to: 'javascript' });
    expect(r.run({ x: 3 })).toEqual(4);
  });

  test('the removed `realOnly` option is rejected by the option type', () => {
    // The option no longer exists. An untyped JavaScript caller can still
    // reach the key (and gets a one-time removal warning at run time), but the
    // typed surface must reject it so a migrating consumer sees the break at
    // build time rather than silently losing the projection.
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // @ts-expect-error — `realOnly` was removed from the compile options.
      const r = compile(ce.parse('x + 1'), { realOnly: true });
      expect(r.run({ x: 2 })).toEqual(3);
    } finally {
      warn.mockRestore();
    }
  });

  test('the default result type spans everything a runner returns', () => {
    // The default `R` is `CompiledValue`, which is deliberately wider than
    // the numeric case: the same `run` returns a boolean for a predicate, a
    // string for a string-valued expression and an array for a collection.
    // Arithmetic on it therefore must NOT typecheck without narrowing — the
    // point of the widening is that a caller who multiplies the result is
    // told at build time that it might not be a number.
    const r = compile(ce.parse('x + 1'));
    // @ts-expect-error — `CompiledValue` is not an arithmetic operand.
    const doubled = () => r.run({ x: 1 }) * 2;
    void doubled;

    // …and the values that motivate it really do come back.
    expect(compile(ce.box(['Greater', 'x', 0])).run({ x: 1 })).toBe(true);
    expect(compile(ce.box(['List', 1, 2, 3])).run({})).toEqual([1, 2, 3]);
    expect(compile(ce.box(['List', ['List', 1, 2]])).run({})).toEqual([[1, 2]]);
    expect(compile(ce.box({ str: 'abc' })).run({})).toBe('abc');
  });

  test('the R type parameter narrows the result, with no runtime effect', () => {
    // The replacement for the removed `realOnly` option: a caller who knows
    // the expression is numeric says so in the TYPE and gets arithmetic back,
    // without the engine coercing anything at run time (which is what made
    // `realOnly` worth removing).
    const r = compile<'javascript', number>(ce.parse('x + 1'));
    expect(r.run({ x: 1 }) * 2).toEqual(4);

    // The assertion is the caller's responsibility: narrowing a genuinely
    // non-numeric expression still compiles, and still returns the boolean.
    const lying = compile<'javascript', number>(ce.box(['Greater', 'x', 0]));
    expect(lying.run({ x: 1 })).toBe(true as unknown as number);
  });

  test('the interval target has its own result type, not the ordinary one', () => {
    // `interval-js` does not produce ordinary values: its runner answers with
    // an `IntervalResult` tagged union, or with a bare `{lo, hi}` interval for
    // a constant. The default `R` therefore selects on the TARGET, so an
    // interval caller is not handed a numeric contract it can never satisfy.
    const r = compile(ce.parse('x + 1'), { to: 'interval-js' });
    const v = r.run({ x: 2 });
    // @ts-expect-error — an interval result is not an arithmetic operand.
    const doubled = () => v * 2;
    void doubled;
    expect(v).toEqual({ kind: 'interval', value: { lo: 3, hi: 3 } });
    // A constant comes back as the bare interval, which the type admits too.
    expect(compile(ce.box(5), { to: 'interval-js' }).run({})).toEqual({
      lo: 5,
      hi: 5,
    });
  });

  test('a function-valued expression runs to a callable', () => {
    // `Derivative(Sin)` compiles to `(x) => Math.cos(x)`: the runner hands
    // back a FUNCTION, which is why `CompiledValue` includes a callable.
    const r = compile(ce.box(['Derivative', 'Sin']));
    const f = r.run({});
    expect(typeof f).toBe('function');
    expect(typeof f === 'function' ? f(0) : undefined).toBeCloseTo(1);
  });

  test('source-only target: run is not callable unguarded', () => {
    const r = compile(ce.parse('x + 1'), { to: 'python' });
    // @ts-expect-error — python is source-only; `run` types optional there,
    // so an unguarded call must not typecheck.
    const call = () => r.run({ x: 1 });
    void call;
    expect(r.success).toBe(true);
    expect(typeof r.code).toBe('string');
  });
});
