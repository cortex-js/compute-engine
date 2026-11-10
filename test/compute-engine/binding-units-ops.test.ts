import { ComputeEngine, compile } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import { isFreeName } from '../../src/compute-engine/boxed-expression/type-guards';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import * as limitProbe from '../../src/compute-engine/symbolic/limit';
import { asyncEvaluationOf } from '../../src/compute-engine/boxed-expression/evaluation-epoch';
import {
  UnitEnvironment,
  sameUnitEnvironmentStamp,
  unitEnvironmentStamp,
} from '../../src/compute-engine/binding-unit';

// Phase C of slice 1 of binding units, with the engine flag `_bindingUnits`
// on: rules 8 (operations), 9 (caches) and 10 (programs) of
// `docs/plans/2026-11-09-binding-units-slice-1-spec.md`.

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce._bindingUnits = true;
  return ce;
}

describe('BINDING UNITS: OPERATIONS', () => {
  test('compile a derivative of a function of two free names', () => {
    const ce = engine();
    const result = compile(ce.box(['D', ['Arctan2', 'y', 'x'], 'x']));
    expect(result.success).toBe(true);
    expect(typeof result.run).toBe('function');
  });

  test('compile the result of a simplification', () => {
    const ce = engine();
    const result = compile(ce.parse('x + 1').simplify());
    expect(result.success).toBe(true);
    expect((result.run as (v: object) => number)({ x: 2 })).toBe(3);
  });

  test('an operation does not narrow the expression of the host', () => {
    const ce = engine();
    let inside = '';
    ce.declare('Probe', {
      signature: '(any) -> string',
      lazy: true,
      evaluate: ([v], { engine }) => {
        engine.function('Sqrt', [v]);
        inside = v.type.toString();
        return engine.string(inside);
      },
    });
    const a = ce.box(['Tuple', 'x', 'y']);
    expect(a.op1.type.toString()).toBe('unknown');
    ce.box(['Probe', a.op1]).evaluate();
    // Inside the operation, the requirement of `Sqrt` is read.
    expect(inside).toBe('number');
    expect(a.op1.type.toString()).toBe('unknown');
  });

  test('a nested operation does not narrow the enclosing operation', () => {
    const ce = engine();
    const seen: string[] = [];
    ce.declare('Probe', {
      signature: '(any) -> string',
      lazy: true,
      evaluate: ([v], { engine }) => {
        engine.function('Sqrt', [v]);
        seen.push(v.type.toString());
        return engine.string('');
      },
    });
    ce.declare('Outer', {
      signature: '(any) -> string',
      lazy: true,
      evaluate: ([v], { engine }) => {
        engine.box(['Probe', v]).evaluate();
        seen.push(v.type.toString());
        return engine.string('');
      },
    });
    const a = ce.box(['Tuple', 'x']);
    ce.box(['Outer', a.op1]).evaluate();
    expect(seen).toEqual(['number', 'unknown']);
  });

  test('the environment of a nested operation', () => {
    const ce = engine();
    const state = ce._boxingState;
    const a = ce.box(['Tuple', 'x']);
    ce._withOperation(
      a,
      () => {
        const outer = state.currentOperation()!;
        ce._withOperation(
          a,
          () => {
            // No environment until the first write.
            expect(state.currentOperation()).toBe(outer);
            ce.function('Sqrt', [a.op1]);
            const nested = state.currentOperation()!;
            expect(nested).not.toBe(outer);
            expect(nested.parents()).toEqual([outer]);
            expect(a.type.toString()).toBe('tuple<number>');
          },
          false
        );
        expect(state.currentOperation()).toBe(outer);
        expect(a.type.toString()).toBe('tuple<unknown>');
        // Also after a throw.
        expect(() =>
          ce._withOperation(
            a,
            () => {
              ce.function('Sqrt', [a.op1]);
              throw new Error('stop');
            },
            false
          )
        ).toThrow('stop');
        expect(state.currentOperation()).toBe(outer);
      },
      false
    );
    expect(state.currentOperation()).toBeUndefined();
  });

  test('a name boxed again in a scope that an operation pushed', () => {
    const ce = engine();
    let same: boolean | undefined;
    let type = '';
    ce.declare('Rebox', {
      signature: '(any) -> string',
      lazy: true,
      evaluate: ([v], { engine }) => {
        engine.pushScope();
        try {
          const x = engine.box('x');
          same = isFreeName(x) && x.isSame(v);
          type = x.type.toString();
        } finally {
          engine.popScope();
        }
        return engine.string(type);
      },
    });
    const a = ce.parse('x + 1');
    ce.box(['Rebox', a.op1]).evaluate();
    expect(same).toBe(true);
    expect(type).toBe('number');
  });

  test('a compilation reads the meet of the units of its input', () => {
    const ce = engine();
    const a = ce.parse('x + 1');
    const b = ce.parse('x > 1');
    expect(compile(ce.function('Add', [a, ce.function('Boole', [b])])).success)
      .toBe(true);
    // Units that disagree: the input has no type, and the compilation
    // declines.
    const c = ce.parse('x \\land y');
    const r = compile(ce.function('Tuple', [a, c]));
    expect(r.success).toBe(false);
  });

  test('two operations that interleave keep their environments', async () => {
    const ce = engine();
    const gates: Record<string, () => void> = {};
    ce.declare('ReadX', {
      signature: '() -> string',
      // A symbol made inside an operation reads the environment of the
      // operation, and so the unit of its input.
      evaluate: (_ops, { engine }) =>
        engine.string(engine.box('x').type.toString()),
    });
    ce.declare('Pause', {
      signature: '(any, any, string) -> any',
      lazy: true,
      evaluateAsync: async ([body, , tag], options) => {
        await new Promise<void>((resolve) => (gates[tag.string!] = resolve));
        return body.evaluateAsync(options);
      },
    });
    // Two units: `x` is a number in one and a boolean in the other.
    const ua = ce.parse('x + 1');
    const ub = ce.parse('x \\land y');
    expect(ua.op1.type.toString()).toBe('number');
    expect(ub.op1.type.toString()).toBe('boolean');
    const a = ce.function('Pause', [ce.box(['ReadX']), ua, ce.string('a')]);
    const b = ce.function('Pause', [ce.box(['ReadX']), ub, ce.string('b')]);
    const pa = a.evaluateAsync();
    const pb = b.evaluateAsync();
    const ready = async (tag: string) => {
      while (gates[tag] === undefined)
        await new Promise((resolve) => setTimeout(resolve, 0));
    };
    await ready('a');
    await ready('b');
    // `b` resumes first, while `a` waits.
    gates.b();
    const rb = await pb;
    gates.a();
    const ra = await pa;
    expect(ra.string).toBe('number');
    expect(rb.string).toBe('boolean');
  });
});

