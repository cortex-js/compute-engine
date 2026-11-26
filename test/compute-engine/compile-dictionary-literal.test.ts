/**
 * A dictionary literal compiles on JavaScript as a record (CE-1771;
 * `compilation/ir/README.md`, "Records"): its values are the fields, its
 * keys the field names, and a read of a key (`d.k`, `d["k"]`) is the field
 * of that name. A function of the host receives the dictionary that the
 * interpreter passes. Every other target declines, and so does a read that
 * is not of a key that the literal has.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { isDictionary } from '../../src/compute-engine/boxed-expression/type-guards';
import type { Expression } from '../../src/compute-engine/global-types';

type Target = 'javascript' | 'glsl' | 'interval-js';

const PRELUDE = `
  type Fig = tuple<x: real, fill: string, w: real>
  function styled(c: tuple<real, real>, o: any) { Fig(c[1], o.fill, o["w"]) }
  function width(o: any) { o.w * 2 }
`;

/** Functions that give a function of the host a dictionary with a tuple
 *  value. They are declared after `figureDraw`. */
const HOST_PRELUDE = `
  function options(t: real) { {p -> (t, 1)} }
  function drawWith(t: real) { let q = (t, 1); figureDraw({p -> q}) }
  function drawOf(t: real) { let d = {p -> (t, 1)}; figureDraw(d) }
  function drawValue(t: real) { let d = {p -> (t, 1), w -> t}; figureDraw((d.p, d.w)) }
`;

/** An engine with the prelude, the function `f` of `body` (a function of
 *  `t: real`), and a function of the host, `figureDraw`, that records each
 *  argument it receives in `received`. */
function engine(body: string) {
  const ce = new ComputeEngine();
  const received: Expression[] = [];
  ce.declare('figureDraw', {
    signature: '(any) -> nothing',
    pure: false,
    evaluate: (ops) => {
      received.push(ops[0]);
      return ce.symbol('Nothing');
    },
  });
  const errors = executeEpsil(
    ce,
    `${PRELUDE}${HOST_PRELUDE}\nfunction f(t: real) { ${body} }`
  ).diagnostics.filter((d) => d.severity === 'error');
  if (errors.length > 0)
    throw new Error(`prelude: ${JSON.stringify(errors[0].message)}`);
  return { ce, received };
}

