import { ComputeEngine } from '../../src/compute-engine';
import { asComputation } from '../../src/common/computation-depth';
import {
  cachedValue,
  type CachedValue,
} from '../../src/compute-engine/boxed-expression/cache';
import { withScratchScope } from '../../src/compute-engine/scratch-scopes';

// CE-36. A signature derivation boxes a function body in a scratch scope
// (`resultUnderDeclaredParameters`, `declared-parameter-result.ts`). When a
// `_type` read reaches the derivation, it runs inside a cached computation,
// and a value-type inference advances the `any` cache axis only when no
// cached computation is running (`runWhenIdle`). A type that the derivation
// cached before a WIDENING of one of its temporary symbols was then served
// again after the widening: `x + 1` stayed `integer` after `x` became
// `real`. A widening now advances the axis at once, on a scratch binding
// and on any other binding.
//
// No public input is known to reach this case, so the tests set up the same
// state directly: a scope, a running computation, a cached type, and a
// widening of the binding it reads.

type Setup = {
  ce: ComputeEngine;
  x: any;
  sum: ReturnType<ComputeEngine['box']>;
};

/** Run `f` in a fresh engine, in a scope that holds `x` (inferred
 * `integer`) and `x + 1`. With `scratch`, the scope is registered as a
 * scratch scope while `f` runs. */
function inScope<T>(scratch: boolean, f: (s: Setup) => T): T {
  const ce = new ComputeEngine();
  const scope = { parent: ce.context.lexicalScope, bindings: new Map() };
  const body = () =>
    (ce as any)._inScope(scope, () => {
      ce.declare('x', 'unknown');
      // The sum is boxed before the narrowing: its unit then requires
      // `number` of `x`, not the type that `x` has at that time.
      const sum = ce.box(['Add', 'x', 1]);
      const x = ce.box('x') as any;
      x._infer(() => 'integer', 'narrow');
      return f({ ce, x, sum });
    });
  return scratch ? withScratchScope(ce as any, scope, body) : body();
}

function typesAroundWidening(options: {
  inComputation: boolean;
  scratch: boolean;
}): { before: string; after: string; x: string } {
  const run = () =>
    inScope(options.scratch, ({ x, sum }) => {
      const before = sum.type.toString();
      x._infer(() => 'real', 'widen');
      return { before, after: sum.type.toString(), x: x.type.toString() };
    });
  return options.inComputation ? asComputation(run) : run();
}

