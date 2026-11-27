/**
 * The records of GLSL (CE-1870): a value of a nominal tuple type of two to
 * four real or integer numbers (`type P2 = tuple<x: real, y: real>`) is a
 * `vec2` to a `vec4`. The constructor is the vector of its operands, a
 * field read is one element, a parameter and the result of a user function
 * are the vector, and `Equal` of two values of the type is the equality of
 * the elements. The value keeps its type: with another nominal type or an
 * unnamed tuple it declines, as on JavaScript. Every other record declines
 * on GLSL with a message that names the cause.
 *
 * The emitted text pinned here is the text that
 * `scripts/repros/2026-11-26-glsl-nominal-tuple.mjs` ran in a WebGL 2
 * context (SwiftShader) for `mid` and `Equal` of two `P2` values.
 */

import { compile } from '../../src/compile';
import { compileSlice } from '../../src/compute-engine/compilation/ir/index';
import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil';

const ce = new ComputeEngine();
const program = executeEpsil(
  ce,
  `type P2 = tuple<x: real, y: real>
type alias PointAlias = P2
type V2 = tuple<x: real, y: real>
type C3 = tuple<r: real, g: real, b: real>
type Q4 = tuple<a: real, b: real, c: real, d: real>
type I3 = tuple<p: integer, q: integer, r: integer>
type M2 = tuple<k: integer, x: real>
type alias R = real
type A2 = tuple<x: R, y: R>
type B2 = tuple<x: boolean, y: boolean>
type S2 = tuple<x: string, y: real>
type L2 = tuple<x: list<real>, y: real>
type N2 = tuple<p: P2, y: real>
type Z2 = tuple<x: complex, y: complex>
type AR = tuple<a: array<real>, n: real>
type One = tuple<x: real>
type Five = tuple<a: real, b: real, c: real, d: real, e: real>
function mid(a: P2, b: P2) -> P2 { P2((a.x + b.x) / 2, (a.y + b.y) / 2) }
function norm2(p: P2) { p.x * p.x + p.y * p.y }
function gray(c: C3) { 0.3 * c.r + 0.6 * c.g + 0.1 * c.b }
function swap(p) { P2(p.y, p.x) }
`
);
if (program.diagnostics.some((d) => d.severity === 'error'))
  throw new Error('the Epsil source has an error');
ce.declare('x', 'real');
ce.declare('y', 'real');
ce.declare('i', 'integer');
ce.declare('n', 'integer');
ce.declare('c', 'boolean');
ce.declare('q', 'P2');
ce.declare('mixed', 'M2');
ce.declare('labels', 'S2');
ce.declare('aliasPoint', 'PointAlias');

const glsl = (json: unknown) =>
  compile(ce.box(json as never), { to: 'glsl', fallback: false } as never);

const P = ['P2', 'x', 'y'];
const Q = ['P2', 'y', 'x'];

