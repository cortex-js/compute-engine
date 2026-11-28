/**
 * A function value given to a function of the host, and a dictionary
 * parameter, in compiled JavaScript (CE-1911; `docs/COMPILATION-MODEL.md`,
 * "Function values" and "Dictionary literals").
 *
 * The host function `hostApply(a, f)` records `Apply(f, 41)` (or the value
 * of `f` when it is not a function) and the first cell of the array `a`.
 * Each program runs on two engines, one compiled and one interpreted, and
 * the records of the host and the value of `k0` are compared.
 */

import { compile } from '../../src/compile';
import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import {
  isMutableArray,
  isSymbol,
} from '../../src/compute-engine/boxed-expression/type-guards';
import { executeEpsil } from '../../src/epsil';

const PRELUDE = `
let cells = arrayFrom([0, 0, 0, 0], "integer<0..255>")
type Box = tuple<cells: array<integer<0..255>>>
protocol Ops {
  function touch(self: Self) -> nothing
  function apply(self: Self, f: any) -> nothing
  function compute(self: Self, f: any) -> integer
}
type Box is Ops {
  function touch(self: Box) -> nothing { hostApply(self.cells, 0) }
  function apply(self: Box, f: any) -> nothing { hostApply(self.cells, f) }
  function compute(self: Box, f: any) -> integer { hostCount(self.cells, f) }
}
let box = Box(cells)
let inc = (i: integer) => i + 1
let dec = (i: integer) => i - 1
let k0 = 5
let addK = (i: integer) => i + k0
function passOn(f: any) -> nothing { hostApply(cells, f) }
function callsF(f: any) { f(3) }
function withOpts(n: integer, opts: dictionary = {->}) { n + 1 }
function styled(n: integer, opts: dictionary = {->}) -> nothing { hostApply(cells, opts) }
function pick(d: dictionary) { d.a }
let withOptsL = (n: integer, opts: dictionary = {->}) => n + 1
let addTwo = (n: integer, k: integer = 2) => n + k
const c0 = 7
let addC0 = (n: integer, k: integer = c0) => n + k
`;

function engine(program: string) {
  const ce = new ComputeEngine();
  const calls: string[] = [];
  ce.declare('hostApply', {
    signature: '(any, any) -> nothing',
    pure: false,
    evaluate: (ops: ReadonlyArray<Expression>) => {
      const [a, f] = ops;
      const first = isMutableArray(a) ? (a.cells as ArrayLike<number>)[0] : '?';
      const v =
        f.operator === 'Function' || isSymbol(f)
          ? ce.expr(['Apply', f, 41]).evaluate().json
          : f.json;
      calls.push(`${JSON.stringify(v)}@${first}`);
      return ce.Nothing;
    },
  });
  // `hostCount(a, f)`: `f(7)`, an integer, as Tycho's
  // `figureComputeRaster` gives the number of pixels.
  ce.declare('hostCount', {
    signature: '(any, any) -> integer',
    pure: false,
    evaluate: (ops: ReadonlyArray<Expression>) =>
      ce.expr(['Apply', ops[1], 7]).evaluate(),
  });
  const result = executeEpsil(ce, PRELUDE + program);
  const errors = result.diagnostics.filter((d) => d.severity === 'error');
  if (errors.length > 0) throw new Error(errors.map((d) => d.message).join());
  return { ce, calls };
}

/** The records of the host and the value of `k0` after a call of `frame`
 *  at 3, compiled and interpreted. */
function both(program: string) {
  const a = engine(program);
  const r = compile(a.ce.expr('frame').evaluate(), {
    to: 'javascript',
    fallback: false,
  });
  expect(r.success).toBe(true);
  const value = (r.run as (t: number) => unknown)(3);
  const b = engine(program);
  const expected = b.ce.expr(['frame', 3]).evaluate();
  return {
    compiled: { calls: a.calls, k0: a.ce.expr('k0').evaluate().json, value },
    interpreted: {
      calls: b.calls,
      k0: b.ce.expr('k0').evaluate().json,
      value: expected.json,
    },
  };
}

