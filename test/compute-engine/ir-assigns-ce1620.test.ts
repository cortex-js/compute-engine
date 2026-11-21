/**
 * CE-1620: a root function literal that assigns a variable of the engine
 * (the state of an animation, `s = s + t / 1000`) compiles to JavaScript.
 *
 * The variable is a local of the code whose value is a parameter after the
 * arguments; the code returns the value of the body and the new value of
 * each variable (`CompilationResult.assigns`). `run()` reads the values in
 * the engine at each call and writes the new values back, as an evaluation
 * of the call does.
 */

import { compile } from '../../src/compile';
import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil';
import { createJavaScriptRuntime } from '../../src/runtime';
import { implicitCompile } from '../../src/compute-engine/implicit-compile';
import type { Expression } from '../../src/compute-engine/global-types';

type Run = (...args: unknown[]) => unknown;

function engine(source: string): ComputeEngine {
  const ce = new ComputeEngine();
  const program = executeEpsil(ce, source);
  const errors = program.diagnostics.filter((d) => d.severity === 'error');
  if (errors.length > 0) throw new Error(errors.map((d) => d.message).join());
  return ce;
}

const fn = (ce: ComputeEngine, name: string): Expression =>
  ce.box(name).evaluate();

const valueOf = (ce: ComputeEngine, name: string) =>
  ce.box(name).evaluate().json;

function compiled(e: Expression) {
  const result = compile(e, { to: 'javascript', fallback: false });
  expect(result.success).toBe(true);
  return { result, run: result.run as Run };
}

function declined(e: Expression, options: object = {}): string {
  const result = compile(e, { to: 'javascript', ...options });
  expect(result.success).toBe(false);
  return result.diagnostic?.message ?? '';
}

