/**
 * Compiling records (CE-1652, step 2; `compilation/ir/README.md`,
 * "Records"): a value whose fields each have a settled shape.
 *
 * - The constructor of a named tuple type makes a record; each operand is
 *   lowered for the declared type of its field, and where that type gives
 *   no single shape (`list`, `string | color | nothing`), the operand
 *   decides. `Nothing` is a field of the unit type `nothing`.
 * - A `Tuple` or a `List` literal of elements of several lanes is a record
 *   with no names.
 * - `Field(r, name)` and `At(r, k)` of a constant `k` read a field; another
 *   index declines. A field read of a record built in the same body is the
 *   value it was built of, so `match fig.kind` and `if fig.kind == …` keep
 *   one arm.
 * - The result of `run()`: a record of a named tuple type is an object
 *   keyed by its field names (a nested one too, `Nothing` as `null`); a
 *   record with no names is an array.
 *
 * Every case is compared with the interpreter's value within 1e-12 on
 * `javascript`; GLSL, `interval-js` and the `bigint` mode decline a record.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import {
  isFunction,
  isNumber,
  isString,
  isSymbol,
} from '../../src/compute-engine/boxed-expression/type-guards';

type Target = 'javascript' | 'glsl' | 'interval-js';

const PRELUDE = `
  type P = tuple<x: real, y: real>
  type Q = tuple<name: string, at: P>
  type C = tuple<re: real, im: real>
  type A = tuple<v: real>
  type B = tuple<v: real>
  type Tree = Leaf(v: real) | Node(l: Tree, r: Tree)
  cx(t: real) = C(t, 0)
  type Figure = tuple<kind: string, geom: list, matrix: tuple<real, real, real, real, real, real>, fillPaint: string | color | nothing, strokePaint: string | color | nothing, strokePx: real | nothing, dashPattern: list<real> | nothing, alpha: real | nothing>
  f(t: real) = P(cos(t), sin(t))
  g(t: real) = [t, "a"]
  function circle(c: tuple<real, real>, r: real) {
    Figure("circle", [N(c[1], 15), N(c[2], 15), N(r, 15)], (1, 0, 0, 1, 0, 0), Nothing, Nothing, Nothing, Nothing, Nothing)
  }
  function filled(t: real) {
    Figure("circle", [t, 0, 1], (1, 0, 0, 1, 0, 0), "red", Nothing, 2, [1, 2], 0.5)
  }
  function label(t: real) {
    Figure("label", [t, 0, "hi"], (1, 0, 0, 1, 0, 0), Nothing, Nothing, Nothing, Nothing, Nothing)
  }
  function nested(t: real) { Q("a", P(t, 2 * t)) }
  function sum(t: real) { let p = P(cos(t), sin(t)); p.x + p.y }
  function pair(t: real) { ("a", t) }
  function kindOf(t: real) {
    let fig = label(t)
    let own = Figure("label", [t, 0, "hi"], (1, 0, 0, 1, 0, 0), Nothing, Nothing, Nothing, Nothing, Nothing)
    match own.kind { == "circle" => [1, 2]; == "label" => own.geom[1] + 1; _ => "none" }
  }
  function viaIf(t: real) {
    let fig = Figure("circle", [t, 0, 1], (1, 0, 0, 1, 0, 0), Nothing, Nothing, Nothing, Nothing, Nothing)
    if fig.kind == "circle" { fig.geom[3] + t } else { "none" }
  }
  function noFill(t: real) { let fig = circle((t, 0), 1); if fig.fillPaint is nothing { t } else { 2 } }
  function hasText(t: real) { let fig = filled(t); if fig.fillPaint is string { t } else { 2 } }
  function matchP(t: real) { match P(t, 3) { (u, v) => v; _ => 0 } }
  function matchPair(t: real) { match ("a", t) { (u, v) => v; _ => 0 } }
  function twoTypes(t: real) { if t > 0 { filled(t) } else { circle((t, 0), 1) } }
  function many(t: real) { [P(k, t) for k in 1..3] }
`;

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('t', 'real');
  ce.declare('n', 'integer');
  executeEpsil(ce, PRELUDE);
  return ce;
}

function compileTo(
  ce: ComputeEngine,
  expr: any,
  to: Target,
  mode?: string
): { ok: true; result: any } | { ok: false; message: string } {
  try {
    const result: any = compile(ce.box(expr), {
      to,
      fallback: false,
      ...(mode === undefined ? {} : { mode }),
    } as any);
    return { ok: true, result };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

/** The field names of the named tuple type of the value `v`. */
function fieldNames(v: any): string[] | undefined {
  const t = v.type.type;
  if (typeof t !== 'object' || t.kind !== 'reference') return undefined;
  const elements = t.def?.kind === 'tuple' ? t.def.elements : undefined;
  return elements?.every((x: any) => x.name !== undefined)
    ? elements.map((x: any) => x.name)
    : undefined;
}

