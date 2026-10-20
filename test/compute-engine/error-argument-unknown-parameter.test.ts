import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';
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

describe('A SYMBOL DECLARED `error` WITH NO VALUE', () => {
  // Such a symbol evaluates to itself, not to an error, so it is not passed
  // through as an error (`isErrorTypedOperand()`,
  // `src/compute-engine/boxed-expression/error-typed-operand.ts`). It is
  // checked as an ordinary operand of type `error`. The type `error`
  // overlaps every type (`overlapAdmission()`,
  // `src/compute-engine/boxed-expression/validate.ts`), so a scalar
  // parameter admits it on the ground and on the generic route alike (user
  // decision 2026-10-19), and a collection parameter refuses it.
  beforeEach(() => ce.declare('e', 'error'));

  test('at a parameter typed `list`: refused', () => {
    defineIdentity('op', 'list');
    const call = ce.box(['op', 'e']);
    expect(call.isValid).toBe(false);
    expect(errorCode(call.ops![0])).toBe('incompatible-type list error');
  });

  test('at a function-literal parameter typed `unknown`: refused', () => {
    defineIdentity('op', 'unknown');
    const call = ce.box(['op', 'e']);
    expect(call.isValid).toBe(false);
    expect(errorCode(call.ops![0])).toBe('incompatible-type unknown error');
  });

  test('at a ground parameter typed `number`: admitted, the call evaluates to itself', () => {
    ce.declare('g', '(number) -> number');
    const call = ce.box(['g', 'e']);
    expect(call.isValid).toBe(true);
    expect(call.type.toString()).toBe('number');
    expect(call.evaluate().toString()).toBe('g(e)');
  });

  test('at a parameter typed by a type variable bounded by `number`: admitted, the call evaluates to itself', () => {
    ce.declare('g', { type: '(T) -> T where T: number' });
    const call = ce.box(['g', 'e']);
    expect(call.isValid).toBe(true);
    // The variable is absorbed: the call is typed `unknown`, not `error`.
    expect(call.type.toString()).toBe('unknown');
    expect(call.evaluate().toString()).toBe('g(e)');
  });

  test('`Conjugate(e)` is valid and evaluates to itself, as `Sqrt(e)` does', () => {
    for (const op of ['Conjugate', 'Sqrt']) {
      const call = ce.box([op, 'e']);
      expect(call.isValid).toBe(true);
      expect(call.evaluate().isSame(call)).toBe(true);
    }
  });

  test('at a parameter typed by a type variable bounded by a collection: refused, as at `list`', () => {
    ce.declare('g', { type: '(T) -> T where T: indexed_collection' });
    const call = ce.box(['g', 'e']);
    expect(call.isValid).toBe(false);
    expect(errorCode(call.ops![0])).toBe(
      'incompatible-type indexed_collection error'
    );
  });

  test('at an overloaded function: refused', () => {
    ce.declare('ov', { type: '((number) -> number) & ((string) -> string)' });
    const call = ce.box(['ov', 'e']);
    expect(call.isValid).toBe(false);
    expect(errorCode(call.ops![0])).toBe(
      'incompatible-type number | string error'
    );
  });

  test('as a condition: admitted, as at a parameter typed `boolean`; no branch is selected', () => {
    const call = ce.box(['If', 'e', 1, 2]);
    expect(call.isValid).toBe(true);
    expect(call.evaluate().toString()).toBe('If(e, 1, 2)');
    expect(ce.box(['Which', 'e', 1, 'True', 2]).isValid).toBe(true);
  });
});