describe('A HOST INPUT OF A NAMED NUMERIC TUPLE TYPE', () => {
  const field = ['Field', 'q', "'x'"];
  const norm = ['norm2', 'q'];

  test('JavaScript accepts the object it returns for the same type', () => {
    const point = compile<'javascript', { x: number; y: number }>(ce.box(P), {
      fallback: false,
    });
    const read = compile(ce.box(field), { fallback: false });
    const call = compile(ce.box(norm), { fallback: false });
    const identity = compile(ce.box('q'), { fallback: false });
    const q = point.run!({ x: 3, y: 4 });
    expect(read.run!({ q })).toBe(3);
    expect(call.run!({ q })).toBe(25);
    expect(identity.run!({ q })).toEqual({ x: 3, y: 4 });
    expect(call.freeSymbolTypes).toEqual({
      q: { type: 'P2', lowered: 'record', provenance: 'declared' },
    });
  });

  test('GLSL uses a single uniform and passes it to a vec2 parameter', () => {
    expect(glsl(field).code).toBe('q[int(0.0)]');
    const call = glsl(norm);
    expect(call.freeSymbolTypes).toEqual({
      q: { type: 'P2', lowered: 'vec2', provenance: 'declared' },
    });
    expect(call.code).toContain('_fn_ir_u0_norm2(q)');
    expect(call.preamble).toContain('float _fn_ir_u0_norm2(vec2 ');
    expect(glsl('q').code).toBe('q');
  });

  test('the field order and integer lane come from the declaration', () => {
    const json = ['Field', 'mixed', "'k'"];
    const r = compile(ce.box(json), { fallback: false });
    expect(r.run!({ mixed: { x: 0.5, k: 7 } })).toBe(7);
    expect(glsl(json).code).toBe('mixed[int(0.0)]');
  });

  test('a compiled lambda accepts a named tuple as a positional object', () => {
    const lambda = ce.box(['Function', field, ['Typed', 'q', "'P2'"]]);
    const r = compile(lambda, { fallback: false });
    expect(r.calling).toBe('lambda');
    expect(r.run!({ x: 3, y: 4 })).toBe(3);
  });

  test('a transparent alias keeps the underlying nominal type at a call', () => {
    const call = ['norm2', 'aliasPoint'];
    const r = compile(ce.box(call), { fallback: false });
    expect(r.run!({ aliasPoint: { x: 3, y: 4 } })).toBe(25);
    expect(glsl(call).freeSymbolTypes?.aliasPoint).toMatchObject({
      type: 'PointAlias',
      lowered: 'vec2',
    });
  });

  test('other records and unsupported modes decline', () => {
    for (const to of ['javascript', 'glsl'] as const)
      expect(() => compile(ce.box('labels'), { to, fallback: false })).toThrow(
        'the input labels of type S2'
      );
    expect(() =>
      compile(ce.box(field), { to: 'interval-js', fallback: false })
    ).toThrow('the input q of type P2');
    expect(() =>
      compile(ce.box(field), { mode: 'bigint', fallback: false })
    ).toThrow('the input q of type P2');
  });
});