/** `f(t)` compiled to `to`, or the message of its decline. */
function compileTo(
  ce: ComputeEngine,
  to: Target = 'javascript'
): { ok: true; result: any } | { ok: false; message: string } {
  try {
    const result: any = compile(ce.box(['f', 't']) as any, {
      to,
      fallback: false,
    } as any);
    return { ok: true, result };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

/** `f` of the body `body` compiles on JavaScript and gives the
 *  interpreter's value at each `t`. */
function expectAgrees(body: string, ts: number[] = [2, -0.5]) {
  const { ce } = engine(body);
  const r = compileTo(ce);
  if (!r.ok) throw new Error(r.message);
  for (const t of ts) {
    const expected = ce.box(['f', t]).evaluate();
    const got = r.result.run({ t });
    if (typeof got === 'string')
      expect(got).toBe((expected as unknown as { string: string }).string);
    else expect(got).toBeCloseTo(expected.re, 12);
  }
}

function expectDeclines(
  body: string,
  reason: RegExp,
  to: Target = 'javascript'
) {
  const { ce } = engine(body);
  const r = compileTo(ce, to);
  expect(r.ok).toBe(false);
  expect((r as { message: string }).message).toMatch(reason);
}

describe('a dictionary literal compiles on JavaScript', () => {
  test.each([
    // The witness of CE-1771: `d["w"]` and `d.w`.
    'let d = {w -> t, fill -> "red"}; d["w"] + 1',
    'let d = {w -> t, fill -> "red"}; d.w + 1',
    // A string value.
    'let d = {w -> t, fill -> "red"}; d.fill',
    // A tuple value.
    'let d = {w -> t, p -> (t, 3)}; d.p[2] * t',
    // Two arms of one set of keys.
    'let d = {w -> t} if t > 0 else {w -> 2 * t}; d.w',
    // A parameter of type `any` that holds the dictionary.
    'width({w -> t, fill -> "red"})',
  ])('%s', (body) => expectAgrees(body));

  test('the result of the program is an object of the keys', () => {
    const { ce } = engine('{w -> t, fill -> "red"}');
    const r = compileTo(ce);
    if (!r.ok) throw new Error(r.message);
    expect(r.result.run({ t: 2 })).toEqual({ w: 2, fill: 'red' });
  });
});

/** The program `(t: real) => call` compiled on JavaScript, with the
 *  engine and the arguments that `figureDraw` receives. */
function hostProgram(call: string) {
  const { ce, received } = engine('t');
  const f = executeEpsil(ce, `(t: real) => ${call}`).value!;
  const result: any = compile(f as any, {
    to: 'javascript',
    fallback: false,
  } as any);
  return { ce, received, f, result };
}

describe('a function of the host', () => {
  test.each([
    // The case of the issue: a figure styled by an options dictionary.
    'figureDraw(styled((t, 0), {fill -> "red", w -> t}))',
    // The dictionary itself.
    'figureDraw({w -> t, fill -> "red"})',
    // A tuple, a list, a tuple of tuples and a dictionary as values
    // (CE-1802).
    'figureDraw({p -> (t, 1)})',
    'figureDraw({dash -> [t, 4, 2]})',
    'figureDraw({bounds -> ((t, 0), (1, t)), fill -> "red"})',
    'figureDraw({style -> {dash -> (4, t)}, w -> t})',
    // A local that holds the tuple, and one that holds the dictionary.
    'drawWith(t)',
    'drawOf(t)',
    // A user function that makes the dictionary.
    'figureDraw(options(t))',
    // A value of a dictionary, read by its key.
    'drawValue(t)',
  ])('%s receives the value of the interpreter', (call) => {
    const { ce, received, f, result } = hostProgram(call);
    expect(result.hostCalls).toEqual(['figureDraw']);
    for (const t of [2, -0.5]) {
      received.length = 0;
      ce.box(['Apply', f, t] as any).evaluate();
      const expected = [...received];
      received.length = 0;
      result.run(t);
      expect(expected.length).toBe(1);
      expect(received.length).toBe(1);
      expect(received[0].isSame(expected[0])).toBe(true);
    }
  });

  test('a dictionary argument is a dictionary of the engine', () => {
    const { received, result } = hostProgram('figureDraw({w -> t})');
    result.run(2);
    expect(isDictionary(received[0])).toBe(true);
    expect(received[0].json).toEqual({ dict: { w: 2 } });
  });
});

describe('a dictionary declines', () => {
  test('a read at a position, not a key', () =>
    expectDeclines(
      'let d = {w -> t, a -> 3}; d[2]',
      /At of a dictionary at an index that is not a constant key/
    ));

  test('the key __proto__', () =>
    expectDeclines(
      '{__proto__ -> t}',
      /a dictionary with the key __proto__/
    ));

  // The interpreter can hold such a value as a lazy collection, where the
  // code holds the array of its elements.
  test.each([
    'figureDraw({p -> Range(1, 3)})',
    'figureDraw({p -> [t, 1] + 1})',
    'figureDraw({p -> Reverse([t, 1])})',
  ])('%s: a value that is not a List or a Tuple literal', (call) => {
    const { ce } = engine('t');
    const f = executeEpsil(ce, `(t: real) => ${call}`).value!;
    expect(() =>
      compile(f as any, { to: 'javascript', fallback: false } as any)
    ).toThrow(/does not know as a List or a Tuple literal/);
  });

  // A list of NaN does not stand for the absent list of an `If` with no
  // else where a dictionary holds it: a reader of the key could tell them
  // apart.
  test('an If with no else of a list arm as a value', () => {
    const ce = new ComputeEngine();
    ce.declare('t', 'real');
    const arm = ce.box(['If', ['Less', 0, 't'], ['List', 't', 1]] as any);
    // The same boxed `If` is also the result of the program, a place that
    // takes the list of NaN.
    const program = ce.function('Block', [
      ce.function('At', [
        ce.box(['Dictionary', ['Tuple', { str: 'p' }, arm]] as any),
        ce.string('p'),
      ]),
      arm,
    ]);
    expect(() =>
      compile(program as any, { to: 'javascript', fallback: false } as any)
    ).toThrow(/an If with no else of a list arm/);
  });

  test('the bigint mode', () => {
    const { ce } = engine('let d = {w -> 2}; d.w');
    expect(() =>
      compile(ce.box(['f', 't']) as any, {
        to: 'javascript',
        mode: 'bigint',
        fallback: false,
      } as any)
    ).toThrow(/records compile on javascript only/);
  });

  test('two arms of two sets of keys', () =>
    expectDeclines(
      'let d = {w -> t} if t > 0 else {v -> t}; 1',
      /arms of two types/
    ));

  test('the length of a dictionary', () =>
    expectDeclines(
      'let d = {w -> t, a -> 3}; length(d)',
      /a scalar where a list is required/
    ));

  test.each(['glsl', 'interval-js'] as const)('on %s', (to) =>
    expectDeclines(
      'let d = {w -> t}; d.w',
      /records compile on javascript only/,
      to
    )
  );
});