describe('A SYMBOL DECLARED `error` WITH NO VALUE AT A LIBRARY OPERATOR WITH A TYPE VARIABLE', () => {
  // The solver absorbs the type variable, and `validateArguments()` then
  // checks the symbol against the parameter with the variable read at its
  // declared bound, or at `any` when it has no bound, by the rule of the
  // ground route.
  beforeEach(() => ce.declare('e', 'error'));

  for (const where of [
    'where T: any',
    'where T: error',
    'where T',
    'where T: number',
  ]) {
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

  test('`(T) -> T where T: list` refuses it', () => {
    ce.declare('f', {
      signature: '(T) -> T where T: list',
      evaluate: (ops) => ops[0],
    });
    const call = ce.box(['f', 'e']);
    expect(call.isValid).toBe(false);
    expect(errorCode(call.ops![0])).toBe('incompatible-type list error');
  });
});

describe('AN APPLICATION TYPED `error` BY ITS DECLARED RESULT TYPE IS NOT AN ERROR VALUE', () => {
  // A declared result type is a promise of the host: `g(2)` is typed
  // `error`, but with no body it evaluates to itself. It is not passed
  // through as an error argument (`isErrorTypedOperand()`,
  // `src/compute-engine/boxed-expression/error-typed-operand.ts`). It is
  // checked as a symbol declared `error` with no value is.
  beforeEach(() => ce.declare('g', '(number) -> error'));

  test('`g(2)` is valid and typed `error`', () => {
    const call = ce.box(['g', 2]);
    expect(call.isValid).toBe(true);
    expect(call.type.toString()).toBe('error');
  });

  test('as a condition: `If(g(2), 1, 2)` is valid and evaluates to itself', () => {
    const call = ce.box(['If', ['g', 2], 1, 2]);
    expect(call.isValid).toBe(true);
    expect(call.evaluate().toString()).toBe('If(g(2), 1, 2)');
  });

  test('at a parameter typed by a bounded type variable: `Conjugate(g(2))` is valid and evaluates to itself', () => {
    const call = ce.box(['Conjugate', ['g', 2]]);
    expect(call.isValid).toBe(true);
    expect(call.evaluate().toString()).toBe('Conjugate(g(2))');
  });

  test('at a parameter typed `list`: refused', () => {
    defineIdentity('op', 'list');
    const call = ce.box(['op', ['g', 2]]);
    expect(call.isValid).toBe(false);
    expect(errorCode(call.ops![0])).toBe('incompatible-type list error');
  });

  test('a symbol declared `error` that holds `g(2)` is admitted as a condition', () => {
    // The value of `h` is not an `Error` expression.
    ce.declare('h', 'error');
    ce.assign('h', ce.box(['g', 2]));
    const call = ce.box(['If', 'h', 1, 2]);
    expect(call.isValid).toBe(true);
    expect(call.evaluate().toString()).toBe('If(g(2), 1, 2)');
  });
});

describe('AN ERROR ARGUMENT AT THE CALLBACK PARAMETER OF A COLLECTION OPERATOR', () => {
  // The lazy operators (`Any`, `Filter`, `Reduce`, `Map`) hold their
  // operands, so `w` is not evaluated before the handler runs. Their
  // canonical form keeps `w` (`canonicalCallbackOperand()`,
  // `src/compute-engine/library/collections.ts`), and their evaluation gives
  // the error of `w` (`heldErrorCallback()`,
  // `src/compute-engine/boxed-expression/boxed-function.ts`). Before, they
  // reported "expected `function`, got `error`".
  for (const [name, expr, index, frame] of [
    ['Any', ['Any', ['List', 1, 2], 'w'], 2],
    ['All', ['All', ['List', 1, 2], 'w'], 2],
    ['Filter', ['Filter', ['List', 1, 2], 'w'], 2],
    ['Reduce', ['Reduce', ['List', 1, 2], 'w'], 2],
    ['Scan', ['Scan', ['List', 1, 2], 'w'], 2],
    ['TakeWhile', ['TakeWhile', ['List', 1, 2], 'w'], 2],
    ['MaxBy', ['MaxBy', ['List', 1, 2], 'w'], 2],
    // `Fold` is canonicalized to `Reduce`, whose callback is the second
    // operand.
    ['Fold', ['Fold', 'w', 0, ['List', 1, 2]], 2, 'Reduce'],
    ['Map', ['Map', 'w', ['List', 1, 2]], 1],
    ['Map over a range', ['Map', 'w', ['Range', 1, 3]], 1],
    // The eager operators already gave the error of `w`.
    ['Count', ['Count', ['List', 1, 2], 'w'], 2],
    ['CountIf', ['CountIf', ['List', 1, 2], 'w'], 2],
    ['Sort', ['Sort', ['List', 2, 1], 'w'], 2],
  ] as [string, unknown[], number, string?][]) {
    test(`\`${name}\` is valid and evaluates to the error of the callback`, () => {
      const call = ce.box(expr as MathJsonExpression);
      expect(call.isValid).toBe(true);
      const v = call.evaluate();
      expect(errorCode(v)).toBe(LN_ERROR);
      expect(errorFrames(v)).toEqual([
        { operator: 'Ln', index: 1 },
        { operator: frame ?? expr[0], index },
      ]);
    });
  }

  test('the asynchronous evaluation gives the same error', async () => {
    const v = await ce.box(['Filter', ['List', 1, 2], 'w']).evaluateAsync();
    expect(errorCode(v)).toBe(LN_ERROR);
    expect(errorFrames(v)).toEqual([
      { operator: 'Ln', index: 1 },
      { operator: 'Filter', index: 2 },
    ]);
  });

  test('a parameter named like the symbol shadows it', () => {
    ce.assign('h', ce.box(['Function', ['Filter', ['List', 1, 2], 'w'], 'w']));
    const v = ce.box(['h', ['Function', ['Greater', 'x', 1], 'x']]).evaluate();
    expect(v.toString()).toBe('[2]');
  });

  test('the asynchronous evaluation of `Map(w, xs)` gives the same error', async () => {
    const v = await ce.box(['Map', 'w', ['List', 1, 2]]).evaluateAsync();
    expect(errorCode(v)).toBe(LN_ERROR);
    expect(errorFrames(v)).toEqual([
      { operator: 'Ln', index: 1 },
      { operator: 'Map', index: 1 },
    ]);
  });

  test('an element read directly is the error: `Map(w, [1, 2]).at(1)`', () => {
    const x = ce.box(['Map', 'w', ['List', 1, 2]]).at(1);
    expect(errorCode(x!)).toBe(LN_ERROR);
  });

  test('a walk of the elements gives the error: `Filter([1, 2], w).each()`', () => {
    const xs = [...ce.box(['Filter', ['List', 1, 2], 'w']).each()];
    expect(xs.map((x) => errorCode(x))).toEqual([LN_ERROR, LN_ERROR]);
  });

  test('`Map(w, xs)` is typed with `unknown` elements, not the elements of the source', () => {
    expect(ce.box(['Map', 'w', ['List', 1, 2]]).type.toString()).toBe(
      'list<unknown^2>'
    );
  });

  test('`Map(f, xs)` with `f` declared `function` is typed with `unknown` elements', () => {
    ce.declare('fd', 'function');
    expect(ce.box(['Map', 'fd', ['List', 1, 2]]).type.toString()).toBe(
      'list<unknown^2>'
    );
    expect(ce.box(['Map', 'fd', ['Range', 1, 3]]).type.toString()).toBe(
      'list'
    );
  });

  test('`Map(f, xs)` with `f` not declared still copies the type of the source', () => {
    // User decision 2026-09-27: the source type is copied when the callback
    // is not known.
    expect(ce.box(['Map', 'fq', ['List', 1, 2]]).type.toString()).toBe(
      'vector<integer^2>'
    );
  });

  test('`Map(w, f)` with the arguments in the wrong order still reports the wrong order', () => {
    ce.assign('f', ce.box(['Function', ['Multiply', 'x', 2], 'x']));
    const call = ce.box(['Map', 'w', 'f']);
    expect(call.isValid).toBe(false);
    expect(errorCode(call.ops![0])).toBe('incompatible-type function error');
  });
});

describe('A SYMBOL HOLDING AN ERROR AT A PARAMETER THAT IS NOT A CALLBACK OF A COLLECTION OPERATOR', () => {
  // Only the callback parameters of the lazy collection operators (a
  // parameter typed by a signature) give the error of the symbol before the
  // handler runs (`callbackSlots()`,
  // `src/compute-engine/boxed-expression/boxed-function.ts`). Another lazy
  // operator decides itself what such an operand gives.
  test('`Integrate(w, Limits(w, 0, 1))` binds `w`: it is `1/2` (box route)', () => {
    const v = ce.box(['Integrate', 'w', ['Limits', 'w', 0, 1]]).evaluate();
    expect(v.toString()).toBe('1/2');
  });

  test('`Integrate(w, Limits(w, 0, 1))` binds `w`: it is `1/2` (function route)', () => {
    const v = ce
      .function('Integrate', [
        ce.symbol('w'),
        ce.function('Limits', [ce.symbol('w'), ce.number(0), ce.number(1)]),
      ])
      .evaluate();
    expect(v.toString()).toBe('1/2');
  });

  test('`Integrate(w, w)` binds `w`', () => {
    expect(ce.box(['Integrate', 'w', 'w']).evaluate().isValid).toBe(true);
  });

  test('`Limit(w, 0)` and `Pipe(3, w)` are not the error', () => {
    expect(ce.box(['Limit', 'w', 0]).evaluate().operator).toBe('Limit');
    expect(ce.box(['Pipe', 3, 'w']).evaluate().toString()).toBe('w(3)');
  });

  test('a lazy operator that selects its operands still selects', () => {
    ce.declare('sel', {
      signature: '(boolean, () -> any, () -> any) -> any',
      lazy: true,
      selectsOperands: true,
      evaluate: (ops) => (ops[0].symbol === 'True' ? ops[1] : ops[2]),
    });
    const v = ce.box(['sel', 'True', ['Function', 5], 'w']).evaluate();
    expect(v.isValid).toBe(true);
    expect(v.operator).toBe('Function');
  });

  test('a change of the signature of an operator in place is seen at the next evaluation', () => {
    // The callback parameters of a definition are cached with its
    // `_writeVersion` (`callbackSlots()`), which a signature write increases.
    ce.declare('cb', {
      signature: '(list, (unknown) -> any) -> any',
      lazy: true,
      evaluate: () => ce.number(1),
    });
    const call = () => ce.box(['cb', ['List', 1], 'w']).evaluate();
    expect(errorCode(call())).toBe(LN_ERROR);
    const def = ce.lookupDefinition('cb') as {
      operator: { signature: ReturnType<typeof ce.type> };
    };
    def.operator.signature = ce.type('(list, function) -> any');
    expect(call().toString()).toBe('1');
    def.operator.signature = ce.type('(list, (unknown) -> any) -> any');
    expect(errorCode(call())).toBe(LN_ERROR);
  });

  test('a lazy operator with parameters typed `function` still selects', () => {
    ce.declare('sel', {
      signature: '(boolean, function, function) -> any',
      lazy: true,
      evaluate: (ops) => (ops[0].symbol === 'True' ? ops[1] : ops[2]),
    });
    const v = ce.box(['sel', 'True', ['Function', 5], 'w']).evaluate();
    expect(v.isValid).toBe(true);
    expect(v.operator).toBe('Function');
  });
});

describe('A SYMBOL DECLARED `error` WITH NO VALUE AT AN OVERLOADED FUNCTION WITH A GENERIC ARM', () => {
  test('the verdict is the verdict of the same overload with ground arms', () => {
    ce.declare('e', 'error');
    ce.declare('ovg', { type: '((string) -> string) & ((T) -> T where T: number)' });
    ce.declare('ov', { type: '((string) -> string) & ((number) -> number)' });
    expect(ce.box(['ov', 'e']).isValid).toBe(false);
    expect(ce.box(['ovg', 'e']).isValid).toBe(false);
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