describe('a function that assigns a variable of the engine', () => {
  const SOURCE = `let c = 0
let s = 0.5
let on = false
let bump = (t: real) => do { c = c + 1 }
let advance = (t: real) => do { s = s + t / 1000 }
let pure = (t: real) => s + t / 1000`;

  test('the witness: three ticks write the state to the engine', () => {
    const ce = engine(SOURCE);
    const { result, run } = compiled(fn(ce, 'advance'));
    expect(result.assigns).toEqual(['s']);
    expect(result.shippable).toBe(false);
    for (let k = 0; k < 3; k++) run(16);
    expect(valueOf(ce, 's')).toBeCloseTo(0.548, 15);
    const bump = compiled(fn(ce, 'bump')).run;
    // The value of a body that ends in an assignment is `Nothing`: NaN.
    expect(bump(16)).toBeNaN();
    bump(16);
    bump(16);
    expect(valueOf(ce, 'c')).toBe(3);
  });

  test('the interpreter gives the same values', () => {
    const ce = engine(SOURCE);
    for (let k = 0; k < 3; k++) ce.box(['advance', 16]).evaluate();
    for (let k = 0; k < 3; k++) ce.box(['bump', 16]).evaluate();
    expect(valueOf(ce, 's')).toBeCloseTo(0.548, 15);
    expect(valueOf(ce, 'c')).toBe(3);
  });

  test('each call reads the value that the engine holds', () => {
    const ce = engine(SOURCE);
    const { run } = compiled(fn(ce, 'bump'));
    run(0);
    ce.assign('c', 10);
    run(0);
    expect(valueOf(ce, 'c')).toBe(11);
    // An interpreted call between two compiled calls.
    ce.box(['bump', 0]).evaluate();
    run(0);
    expect(valueOf(ce, 'c')).toBe(13);
  });

  test('the value of the body reads the state', () => {
    const ce = engine(`let s = 1
let f = (t: real) => do { let k = s; s = s + t; k * 10 + s }
let g = (t: real) => do { if t > 0 { s = s + 1 } else { s = s - 1 }; s }
let h = (t: real) => do { s += t; sqrt(s) }`);
    const f = compiled(fn(ce, 'f')).run;
    // k = 1, s = 3: 10 + 3.
    expect(f(2)).toBe(13);
    expect(valueOf(ce, 's')).toBe(3);
    const g = compiled(fn(ce, 'g')).run;
    expect(g(1)).toBe(4);
    expect(g(-1)).toBe(3);
    const h = compiled(fn(ce, 'h')).run;
    expect(h(1)).toBe(2);
    expect(valueOf(ce, 's')).toBe(4);
  });

  test('a loop that assigns the state', () => {
    const ce = engine(`let s = 0
let f = (t: real) => do { for i in 1..3 { s = s + i * t }; s }`);
    const { run } = compiled(fn(ce, 'f'));
    expect(run(2)).toBe(12);
    expect(run(1)).toBe(18);
    ce.assign('s', 0);
    ce.box(['f', 2]).evaluate();
    expect(valueOf(ce, 's')).toBe(12);
  });

  test('a boolean and an integer state', () => {
    const ce = engine(SOURCE);
    const toggle = ce.box([
      'Function',
      ['Block', ['Assign', 'on', ['Not', 'on']]],
      't',
    ]);
    const { result, run } = compiled(toggle);
    expect(result.assigns).toEqual(['on']);
    run(0);
    expect(valueOf(ce, 'on')).toBe('True');
    run(0);
    expect(valueOf(ce, 'on')).toBe('False');
    ce.declare('n', 'integer');
    ce.assign('n', 2);
    const count = ce.box(['Function', ['Block', ['AddTo', 'n', 1], 'n'], 't']);
    expect(compiled(count).run(0)).toBe(3);
    expect(valueOf(ce, 'n')).toBe(3);
    // A real value for an integer variable: the interpreter refuses it.
    expect(
      declined(
        ce.box(['Function', ['Block', ['Assign', 'n', ['Add', 'n', 0.5]]], 't'])
      )
    ).toMatch('a value that is not integer');
  });

  test('a local or a parameter of the same name is not the state', () => {
    const ce = engine(`let s = 0.5
let f = (t: real) => do { let s = 1; s = s + t; s }`);
    const { result, run } = compiled(fn(ce, 'f'));
    expect(result.assigns).toBeUndefined();
    expect(run(2)).toBe(3);
    expect(valueOf(ce, 's')).toBe(0.5);
  });

  test('the code takes the state after the arguments', () => {
    const ce = engine(SOURCE);
    const { result } = compiled(fn(ce, 'advance'));
    const load = createJavaScriptRuntime().load({ ...result }) as Run;
    expect(load(16, 0.5)).toEqual([NaN, 0.516]);
    // The engine is not read or written by the loaded code.
    expect(valueOf(ce, 's')).toBe(0.5);
  });

  test('a call that throws writes nothing', () => {
    const ce = engine(`let s = 0
let f = (t: real) => do { for i in 1..t { s = s + 1 }; s }`);
    const { run } = compiled(fn(ce, 'f'));
    expect(run(3)).toBe(3);
    // The code refuses a loop of more than 2^32 passes.
    expect(() => run(1e10)).toThrow(RangeError);
    expect(valueOf(ce, 's')).toBe(3);
  });

  test('an exact value of the variable is read as its machine number', () => {
    const ce = engine(`let theta = 0
let spin = (t: real) => do { theta = theta + pi / 30; theta }`);
    const { run } = compiled(fn(ce, 'spin'));
    // An interpreted call writes the exact value `1/30 * pi`.
    ce.box(['spin', 1]).evaluate();
    expect(run(1)).toBeCloseTo(Math.PI / 15, 15);
    expect(ce.box('theta').evaluate().re).toBeCloseTo(Math.PI / 15, 15);
  });

  test('an input of the host that the function assigns declines', () => {
    const ce = engine(SOURCE);
    for (const options of [
      { vars: { s: 's' } },
      { symbolic: ['s'] },
      { inputs: { s: 'real' } },
    ])
      expect(declined(fn(ce, 'advance'), options)).toMatch(
        'an assignment of s, a name with no value at the compilation, or an input'
      );
  });

  test('a variable with no value throws before the call', () => {
    const ce = engine(SOURCE);
    const { run } = compiled(fn(ce, 'advance'));
    ce.assign('s', undefined);
    expect(() => run(16)).toThrow(
      'The variable "s" that the compiled function assigns holds no value'
    );
  });

  test('a read of the state by a function that the body calls declines', () => {
    const ce = engine(`let s = 0.5
let get = () => s
let f = (t: real) => do { s = s + 1; get() }`);
    expect(declined(fn(ce, 'f'))).toMatch(
      'a call of get, which reads the input s'
    );
    // The stored value is back after the compilation.
    expect(valueOf(ce, 's')).toBe(0.5);
    expect(ce.box(['f', 0]).evaluate().json).toBe(1.5);
  });

  test('a variable whose type is inferred from its value declines', () => {
    const ce = new ComputeEngine();
    ce.assign('u', 1);
    const f = ce.box([
      'Function',
      ['Block', ['Assign', 'u', ['Add', 'u', 't']]],
      't',
    ]);
    expect(declined(f)).toMatch(
      'an assignment of u, whose type is inferred from its value: declare its type'
    );
  });

  test('another target declines', () => {
    const ce = engine(SOURCE);
    expect(declined(fn(ce, 'advance'), { to: 'glsl' })).toMatch(
      'an assignment of s, a variable of the engine, on this target'
    );
    expect(declined(fn(ce, 'advance'), { mode: 'bigint' })).toMatch(
      'an assignment of s'
    );
  });

  test('an expression that assigns a variable still declines', () => {
    const ce = engine(SOURCE);
    expect(
      declined(ce.box(['Block', ['Assign', 's', ['Add', 's', 1]]]))
    ).toMatch('a write to a name that is not a local');
  });

  test('a function that reads the state only is unchanged', () => {
    const ce = engine(SOURCE);
    const { result, run } = compiled(fn(ce, 'pure'));
    expect(result.assigns).toBeUndefined();
    expect(run(16)).toBe(0.516);
  });

  test('an implicit compilation of a function that assigns declines', () => {
    const ce = engine(`let s = 0
let f = (x: real) => do { s = s + x; s }`);
    // A caller such as the Map drain can compute an element again with the
    // interpreter, which would assign `s` a second time.
    expect(implicitCompile(ce, fn(ce, 'f'), 'map')).toBeUndefined();
    expect(executeEpsil(ce, 'listFrom(map(f, [1, 2, 3]))').value.json).toEqual([
      'List',
      1,
      3,
      6,
    ]);
    expect(valueOf(ce, 's')).toBe(6);
  });
});
