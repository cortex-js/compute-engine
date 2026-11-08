/**
 * A user function given by its name as the callback of `Map`, `Filter`,
 * `Count` or `Any` over a list of strings, on the JavaScript target.
 *
 * A string is a collection of its characters, so the body of
 * `f := s ↦ Length(s)` infers `s: collection`. A bare symbol in callback
 * position compiled to the generic definition `_fn_f`, whose `Length` of a
 * `collection` reads the operand with `_SYS.elts`, which throws a
 * `RangeError` for a string: `Map(f, S)` over `S: list<string>` threw,
 * while the interpreter gives the number of characters of each string. The
 * callback is now the expansion `(_x: string) ↦ f(_x)`, whose call takes
 * the copy of `f` with the parameter typed `string` (`_fn_f_string`,
 * `stringElementCallbackEta()` in `compile-user-functions.ts`).
 *
 * The direct call `f(t)` with a string `t` is in
 * `ce-1036-user-function-string-argument.test.ts`.
 */

import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import {
  isCharacter,
  isString,
} from '../../src/compute-engine/boxed-expression/type-guards';

/** An engine with `S: list<string>` and `f` assigned the function literal
 * `fn`. With `signature`, `f` is declared with it first. */
function engineWith(fn: unknown, signature?: string): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('S', 'list<string>');
  if (signature !== undefined) ce.declare('f', signature);
  ce.box(['Assign', 'f', fn] as never).evaluate();
  return ce;
}

/** The value of `json` given by the interpreter with `S` replaced by the
 * list of the strings `strings`. */
function interpreted(
  ce: ComputeEngine,
  json: unknown,
  strings: string[]
): unknown {
  const S = ce.box(['List', ...strings.map((s) => ({ str: s }))] as never);
  return project(
    ce
      .box(json as never)
      .subs({ S })
      .evaluate()
  );
}

/** The JavaScript value that compiled code gives for the value `v`. The
 * string branch comes first, because a string is also a collection. */
function project(v: Expression): unknown {
  if (isString(v) || isCharacter(v)) return v.string;
  if (v.symbol === 'True') return true;
  if (v.symbol === 'False') return false;
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
const longerThanOne = ['Function', ['Greater', ['Length', 's'], 1], 's'];
const strings = ['xy', 'z', 'a😀b', ''];

describe('a user function as the callback over a list of strings', () => {
  test.each([
    ['inferred', undefined],
    ['declared (collection) -> integer', '(collection) -> integer'],
    // The declaration does not type the body of the generic definition,
    // which keeps the `collection` that the literal infers.
    ['declared (string) -> integer', '(string) -> integer'],
  ])('Map(f, S) counts the characters: %s', (_, signature) => {
    const ce = engineWith(lengthOf, signature);
    const r = compiled(ce, ['Map', 'f', 'S']);
    expect(r.code).toBe(
      '((_f) => (_.S).map((_x) => _f(_x)))(((_x) => _fn_f_string(_x)))'
    );
    expect(r.preamble ?? '').not.toContain('_SYS.elts');
    expect(r.run!({ S: strings })).toEqual([2, 1, 3, 0]);
    expect(r.run!({ S: strings })).toEqual(
      interpreted(ce, ['Map', 'f', 'S'], strings)
    );
  });

  test('a parameter typed collection in the literal', () => {
    const ce = engineWith([
      'Function',
      ['Length', 's'],
      ['Typed', 's', { str: 'collection' }],
    ]);
    const r = compiled(ce, ['Map', 'f', 'S']);
    expect(r.run!({ S: strings })).toEqual([2, 1, 3, 0]);
  });

  test('a list of literal strings', () => {
    const ce = new ComputeEngine();
    ce.declare('S', 'list<"ab" | "c">');
    ce.box(['Assign', 'f', lengthOf] as never).evaluate();
    const r = compiled(ce, ['Map', 'f', 'S']);
    expect(r.run!({ S: ['ab', 'c'] })).toEqual([2, 1]);
  });

  test.each([
    ['Filter', ['Filter', 'S', 'f']],
    ['Count', ['Count', 'S', 'f']],
    ['Any', ['Any', 'S', 'f']],
    ['All', ['All', 'S', 'f']],
  ])('a predicate: %s', (_, json) => {
    const ce = engineWith(longerThanOne);
    const r = compiled(ce, json);
    expect(r.code).toContain('_fn_f_string');
    expect(r.run!({ S: strings })).toEqual(interpreted(ce, json, strings));
  });

  test('the body reads the characters of the string: Reverse', () => {
    const ce = engineWith(['Function', ['Reverse', 's'], 's']);
    const r = compiled(ce, ['Map', 'f', 'S']);
    expect(r.run!({ S: strings })).toEqual(['yx', 'z', 'b😀a', '']);
    expect(r.run!({ S: strings })).toEqual(
      interpreted(ce, ['Map', 'f', 'S'], strings)
    );
  });

  test('a parameter typed string in the literal keeps the generic definition', () => {
    // The body is compiled with `s: string`, so the generic definition
    // counts the characters and no copy is needed.
    const ce = engineWith([
      'Function',
      ['Length', 's'],
      ['Typed', 's', { str: 'string' }],
    ]);
    const r = compiled(ce, ['Map', 'f', 'S']);
    expect(r.code).toBe('((_f) => (_.S).map((_x) => _f(_x)))(_fn_f)');
    expect(r.run!({ S: strings })).toEqual([2, 1, 3, 0]);
  });

  test('the compilation does not declare the parameter of the expansion', () => {
    const ce = engineWith(lengthOf);
    compiled(ce, ['Map', 'f', 'S']);
    expect(ce.lookupDefinition('_x')).toBeUndefined();
  });

  test('a callback that the caller maps in vars is read once', () => {
    // The caller supplies the code of `f`. The expansion would read that
    // code again for each element.
    const ce = engineWith(lengthOf);
    const r = compile(ce.box(['Map', 'f', 'S'] as never), {
      to: 'javascript',
      fallback: false,
      vars: { f: '_.makeF()' },
    });
    expect(r.code).not.toContain('_fn_f_string');
    let made = 0;
    const makeF = () => {
      made += 1;
      return (s: string) => s.length;
    };
    expect(r.run!({ S: ['xy', 'z'], makeF } as never)).toEqual([2, 1]);
    expect(made).toBe(1);
  });

  test('a parameter inferred string keeps the generic definition', () => {
    const ce = engineWith(['Function', ['Equal', 's', { str: 'z' }], 's']);
    const r = compiled(ce, ['Filter', 'S', 'f']);
    expect(r.code).toBe('((_f) => (_.S).filter((_x) => _f(_x)))(_fn_f)');
    expect(r.run!({ S: strings })).toEqual(['z']);
  });
});
