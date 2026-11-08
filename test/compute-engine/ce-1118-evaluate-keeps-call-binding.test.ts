import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';

// CE-1118: the evaluation of a call keeps the function the call was boxed
// with, also when the current scope gives its name another definition
// (`docs/SCOPING-MODEL.md`, "Callable resolution"). An `evaluate` handler
// builds its unevaluated result by name (the `Sin` handler returns
// `Sin(x)` for a symbolic `x`), so the handler runs in a scope where the
// name denotes the binding of the call (`BoxedFunction._inOwnBinding()`).
// The call of a function that has no value is rebuilt with its own binding
// too (`applyFunctionLiteralWith()`).

/** Declare `name` as a function held as a value, and assign `fn` to it. */
function define(ce: ComputeEngine, name: string, fn: unknown): void {
  ce.declare(name, 'function');
  ce.assign(name, ce.box(fn as any));
}

/** The definition of the first call of `name` in `e`, depth first. */
function callDef(e: Expression, name: string): unknown {
  if (e.operator === name) return e.operatorDefinition ?? e.valueDefinition;
  for (const op of e.ops ?? []) {
    const def = callDef(op, name);
    if (def !== undefined) return def;
  }
  return undefined;
}

describe('CE-1118: evaluation keeps the binding of each call', () => {
  test('a library call evaluated in a scope with a user function of its name', () => {
    const ce = new ComputeEngine();
    const librarySin = ce.lookupDefinition('Sin')!.operator;
    const sum = ce.box(['Add', 'x', ['Sin', 'x']]);
    ce.pushScope();
    define(ce, 'Sin', ['Function', ['Add', 't', 100], 't']);
    const r = sum.evaluate();
    // The `Module` qualifier tells that the call is the library `Sin`.
    expect(r.json).toEqual(['Add', 'x', ['Apply', ['Module', 'Sin'], 'x']]);
    expect(callDef(r, 'Sin')).toBe(librarySin);
    expect(callDef(ce.box(['Sin', 'x']).evaluate(), 'Sin')).not.toBe(
      librarySin
    );
    ce.popScope();
    expect(r.subs({ x: 1 }).N().re).toBeCloseTo(1 + Math.sin(1), 12);
  });

  test('a product and a power of a library call', () => {
    const ce = new ComputeEngine();
    const librarySin = ce.lookupDefinition('Sin')!.operator;
    const prod = ce.box(['Multiply', 2, ['Sin', 'x']]);
    const pow = ce.box(['Power', ['Sin', 'x'], 2]);
    ce.pushScope();
    define(ce, 'Sin', ['Function', ['Add', 't', 100], 't']);
    const p = prod.evaluate();
    const q = pow.evaluate();
    expect(callDef(p, 'Sin')).toBe(librarySin);
    expect(callDef(q, 'Sin')).toBe(librarySin);
    ce.popScope();
    expect(p.subs({ x: 1 }).N().re).toBeCloseTo(2 * Math.sin(1), 12);
    expect(q.subs({ x: 1 }).N().re).toBeCloseTo(Math.sin(1) ** 2, 12);
  });

  test('a library call over an operand that is not pure', () => {
    // `Sin` is not lazy: its operand is evaluated before the handler runs,
    // so the handler still builds its result with the library binding.
    const ce = new ComputeEngine();
    const librarySin = ce.lookupDefinition('Sin')!.operator;
    const e = ce.box(['Sin', ['Add', 'x', ['Random']]]);
    ce.pushScope();
    define(ce, 'Sin', ['Function', ['Add', 't', 100], 't']);
    expect(callDef(e.evaluate(), 'Sin')).toBe(librarySin);
    ce.popScope();
  });

  test('the terms of a derivative evaluated in such a scope', () => {
    const ce = new ComputeEngine();
    const e = ce.box(['Multiply', 'x', ['Sin', 'x']]);
    ce.pushScope();
    define(ce, 'Sin', ['Function', ['Add', 't', 100], 't']);
    const d = ce.box(['D', e, 'x']).evaluate();
    ce.popScope();
    expect(d.subs({ x: 1 }).N().re).toBeCloseTo(
      Math.cos(1) + Math.sin(1),
      12
    );
  });

  test('a library Hold evaluated in a scope with a user Hold', () => {
    const ce = new ComputeEngine();
    const p = ce.box(['Hold', ['Add', 1, 2]]);
    ce.pushScope();
    ce.assign('Hold', ce.box(['Function', 0, 'a']));
    const v = p.evaluate();
    expect(v.json).toEqual(['Apply', ['Module', 'Hold'], ['Add', 1, 2]]);
    expect(v.evaluate().json).toEqual([
      'Apply',
      ['Module', 'Hold'],
      ['Add', 1, 2],
    ]);
    ce.popScope();
  });

  test('a user function with no value, evaluated after its scope', () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    ce.declare('Not', 'function');
    const userNot = ce.lookupDefinition('Not')!;
    const q = ce.box(['Apply', ['Module', 'Not'], ['Not', 'p']]);
    const call = ce.box(['Not', 'p']);
    ce.popScope();
    // The inner call is the user `Not`: the library `Not` does not fold
    // it away.
    expect(q.evaluate().json).toEqual(['Not', ['Not', 'p']]);
    expect(callDef(call.evaluate(), 'Not')).toBe(userNot.value);
  });

  test('a user function with no value whose library namesake folds', () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    ce.declare('Sqrt', 'function');
    const userSqrt = ce.lookupDefinition('Sqrt')!;
    const call = ce.box(['Sqrt', 4]);
    ce.popScope();
    // The library `Sqrt` would fold the rebuilt call to 2.
    const r = call.evaluate();
    expect(r.operator).toBe('Sqrt');
    expect(callDef(r, 'Sqrt')).toBe(userSqrt.value);
  });

  test('a user variable with the name of a library function', () => {
    // A variable cannot be applied, so it does not hide the library `D`
    // and `N`: their operands read the value of the variable.
    const ce = new ComputeEngine();
    ce.declare('D', 'real');
    ce.assign('D', 3);
    const d = ce
      .box(['D', ['Multiply', 'D', ['Power', 'x', 2]], 'x'])
      .evaluate();
    expect(d.json).toEqual(['Multiply', 6, 'x']);
    ce.declare('N', 'real');
    ce.assign('N', 85);
    expect(ce.box(['N', ['Divide', 'N', 3]]).evaluate().re).toBeCloseTo(
      85 / 3,
      12
    );
  });
});