describe('CE-36: a widening of a scratch binding inside a cached computation', () => {
  test('control: outside a computation, the widening is seen at once', () => {
    expect(typesAroundWidening({ inComputation: false, scratch: true })).toEqual(
      { before: 'integer', after: 'real', x: 'real' }
    );
  });

  test('inside a computation, a type cached before the widening is computed again', () => {
    expect(typesAroundWidening({ inComputation: true, scratch: true })).toEqual(
      { before: 'integer', after: 'real', x: 'real' }
    );
  });

  test('control: outside a computation, the widening of a binding outside a scratch scope is seen at once', () => {
    expect(
      typesAroundWidening({ inComputation: false, scratch: false })
    ).toEqual({ before: 'integer', after: 'real', x: 'real' });
  });

  test('inside a computation, a widening of a binding outside a scratch scope is seen at once', () => {
    // A widening of any binding advances the `any` cache axis at once, not
    // only when the outermost computation ends: before, `x + 1` stayed
    // `integer` here after `x` became `real`.
    expect(typesAroundWidening({ inComputation: true, scratch: false })).toEqual(
      { before: 'integer', after: 'real', x: 'real' }
    );
  });

  test('inside a computation, a narrowing still waits for the computation to end', () => {
    // A narrowing can only leave a cached type wider than it could be, so
    // its advance stays deferred: `x + 1` is still `real` inside the
    // computation after `x` is narrowed back to `integer`, and is `integer`
    // after the computation ends.
    const ce = new ComputeEngine();
    ce.declare('y', 'unknown');
    const sum = ce.box(['Add', 'y', 1]);
    const inside = asComputation(() => {
      const y = ce.box('y') as any;
      y._infer(() => 'real', 'narrow');
      const before = sum.type.toString();
      y._infer(() => 'integer', 'narrow');
      return { before, after: sum.type.toString(), y: y.type.toString() };
    });
    expect(inside).toEqual({ before: 'real', after: 'real', y: 'integer' });
    expect(sum.type.toString()).toBe('integer');
  });

  test('a widening inside an in-flight cached computation that reads its own cell again', () => {
    // The computation widens `x`, then reads its own cell again (as a
    // recursive type read does), then reads the type of `x + 1`. The advance
    // makes the cell's generation outdated, so the re-entrant read computes
    // once more. That second run sends no event (the widening to the same
    // type is a no-op), so its own re-entrant read is served the empty
    // value, and the recomputation ends.
    const { result, runs } = inScope(true, ({ ce, x, sum }) => {
      expect(sum.type.toString()).toBe('integer');
      const cell: CachedValue<string> = { value: null, generation: undefined };
      let runs = 0;
      const read = (): string =>
        cachedValue(
          cell,
          (ce as any)._anyVersion * 2,
          () => {
            runs += 1;
            if (runs > 10) throw new Error('unbounded recomputation');
            x._infer(() => 'real', 'widen');
            read();
            return sum.type.toString();
          },
          undefined,
          undefined,
          'pending'
        );
      return { result: read(), runs };
    });
    expect(result).toBe('real');
    // Two runs: the second widening is a no-op because `'real'` is an
    // interned primitive type, so `_infer` sees the same type object.
    expect(runs).toBe(2);
  });

  test('the rollback of a narrowing inside a computation is seen at once', () => {
    // The undo of a narrowing puts the wider type back and sends a widening
    // event. `x` is `number`, narrowed to `integer` inside a rollback frame,
    // and `x + 1` is typed while the narrowing is in force.
    const result = asComputation(() =>
      inScope(true, ({ ce, x, sum }) => {
        x._infer(() => 'real', 'widen');
        x._infer(() => 'number', 'widen');
        const engine = ce as any;
        const inside = engine._withBoxingPassWindow(() =>
          engine._withRolledBackInference(() => {
            x._infer(() => 'integer', 'narrow');
            return sum.type.toString();
          })
        );
        return { inside, x: x.type.toString(), after: sum.type.toString() };
      })
    );
    expect(result).toEqual({ inside: 'integer', x: 'number', after: 'number' });
  });

  test.each(['widen', 'replace'] as const)(
    'a repeated %s with an equal type built as an object sends one event',
    (mode) => {
      // A type built as an object is a new object at each call. The second
      // and third writes are equal to the recorded type, so they are no-ops:
      // they send no event and do not advance the `any` cache axis again.
      // Here the recorded type after the first `widen` is the union
      // `integer | list<real>`, which already holds `list<real>`, so `widen`
      // returns the recorded object and `_infer` sees the same object; a
      // `replace` writes the new object, so only the structural comparison
      // in `_infer` finds it equal.
      const { events, advances, x } = asComputation(() =>
        inScope(false, ({ ce, x }) => {
          const engine = ce as any;
          const events: unknown[] = [];
          const note = engine._noteStateEvent.bind(engine);
          engine._noteStateEvent = (e: any) => {
            if (e.kind === 'inference') events.push(e);
            return note(e);
          };
          const start = engine._anyVersion;
          for (let i = 0; i < 3; i++)
            x._infer(() => ({ kind: 'list', elements: 'real' }), mode);
          return {
            events: events.length,
            advances: engine._anyVersion - start,
            x: x.type.toString(),
          };
        })
      );
      expect({ events, advances, x }).toEqual({
        events: 1,
        advances: 1,
        x: mode === 'widen' ? 'integer | list<real>' : 'list<real>',
      });
    }
  );
});
