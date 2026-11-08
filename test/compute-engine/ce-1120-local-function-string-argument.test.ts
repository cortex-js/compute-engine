/**
 * A block-local function whose parameter is a collection, used with a
 * string, on the JavaScript target.
 *
 * A string is a collection of its characters, so the body of
 * `g := s ↦ Length(s)` infers `s: collection`. A block binds the literal
 * of a local function once, compiled against that type: `Length` of a
 * `collection` reads the operand with `_SYS.elts`, which throws a
 * `RangeError` for a string. `g(t)` with a string `t`, and `Map(g, S)` over
 * `S: list<string>`, threw, while the interpreter gives the number of
 * characters.
 *
 * A use that gives a string now compiles the literal with the parameter
 * typed `string` at that use (`stringTypedLocalLiteral()` in
 * `compile-user-functions.ts`): the call is the application of that
 * literal, and the callback is that literal. A use that gives a list keeps
 * the binding of the block. When the typed literal cannot be written at
 * the use, the compilation declines.
 *
 * The same uses of a function defined on the engine are in
 * `ce-1036-user-function-string-argument.test.ts` (a call) and
 * `ce-1076-user-function-string-callback.test.ts` (a callback).
 */

import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import {
  isCharacter,
  isString,
} from '../../src/compute-engine/boxed-expression/type-guards';

type Inputs = Record<string, string | number | string[] | number[]>;

/** An engine with `S: list<string>`, `t: string`, `L: list<real>` and
 * `n: real`, all without a value. */
function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('S', 'list<string>');
  ce.declare('t', 'string');
  ce.declare('L', 'list<real>');
  ce.declare('n', 'real');
  return ce;
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

/** The boxed value of one input. */
function boxed(ce: ComputeEngine, value: Inputs[string]): Expression {
  const one = (x: string | number) => (typeof x === 'string' ? { str: x } : x);
  return ce.box(
    (Array.isArray(value) ? ['List', ...value.map(one)] : one(value)) as never
  );
}

/**
 * The value that the compiled JavaScript of `json` gives for `inputs`, and
 * the value that the interpreter gives. The expression is compiled first:
 * an input with a value would be written into the code as a constant.
 */
function both(
  json: unknown,
  inputs: Inputs
): { code: string; compiled: unknown; interpreted: unknown } {
  const ce = engine();
  const expr = ce.box(json as never);
  const r = compile(expr, { to: 'javascript', fallback: false });
  expect(r.success).toBe(true);
  const compiled = r.run!(inputs as never);
  for (const [name, value] of Object.entries(inputs))
    ce.assign(name, boxed(ce, value));
  return { code: r.code, compiled, interpreted: project(expr.evaluate()) };
}

/** The reason for which the JavaScript compilation of `json` declines. */
function declineReason(json: unknown): string {
  const ce = engine();
  try {
    compile(ce.box(json as never), { to: 'javascript', fallback: false });
  } catch (e) {
    return (e as Error).message;
  }
  return 'the expression compiled';
}

const lengthOf = ['Function', ['Length', 's'], 's'];
const longerThanOne = ['Function', ['Greater', ['Length', 's'], 1], 's'];
const strings = ['xy', 'z', 'a😀b', ''];

/** `g := fn` local to a block whose value is `use`. */
const withLocal = (fn: unknown, use: unknown) => [
  'Block',
  ['Assign', 'g', fn],
  use,
];