describe('BINDING UNITS: THE ASYNCHRONOUS EVALUATION OF A SYMBOL', () => {
  test('captures an operation environment whose parent is its unit', async () => {
    const ce = engine();
    const a = ce.parse('x + 1');
    const x = a.op1;
    const options = (
      x as unknown as {
        _inAsyncEvaluation(o: undefined): { _contextStack?: object };
      }
    )._inAsyncEvaluation(undefined);
    const operation = asyncEvaluationOf(options._contextStack)?.operation;
    expect(operation).toBeDefined();
    expect(operation!.parents()).toContain(
      (x as unknown as { _env: object })._env
    );
    // The value: a free name with no definition stays symbolic.
    expect((await x.evaluateAsync()).symbol).toBe('x');
    // No operation environment is left in place after the evaluation.
    expect(ce._boxingState.currentOperation()).toBeUndefined();
  });
});

describe('BINDING UNITS: CACHES', () => {
  test('a type cached on a compound expression reads a later requirement', () => {
    const ce = engine();
    const a = ce.box(['Tuple', 'x']);
    expect(a.type.toString()).toBe('tuple<unknown>');
    const generation = ce._typeCacheGeneration();
    ce.function('Add', [a.op1, 1]);
    // No engine-wide event: the counter of the environment moved.
    expect(ce._typeCacheGeneration()).toBe(generation);
    expect(a.type.toString()).toBe('tuple<number>');
  });

  test('a type cached on a compound expression and a pushed scope', () => {
    const ce = engine();
    const a = ce.box(['Tuple', 'x']);
    expect(a.type.toString()).toBe('tuple<unknown>');
    ce.pushScope();
    try {
      ce.declare('x', 'string');
      expect(a.type.toString()).toBe('tuple<string>');
    } finally {
      ce.popScope();
    }
    expect(a.type.toString()).toBe('tuple<unknown>');
  });

  test('the memo of merged facts is not read for an occurrence of a unit', () => {
    const ce = engine();
    ce.declare('x', 'unknown');
    ce.assume(ce.parse('x > 0'));
    const a = ce.box(['Tuple', 'x']);
    const before = a.op1.type.toString();
    expect(before).toBe('real<0<..>');
    // `Divisors` requires an integer: the fact `x > 0` is merged with it.
    ce.function('Divisors', [a.op1]);
    expect(a.op1.type.toString()).toBe('integer<1..>');
    // The definition is not narrowed by the requirement.
    expect(ce.box('x').type.toString()).toBe(before);
  });

  test('the compiled probes of a limit are read from the cache', () => {
    const compiles = (bindingUnits: boolean) => {
      const ce = new ComputeEngine();
      ce._bindingUnits = bindingUnits;
      const limit = ce.box([
        'Limit',
        ['Function', ['Divide', ['Ln', ['Ln', 'x']], ['Ln', 'x']], 'x'],
        'PositiveInfinity',
      ]);
      const counts: number[] = [];
      for (let i = 0; i < 2; i++) {
        const before = limitProbe.limitProbeCompileCount;
        expect(limit.evaluate().json).toEqual(0);
        counts.push(limitProbe.limitProbeCompileCount - before);
      }
      return counts;
    };
    // Each evaluation builds its probe expressions again, and the probe
    // cache is keyed on the expression, so the second evaluation compiles
    // as many probes as the first. In one evaluation, the stamp of the
    // environments (`unitEnvironmentStamp()`) causes no compilation that
    // the flag off does not make: without the cache, there are 132.
    const on = compiles(true);
    expect(on).toEqual(compiles(false));
    expect(on[1]).toBe(on[0]);
    expect(on[0]).toBeLessThan(20);
  });

  test('a probe of an expression with a free name is read from the cache', () => {
    // Here `x` is a free name, not a parameter: the dependency walk of the
    // probe cache tracks its resolution instead of refusing to cache.
    const compiles = (bindingUnits: boolean) => {
      const ce = new ComputeEngine();
      ce._bindingUnits = bindingUnits;
      const e = ce.parse('\\frac{\\ln(\\ln(x))}{\\ln(x)}');
      const before = limitProbe.limitProbeCompileCount;
      limitProbe.symbolicLimit(e, 'x', ce.PositiveInfinity, undefined, ce);
      return limitProbe.limitProbeCompileCount - before;
    };
    expect(compiles(true)).toBe(compiles(false));
  });

  test('the stamp of a probe moves at a write in the unit of a free name', () => {
    const ce = engine();
    const e = ce.parse('\\frac{\\ln(\\ln(a))}{\\ln(a)}');
    const stamp = () => [...unitEnvironmentStamp(undefined, [e])!.values()];
    const before = stamp();
    expect(stamp()).toEqual(before);
    // Two operations on `e` that write nothing give the same stamp.
    const inOperation = () =>
      ce._withOperation(e, () =>
        unitEnvironmentStamp(ce._boxingState.currentOperation(), [e])
      );
    expect(sameUnitEnvironmentStamp(inOperation(), inOperation())).toBe(true);
    // A requirement on `a` in its unit: the stamp moves, so a probe of `e`
    // kept before is not read (`compiledProbe()`).
    ce.function('Divisors', [e.op2.op1]);
    expect(stamp()).not.toEqual(before);
  });
});

