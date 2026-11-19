/**
 * `Apply` of a function literal whose parameters are typed (CE-1469; README
 * of `src/compute-engine/compilation/ir/`, "User functions"). A parameter
 * declared a list or a tuple binds its argument whole, as the interpreter
 * does; a list argument at a typed scalar parameter of a scalar signature is
 * mapped over, as the interpreter maps it; an argument whose type does not
 * fit the parameter's type declines. A list argument at an untyped parameter
 * still declines: the interpreter may map the function over it.
 *
 * Each case states the interpreter's value, which the test checks, and the
 * value of the code on JavaScript (or a decline).
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compile';
import type { Expression } from '../../src/compute-engine/global-types';

type Json = unknown;
type Value = number | number[];

const typed = (name: string, type: string) => ['Typed', name, `'${type}'`];

/** The witness of CE-1469: Tycho binds the inputs of an action body so. */
const WITNESS = [
  'Apply',
  [
    'Function',
    ['Block', ['Add', ['At', 'H', 1], 'n']],
    typed('H', 'list<real>'),
    typed('n', 'integer'),
  ],
  'L',
  5,
];

function engine(listType = 'list<real>'): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('L', listType);
  ce.declare('x', 'real');
  ce.declare('E', 'list<real | infinity>');
  return ce;
}

/** The interpreter's value at the inputs, as `toString()` prints it. */
function interpret(e: Expression, inputs: Record<string, Value>): string {
  const ce = e.engine;
  const subs = Object.fromEntries(
    Object.entries(inputs).map(([k, v]) => [
      k,
      Array.isArray(v) ? ce.box(['List', ...v]) : ce.number(v),
    ])
  );
  return e.subs(subs).evaluate().toString();
}

/** The message of a compilation that throws, or `undefined`. */
function failure(f: () => unknown): string | undefined {
  try {
    f();
  } catch (x) {
    return (x as { diagnostic?: { message: string } }).diagnostic?.message;
  }
  return undefined;
}

const INPUTS = { L: [2, 3, 4], x: 0.5 };

