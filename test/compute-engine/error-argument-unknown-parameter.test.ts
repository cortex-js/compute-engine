import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import { errorFrames } from '../../src/compute-engine/boxed-expression/error-value';

//
// An argument whose value is an error (a valid operand typed `error`, such
// as a symbol that holds the error of `Ln("a")`) passes through the
// argument check at every parameter type. The call then evaluates to the
// error of the argument. Before, a parameter typed `unknown`, a collection
// or `function` refused such an argument with a new `incompatible-type`
// error ("expected `unknown`, got `error`"), which hid the real error. A
// parameter typed `number` or with no type already passed it through.
// The check is in `validateArguments()` (`isErrorTypedOperand()`,
// `src/compute-engine/boxed-expression/validate.ts`); the overload
// prefilter (`prefilterAdmits()`, `overload.ts`) lets it through every arm.
//

let ce: ComputeEngine;
beforeEach(() => {
  ce = new ComputeEngine();
  // `w` holds the error value of `Ln("a")`: its type is `error`, and it is
  // a valid expression.
  ce.assign('w', ce.box(['Ln', "'a'"]).evaluate());
});

/** The error code of an `Error` expression, or `undefined`. */
function errorCode(x: Expression): string | undefined {
  if (x.operator !== 'Error') return undefined;
  const json = x.json;
  if (!Array.isArray(json)) return undefined;
  const code = json[1];
  if (typeof code === 'string') return code.replace(/'/g, '');
  if (Array.isArray(code) && code[0] === 'ErrorCode')
    return [code[1], code[2], code[3]]
      .map((c) => String(c).replace(/'/g, ''))
      .join(' ');
  return undefined;
}

/** The code of the error of `Ln("a")`, with the expected and actual types. */
const LN_ERROR = 'incompatible-type number string';

/** Assign to `name` a function literal with one parameter `a: <type>` and
 * the body `a`. */
function defineIdentity(name: string, type: string): void {
  ce.assign(name, ce.box(['Function', ['Block', 'a'], ['Typed', 'a', `'${type}'`]]));
}

describe('AN ERROR ARGUMENT PASSES THROUGH A TYPED PARAMETER', () => {
  test('the operand is valid and typed `error`', () => {
    const w = ce.symbol('w');
    expect(w.isValid).toBe(true);
    expect(w.type.toString()).toBe('error');
  });

  for (const type of [
    'unknown',
    'number',
    'string',
    'list',
    'list<number>',
    'tuple<unknown>',
    'function',
  ]) {
    test(`a parameter typed \`${type}\`: the call is valid and evaluates to the error of the argument`, () => {
      defineIdentity('op', type);
      const call = ce.box(['op', 'w']);
      expect(call.isValid).toBe(true);
      const v = call.evaluate();
      expect(errorCode(v)).toBe(LN_ERROR);
      // The call adds its own frame, after the frame of `Ln`.
      expect(errorFrames(v)).toEqual([
        { operator: 'Ln', index: 1 },
        { operator: 'op', index: 1 },
      ]);
    });
  }

  test('the body does not read the parameter: the call is still the error of the argument', () => {
    ce.assign('op', ce.box(['Function', ['Block', 5], ['Typed', 'a', "'list'"]]));
    const v = ce.box(['op', 'w']).evaluate();
    expect(errorCode(v)).toBe(LN_ERROR);
  });

  test('an anonymous application: `Apply((a: list) ↦ a, w)` is the error of the argument', () => {
    const call = ce.box([
      'Apply',
      ['Function', ['Block', 'a'], ['Typed', 'a', "'list'"]],
      'w',
    ]);
    expect(call.isValid).toBe(true);
    const v = call.evaluate();
    expect(errorCode(v)).toBe(LN_ERROR);
    expect(errorFrames(v)).toEqual([
      { operator: 'Ln', index: 1 },
      { operator: 'Apply', index: 2 },
    ]);
  });

  test('a function declared with the signature `(list) -> unknown`', () => {
    ce.declare('op', { type: '(list) -> unknown' });
    ce.assign('op', ce.box(['Function', 'a', 'a']));
    const call = ce.box(['op', 'w']);
    expect(call.isValid).toBe(true);
    expect(errorCode(call.evaluate())).toBe(LN_ERROR);
  });

  test('a library operator with a collection parameter: `Length(w)` is the error of the argument', () => {
    const call = ce.box(['Length', 'w']);
    expect(call.isValid).toBe(true);
    const v = call.evaluate();
    expect(errorCode(v)).toBe(LN_ERROR);
    expect(errorFrames(v)).toEqual([
      { operator: 'Ln', index: 1 },
      { operator: 'Length', index: 1 },
    ]);
  });

  test('the argument is passed to the second parameter', () => {
    ce.assign(
      'op',
      ce.box([
        'Function',
        ['Block', 'b'],
        ['Typed', 'a', "'number'"],
        ['Typed', 'b', "'list'"],
      ])
    );
    const v = ce.box(['op', 1, 'w']).evaluate();
    expect(errorCode(v)).toBe(LN_ERROR);
    expect(errorFrames(v)).toEqual([
      { operator: 'Ln', index: 1 },
      { operator: 'op', index: 2 },
    ]);
  });

  test('an argument that is an error at boxing still passes through', () => {
    defineIdentity('op', 'unknown');
    const v = ce.box(['op', ['Ln', "'a'"]]).evaluate();
    expect(errorCode(v)).toBe(LN_ERROR);
    expect(errorFrames(v)).toEqual([
      { operator: 'Ln', index: 1 },
      { operator: 'op', index: 1 },
    ]);
  });
});

describe('AN ERROR ARGUMENT AT AN OVERLOADED FUNCTION SELECTS NO ARM', () => {
  test('the call is valid, and its type is the join of the results of the arms', () => {
    ce.declare('ov', { type: '((number) -> number) & ((string) -> string)' });
    const call = ce.box(['ov', 'w']);
    expect(call.isValid).toBe(true);
    expect(call.type.toString()).toBe('number | string');
  });

  test('an argument that matches no arm is still refused', () => {
    ce.declare('ov', { type: '((number) -> number) & ((string) -> string)' });
    const call = ce.box(['ov', 'True']);
    expect(call.isValid).toBe(false);
    expect(errorCode(call.ops![0])).toBe(
      'incompatible-type number | string boolean'
    );
  });
});

describe('AN ERROR ARGUMENT AT A PARAMETER TYPED BY A BOUNDED TYPE VARIABLE', () => {
  // The type solver (`joinBounds()`, `src/common/type/instantiate.ts`)
  // drops a top-level `error` bound at a call, so the variable is absorbed
  // and its declared bound is not checked against `error`.
  test('`Conjugate(w)` (`(T) -> T where T: number`) is the error of the argument', () => {
    const call = ce.box(['Conjugate', 'w']);
    expect(call.isValid).toBe(true);
    const v = call.evaluate();
    expect(errorCode(v)).toBe(LN_ERROR);
    expect(errorFrames(v)).toEqual([
      { operator: 'Ln', index: 1 },
      { operator: 'Conjugate', index: 1 },
    ]);
  });

  for (const [op, args] of [
    ['Remainder', ['w', 2]],
    ['Chop', ['w']],
    ['BaseForm', ['w']],
    ['PlusMinus', ['w', 1]],
  ] as const) {
    test(`\`${op}\` with the error argument first is the error of the argument`, () => {
      const call = ce.box([op, ...args]);
      expect(call.isValid).toBe(true);
      expect(errorCode(call.evaluate())).toBe(LN_ERROR);
    });
  }

  test('a function declared `(T) -> T where T: number`', () => {
    ce.declare('g', { type: '(T) -> T where T: number' });
    ce.assign('g', ce.box(['Function', 'a', 'a']));
    const call = ce.box(['g', 'w']);
    expect(call.isValid).toBe(true);
    expect(errorCode(call.evaluate())).toBe(LN_ERROR);
  });

  test('a function declared `(T) -> T where T: indexed_collection`', () => {
    ce.declare('g', { type: '(T) -> T where T: indexed_collection' });
    ce.assign('g', ce.box(['Function', 'a', 'a']));
    const call = ce.box(['g', 'w']);
    expect(call.isValid).toBe(true);
    expect(errorCode(call.evaluate())).toBe(LN_ERROR);
  });

  test('another argument still constrains the variable: `(T, T) -> T where T: number` refuses a string', () => {
    ce.declare('g', { type: '(T, T) -> T where T: number' });
    const call = ce.box(['g', 'w', "'x'"]);
    expect(call.isValid).toBe(false);
  });

  test('the type of a generic arm is read at its bound: `((T) -> T where T: number) & ((string) -> string)` applied to `w` is `number | string`', () => {
    ce.declare('ov', {
      type: '((T) -> T where T: number) & ((string) -> string)',
    });
    const call = ce.box(['ov', 'w']);
    expect(call.isValid).toBe(true);
    expect(call.type.toString()).toBe('number | string');
  });
});

describe('AN ERROR CONDITION', () => {
  test('`If(w, 1, 2)` is the error of the condition', () => {
    const call = ce.box(['If', 'w', 1, 2]);
    expect(call.isValid).toBe(true);
    const v = call.evaluate();
    expect(errorCode(v)).toBe(LN_ERROR);
    expect(errorFrames(v)).toEqual([
      { operator: 'Ln', index: 1 },
      { operator: 'If', index: 1 },
    ]);
  });

  test('`Which(w, 1, True, 2)` is the error of the condition', () => {
    const call = ce.box(['Which', 'w', 1, 'True', 2]);
    expect(call.isValid).toBe(true);
    expect(errorCode(call.evaluate())).toBe(LN_ERROR);
  });

  test('a string condition is still refused', () => {
    const call = ce.box(['If', "'x'", 1, 2]);
    expect(call.isValid).toBe(false);
  });
});

describe('A SYMBOL DECLARED `error` WITH NO VALUE IS STILL REFUSED', () => {
  // Such a symbol evaluates to itself, not to an error, so it is not passed
  // through (`isErrorTypedOperand()`,
  // `src/compute-engine/boxed-expression/error-typed-operand.ts`).
  beforeEach(() => ce.declare('e', 'error'));

  test('at a parameter typed `list`', () => {
    defineIdentity('op', 'list');
    const call = ce.box(['op', 'e']);
    expect(call.isValid).toBe(false);
    expect(errorCode(call.ops![0])).toBe('incompatible-type list error');
  });

  test('at a parameter typed by a bounded type variable', () => {
    ce.declare('g', { type: '(T) -> T where T: number' });
    const call = ce.box(['g', 'e']);
    expect(call.isValid).toBe(false);
    expect(errorCode(call.ops![0])).toBe('incompatible-type number error');
  });

  test('at an overloaded function', () => {
    ce.declare('ov', { type: '((number) -> number) & ((string) -> string)' });
    const call = ce.box(['ov', 'e']);
    expect(call.isValid).toBe(false);
    expect(errorCode(call.ops![0])).toBe(
      'incompatible-type number | string error'
    );
  });

  test('as a condition', () => {
    expect(ce.box(['If', 'e', 1, 2]).isValid).toBe(false);
  });
});

describe('A SYMBOL DECLARED `error` WITH NO VALUE AT A TYPE VARIABLE THAT ACCEPTS `error`', () => {
  // The solver absorbs the type variable, and `validateArguments()` then
  // checks the symbol against the parameter with the variable read at its
  // declared bound, or at `any` when it has no bound. The type `error` is a
  // subtype of `any` and of `error`, so these calls are valid. The library
  // operator route is used: the route of a function held as a value drops
  // such a refusal on its own (`keepProvisionalOperands()`).
  beforeEach(() => ce.declare('e', 'error'));

  for (const where of ['where T: any', 'where T: error', 'where T']) {
    test(`\`(T) -> T ${where}\` admits it`, () => {
      ce.declare('f', {
        signature: `(T) -> T ${where}`,
        evaluate: (ops) => ops[0],
      });
      const call = ce.box(['f', 'e']);
      expect(call.isValid).toBe(true);
      expect(call.ops![0].symbol).toBe('e');
    });
  }

  test('`(T) -> T where T: number` still refuses it', () => {
    ce.declare('f', {
      signature: '(T) -> T where T: number',
      evaluate: (ops) => ops[0],
    });
    const call = ce.box(['f', 'e']);
    expect(call.isValid).toBe(false);
    expect(errorCode(call.ops![0])).toBe('incompatible-type number error');
  });
});

describe('AN APPLICATION TYPED `error` BY ITS DECLARED RESULT TYPE IS NOT AN ERROR VALUE', () => {
  // A declared result type is a promise of the host: `g(2)` is typed
  // `error`, but with no body it evaluates to itself. It is not passed
  // through as an error argument (`isErrorTypedOperand()`,
  // `src/compute-engine/boxed-expression/error-typed-operand.ts`).
  beforeEach(() => ce.declare('g', '(number) -> error'));

  test('`g(2)` is valid and typed `error`', () => {
    const call = ce.box(['g', 2]);
    expect(call.isValid).toBe(true);
    expect(call.type.toString()).toBe('error');
  });

  test('as a condition: `If(g(2), 1, 2)` is refused', () => {
    const call = ce.box(['If', ['g', 2], 1, 2]);
    expect(call.isValid).toBe(false);
    expect(errorCode(call.ops![0])).toBe('incompatible-type boolean error');
  });

  test('at a parameter typed by a bounded type variable: `Conjugate(g(2))` is refused', () => {
    const call = ce.box(['Conjugate', ['g', 2]]);
    expect(call.isValid).toBe(false);
    expect(errorCode(call.ops![0])).toBe('incompatible-type number error');
  });

  test('at a parameter typed `list`', () => {
    defineIdentity('op', 'list');
    const call = ce.box(['op', ['g', 2]]);
    expect(call.isValid).toBe(false);
    expect(errorCode(call.ops![0])).toBe('incompatible-type list error');
  });

  test('a symbol declared `error` that holds `g(2)` is refused as a condition', () => {
    // The value of `h` is not an `Error` expression.
    ce.declare('h', 'error');
    ce.assign('h', ce.box(['g', 2]));
    const call = ce.box(['If', 'h', 1, 2]);
    expect(call.isValid).toBe(false);
    expect(errorCode(call.ops![0])).toBe('incompatible-type boolean error');
  });
});

describe('AN ERROR ARGUMENT AND AN EMPTY LIST AT A GENERIC SIGNATURE', () => {
  // The solver drops the bound of the error argument and the `never` bound
  // of the element of `[]` (`joinBounds()`, `src/common/type/instantiate.ts`).
  // Before, the variable was solved to `never`.
  test('`(T, list<T>) -> list<T> where T` is typed `list<unknown>`', () => {
    ce.declare('m', { type: '(T, list<T>) -> list<T> where T' });
    const call = ce.box(['m', 'w', ['List']]);
    expect(call.isValid).toBe(true);
    expect(call.type.toString()).toBe('list<unknown>');
  });

  test('`(T, list<T>) -> T where T: number` is not typed `never`', () => {
    ce.declare('m', { type: '(T, list<T>) -> T where T: number' });
    const call = ce.box(['m', 'w', ['List']]);
    expect(call.isValid).toBe(true);
    expect(call.type.toString()).toBe('unknown');
  });
});

describe('A LAZY OVERLOADED OPERATOR', () => {
  test('a held raw function literal with no body is boxed without reading its type', () => {
    // The overload prefilter tests the `error` type only after the lazy
    // test: a held operand is unbound, and reading the type of a raw
    // `["Function"]` throws.
    ce.declare('lz', {
      signature: '((function) -> integer) & ((number) -> integer)',
      lazy: true,
      evaluate: () => ce.number(1),
    });
    expect(() => ce.box(['lz', ['Function']])).not.toThrow();
  });
});

describe('THE OTHER ARGUMENT CHECKS ARE UNCHANGED', () => {
  test('a value of the wrong type is refused', () => {
    defineIdentity('op', 'number');
    const call = ce.box(['op', "'x'"]);
    expect(call.isValid).toBe(false);
    const v = call.evaluate();
    expect(errorCode(v)).toBe('incompatible-type number string');
  });

  test('a string at a `list` parameter is refused', () => {
    defineIdentity('op', 'list');
    const call = ce.box(['op', "'x'"]);
    expect(call.isValid).toBe(false);
    expect(errorCode(call.evaluate())).toBe('incompatible-type list string');
  });

  test('a missing argument is the `missing` error', () => {
    defineIdentity('op', 'unknown');
    const call = ce.box(['op']);
    expect(call.isValid).toBe(false);
    expect(errorCode(call.evaluate())).toBe('missing');
  });
});
