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

  test('the override is per-engine', () => {
    const a = new ComputeEngine();
    attachWhichHandler(a, () => '(777)');
    const b = new ComputeEngine();
    const ra = compile(a.box(['Which', 'True', 5]));
    const rb = compile(b.box(['Which', 'True', 5]));
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