describe('Apply of a function literal with typed parameters', () => {
  // prettier-ignore
  test.each<[string, Json, string, Value, Record<string, Value>?]>([
    // (a) A list parameter binds the list whole.
    ['the witness', WITNESS, '7', 7],
    ['the witness, another list', WITNESS, '7.5', 7.5, { L: [2.5, 3, 4] }],
    ['a list parameter read whole', ['Apply', ['Function', ['Length', 'H'], typed('H', 'list<real>')], 'L'], '3', 3],
    ['a list parameter summed', ['Apply', ['Function', ['Sum', ['At', 'H', 'i'], ['Limits', 'i', 1, ['Length', 'H']]], typed('H', 'list<real>')], 'L'], '9', 9],
    ['a list parameter and an untyped scalar parameter', ['Apply', ['Function', ['Add', ['At', 'H', 1], 'n'], typed('H', 'list<real>'), 'n'], 'L', 5], '7', 7],
    ['a list parameter and a real input', ['Apply', ['Function', ['Add', ['At', 'H', 1], 'k'], typed('H', 'list<real>'), typed('k', 'real')], 'L', 'x'], '2.5', 2.5],
    ['a body that reads a local outside', ['Block', ['Declare', 'q', "'real'", 10], ['Apply', ['Function', ['Add', ['At', 'H', 1], 'q'], typed('H', 'list<real>')], 'L']], '12', 12],
    ['a tuple parameter binds the point whole', ['Apply', ['Function', ['Add', ['At', 'p', 1], ['At', 'p', 2]], typed('p', 'tuple<real, real>')], ['Tuple', 1, 'x']], '1.5', 1.5],
    // (b) A typed scalar parameter of a scalar signature maps over a list.
    ['a real parameter over a list', ['Apply', ['Function', ['Multiply', 2, 'k'], typed('k', 'real')], 'L'], '[4,6,8]', [4, 6, 8]],
    ['a real parameter over a list, an integer beside it', ['Apply', ['Function', ['Add', 'k', 'n'], typed('k', 'real'), typed('n', 'integer')], 'L', 5], '[7,8,9]', [7, 8, 9]],
    ['a real parameter over a literal list', ['Apply', ['Function', ['Add', 'k', 1], typed('k', 'real')], ['List', 1, 'x']], '[2,1.5]', [2, 1.5]],
  ])('%s', (_, json, interpreted, value, inputs = INPUTS) => {
    const ce = engine();
    const e = ce.box(json as never);
    expect(interpret(e, { ...INPUTS, ...inputs })).toBe(interpreted);
    const run = compile(e, { fallback: false }).run as (
      v: Record<string, Value>
    ) => Value;
    expect(run({ ...INPUTS, ...inputs })).toEqual(value);
  });

  // (c) An argument whose type does not fit the parameter's type declines.
  // The interpreter does not check a list against the type of its
  // parameter: it reads the list whole.
  // prettier-ignore
  test.each<[string, Json, string, RegExp, string?]>([
    ['a list of reals at a list<integer> parameter', ['Apply', ['Function', ['At', 'H', 1], typed('H', 'list<integer>')], 'L'], '2.5', /not list<integer>, the type of its parameter H/],
    ['a list of no stated length at a list<real^3> parameter', ['Apply', ['Function', ['At', 'H', 1], typed('H', 'list<real^3>')], 'L'], '2.5', /not vector<real\^3>, the type of its parameter H/],
    ['a real at an integer parameter', ['Apply', ['Function', ['Add', 'k', 1], typed('k', 'integer')], 'x'], 'Error(ErrorCode("incompatible-type", "integer", "0.5"), 0.5)', /not integer, the type of its parameter k/],
    ['a list of reals mapped at an integer parameter', ['Apply', ['Function', ['Add', 'k', 1], typed('k', 'integer')], 'L'], '[Error(ErrorCode("incompatible-type", "integer", "2.5"), 2.5, "while applying the function literal element-wise over 3 elements (element 1)"),4,5]', /not integer at each element, the type of its parameter k/],
    // A declared range: the engine type of the argument does not prove it.
    ['a real at a real<0..1> parameter', ['Apply', ['Function', ['Add', 'k', 1], typed('k', 'real<0..1>')], 'x'], '1.5', /not real<0..1>, the type of its parameter k/],
    ['a list mapped at a real<0..1> parameter', ['Apply', ['Function', ['Add', 'k', 1], typed('k', 'real<0..1>')], 'L'], '[Error(ErrorCode("incompatible-type", "real<0..1>", "2.5"), 2.5, "while applying the function literal element-wise over 3 elements (element 1)"),Error(ErrorCode("incompatible-type", "real<0..1>", "3"), 3, "while applying the function literal element-wise over 3 elements (element 2)"),Error(ErrorCode("incompatible-type", "real<0..1>", "4"), 4, "while applying the function literal element-wise over 3 elements (element 3)")]', /not real<0..1> at each element, the type of its parameter k/],
    ['a list of extended reals mapped at a real parameter', ['Apply', ['Function', ['If', ['Greater', 'k', 0], 1, 2], typed('k', 'real')], 'E'], '[Error(ErrorCode("incompatible-type", "real", "+oo"), +oo, "while applying the function literal element-wise over 2 elements (element 1)"),1]', /not real at each element, the type of its parameter k/],
    // The canonical form gives the error, of the static type `error`.
    ['a point at a list parameter', ['Apply', ['Function', ['At', 'H', 1], typed('H', 'list<real>')], ['Tuple', 'x', 1]], 'Apply((H) => At(H, 1), Error(ErrorCode("incompatible-type", "list<real>", "tuple<real, integer>"), (0.5, 1)))', /static type error/],
    ['a union type', ['Apply', ['Function', ['Add', ['At', 'H', 1], 'k'], typed('H', 'list<real>'), typed('k', 'real | list<real>')], 'L', 1], '3.5', /a parameter of Apply whose type is not a scalar, a list or a tuple of numbers/],
    // A list at an untyped parameter: the interpreter binds it whole here,
    // and may map over it elsewhere; the code declines.
    ['the witness with untyped parameters', ['Apply', ['Function', ['Block', ['Add', ['At', 'H', 1], 'n']], 'H', 'n'], 'L', 5], '7.5', /a list or a tuple argument of Apply \(the interpreter may map the function over it\)/],
  ])('%s declines', (_, json, interpreted, cause) => {
    const ce = engine();
    const e = ce.box(json as never);
    if (interpreted !== undefined)
      expect(interpret(e, { ...INPUTS, L: [2.5, 3, 4], E: [Infinity, 1] })).toBe(interpreted);
    expect(failure(() => compile(e, { fallback: false }))).toMatch(cause);
  });

  test('the witness on GLSL, a list of a stated length', () => {
    const ce = engine('list<real^3>');
    const result = compile(ce.box(WITNESS as never), {
      to: 'glsl',
      fallback: false,
    });
    expect(result.success).toBe(true);
  });

  test('the witness on GLSL, a list of a run-time length declines', () => {
    const ce = engine();
    expect(
      failure(() =>
        compile(ce.box(WITNESS as never), { to: 'glsl', fallback: false })
      )
    ).toMatch(/run-time length/);
  });

  test('the witness in interval arithmetic', () => {
    const ce = engine();
    const run = compile(ce.box(WITNESS as never), {
      to: 'interval-js',
      fallback: false,
    }).run as (v: Record<string, Value>) => unknown;
    expect(run({ L: [2, 3, 4] })).toEqual({
      kind: 'interval',
      value: { lo: 7, hi: 7 },
    });
  });
});
