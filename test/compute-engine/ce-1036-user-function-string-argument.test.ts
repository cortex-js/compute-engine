/**
 * The compiled call `f(t)` of a user function with a string argument `t`,
 * at a parameter whose type is a collection that admits a string.
 *
 * A string is a collection of its characters, so the body of
 * `f := s ↦ Length(s)` infers `s: collection`, and a declaration
 * `f: (collection) -> integer` gives the same type. The generic definition
 * compiles `Length` of a `collection` with `_SYS.elts`, which throws a
 * `RangeError` for a string. The interpreter binds a string whole and
 * counts its characters. The call now takes a copy of `f` with `s` typed
 * `string` (`_fn_f_string`), whose `Length` counts the characters
 * (`_SYS.chars`): a grapheme cluster (`😀`) is one character.
 *
 * The case of an applied function literal, `Apply(s ↦ Length(s), t)`, is in
 * `issue-498-applied-literal-parameter-type.test.ts`.
 */

import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import {
  isCharacter,
  isString,
} from '../../src/compute-engine/boxed-expression/type-guards';

/** An engine with `t: string`, `L: list<real>`, `y: real` and
 * `S: list<string>`, and `f` assigned the function literal `fn`. With
 * `signature`, `f` is declared with it first. */
function engineWith(fn: unknown, signature?: string): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('t', 'string');
  ce.declare('L', 'list<real>');
  ce.declare('y', 'real');
  ce.declare('S', 'list<string>');
  if (signature !== undefined) ce.declare('f', signature);
  ce.box(['Assign', 'f', fn] as never).evaluate();
  return ce;
}

/** The value of `json` given by the interpreter at `values`. */
function interpreted(
  ce: ComputeEngine,
  json: unknown,
  values: Record<string, unknown>
): unknown {
  const subs = Object.fromEntries(
    Object.entries(values).map(([k, v]) => [
      k,
      typeof v === 'string'
        ? ce.string(v)
        : Array.isArray(v)
          ? ce.box([
              'List',
              ...v.map((x) => (typeof x === 'string' ? { str: x } : x)),
            ] as never)
          : ce.box(v as never),
    ])
  );
  return project(
    ce
      .box(json as never)
      .subs(subs)
      .evaluate()
  );
}

/** The JavaScript value that compiled code gives for the value `v`: a
 * number, a string for a string or a character, an array for a list. The
 * string branch comes first, because a string is also a collection. */
function project(v: Expression): unknown {
  if (isString(v) || isCharacter(v)) return v.string;
  if (v.isNumberLiteral) return v.re;
  if (v.isCollection) return Array.from(v.each(), project);
  return `unexpected value: ${v.toString()}`;
}

/** The compiled JavaScript of `json`, which must compile. */
function compiled(ce: ComputeEngine, json: unknown) {
  const r = compile(ce.box(json as never), {
    to: 'javascript',
    fallback: false,
  });
  expect(r.success).toBe(true);
  return r;
}

const lengthOf = ['Function', ['Length', 's'], 's'];

describe('a string argument of a user function', () => {
  test.each([
    ['inferred', undefined],
    ['declared (collection) -> integer', '(collection) -> integer'],
    // The declaration does not type the body of the generic definition,
    // which keeps the `collection` that the literal infers.
    ['declared (string) -> integer', '(string) -> integer'],
    ['declared (indexed_collection) -> integer', '(indexed_collection) -> integer'],
    ['declared (list<real> | string) -> integer', '(list<real> | string) -> integer'],
  ])('Length counts the characters: %s', (_, signature) => {
    const ce = engineWith(lengthOf, signature);
    const r = compiled(ce, ['f', 't']);
    expect(r.code).toBe('_fn_f_string(_.t)');
    expect(r.preamble ?? '').not.toContain('_SYS.elts');
    for (const t of ['abc', '', '😀a']) {
      expect(r.run!({ t })).toBe(interpreted(ce, ['f', 't'], { t }));
      expect(r.run!({ t })).toBe([...new Intl.Segmenter().segment(t)].length);
    }
  });

  test.each([
    ['At', ['At', 's', 2], '😀'],
    ['Take', ['Take', 's', 2], 'a😀'],
    ['Last', ['Last', 's'], 'b'],
    ['Reverse', ['Reverse', 's'], 'b😀a'],
  ])('the body reads the characters of the string: %s', (_, body, expected) => {
    const ce = engineWith(['Function', body, 's']);
    const r = compiled(ce, ['f', 't']);
    expect(r.run!({ t: 'a😀b' })).toBe(expected);
    expect(interpreted(ce, ['f', 't'], { t: 'a😀b' })).toBe(expected);
  });

  test.each([
    ['beside a real', ['f', 't', 'y'], { t: 'a😀b', y: 2 }],
    ['beside a list bound whole', ['f', 't', 'L'], { t: 'a😀b', L: [1, 2] }],
    [
      'with a call of the same function on a list',
      ['Add', ['f', 't', 'y'], ['f', 'L', 'y']],
      { t: 'a😀b', L: [1, 2], y: 2 },
    ],
    [
      'with an element of a list of strings',
      ['f', ['At', 'S', 1], 'y'],
      { S: ['xyz', 'w'], y: 2 },
    ],
  ])('a function of two parameters: %s', (_, call, values) => {
    const ce = engineWith([
      'Function',
      ['Add', ['Length', 's'], 'x'],
      's',
      'x',
    ]);
    const r = compiled(ce, call);
    expect(r.run!(values)).toEqual(interpreted(ce, call, values));
  });

  test('Reverse with the parameter declared string', () => {
    const ce = engineWith(['Function', ['Reverse', 's'], 's'], '(string) -> string');
    const r = compiled(ce, ['f', 't']);
    expect(r.run!({ t: 'a😀b' })).toBe('b😀a');
    expect(interpreted(ce, ['f', 't'], { t: 'a😀b' })).toBe('b😀a');
  });

  test('a list argument keeps the copy typed by the list', () => {
    const ce = engineWith(lengthOf);
    const r = compiled(ce, ['Add', ['f', 't'], ['f', 'L']]);
    expect(r.code).toContain('_fn_f_string(_.t)');
    expect(r.code).toContain('_fn_f_list_real_(_.L)');
    expect(r.run!({ t: 'a😀b', L: [1, 2, 3] })).toBe(6);
  });

  test('a parameter declared as a list of numbers does not take the copy', () => {
    // The declaration is a contract: a string argument does not match
    // `indexed_collection<integer>`, so no copy typed `string` is made.
    const ce = engineWith(lengthOf, '(indexed_collection<integer>) -> integer');
    const r = compile(ce.box(['f', 't'] as never), { to: 'javascript' });
    expect(r.code ?? '').not.toContain('_fn_f_string');
  });

  test('Max of a string declines in the copy', () => {
    // The interpreter does not give a number for `Max("abc")`. In the copy
    // typed `string`, `Max` of the parameter declines, as it does for an
    // applied function literal.
    const ce = engineWith(['Function', ['Max', 's'], 's'], '(collection) -> real');
    expect(() =>
      compile(ce.box(['f', 't'] as never), {
        to: 'javascript',
        fallback: false,
      })
    ).toThrow(/Could not compile `Max`/);
  });
});
