import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { copyCallerLowered } from '../../src/compute-engine/compilation/compile-cse';
import { CompilerState } from '../../src/compute-engine/compilation/compiler-state';
import type { Expression } from '../../src/compute-engine/global-types';

/**
 * A definition-level `compile` handler on `Which` is honored (Tycho item
 * 180). `Which` is the carve-out from the control-flow guard
 * (`OVERRIDABLE_CONTROL_FLOW_HEADS`, `base-compiler.ts`): it has no binding
 * structure, so a handler can compile its condition/value operands through
 * the callback it is given. The contract matches every other operator
 * `compile` handler — the handler takes precedence over the built-in
 * lowering, returning `undefined` falls back to it — and the override is
 * per-engine: it is attached to the engine's own definition, not a
 * process-global target table.
 *
 * The attach route is assignment onto the engine's own (stock) definition,
 * NOT `ce.declare('Which', {...})`: a re-declaration replaces the stock
 * `evaluate`/`canonical` handlers and breaks interpretation.
 */

function attachWhichHandler(
  ce: ComputeEngine,
  handler: (
    args: ReadonlyArray<unknown>,
    compileFn: (expr: unknown) => string
  ) => string | undefined
): void {
  const def = ce.lookupDefinition('Which');
  if (def && 'operator' in def) (def.operator as any).compile = handler;
}