function declined(program: string): string {
  const { ce } = engine(program);
  const r = compile(ce.expr('frame').evaluate(), { to: 'javascript' });
  expect(r.success).toBe(false);
  return r.diagnostic?.message ?? '';
}

describe('A FUNCTION VALUE GIVEN TO A FUNCTION OF THE HOST', () => {
  test.each([
    ['a name bound to a function', 'hostApply(cells, inc)', ['42@0']],
    ['a function literal', 'hostApply(cells, (i: integer) => 2i)', ['82@0']],
    ['through a protocol method', 'box.apply(inc)', ['42@0']],
    ['through a user function', 'passOn(addK)', ['46@0']],
  ])('%s', (_, call, calls) => {
    const { compiled, interpreted } = both(
      `let frame = (t: integer) => ${call}`
    );
    expect(compiled.calls).toEqual(calls);
    expect(compiled.calls).toEqual(interpreted.calls);
  });

  test('through a method whose host function gives an integer', () => {
    const { compiled, interpreted } = both(
      `let frame = (t: integer) => do { let n = 0; for k in 1..3 { n = n + box.compute(addK) }; n }`
    );
    expect(compiled.value).toBe(36);
    expect(compiled.value).toBe(interpreted.value);
  });

  test('two function values through one method are two values', () => {
    const { compiled, interpreted } = both(
      `let frame = (t: integer) => do { box.apply(inc); box.apply(dec); 0 }`
    );
    expect(compiled.calls).toEqual(['42@0', '40@0']);
    expect(compiled.calls).toEqual(interpreted.calls);
  });

  test('in a loop and in a condition', () => {
    const { compiled, interpreted } = both(
      `let frame = (t: integer) => do { for k in 1..4 { box.cells[k] = k; if t > 2 { box.apply(inc) } }; 0 }`
    );
    expect(compiled.calls).toEqual(['42@1', '42@1', '42@1', '42@1']);
    expect(compiled).toEqual(interpreted);
  });

  test('a name of the engine that the function reads is read at the call', () => {
    const { compiled, interpreted } = both(
      `let frame = (t: integer) => do { k0 = t; hostApply(cells, addK); k0 }`
    );
    expect(compiled.calls).toEqual(['44@0']);
    expect(compiled).toEqual(interpreted);
  });

  test('a literal that reads a parameter of the compiled function declines', () => {
    expect(
      declined(`let frame = (t: integer) => box.apply((i: integer) => i + t)`)
    ).toMatch(/reads t, a name of the compiled code/);
  });

  test('a function literal through a protocol method', () => {
    const { compiled, interpreted } = both(
      `let frame = (t: integer) => box.apply((i: integer) => 2i)`
    );
    expect(compiled.calls).toEqual(['82@0']);
    expect(compiled.calls).toEqual(interpreted.calls);
    expect(
      declined(`let frame = (t: integer) => box.apply((i: integer) => i + t)`)
    ).toMatch(/reads t, a name of the compiled code/);
  });

  test('a function value that reads an input of the compilation declines', () => {
    // `u` has no value: only the compiled code holds it, from `run()`.
    const ce = new ComputeEngine();
    ce.declare('applyAt', {
      signature: '(any, real) -> real',
      evaluate: ([f, x]) => ce.expr(['Apply', f, x]).evaluate(),
    });
    ce.declare('u', 'real');
    ce.assign('addU', ce.parse('t \\mapsto t + u'));
    // `g` is a function input: declared, with no value.
    ce.declare('g', '(integer) -> integer');
    for (const f of [
      ['Function', ['Add', 't', 'u'], 't'],
      'addU',
      // A binder of the name `u` does not hide the input `u`.
      ['Function', ['Add', 'u', ['Sum', 'u', ['Limits', 'u', 1, 3]]], 't'],
      ['Function', ['g', 't'], 't'],
    ]) {
      const r = compile(ce.expr(['applyAt', f, 1]), { to: 'javascript' });
      expect(r.success).toBe(false);
      expect(r.diagnostic?.message).toMatch(/reads [ug]/);
    }
  });

  test('a literal that calls or assigns a name of the compiled code declines', () => {
    expect(
      declined(
        `function wrap(f: any) -> nothing { hostApply(cells, (i: integer) => f(i)) }
let frame = (t: integer) => wrap(inc)`
      )
    ).toMatch(/reads f/);
    expect(
      declined(
        `let frame = (t: integer) => hostApply(cells, (i: integer) => do { t = t + i; t })`
      )
    ).toMatch(/reads t/);
  });

  test('a literal that reads t in a dictionary declines', () => {
    expect(
      declined(
        `let frame = (t: integer) => hostApply(cells, (i: integer) => {v -> t})`
      )
    ).toMatch(/reads t, a name of the compiled code/);
  });

  test('a literal that reads a variable of the engine that the code assigns', () => {
    const { compiled, interpreted } = both(
      `let frame = (t: integer) => do { k0 = t; hostApply(cells, (i: integer) => i + k0); k0 }`
    );
    expect(compiled.calls).toEqual(['44@0']);
    expect(compiled).toEqual(interpreted);
  });

  test('a call of the parameter that holds the function value declines', () => {
    expect(declined(`let frame = (t: integer) => callsF(inc)`)).not.toBe('');
  });
});