describe('A VALUE OF A NOMINAL TUPLE TYPE OF NUMBERS IS A VECTOR', () => {
  test('P2: the constructor, a field read and the result type', () => {
    expect(glsl(P).code).toBe('vec2(x, y)');
    expect(glsl(['Field', P, "'y'"]).code).toBe('y');
    const slice = compileSlice(ce.box(P as never), {
      target: 'glsl',
      bareInputs: true,
    });
    expect(slice.returnType).toBe('vec2');
  });

  test('P2: a user function P2 -> P2 takes and returns a vec2', () => {
    const r = glsl(['mid', P, Q]);
    expect(r.preamble).toBe(
      [
        'vec2 _fn_ir_u0_mid(vec2 v4, vec2 v5) {',
        '  return vec2((0.5 * (v4[int(0.0)] + v5[int(0.0)])), (0.5 * (v4[int(1.0)] + v5[int(1.0)])));',
        '}',
      ].join('\n')
    );
    expect(r.code).toBe(
      'vec2 v18 = _fn_ir_u0_mid(vec2(x, y), vec2(y, x));\nreturn v18;'
    );
    // A parameter of no stated type takes the vec2 of its argument.
    expect(glsl(['swap', P]).preamble).toBe(
      'vec2 _fn_ir_u0_swap(vec2 v3) {\n  return vec2(v3[int(1.0)], v3[int(0.0)]);\n}'
    );
  });

  test('P2: Equal and NotEqual are the equality of the elements', () => {
    expect(glsl(['Equal', P, Q]).code).toBe('((x == y) && (y == x))');
    expect(glsl(['NotEqual', P, Q]).code).toBe('(!((x == y) && (y == x)))');
  });

  test('P2: an If of two P2 arms, and a block local', () => {
    expect(glsl(['If', 'c', P, Q]).code).toBe(
      'vec2 v5;\nif (c) {\n  v5 = vec2(x, y);\n} else {\n  v5 = vec2(y, x);\n}\nreturn v5;'
    );
    expect(
      glsl([
        'Block',
        ['Declare', 'p', ['Dictionary', ['KeyValuePair', { str: 'value' }, P]]],
        ['Add', ['Field', 'p', "'x'"], ['Field', 'p', "'y'"]],
      ]).code
    ).toBe('(x + y)');
  });

  test('C3: a vec3, and a function of a C3', () => {
    expect(glsl(['C3', 'x', 'y', 'x']).code).toBe('vec3(x, y, x)');
    expect(glsl(['Field', ['C3', 'x', 'y', 'x'], "'g'"]).code).toBe('y');
    expect(glsl(['gray', ['C3', 'x', 'y', 'x']]).preamble).toBe(
      'float _fn_ir_u0_gray(vec3 v3) {\n  return (((0.1 * v3[int(2.0)]) + (0.3 * v3[int(0.0)])) + (0.6 * v3[int(1.0)]));\n}'
    );
  });

  test('Q4: a vec4 of four reals, and Equal', () => {
    const a = ['Q4', 'x', 'y', 'x', 'y'];
    expect(glsl(a).code).toBe('vec4(x, y, x, y)');
    expect(glsl(['Equal', a, ['Q4', 'y', 'x', 'y', 'x']]).code).toBe(
      'bool v4 = (x == y);\nbool v5 = (y == x);\nreturn (((v4 && v5) && v4) && v5);'
    );
  });

  test('integers, a real and an integer, and a field type through an alias', () => {
    expect(glsl(['I3', 'i', 'n', 'i']).code).toBe('vec3(i, n, i)');
    expect(glsl(['M2', 'i', 'x']).code).toBe('vec2(i, x)');
    expect(glsl(['A2', 'x', 'y']).code).toBe('vec2(x, y)');
  });

  // A value of a real field is never NaN in the interpreter (`P2(NaN, 1)`
  // is an `incompatible-type` error), so a discharge has the value that it
  // has on JavaScript: `IsMissing` is false, `Coalesce` the first operand.
  test('the discharges of a P2', () => {
    expect(glsl(['IsMissing', P]).code).toBe('false');
    expect(glsl(['Coalesce', P, ['P2', 0, 0]]).code).toBe('vec2(x, y)');
    expect(glsl(['AssertPresent', P]).code).toBe('vec2(x, y)');
  });
});