/** The JavaScript value that `run()` gives for the interpreter's value
 *  `v`: an object for a value of a named tuple type, an array for a list or
 *  a tuple, `null` for `Nothing`. */
function hostValue(v: any): unknown {
  if (isSymbol(v, 'Nothing')) return null;
  if (isSymbol(v, 'True')) return true;
  if (isSymbol(v, 'False')) return false;
  if (isString(v)) return v.string;
  if (isNumber(v)) return v.im === 0 ? v.re : { re: v.re, im: v.im };
  if (isFunction(v)) {
    const items = v.ops.map(hostValue);
    if (v.operator === 'List' || v.operator === 'Tuple') return items;
    const names = fieldNames(v);
    if (names !== undefined)
      return Object.fromEntries(names.map((n, k) => [n, items[k]]));
  }
  throw new Error(`no host value for ${v.toString()}`);
}

/** `got` is `expected`, numbers within 1e-12. */
function expectClose(got: unknown, expected: unknown, path = 'result') {
  if (typeof expected === 'number') {
    expect(typeof got).toBe('number');
    expect(Math.abs((got as number) - expected)).toBeLessThanOrEqual(1e-12);
  } else if (Array.isArray(expected)) {
    expect(Array.isArray(got)).toBe(true);
    expect((got as unknown[]).length).toBe(expected.length);
    expected.forEach((x, k) =>
      expectClose((got as unknown[])[k], x, `${path}[${k}]`)
    );
  } else if (expected !== null && typeof expected === 'object') {
    expect(got !== null && typeof got === 'object' && !Array.isArray(got)).toBe(
      true
    );
    expect(Object.keys(got as object)).toEqual(Object.keys(expected));
    for (const [k, x] of Object.entries(expected))
      expectClose((got as any)[k], x, `${path}.${k}`);
  } else expect(got).toBe(expected);
}

/** `expr` compiles on JavaScript and gives the interpreter's value at each
 *  value of `t`. */
function expectAgrees(ce: ComputeEngine, expr: any, ts: number[] = [1, -0.3]) {
  const js = compileTo(ce, expr, 'javascript');
  if (!js.ok) throw new Error(js.message);
  for (const t of ts) {
    const expected = hostValue(ce.box(expr).subs({ t }).evaluate().N());
    expectClose(js.result.run({ t }), expected);
  }
  return js.result;
}

function expectDeclines(
  ce: ComputeEngine,
  expr: any,
  reason: RegExp,
  to: Target = 'javascript',
  mode?: string
) {
  const r = compileTo(ce, expr, to, mode);
  expect(r.ok).toBe(false);
  expect((r as { message: string }).message).toMatch(reason);
}

