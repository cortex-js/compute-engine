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