describe('Which compile handler (Tycho item 180)', () => {
  test('the handler fires and its code is used', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    let fired = 0;
    attachWhichHandler(ce, (args, c) => {
      fired++;
      // A recognizable lowering: last-value fallback regardless of branches.
      return `(${c(args[args.length - 1])})`;
    });
    const e = ce.box(['Which', ['Less', 'x', 0], 1, 'True', 42]);
    const r = compile(e);
    expect(r.success).toBe(true);
    expect(fired).toBeGreaterThan(0);
    expect((r.run as any)({ x: -5 })).toBe(42);
  });

  test('stock evaluation semantics are untouched by the handler', () => {
    const ce = new ComputeEngine();
    attachWhichHandler(ce, () => '(999)');
    const e = ce.box(['Which', ['Less', 'x', 0], 1, 'True', 2]);
    expect(e.subs({ x: -1 }).evaluate().re).toBe(1);
    expect(e.subs({ x: 3 }).evaluate().re).toBe(2);
  });

  test('a declining handler falls back to the stock lowering', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    let fired = 0;
    attachWhichHandler(ce, () => {
      fired++;
      return undefined;
    });
    const e = ce.box(['Which', ['Less', 'x', 0], 1, 'True', 2]);
    const r = compile(e);
    expect(r.success).toBe(true);
    expect(fired).toBeGreaterThan(0);
    // Stock branch selection, not the handler's output.
    expect((r.run as any)({ x: -1 })).toBe(1);
    expect((r.run as any)({ x: 3 })).toBe(2);
  });

  test('the code of the handler is used when the stock branches have different shapes', () => {
    // The stock lowering declines `Which(x > 0, 0, True, [1, 2])`: its
    // branches are a number and a list. A handler that writes the code of
    // the node takes precedence, so the compilation uses that code. This
    // handler broadcasts the scalar branch to the length of the list.
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    attachWhichHandler(ce, (args, c) => {
      const scalar = c(args[1]);
      return `((${c(args[0])}) ? [${scalar}, ${scalar}] : (${c(args[3])}))`;
    });
    const e = ce.box(['Which', ['Greater', 'x', 0], 0, 'True', ['List', 1, 2]]);
    const r = compile(e);
    expect(r.success).toBe(true);
    expect((r.run as any)({ x: 1 })).toEqual([0, 0]);
    expect((r.run as any)({ x: -1 })).toEqual([1, 2]);
  });

  test('a declining handler keeps the shape check of the stock lowering', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    attachWhichHandler(ce, () => undefined);
    const e = ce.box(['Which', ['Greater', 'x', 0], 0, 'True', ['List', 1, 2]]);
    const r = compile(e, { fallback: true });
    expect(r.success).toBe(false);
    expect(r.diagnostic?.code).toBe('unsettled-shape');
  });

  test('a handler node of a type of several shapes declines under a stock consumer', () => {
    // The type of the `Which` stays `integer | list<integer>`: the stock
    // code of `Add` would decide the shape of its operand at run time.
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    attachWhichHandler(ce, (args, c) => {
      const scalar = c(args[1]);
      return `((${c(args[0])}) ? [${scalar}, ${scalar}] : (${c(args[3])}))`;
    });
    const e = ce.box([
      'Add',
      ['Which', ['Greater', 'x', 0], 0, 'True', ['List', 1, 2]],
      1,
    ]);
    const r = compile(e, { fallback: true });
    expect(r.success).toBe(false);
    expect(r.diagnostic?.code).toBe('unsettled-shape');
    expect(r.diagnostic?.message).toContain('`compile` handler');
  });

  test('a handler node of a type of one shape compiles under a stock consumer', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    attachWhichHandler(ce, (args, c) => `((${c(args[0])}) ? 10 : 20)`);
    const e = ce.box([
      'Add',
      ['Which', ['Greater', 'x', 0], 0, 'True', 5],
      1,
    ]);
    const r = compile(e);
    expect(r.success).toBe(true);
    expect((r.run as any)({ x: 1 })).toBe(11);
    expect((r.run as any)({ x: -1 })).toBe(21);
  });

  test('a handler node as the value of the root compiles', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    attachWhichHandler(ce, (args, c) => {
      const scalar = c(args[1]);
      return `((${c(args[0])}) ? [${scalar}, ${scalar}] : (${c(args[3])}))`;
    });
    const e = ce.box([
      'Block',
      ['Declare', 'a', "'unknown'", 'x'],
      ['Which', ['Greater', 'a', 0], 0, 'True', ['List', 1, 2]],
    ]);
    const r = compile(e);
    expect(r.success).toBe(true);
    expect((r.run as any)({ x: 1 })).toEqual([0, 0]);
    expect((r.run as any)({ x: -1 })).toEqual([1, 2]);
  });

  describe('a handler node that occurs more than once', () => {
    // The common-subexpression pass compiles one occurrence of the `Which`
    // and gives its code (the name of a temporary) to the others, which are
    // not compiled. Each occurrence is still a node whose code the handler
    // wrote, so the shape check of the stock lowering does not apply to it.
    const setup = (): ComputeEngine => {
      const ce = new ComputeEngine();
      ce.declare('x', 'real');
      // A handler that writes code only for a scalar branch beside a list
      // branch, and declines every other `Which`.
      attachWhichHandler(ce, (args: any, c) => {
        if (args.length !== 4) return undefined;
        const isList = (a: any) => a.operator === 'List';
        if (isList(args[1]) === isList(args[3])) return undefined;
        const [scalar, list] = isList(args[1])
          ? [args[3], args[1]]
          : [args[1], args[3]];
        const s = c(scalar);
        return `((${c(args[0])}) ? [${s}, ${s}] : (${c(list)}))`;
      });
      return ce;
    };
    const W = ['Which', ['Greater', 'x', 0], 0, 'True', ['List', 1, 2]];

    test('compiles when each occurrence is read by a handler of `At`', () => {
      const ce = setup();
      const def = ce.lookupDefinition('At');
      if (def && 'operator' in def)
        (def.operator as any).compile = (args: any, c: any) =>
          `(${c(args[0])})[(${c(args[1])}) - 1]`;
      const e = ce.box(['Add', ['At', W, 1], ['Multiply', 10, ['At', W, 2]]]);
      const r = compile(e);
      expect(r.success).toBe(true);
      expect((r.run as any)({ x: 1 })).toBe(0);
      expect((r.run as any)({ x: -1 })).toBe(21);
    });

    const attachAtHandler = (ce: ComputeEngine): void => {
      const def = ce.lookupDefinition('At');
      if (def && 'operator' in def)
        (def.operator as any).compile = (args: any, c: any) =>
          `(${c(args[0])})[(${c(args[1])}) - 1]`;
    };

    test('compiles when it occurs twice in the body of a Sum, as a loop invariant', () => {
      // The two occurrences do not depend on the index `k`: the loop
      // invariant pass compiles one and gives its code to the other.
      const ce = setup();
      attachAtHandler(ce);
      const e = ce.box([
        'Sum',
        ['Add', ['At', W, 1], ['Multiply', 10, ['At', W, 2]], 'k'],
        ['Limits', 'k', 1, 3],
      ]);
      const r = compile(e);
      expect(r.success).toBe(true);
      expect((r.run as any)({ x: 1 })).toBe(6);
      expect((r.run as any)({ x: -1 })).toBe(69);
    });

    test('compiles when it occurs once outside and once in a branch of an If', () => {
      // The occurrence in the branch reads the temporary that the
      // occurrence outside binds in the enclosing region
      // (`availableCseBinding()`).
      const ce = setup();
      attachAtHandler(ce);
      const e = ce.box([
        'Add',
        ['At', W, 1],
        ['If', ['Greater', 'x', 5], ['At', W, 2], 7],
      ]);
      const r = compile(e);
      expect(r.success).toBe(true);
      expect((r.run as any)({ x: -1 })).toBe(8);
      expect((r.run as any)({ x: 10 })).toBe(0);
    });

    test('declines when the stock code of `At` reads an occurrence', () => {
      // The type of the `Which` is `integer | vector<integer^2>`: the stock
      // code of `At` would decide the shape of its operand at run time.
      const ce = setup();
      const e = ce.box(['Add', ['At', W, 1], ['Multiply', 10, ['At', W, 2]]]);
      const r = compile(e, { fallback: true });
      expect(r.success).toBe(false);
      expect(r.diagnostic?.code).toBe('unsettled-shape');
      expect(r.diagnostic?.message).toContain('`compile` handler');
    });
  });

  test('a handler node whose missing value is the only other member compiles under a stock consumer', () => {
    // With no default clause, the type of the `Which` is `integer |
    // missing`: one shape.
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    attachWhichHandler(
      ce,
      (args, c) => `((${c(args[0])}) ? 1 : 2)`
    );
    const e = ce.box([
      'Add',
      ['Which', ['Greater', 'x', 0], 1, ['Less', 'x', 0], 2],
      1,
    ]);
    const r = compile(e);
    expect(r.success).toBe(true);
    expect((r.run as any)({ x: 1 })).toBe(2);
    expect((r.run as any)({ x: -1 })).toBe(3);
  });

  describe('a handler operator that is not a conditional', () => {
    const declareHostPair = (ce: ComputeEngine): void => {
      ce.declare('x', 'real');
      ce.declare('HostPair', {
        signature: '(real) -> real | list<real>',
        compile: (args, c) => `[${c(args[0])}, ${c(args[0])}]`,
      });
    };

    test('of a type of several shapes declines under a stock consumer', () => {
      const ce = new ComputeEngine();
      declareHostPair(ce);
      const e = ce.box(['Add', ['HostPair', 'x'], 1]);
      const r = compile(e, { fallback: true });
      expect(r.success).toBe(false);
      expect(r.diagnostic?.code).toBe('unsettled-shape');
      expect(r.diagnostic?.message).toContain('`compile` handler');
    });

    test('of a type of several shapes compiles at the root', () => {
      const ce = new ComputeEngine();
      declareHostPair(ce);
      const r = compile(ce.box(['HostPair', 'x']));
      expect(r.success).toBe(true);
      expect((r.run as any)({ x: 3 })).toEqual([3, 3]);
    });

    const declareHostValue = (ce: ComputeEngine): void => {
      ce.declare('x', 'real');
      ce.declare('HostValue', {
        signature: '(real) -> (broadcastable<real> | missing)',
        compile: (args, c) => `[${c(args[0])}]`,
      });
    };

    test('of a type broadcastable<real> | missing declines under a stock consumer', () => {
      const ce = new ComputeEngine();
      declareHostValue(ce);
      const e = ce.box(['Add', ['HostValue', 'x'], 1]);
      const r = compile(e, { fallback: true });
      expect(r.success).toBe(false);
      expect(r.diagnostic?.code).toBe('unsettled-shape');
      expect(r.diagnostic?.message).toContain('`compile` handler');
    });

    test('of a type broadcastable<real> | missing compiles at the root', () => {
      const ce = new ComputeEngine();
      declareHostValue(ce);
      const r = compile(ce.box(['HostValue', 'x']));
      expect(r.success).toBe(true);
      expect((r.run as any)({ x: 3 })).toEqual([3]);
    });

    test('of a type of several shapes in a case of a Match declines under a stock consumer', () => {
      // The case parts of a `Match` are made canonical again by the
      // admission, so they are checked by the operator of the handler.
      const ce = new ComputeEngine();
      ce.declare('x', 'real');
      ce.declare('H', {
        signature: '(real) -> (integer | list<integer>)',
        compile: () => `[1, 2]`,
      });
      const e = ce.box([
        'Add',
        ['Match', 'x', ['MatchCase', 1, ['H', 'x']], ['MatchCase', '_', 3]],
        1,
      ]);
      const r = compile(e, { fallback: true });
      expect(r.success).toBe(false);
      expect(r.diagnostic?.code).toBe('unsettled-shape');
      expect(r.diagnostic?.message).toContain('`compile` handler');
    });
  });

  test('the override is per-engine', () => {
    const a = new ComputeEngine();
    attachWhichHandler(a, () => '(777)');
    const b = new ComputeEngine();
    // `constantFold: false`: `Which(True, 5)` has no free variables, so
    // compile-time constant folding would emit `5` on both engines and the
    // per-engine handler under test would never run.
    const ra = compile(a.box(['Which', 'True', 5]), { constantFold: false });
    const rb = compile(b.box(['Which', 'True', 5]), { constantFold: false });
    expect((ra.run as any)({})).toBe(777);
    expect((rb.run as any)({})).toBe(5);
  });

  test('the other control-flow heads remain non-overridable', () => {
    const ce = new ComputeEngine();
    let fired = 0;
    const def = ce.lookupDefinition('Sum');
    if (def && 'operator' in def)
      (def.operator as any).compile = () => {
        fired++;
        return '(0)';
      };
    const e = ce.box([
      'Sum',
      ['Power', 'k', 2],
      ['Limits', 'k', 1, 3],
    ]);
    const r = compile(e);
    expect(r.success).toBe(true);
    expect(fired).toBe(0);
    expect((r.run as any)({})).toBe(14);
  });
});