describe('making a record', () => {
  const ce = engine();

  test('the constructor of a named tuple type: an object at run()', () => {
    const r = expectAgrees(ce, ['f', 't']);
    expect(r.run({ t: 1 })).toEqual({ x: Math.cos(1), y: Math.sin(1) });
  });

  test('a List of a real and a string: an array', () => {
    expectAgrees(ce, ['g', 't']);
  });

  test('a Tuple of a string and a real: an array', () => {
    expectAgrees(ce, ['pair', 't']);
    expectAgrees(ce, ['Tuple', { str: 'b' }, ['Multiply', 2, 't']]);
  });

  test('a Figure built by a function, fields of nothing', () => {
    const r = expectAgrees(ce, [
      'circle',
      ['Tuple', ['Cos', 't'], ['Sin', 't']],
      0.2,
    ]);
    expect(r.run({ t: 0 })).toEqual({
      kind: 'circle',
      geom: [1, 0, 0.2],
      matrix: [1, 0, 0, 1, 0, 0],
      fillPaint: null,
      strokePaint: null,
      strokePx: null,
      dashPattern: null,
      alpha: null,
    });
  });

  test('a Figure whose style fields hold a string, numbers and a list', () => {
    expectAgrees(ce, ['filled', 't']);
  });

  test('a List of records: an array of objects', () => {
    expectAgrees(ce, ['List', ['f', 't'], ['nested', 't']]);
  });

  test('a record in a field: a nested object', () => {
    const r = expectAgrees(ce, ['nested', 't']);
    expect(r.run({ t: 2 })).toEqual({ name: 'a', at: { x: 2, y: 4 } });
  });

  test('a record result has no batch', () => {
    const r = expectAgrees(ce, ['f', 't']);
    expect(() => r.broadcast({ t: [1, 2] })).toThrow(/a record/);
  });
});

describe('reading a record', () => {
  const ce = engine();

  test('Field of a local, and of a call', () => {
    expectAgrees(ce, ['sum', 't']);
    expectAgrees(ce, ['Field', ['f', 't'], { str: 'y' }]);
    expectAgrees(ce, [
      'Field',
      ['Field', ['nested', 't'], { str: 'at' }],
      { str: 'y' },
    ]);
  });

  test('At of a constant index, from the end too', () => {
    expectAgrees(ce, ['At', ['g', 't'], 1]);
    expectAgrees(ce, ['At', ['g', 't'], -2]);
    expectAgrees(ce, ['First', ['pair', 't']]);
    expectAgrees(ce, ['Last', ['pair', 't']]);
  });

  test('a Match on a field of a record made in the body keeps one case', () => {
    expectAgrees(ce, ['kindOf', 't']);
  });

  test('an If on a field of a record made in the body keeps one arm', () => {
    expectAgrees(ce, ['viaIf', 't']);
  });

  test('x is T of a field is decided by the lane of the field', () => {
    expectAgrees(ce, ['noFill', 't']);
    expectAgrees(ce, ['hasText', 't']);
  });

  test('a Tuple pattern does not take a value of a named tuple type', () => {
    expectAgrees(ce, ['matchP', 't']);
  });
});

