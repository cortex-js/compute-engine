/**
 * CE-1917: a protocol method that a compiled root function literal calls
 * reads and writes the variables of the engine that the literal assigns, as
 * a user function does (CE-1776). The scan of the called functions visits the
 * body of each implementation that the call can select, so a method whose
 * body calls a function of the host (Tycho's `board.compute(next)`) takes and
 * returns those variables.
 */

import { compile } from '../../src/compile';
import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil';

type Run = (...args: unknown[]) => unknown;

/** A program with the method `touch` of `Ops` implemented by `impl` on
 *  `Box` and by `pt` on `Pt`, and the root `tick`. `calls` counts the
 *  calls of the host function `hostTouch`. */
function engine(
  impl: string,
  tick: string,
  result = 'integer',
  pt = `function touch(self: Pt) -> ${result} { names = ["b"]; ${result === 'nothing' ? 'Nothing' : '1'} }`
) {
  const ce = new ComputeEngine();
  const host = { calls: 0 };
  ce.declare('hostTouch', {
    signature: '(any) -> nothing',
    pure: false,
    evaluate: () => {
      host.calls += 1;
      return ce.Nothing;
    },
  });
  const program = executeEpsil(
    ce,
    `let cells = arrayFrom([0, 0, 0, 0], "integer<0..255>")
type Box = tuple<cells: array<integer<0..255>>>
type Pt = tuple<x: real, y: real>
let gen: integer = 0
let names: list<string> = ["a"]
protocol Ops { function touch(self: Self) -> ${result} }
type Box is Ops { ${impl} }
type Pt is Ops { ${pt} }
let box = Box(cells)
let tick = ${tick}`
  );
  const errors = program.diagnostics.filter((d) => d.severity === 'error');
  if (errors.length > 0) throw new Error(errors.map((d) => d.message).join());
  return { ce, host };
}

/** The values of `tick(2)` and `tick(3)`, then the value of `gen` and the
 *  number of calls of the host, from the code and from the interpreter,
 *  each on a new engine. */
function both(impl: string, tick: string, result?: string) {
  const a = engine(impl, tick, result);
  const compiled = compile(a.ce.box('tick').evaluate(), {
    to: 'javascript',
    fallback: false,
  });
  expect(compiled.assigns).toEqual(['gen']);
  const run = compiled.run as Run;
  const code = [run(2), run(3), a.ce.box('gen').evaluate().re, a.host.calls];
  const b = engine(impl, tick, result);
  const interpreted = [
    b.ce.box(['tick', 2]).evaluate().re,
    b.ce.box(['tick', 3]).evaluate().re,
    b.ce.box('gen').evaluate().re,
    b.host.calls,
  ];
  return { code, interpreted };
}

const HOST = `function touch(self: Box) -> nothing { hostTouch(self.cells) }`;

describe('a protocol method in a function that assigns a variable of the engine', () => {
  test('the witness: a method that calls the host', () => {
    const { code, interpreted } = both(
      HOST,
      '(t: integer) => do { gen = gen + 1; box.touch(); gen }',
      'nothing'
    );
    expect(code).toEqual([1, 2, 2, 2]);
    expect(code).toEqual(interpreted);
  });

  test('two calls of the method, with a write between them', () => {
    const { code, interpreted } = both(
      HOST,
      '(t: integer) => do { gen = gen + 1; box.touch(); gen = gen + t; box.touch(); gen }',
      'nothing'
    );
    expect(code).toEqual([3, 7, 7, 4]);
    expect(code).toEqual(interpreted);
  });

  test('a method that reads the variable', () => {
    const { code, interpreted } = both(
      'function touch(self: Box) -> integer { gen * 10 }',
      '(t: integer) => do { gen = gen + 1; box.touch() + gen }'
    );
    expect(code).toEqual([11, 22, 2, 0]);
    expect(code).toEqual(interpreted);
  });

  test('a method that writes the variable', () => {
    const { code, interpreted } = both(
      'function touch(self: Box) -> integer { gen = gen + 5; 0 }',
      '(t: integer) => do { gen = gen + 1; box.touch(); gen }'
    );
    expect(code).toEqual([6, 12, 12, 0]);
    expect(code).toEqual(interpreted);
  });

  test('a method in a loop that carries the variable', () => {
    const { code, interpreted } = both(
      'function touch(self: Box) -> integer { hostTouch(self.cells); gen * 2 }',
      '(t: integer) => do { for i in 1..t { gen = gen + box.touch() + 1 }; gen }'
    );
    expect(code).toEqual(interpreted);
  });

  test('a lazy collection whose callback reads the variable through a method', () => {
    // The interpreter keeps the view lazy and computes each element when it
    // is read, as for a plain user function (CE-1776). The callback reads
    // no variable of the engine itself (`Pt(i, i)`, not `box`).
    const { ce } = engine(
      'function touch(self: Box) -> integer { 0 }',
      '(t: integer) => do { let L = map((i) => Pt(i, i).touch(), [1, 2]); gen = gen + 1; L[1] }',
      'integer',
      'function touch(self: Pt) -> integer { gen * 10 }'
    );
    const result = compile(ce.box('tick').evaluate(), { to: 'javascript' });
    expect(result.success).toBe(false);
    expect(result.diagnostic?.message).toMatch(
      'a lazy collection whose callback reads a variable of the engine through a user function'
    );
  });

  test('the implementation of another type is not scanned', () => {
    // `Pt`'s `touch` assigns a list of strings, which a compiled function
    // cannot assign: a call on a `Box` does not reach it.
    const { code, interpreted } = both(
      'function touch(self: Box) -> integer { hostTouch(self.cells); gen * 2 }',
      '(t: integer) => do { gen = gen + 1; box.touch() + gen }'
    );
    expect(code).toEqual([3, 6, 2, 2]);
    expect(code).toEqual(interpreted);
  });
});