describe('copyCallerLowered()', () => {
  // The records of the nodes whose code a caller's `compile` handler wrote
  // are copied from a compiled node to a node that is structurally the same
  // and gets the same code without being compiled.
  const withRecords = (
    records: Array<[Expression, boolean]>,
    fn: (lowered: Map<Expression, boolean>) => void
  ): void => {
    const saved = CompilerState._callerLowered;
    const lowered = new Map(records);
    CompilerState._callerLowered = lowered;
    try {
      fn(lowered);
    } finally {
      CompilerState._callerLowered = saved;
    }
  };

  test('walks a shared DAG once per pair of nodes', () => {
    // `e_k = e_(k-1) + e_(k-1)` with the same node object twice has about
    // `2^40` paths, and about 40 distinct nodes. A walk of the paths does
    // not end in practice: at depth 30 it took 46 s.
    const ce = new ComputeEngine();
    const dag = (): [Expression, Expression] => {
      const leaf = ce.box(['Add', 'x', 1]);
      let e = leaf;
      for (let k = 0; k < 40; k++) e = ce._fn('Add', [e, e]);
      return [e, leaf];
    };
    const [from, fromLeaf] = dag();
    const [to, toLeaf] = dag();
    withRecords([[fromLeaf, true]], (lowered) => {
      copyCallerLowered(from, to);
      expect(lowered.get(toLeaf)).toBe(true);
    });
  });

  test('does not replace a record false', () => {
    const ce = new ComputeEngine();
    const from = ce._fn('Sin', [ce.box(['Add', 'x', 1])]);
    const to = ce._fn('Sin', [ce.box(['Add', 'x', 1])]);
    // The two operands must be separate objects, or the test checks nothing.
    expect(from.ops![0]).not.toBe(to.ops![0]);
    withRecords(
      [
        [from.ops![0], true],
        [to.ops![0], false],
      ],
      (lowered) => {
        copyCallerLowered(from, to);
        expect(lowered.get(to.ops![0])).toBe(false);
      }
    );
  });

  test('copies nothing below a set literal whose elements are not ordered', () => {
    // `Set(a, b)` is the same as `Set(b, a)`: the operands at one position
    // are not the same node.
    const ce = new ComputeEngine();
    const a = ce._fn('Sin', [ce.symbol('x')]);
    const b = ce._fn('Cos', [ce.symbol('x')]);
    const from = ce._fn('Set', [a, b]);
    const to = ce._fn('Set', [ce._fn('Cos', [ce.symbol('x')]), ce._fn('Sin', [ce.symbol('x')])]);
    withRecords([[a, true]], (lowered) => {
      copyCallerLowered(from, to);
      expect(lowered.get(to.ops![0])).toBeUndefined();
      expect(lowered.get(to.ops![1])).toBeUndefined();
    });
  });

  test('copies nothing below nodes with different operators', () => {
    const ce = new ComputeEngine();
    const a = ce._fn('Sin', [ce.symbol('x')]);
    const from = ce._fn('List', [a]);
    const to = ce._fn('Tuple', [ce._fn('Sin', [ce.symbol('x')])]);
    withRecords([[a, true]], (lowered) => {
      copyCallerLowered(from, to);
      expect(lowered.get(to.ops![0])).toBeUndefined();
    });
  });
});