describe('a call of a block-local function with a string', () => {
  test('g(t) counts the characters', () => {
    const r = both(withLocal(lengthOf, ['g', 't']), { t: 'a😀b' });
    expect(r.code).toContain('((s) => _SYS.chars(s).length)');
    expect(r.compiled).toBe(3);
    expect(r.compiled).toEqual(r.interpreted);
  });

  test('a local bound by a Declare statement', () => {
    const r = both(
      [
        'Block',
        ['Declare', 'g', { str: '(collection) -> integer' }, lengthOf],
        ['g', 't'],
      ],
      { t: 'abc' }
    );
    expect(r.compiled).toBe(3);
    expect(r.compiled).toEqual(r.interpreted);
  });

  test('a parameter typed collection in the literal', () => {
    const fn = ['Function', ['Length', 's'], ['Typed', 's', 'collection']];
    const r = both(withLocal(fn, ['g', 't']), { t: 'abc' });
    expect(r.compiled).toBe(3);
    expect(r.compiled).toEqual(r.interpreted);
  });

  test('the body reads the characters of the string: Reverse', () => {
    const fn = ['Function', ['Reverse', 's'], 's'];
    const r = both(withLocal(fn, ['g', 't']), { t: 'a😀b' });
    expect(r.compiled).toBe('b😀a');
    expect(r.compiled).toEqual(r.interpreted);
  });

  test('a string and a list given to the same local', () => {
    // The call with the list keeps the binding of the block.
    const r = both(withLocal(lengthOf, ['Add', ['g', 't'], ['g', 'L']]), {
      t: 'abc',
      L: [1, 2],
    });
    expect(r.code).toContain('g(_.L)');
    expect(r.compiled).toBe(5);
    expect(r.compiled).toEqual(r.interpreted);
  });

  test('a call inside a function literal', () => {
    const use = ['Map', ['Function', ['Add', ['g', 'x'], 1], 'x'], 'S'];
    const r = both(withLocal(lengthOf, use), { S: strings });
    expect(r.compiled).toEqual([3, 2, 4, 1]);
    expect(r.compiled).toEqual(r.interpreted);
  });

  test('a second parameter that receives a number', () => {
    const fn = ['Function', ['Add', ['Length', 's'], 'k'], 's', 'k'];
    const r = both(withLocal(fn, ['g', 't', 'n']), { t: 'abc', n: 2 });
    expect(r.compiled).toBe(5);
    expect(r.compiled).toEqual(r.interpreted);
  });

  test('a second collection parameter that receives a list', () => {
    const fn = [
      'Function',
      ['Add', ['Length', 's'], ['Length', 'xs']],
      's',
      'xs',
    ];
    const r = both(withLocal(fn, ['g', 't', 'L']), { t: 'abc', L: [1, 2] });
    expect(r.compiled).toBe(5);
    expect(r.compiled).toEqual(r.interpreted);
  });

  test('the body reads an input of the compiled function', () => {
    const fn = ['Function', ['Add', ['Length', 's'], 'n'], 's'];
    const r = both(withLocal(fn, ['g', 't']), { t: 'abc', n: 5 });
    expect(r.compiled).toBe(8);
    expect(r.compiled).toEqual(r.interpreted);
  });

  test('the compilation does not declare the parameter in the engine', () => {
    const ce = engine();
    compile(ce.box(withLocal(lengthOf, ['g', 't']) as never), {
      to: 'javascript',
      fallback: false,
    });
    expect(ce.lookupDefinition('s')).toBeUndefined();
    expect(ce.lookupDefinition('g')).toBeUndefined();
  });
});

describe('a block-local function as the callback over a list of strings', () => {
  test('Map(g, S) counts the characters of each string', () => {
    const r = both(withLocal(lengthOf, ['Map', 'g', 'S']), { S: strings });
    expect(r.code).toContain('((s) => _SYS.chars(s).length)');
    expect(r.compiled).toEqual([2, 1, 3, 0]);
    expect(r.compiled).toEqual(r.interpreted);
  });

  test('a list of literal strings', () => {
    const ce = new ComputeEngine();
    ce.declare('S', 'list<"ab" | "c">');
    const r = compile(ce.box(withLocal(lengthOf, ['Map', 'g', 'S']) as never), {
      to: 'javascript',
      fallback: false,
    });
    expect(r.run!({ S: ['ab', 'c'] } as never)).toEqual([2, 1]);
  });

  test.each([
    ['Filter', ['Filter', 'S', 'g']],
    ['Count', ['Count', 'S', 'g']],
    ['Any', ['Any', 'S', 'g']],
    ['All', ['All', 'S', 'g']],
  ])('a predicate: %s', (_, use) => {
    const r = both(withLocal(longerThanOne, use), { S: strings });
    expect(r.compiled).toEqual(r.interpreted);
  });

  test('the body reads the characters of the string: Reverse', () => {
    const fn = ['Function', ['Reverse', 's'], 's'];
    const r = both(withLocal(fn, ['Map', 'g', 'S']), { S: strings });
    expect(r.compiled).toEqual(['yx', 'z', 'b😀a', '']);
    expect(r.compiled).toEqual(r.interpreted);
  });
});

