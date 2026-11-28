/**
 * CE-1923: a test of a list type (`v is list<real>`) of a parameter of type
 * `any` that holds a flat list of numbers, in compiled JavaScript. The test
 * is decided by the type of the elements that the static type of the
 * argument proves, or that the static type of the value of a key of a
 * dictionary literal proves (`listProof()` of `lower-functions.ts`). Where
 * nothing proves it (`[t / 0, 1]`, whose first element is
 * `ComplexInfinity` in the interpreter), the compilation declines.
 *
 * Each program is compiled and run, and its value is compared with the
 * interpreter's.
 */

import { compile } from '../../src/compile';
import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil';

const PRELUDE = `
function isReals(v: any) -> real { if v is list<real> { 1 } else { 2 } }
function isInts(v: any) -> real { if v is list<integer> { 1 } else { 2 } }
function isText(v: any) -> real { if v is string { 1 } else { 2 } }
function forward(v: any) -> real { isInts(v) }
function dash(opts: dictionary = {->}) -> real { isReals(opts["dash"]) }
function option(acc: real, k: string, v: any) -> real {
  if k == "dash" && (v is nothing || v is list<real>) {
    acc + length(v)
  } else if k == "width" && (v is nothing || v is real) {
    acc + 10
  } else {
    acc + 100
  }
}
function styled(n: real, opts: dictionary) -> real {
  let s = n
  for k in keys(opts) { s = option(s, k, opts[k]) }
  s
}
`;

function run(
  program: string,
  t = 3
): { compiled?: unknown; error?: string; expected: unknown } {
  const ce = new ComputeEngine();
  const diags = [
    ...executeEpsil(ce, PRELUDE).diagnostics,
    ...executeEpsil(ce, `let frame = (t: real) => ${program}`).diagnostics,
  ].filter((d) => d.severity === 'error');
  if (diags.length > 0) throw new Error(diags.map((d) => d.message).join('; '));
  const expected = ce.expr(['frame', t]).evaluate().json;
  try {
    const r = compile(ce.expr('frame').evaluate(), {
      to: 'javascript',
      fallback: false,
    } as any) as any;
    return { compiled: r.run(t), expected };
  } catch (e) {
    return { error: (e as Error).message.split('\n')[0], expected };
  }
}

function same(program: string, t = 3) {
  const r = run(program, t);
  expect(r.error).toBeUndefined();
  expect(r.compiled).toEqual(r.expected);
}

describe('CE-1923: a test of a list type of a parameter of type any', () => {
  test('a list whose static type proves its elements', () => {
    same('isReals([1, 2]) + t');
    same('isReals([t, 2]) + t');
    same('isInts([1, 2]) + t');
    same('isText([t, 2]) + t');
  });
  test('a list passed on to another parameter of type any', () => {
    same('forward([1, 2]) + t');
  });
  test('two calls with lists of two proofs: one function each', () => {
    same('isInts([1, 2]) + isReals([t, 2]) + t');
  });
  test('the value of a key of a dictionary literal', () => {
    same('dash({dash -> [1, 2]}) + t');
    same('dash({dash -> [0.5, t]}) + t');
    same('dash({dash -> "x"}) + t');
    same('do { let o = {dash -> [1, 2]}; isInts(o["dash"]) + t }');
  });
  test('the options of a figure, in a loop over the keys', () => {
    same('styled(t, {dash -> [4, 2]})');
    same('styled(t, {width -> 2, dash -> [t, 1, 2]})');
    same('styled(t, {dash -> "x"})');
  });
  test('a type that the elements do not prove declines', () => {
    // At t = 3 the interpreter says `true`; at t = 2.5, `false`.
    expect(run('isInts([t, 2]) + t').error).toMatch(/MatchesType/);
    expect(run('forward([t, 2]) + t').error).toMatch(/MatchesType/);
  });
  test('an element that can be ComplexInfinity declines', () => {
    // `3 / 0` is `ComplexInfinity`, not a real: the interpreter says
    // `false`, and the lane of the list is real.
    expect(run('isReals([t / 0, 1]) + t').error).toMatch(/MatchesType/);
    expect(run('dash({dash -> [t / 0, 1]}) + t').error).toMatch(
      /MatchesType/
    );
    expect(
      run('dash({dash -> [t, 1]}) + dash({dash -> [t / 0, 1]}) + t').error
    ).toMatch(/MatchesType/);
  });
});