describe('BINDING UNITS: A TYPE AND THE OPERATION IN PROGRESS', () => {
  test('a type cached before an operation is not read in it', () => {
    const ce = engine();
    const a = ce.box(['Tuple', 'x']);
    expect(a.type.toString()).toBe('tuple<unknown>');
    const inside = ce._withOperation(a, () => {
      ce.function('Sqrt', [a.op1]);
      return a.type.toString();
    });
    expect(inside).toBe('tuple<number>');
    expect(a.type.toString()).toBe('tuple<unknown>');
  });

  test('a type cached in an operation is not read after it', () => {
    const ce = engine();
    const a = ce.box(['Tuple', 'x']);
    const inside = ce._withOperation(a, () => {
      ce.function('Sqrt', [a.op1]);
      return a.type.toString();
    });
    expect(inside).toBe('tuple<number>');
    expect(a.type.toString()).toBe('tuple<unknown>');
    // A second operation that writes nothing reads the unit only.
    expect(ce._withOperation(a, () => a.type.toString())).toBe(
      'tuple<unknown>'
    );
  });
});

describe('BINDING UNITS: THE INPUT OF AN OPERATION', () => {
  test('the record of the uses of a name in two units', () => {
    const ce = engine();
    // `Add` maps over a collection, a bound of `Range` does not.
    const ua = ce.parse('x + 1');
    const ub = ce.box(['Range', 1, 'x']);
    const x = ua.op1 as unknown as { _homeScope: object };
    for (const input of [
      [ua, ub],
      [ub, ua],
    ])
      expect(
        ce._withOperation(input, () =>
          ce._boxingState.currentOperation()!.scalarUsesMap(x._homeScope, 'x')
        )
      ).toBe(false);
  });

  test('the entry of an operation is read before the entry of its parent', () => {
    const ce = engine();
    const g = { parent: null };
    const s1 = { parent: g };
    const s2 = { parent: s1 };
    const unit = new UnitEnvironment();
    unit.set(g, 'x', ce.type('number'));
    const operation = UnitEnvironment.forOperation({
      _kind: 'symbol',
      _env: unit,
    });
    operation.set(s1, 'x', ce.type('integer'));
    const child = UnitEnvironment.forOperation({
      _kind: 'symbol',
      _env: operation,
    });
    expect(child.lookup(s2, 'x')?.toString()).toBe('integer');
    expect(child.lookup(g, 'x')?.toString()).toBe('number');
  });

  test('subs(), replace() and match() read the units of their arguments', () => {
    const ce = engine();
    const expr = ce.box(['Tuple', 'x', 'y']);
    const value = ce.parse('w + 1');
    const rule = { match: ce.box('y'), replace: value };
    const pattern = ce.box(['Tuple', 'x', '_a']);
    const spy = jest.spyOn(ce, '_withOperation');
    try {
      expr.subs({ y: value });
      expr.replace([rule]);
      expr.match(pattern);
      const inputs = spy.mock.calls.map(([input]) => input);
      expect(inputs[0]).toEqual([expr, value]);
      expect(inputs).toContainEqual([expr, rule.match, value]);
      expect(inputs).toContainEqual([expr, pattern]);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('BINDING UNITS: PROGRAMS', () => {
  test('a program in the evaluation of a statement starts outside it', () => {
    const ce = engine();
    const state = ce._boxingState;
    const flags: boolean[] = [];
    ce._withProgramEnvironment(() =>
      state.asProgramStatement(() => {
        flags.push(state.inProgramStatement);
        ce._withProgramEnvironment(() => flags.push(state.inProgramStatement));
        flags.push(state.inProgramStatement);
      })
    );
    expect(flags).toEqual([true, false, true]);
  });

  test('a statement reads a requirement made while an earlier one ran', () => {
    const ce = engine();
    ce.declare('Require', {
      signature: '() -> integer',
      evaluate: (_ops, { engine }) => {
        engine.function('Add', [engine.box('w'), 1]);
        return engine.number(0);
      },
    });
    ce.declare('TypeOfW', {
      signature: '() -> string',
      evaluate: (_ops, { engine }) =>
        engine.string(engine.box('w').type.toString()),
    });
    const r = executeEpsil(ce, 'Require()\nTypeOfW()');
    expect((r.value as Expression).string).toBe('number');
    // The environment of the program is discarded when the run ends.
    expect(ce.box('w').type.toString()).toBe('unknown');
    expect(ce.lookupDefinition('w')).toBeUndefined();
  });
});