describe('review fixes', () => {
  const ce = engine();
  ce.declare('z', 'complex');
  executeEpsil(
    ce,
    `
    type V = tuple<dx: real, dy: real>
    type Sample = tuple<value: complex>
    type W = tuple<s: Sample, l: list<complex>>
    type K = tuple<p: string | nothing, v: real>
    type XS = tuple<x: real, s: string>
    type YS = tuple<y: real, s: string>
    function drawn(t: real) { if K(Nothing, random() + t).p is nothing { t } else { 2 } }
    function namesOk(t: real) -> tuple<x: real, s: string> { XS(t, "a") }
    function otherNames(t: real) -> tuple<x: real, s: string> { YS(t, "a") }
    function noNames(t: real) -> tuple<x: real, s: string> { (t, "a") }
  `
  );

  /** `expr` gives the interpreter's value at each complex value of `z`. */
  const agreesAtZ = (expr: any) => {
    const js = compileTo(ce, expr, 'javascript');
    if (!js.ok) throw new Error(js.message);
    for (const [re, im] of [
      [2, 0],
      [1, 2],
    ]) {
      const expected = hostValue(
        ce
          .box(expr)
          .subs({ z: ce.number(ce.complex(re, im)) })
          .evaluate()
          .N()
      );
      expectClose(js.result.run({ z: { re, im } }), expected);
    }
    return js.result;
  };

  test('a complex field of an object result follows the result convention', () => {
    const r = agreesAtZ(['Sample', 'z']);
    expect(r.run({ z: { re: 2, im: 0 } })).toEqual({ value: 2 });
    // A nested record and a list of complex numbers in a field.
    agreesAtZ(['W', ['Sample', 'z'], ['List', 'z', ['Multiply', 2, 'z']]]);
  });

  test('records of two types of the same fields are not merged', () => {
    expectAgrees(ce, ['Tuple', ['A', 't'], ['B', 't']]);
    expectAgrees(ce, ['Tuple', ['P', 't', 1], ['V', 't', 1]]);
    expectAgrees(ce, ['List', ['P', 't', 1], ['V', 't', 1]]);
  });

  test('x is T of a field lowers the record once', () => {
    const r = expectAgrees(ce, ['drawn', 't']);
    const text = `${r.preamble}\n${r.code}`;
    expect(text.match(/drawNextRandomNumber\(/g)?.length).toBe(1);
  });

  test('a structural result type with field names requires those names', () => {
    expectAgrees(ce, ['namesOk', 't']);
    expectDeclines(
      ce,
      ['otherNames', 't'],
      /a body of otherNames that is not a record of the field names of tuple<x: real, s: string>/
    );
    expectDeclines(
      ce,
      ['noNames', 't'],
      /a body of noNames that is not a record of the field names/
    );
  });
});

describe('a record declines', () => {
  const ce = engine();

  test('an If whose arms give two record types', () => {
    expectDeclines(
      ce,
      ['If', ['Greater', 't', 0], ['P', 't', 1], ['nested', 't']],
      /arms of two types/
    );
    // Two records of one engine type whose fields have different shapes.
    expectDeclines(ce, ['twoTypes', 't'], /arms of two types/);
  });

  test('an If whose arms give records of two nominal types of the same fields', () => {
    expectDeclines(
      ce,
      ['If', ['Greater', 't', 0], ['A', 't'], ['B', 't']],
      /arms of two types/
    );
  });

  test('a variant of a sum type (its tag is a value at run time)', () => {
    expectDeclines(ce, ['Leaf', 't'], /Leaf is not the library operator/);
  });

  test('At of an index that is not a constant', () =>
    expectDeclines(
      ce,
      ['At', ['g', 't'], 'n'],
      /At of a record at an index that is not a constant/
    ));

  test('a list of records', () =>
    expectDeclines(
      ce,
      ['many', 't'],
      /a record made in a build|a list of records/
    ));

  test('a Tuple pattern on a record with no names', () =>
    expectDeclines(
      ce,
      ['matchPair', 't'],
      /a Tuple pattern of a Match on a record with no names/
    ));

  test('Length and Reverse of a record', () => {
    expectDeclines(
      ce,
      ['Length', ['g', 't']],
      /a scalar where a list is required/
    );
    expectDeclines(
      ce,
      ['Reverse', ['g', 't']],
      /a scalar where a list is required/
    );
  });

  test('a result of fields named re and im (the result convention reads a complex number)', () => {
    expectDeclines(ce, ['cx', 't'], /fields named re and im/);
    expectDeclines(
      ce,
      ['List', ['cx', 't'], ['g', 't']],
      /fields named re and im/
    );
  });

  test('Equal of two records', () => {
    expectDeclines(ce, ['Equal', ['g', 't'], ['g', 't']], /Equal of record/);
  });

  test('on GLSL and interval-js', () => {
    for (const to of ['glsl', 'interval-js'] as Target[]) {
      expectDeclines(ce, ['f', 't'], /records compile on javascript only/, to);
      expectDeclines(
        ce,
        ['circle', ['Tuple', 't', 0], 1],
        /text compiles on javascript only|records compile on javascript only/,
        to
      );
      // A record that a field read would fold away declines too.
      expectDeclines(
        ce,
        ['Field', ['P', 't', 1], { str: 'x' }],
        /records compile on javascript only/,
        to
      );
    }
  });

  test('in the bigint mode', () => {
    const ce2 = new ComputeEngine();
    ce2.declare('n', 'integer');
    executeEpsil(ce2, 'type Z = tuple<a: integer, b: integer>');
    expectDeclines(
      ce2,
      ['Z', 'n', 2],
      /records compile on javascript only/,
      'javascript',
      'bigint'
    );
  });
});
