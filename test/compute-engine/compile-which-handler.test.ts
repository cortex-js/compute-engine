import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

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
      ['Assign', 'a', 'x'],
      ['Which', ['Greater', 'a', 0], 0, 'True', ['List', 1, 2]],
    ]);
    const r = compile(e);
    expect(r.success).toBe(true);
    expect((r.run as any)({ x: 1 })).toEqual([0, 0]);
    expect((r.run as any)({ x: -1 })).toEqual([1, 2]);
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