describe('uses that keep the binding of the block', () => {
  test('a parameter typed string in the literal', () => {
    // The binding is compiled with `s: string`, so it counts the
    // characters and no other literal is needed.
    const fn = ['Function', ['Length', 's'], ['Typed', 's', 'string']];
    const r = both(withLocal(fn, ['Map', 'g', 'S']), { S: strings });
    expect(r.code).toContain('(g)');
    expect(r.compiled).toEqual([2, 1, 3, 0]);
  });

  test('a list argument', () => {
    const r = both(withLocal(lengthOf, ['g', 'L']), { L: [1, 2] });
    expect(r.code).toContain('g(_.L)');
    expect(r.code).not.toContain('_SYS.chars');
    expect(r.compiled).toBe(2);
  });
});

describe('uses that decline', () => {
  // The literal typed `string` is written at the use. A name that its body
  // reads and that is bound at the use could be another binding there.
  test('the body reads another local of the block', () => {
    const fn = ['Function', ['Add', ['Length', 's'], 'k'], 's'];
    const json = ['Block', ['Assign', 'k', 2], ['Assign', 'g', fn], ['g', 't']];
    expect(declineReason(json)).toMatch(/its body reads or calls `k`/);
  });

  test('the body calls another function of the block', () => {
    const json = [
      'Block',
      ['Assign', 'k', ['Function', ['Multiply', 2, 'x'], 'x']],
      ['Assign', 'g', ['Function', ['k', ['Length', 's']], 's']],
      ['g', 't'],
    ];
    expect(declineReason(json)).toMatch(/its body reads or calls `k`/);
  });

  test('a recursive function, as a call and as a callback', () => {
    const fn = [
      'Function',
      ['If', ['Equal', ['Length', 's'], 0], 0, ['Add', 1, ['g', ['Rest', 's']]]],
      's',
    ];
    const reason = /its body reads or calls `g`/;
    expect(declineReason(withLocal(fn, ['g', 't']))).toMatch(reason);
    expect(declineReason(withLocal(fn, ['Map', 'g', 'S']))).toMatch(reason);
  });

  test('a list at a scalar parameter beside the string', () => {
    // The interpreter binds the list whole and adds 3 to each element. The
    // literal typed `string` has only scalar parameters, and its
    // application would map over the list.
    const fn = ['Function', ['Add', ['Length', 's'], 'k'], 's', 'k'];
    expect(declineReason(withLocal(fn, ['g', 't', 'L']))).toMatch(
      /argument 2, of type `list<real>`, is not provably a scalar/
    );
  });

  test.each([['(list<real>) -> integer'], ['(list) -> integer']])(
    'a Declare statement whose parameter type no string has: %s',
    (signature) => {
      // The interpreter gives an `incompatible-type` error for `g(t)`.
      const json = [
        'Block',
        ['Declare', 'g', { str: signature }, lengthOf],
        ['g', 't'],
      ];
      expect(declineReason(json)).toMatch(
        /a `Declare` statement declares with the type `list(<real>)?`/
      );
      const ce = engine();
      ce.assign('t', ce.string('abc'));
      const value = ce.box(json as never).evaluate();
      expect(value.operator).toBe('Error');
      expect(JSON.stringify(value.json)).toContain('incompatible-type');
    }
  );

  test('a declined compilation falls back to the interpreter', () => {
    const fn = ['Function', ['Add', ['Length', 's'], 'k'], 's'];
    const json = ['Block', ['Assign', 'k', 2], ['Assign', 'g', fn], ['g', 't']];
    const ce = engine();
    const r = compile(ce.box(json as never), { to: 'javascript' });
    expect(r.success).toBe(false);
    expect(r.run!({ t: 'abc' } as never)).toBe(5);
  });
});