describe('THE DECLINES', () => {
  const vector =
    'on glsl a record is a value of a nominal tuple type of two to four real or integer numbers (a vec2 to a vec4)';
  test.each([
    [
      'Equal of two nominal types of the same fields',
      ['Equal', P, ['V2', 'x', 'y']],
      'Equal of P2(x: real, y: real), V2(x: real, y: real)',
    ],
    [
      'NotEqual of two nominal types',
      ['NotEqual', P, ['V2', 'x', 'y']],
      'Equal of P2(x: real, y: real), V2(x: real, y: real)',
    ],
    [
      'Equal of a P2 and an unnamed tuple (False in the interpreter)',
      ['Equal', P, ['Tuple', 'x', 'y']],
      'Equal of a tuple: its value on a tuple is not its value on a list',
    ],
    [
      'an If of two nominal types',
      ['If', 'c', P, ['V2', 'x', 'y']],
      'arms of two types',
    ],
    ['an If of a P2 and a tuple', ['If', 'c', P, ['Tuple', 'x', 'y']], 'arms of two types'],
    [
      'arithmetic on a whole value (an error in the interpreter)',
      ['Add', P, 1],
      'a sub-expression of the static type error',
    ],
    [
      'a product of a whole value',
      ['Multiply', 2, P],
      'a sub-expression of the static type error',
    ],
    [
      'a boolean field',
      ['B2', 'c', 'c'],
      `a value of the type B2, a record whose field x is of type boolean, not a real or an integer number: ${vector}`,
    ],
    [
      'a string field',
      ['S2', "'a'", 'x'],
      `a value of the type S2, a record whose field x is of type string, not a real or an integer number: ${vector}`,
    ],
    [
      'a list field',
      ['L2', ['List', 'x'], 'x'],
      `a record whose field x is of type list<real>, not a real or an integer number: ${vector}`,
    ],
    [
      'a nested record',
      ['N2', P, 'x'],
      `a record whose field p is of type P2, not a real or an integer number: ${vector}`,
    ],
    [
      'a complex field',
      ['Z2', 'x', 'y'],
      `a record whose field x is of type complex, not a real or an integer number: ${vector}`,
    ],
    [
      'an array field',
      ['AR', ['ArrayFrom', ['List', 1, 2], "'real'"], 'x'],
      `a record whose field a is of type array<real>, not a real or an integer number: ${vector}`,
    ],
    ['one field', ['One', 'x'], `a value of the type One, a record of 1 field, not two to four: ${vector}`],
    [
      'five fields',
      ['Five', 'x', 'x', 'x', 'x', 'x'],
      `a value of the type Five, a record of 5 fields, not two to four: ${vector}`,
    ],
    ['a list of P2 values', ['List', P, Q], 'a list of records'],
    [
      'a dictionary',
      ['Dictionary', ['KeyValuePair', { str: 'a' }, 'x']],
      'a dictionary, a record: records compile on javascript only',
    ],
  ])('%s', (_, json, message) => {
    expect(() => glsl(json)).toThrow(message);
  });
});

/** The value of a compiled JavaScript result, or of the interpreter, as
 *  plain numbers and booleans. */
describe('THE SAME PROGRAMS ON JAVASCRIPT GIVE THE INTERPRETER\'S VALUES', () => {
  const plain = (v: unknown): unknown =>
    typeof v === 'object' && v !== null ? Object.values(v) : v;
  const interpreted = (json: unknown, inputs: Record<string, number>) => {
    const x = ce
      .box(json as never)
      .subs(
        Object.fromEntries(
          Object.entries(inputs).map(([k, v]) => [k, ce.number(v)])
        )
      )
      .evaluate();
    if (x.symbol === 'True' || x.symbol === 'False') return x.symbol === 'True';
    return x.ops !== undefined && x.ops !== null
      ? x.ops.map((y) => y.re)
      : x.re;
  };
  test.each([
    ['mid', ['mid', P, Q]],
    ['norm2', ['norm2', P]],
    ['swap', ['swap', P]],
    ['Equal', ['Equal', P, Q]],
    ['NotEqual', ['NotEqual', P, Q]],
    ['a field of C3', ['Field', ['C3', 'x', 'y', 'x'], "'g'"]],
    ['gray', ['gray', ['C3', 'x', 'y', 'x']]],
    ['Equal of Q4', ['Equal', ['Q4', 'x', 'y', 'x', 'y'], ['Q4', 'y', 'x', 'y', 'x']]],
    ['IsMissing', ['IsMissing', P]],
    ['Coalesce', ['Coalesce', P, ['P2', 0, 0]]],
  ])('%s', (_, json) => {
    const r = compile(ce.box(json as never), { fallback: false });
    expect(r.success).toBe(true);
    for (const inputs of [
      { x: 1, y: 3 },
      { x: 2.5, y: 2.5 },
      { x: -4, y: 0.25 },
    ]) {
      const got = plain(r.run!(inputs as never));
      const want = interpreted(json, inputs);
      if (Array.isArray(want))
        (got as number[]).forEach((g, k) => expect(g).toBeCloseTo(want[k], 12));
      else if (typeof want === 'number') expect(got).toBeCloseTo(want, 12);
      else expect(got).toBe(want);
    }
  });
});
