/**
 * A block local declared with a list type that no later statement writes
 * compiles on JavaScript (CE-1922; `compilation/ir/README.md`, "Blocks"): it
 * is a local of no stated type whose value must be of the stated type, and a
 * `List()` in the value takes the lane of its place in the stated type
 * (CE-1918). Each program is compiled and run, and its value is compared
 * with the interpreter's.
 */

import { compile } from '../../src/compile';
import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil';

/** An engine in which `let frame = (t: real) => <body>` ran. */
function engine(body: string): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('t', 'real');
  const errors = executeEpsil(
    ce,
    `let frame = (t: real) => ${body}`
  ).diagnostics.filter((d) => d.severity === 'error');
  if (errors.length > 0) throw new Error(JSON.stringify(errors[0].message));
  return ce;
}

/** `frame(t)` compiled to JavaScript with no fallback (a decline throws). */
function compiled(ce: ComputeEngine): any {
  return compile(ce.box(['frame', 't']) as any, {
    to: 'javascript',
    fallback: false,
  } as any);
}

/** The interpreter's value of `frame(t)`: a number or an array of them. */
function interpreted(ce: ComputeEngine, t: number): unknown {
  const json = ce.box(['frame', t]).evaluate().json;
  if (Array.isArray(json) && json[0] === 'List') return json.slice(1);
  return ce.box(['frame', t]).evaluate().re;
}

describe('a local of a stated list type that no statement writes', () => {
  test.each([
    // The cases of the issue.
    'do { let b: list<real> = [1]; length(b) + t }',
    'do { let b: list<real> = []; length(b) + t }',
    'do { let b: list<string> = ["x"]; length(b) + t }',
    // Other element types and reads.
    'do { let b: list<string> = []; length(b) + t }',
    'do { let b: list<real> = [1, 2.5]; sum(b) + t }',
    'do { let b: list<integer> = [1, 2]; sum(b) + t }',
    'do { let b: list<real> = []; sum(b) + t }',
    'do { let b: list<real> = [t, 2]; b[1] * b[2] }',
    'do { let b: list<list<real>> = [[1, 2], [3, 4]]; length(b) + t }',
    'do { let b: list = [1]; length(b) + t }',
    'do { const b: list<real> = [1]; length(b) + t }',
    'do { let b: list<real> = 1..3; sum(b) + t }',
    // The local as the value of the block.
    'do { let b: list<real> = [t, 2]; b }',
    'do { let b: list<real> = []; [...b, t] }',
  ])('%s', (body) => {
    const ce = engine(body);
    const f = compiled(ce);
    for (const t of [1, -0.5]) expect(f.run({ t })).toEqual(interpreted(ce, t));
  });

  test.each(['glsl', 'interval-js'])(
    'on %s, the stated type gives the code of no stated type',
    (to) => {
      const code = (body: string) =>
        (
          compile(engine(body).box(['frame', 't']) as any, {
            to,
            fallback: false,
          } as any) as any
        ).code;
      expect(code('do { let b: list<real> = [t, 2]; b[1] * b[2] }')).toBe(
        code('do { let b = [t, 2]; b[1] * b[2] }')
      );
      // An empty list declines there, with or without the stated type.
      expect(() =>
        code('do { let b: list<real> = []; length(b) + t }')
      ).toThrow(/an empty list/);
    }
  );

  test('a value that is not of the stated type declines', () => {
    // The interpreter gives an `incompatible-type` error.
    const ce = engine('do { let b: list<integer> = [1.5]; sum(b) + t }');
    expect(() => compiled(ce)).toThrow(
      /a value of type .* for a local declared list<integer>/
    );
  });
});