describe('A DICTIONARY PARAMETER', () => {
  test.each([
    ['its default', 'withOpts(t)'],
    ['a dictionary literal', 'withOpts(t, {smooth -> true})'],
  ])('compiles with %s', (_, call) => {
    const { compiled, interpreted } = both(
      `let frame = (t: integer) => ${call}`
    );
    expect(compiled.value).toBe(4);
    expect(interpreted.value).toBe(4);
  });

  test.each([
    ['a dictionary default', 'withOptsL(t)', 4],
    ['an integer default', 'addTwo(t)', 5],
    ['an argument for the default', 'addTwo(t, 10)', 13],
  ])(
    'a function literal bound to a name, with %s, compiles',
    (_, call, value) => {
      const { compiled, interpreted } = both(
        `let frame = (t: integer) => ${call}`
      );
      expect(compiled.value).toBe(value);
      expect(interpreted.value).toBe(value);
    }
  );

  test('a default of a function literal that is a name of the program declines', () => {
    expect(declined('let frame = (t: integer) => addC0(t)')).toMatch(
      /addC0 with 1 arguments/
    );
  });

  test('passes the dictionary on to the host', () => {
    for (const [call, seen] of [
      ['styled(t)', '{"dict":{}}@0'],
      ['styled(t, {smooth -> true})', '{"dict":{"smooth":true}}@0'],
    ]) {
      const { compiled, interpreted } = both(
        `let frame = (t: integer) => ${call}`
      );
      expect(compiled.calls).toEqual([seen]);
      expect(compiled.calls).toEqual(interpreted.calls);
    }
  });

  test('reads a field of a dictionary literal', () => {
    const { compiled, interpreted } = both(
      `let frame = (t: integer) => pick({a -> t})`
    );
    expect(compiled.value).toBe(3);
    expect(compiled.value).toBe(interpreted.value);
  });

  test('a held value of a record type there gives the interpreter value', () => {
    const run = (compiled: boolean) => {
      const { ce } = engine('let frame = (t: integer) => pick(rv)');
      ce.declare('rv', 'record{a: integer}');
      ce.assign('rv', ce.expr(['Dictionary', ['Tuple', { str: 'a' }, 1]]));
      if (!compiled) return ce.expr(['frame', 3]).evaluate().json;
      const r = compile(ce.expr('frame').evaluate(), { to: 'javascript' });
      expect(r.success).toBe(true);
      return (r.run as (t: number) => unknown)(3);
    };
    expect(run(true)).toBe(1);
    expect(run(false)).toBe(1);
  });
});
