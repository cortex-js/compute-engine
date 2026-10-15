/**
 * A call of a user function, or of a variable that holds a function, is
 * checked against the function when it is boxed. A later assignment can
 * replace the function. The call records the definition it was boxed
 * against, with a change counter (`BoxedFunction._calleeStamp`). When the
 * definition changed, the type and the value of the call are those of the
 * same call boxed against the definition as it is now
 * (`BoxedFunction._reboxedForCallee()`).
 *
 * Two consequences, one for each part of this file:
 *
 * - A call that the old function accepted, and that the new function refuses,
 *   is typed `error`, as a call boxed after the assignment. It used to keep
 *   the type of the old function (`integer`) while it evaluated to the
 *   `incompatible-type` error.
 * - A named call through a variable with no declared type matches its names
 *   against the function that the variable holds when the call is evaluated.
 *   It used to keep the parameter order of the function the variable held
 *   when the call was made canonical.
 *
 * A call through a variable that holds the name of a lazy operator applies
 * that operator to its operands unevaluated, as a direct call does (last
 * part of this file).
 *
 * A call refused at boxing is checked again by a different mechanism
 * (`_refusedOps`, `_recheckedCall()`), pinned in `apply-literal-maps.test.ts`.
 */

import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';
import { executeEpsil } from '../../src/epsil/execute-epsil';

const REFUSED = 'Error(ErrorCode("incompatible-type", "real", "string"), "abc")';

const N = (name: string, value: unknown): any => [
  'NamedArgument',
  { str: name },
  value,
];

/** The type, the validity and the value of `call`, synchronous and
 * asynchronous, as one record, so that a call boxed before an assignment and
 * a call boxed after it can be compared in one assertion. */
async function observe(call: Expression) {
  return {
    type: call.type.toString(),
    value: call.evaluate().toString(),
    asyncValue: (await call.evaluateAsync()).toString(),
  };
}

describe('THE TYPE OF A CALL FOLLOWS A REASSIGNMENT OF ITS FUNCTION', () => {
  // `h` has no declaration: the assignment of a function literal makes it an
  // operator definition.
  test('operator definition, box route', async () => {
    const ce = new ComputeEngine();
    ce.assign('h', ce.box(['Function', 1, 'u']));
    const call = ce.box(['h', "'abc'"]);
    expect(await observe(call)).toEqual({
      type: 'integer',
      value: '1',
      asyncValue: '1',
    });

    ce.assign('h', ce.box(['Function', 7, ['Typed', 'u', 'real']]));
    const fresh = ce.box(['h', "'abc'"]);
    expect(fresh.type.toString()).toBe('error');
    expect(await observe(call)).toEqual(await observe(fresh));
    expect(call.evaluate().toString()).toBe(REFUSED);
    // The boxed call itself does not change: `isValid` reports the call as
    // it was boxed.
    expect(call.isValid).toBe(true);

    // A function that accepts the string again: the call follows it too.
    ce.assign('h', ce.box(['Function', 2, 'u']));
    expect(await observe(call)).toEqual({
      type: 'integer',
      value: '2',
      asyncValue: '2',
    });
  });

  test('operator definition, parse route', async () => {
    const ce = new ComputeEngine();
    ce.parse('h := u \\mapsto 1').evaluate();
    const call = ce.parse('h(\\text{abc})');
    expect(call.type.toString()).toBe('integer');
    ce.parse('h := (u: \\mathrm{real}) \\mapsto 7').evaluate();
    const fresh = ce.parse('h(\\text{abc})');
    expect(fresh.type.toString()).toBe('error');
    expect(await observe(call)).toEqual(await observe(fresh));
  });

  // `f` is declared `function`: a value definition that holds the literal.
  test('a variable declared `function`', async () => {
    const ce = new ComputeEngine();
    ce.declare('f', 'function');
    ce.assign('f', ce.box(['Function', 1, ['Typed', 'u', 'string']]));
    const call = ce.box(['f', "'abc'"]);
    expect(call.type.toString()).toBe('integer');
    ce.assign('f', ce.box(['Function', 7, ['Typed', 'u', 'real']]));
    const fresh = ce.box(['f', "'abc'"]);
    expect(fresh.type.toString()).toBe('error');
    expect(await observe(call)).toEqual(await observe(fresh));
    expect(call.evaluate().toString()).toBe(REFUSED);
  });

  // The first function narrows the one-cluster string `"a"` to a
  // `character` at its `character` parameter, so the call holds the narrowed
  // operand. The call is boxed again from the operand as written, not from
  // the narrowed one: the second function takes a `string` and accepts it.
  test('an operand narrowed by the old function is boxed again as written', async () => {
    const characterFn = ['Function', 1, ['Typed', 'c', { str: 'character' }]];
    const stringFn = ['Function', 2, ['Typed', 's', { str: 'string' }]];
    const expected = { type: 'integer', value: '2', asyncValue: '2' };

    // A variable declared `function`: a value definition.
    const ce = new ComputeEngine();
    ce.declare('h', 'function');
    ce.assign('h', ce.box(characterFn as any));
    const call = ce.box(['h', { str: 'a' }]);
    expect(call.evaluate().toString()).toBe('1');
    ce.assign('h', ce.box(stringFn as any));
    expect(await observe(ce.box(['h', { str: 'a' }]))).toEqual(expected);
    expect(await observe(call)).toEqual(expected);

    // No declaration: an operator definition. A new function must accept
    // every `character`, so the second function has a bare parameter and
    // returns it: the result is the string as written, not a `character`.
    const ce2 = new ComputeEngine();
    ce2.assign('g', ce2.box(characterFn as any));
    const call2 = ce2.box(['g', { str: 'a' }]);
    expect(call2.evaluate().toString()).toBe('1');
    ce2.assign('g', ce2.box(['Function', 's', 's']));
    const result = async (x: Expression) => {
      const v = x.evaluate();
      const av = await x.evaluateAsync();
      return {
        type: x.type.toString(),
        value: [JSON.stringify(v.json), v.type.toString()],
        asyncValue: [JSON.stringify(av.json), av.type.toString()],
      };
    };
    const asString = {
      type: 'string',
      value: ['"\'a\'"', 'string'],
      asyncValue: ['"\'a\'"', 'string'],
    };
    expect(await result(ce2.box(['g', { str: 'a' }]))).toEqual(asString);
    expect(await result(call2)).toEqual(asString);
  });

  test('a call in an operand follows the function too', () => {
    const ce = new ComputeEngine();
    ce.assign('h', ce.box(['Function', 1, 'u']));
    const sum = ce.box(['Add', ['h', "'abc'"], 1]);
    expect(sum.type.toString()).toBe('integer');
    expect(sum.evaluate().toString()).toBe('2');
    ce.assign('h', ce.box(['Function', 7, ['Typed', 'u', 'real']]));
    const fresh = ce.box(['Add', ['h', "'abc'"], 1]);
    expect(sum.type.toString()).toBe(fresh.type.toString());
    expect(sum.evaluate().toString()).toBe(fresh.evaluate().toString());
  });

  test('a call whose function did not change is not boxed again', () => {
    const ce = new ComputeEngine();
    ce.assign('h', ce.box(['Function', 1, 'u']));
    const call = ce.box(['h', "'abc'"]) as any;
    // An assignment to another name advances the engine generation, and
    // the type of the call is computed again, but its function is the same.
    ce.assign('k', 5);
    expect(call.type.toString()).toBe('integer');
    expect(call._reboxedForCallee()).toBeUndefined();
  });

  // In Epsil, `let g = …` with no type is a variable with an inferred type.
  // The reassignment of a literal with an annotated parameter makes `g` an
  // operator definition: the call boxed before it follows the change.
  test('Epsil: a call boxed before the reassignment of a `let`', async () => {
    const ce = new ComputeEngine();
    expect(executeEpsil(ce, 'let g = (u: string) => 1').diagnostics).toEqual(
      []
    );
    const call = ce.box(['g', "'abc'"]);
    expect(call.type.toString()).toBe('integer');
    expect(executeEpsil(ce, 'g = (u: real) => 7').diagnostics).toEqual([]);
    const fresh = ce.box(['g', "'abc'"]);
    expect(fresh.type.toString()).toBe('error');
    expect(await observe(call)).toEqual(await observe(fresh));
  });

  test('Epsil: a call boxed before the reassignment of a `function`', async () => {
    const ce = new ComputeEngine();
    expect(executeEpsil(ce, 'function h(u) { 1 }').diagnostics).toEqual([]);
    const call = ce.box(['h', "'abc'"]);
    expect(call.type.toString()).toBe('integer');
    expect(executeEpsil(ce, 'h = (u: real) => 7').diagnostics).toEqual([]);
    const fresh = ce.box(['h', "'abc'"]);
    expect(fresh.type.toString()).toBe('error');
    expect(await observe(call)).toEqual(await observe(fresh));
  });

  test('Epsil: a call in a function body', () => {
    const ce = new ComputeEngine();
    const r = executeEpsil(
      ce,
      'let g = (u: string) => 1\nfunction k() { g("abc") }\nlet a = k()\ng = (u: real) => 7\n[a, k()]'
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.value.toString()).toBe(`[1,${REFUSED}]`);
  });
});

describe('A NAMED CALL THROUGH AN UNTYPED VARIABLE MATCHES THE NAMES AT EVALUATION', () => {
  /** `bob_S(x, factor)` computes `x * factor`; `other(factor, x)` computes
   * `factor - x`. */
  function engine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('bob_S', {
      signature: '(x: number, factor: number) -> number',
      evaluate: (ops, { engine }) => engine.number(ops[0].re * ops[1].re),
    });
    ce.declare('other', {
      signature: '(factor: number, x: number) -> number',
      evaluate: (ops, { engine }) => engine.number(ops[0].re - ops[1].re),
    });
    return ce;
  }

  const DEFS =
    'function bob_S(x: number, factor: number) -> number { x * factor }\n' +
    'function other(factor: number, x: number) -> number { factor - x }\n';

  test('box route', () => {
    const ce = engine();
    ce.assign('alias', ce.symbol('bob_S'));
    const call = ce.box(['alias', N('x', 3), N('factor', 5)]);
    expect(call.evaluate().toString()).toBe('15');
    ce.assign('alias', ce.symbol('other'));
    // `other(factor: 5, x: 3)` is `5 - 3`.
    expect(call.evaluate().toString()).toBe('2');
    expect(call.type.toString()).toBe('number');
    // Back to the first function: the names are matched against it again.
    ce.assign('alias', ce.symbol('bob_S'));
    expect(call.evaluate().toString()).toBe('15');
  });

  test('`ce.function` route', () => {
    const ce = engine();
    ce.assign('alias', ce.symbol('bob_S'));
    const call = ce.function('alias', [
      ce.number(3),
      ce.box(N('factor', 5), { form: 'raw' }),
    ]);
    expect(call.evaluate().toString()).toBe('15');
    ce.assign('alias', ce.symbol('other'));
    // The positional `3` fills `factor`, the first parameter of `other`, so
    // `factor: 5` is a duplicate: the same answer as a call boxed now.
    const fresh = ce.function('alias', [
      ce.number(3),
      ce.box(N('factor', 5), { form: 'raw' }),
    ]);
    expect(call.evaluate().toString()).toBe(fresh.evaluate().toString());
    expect(call.evaluate().toString()).toContain('argument-name-duplicate');
  });

  test('Epsil: every argument named', () => {
    const r = executeEpsil(
      new ComputeEngine(),
      DEFS +
        'let alias = bob_S\nfunction g() { alias(x: 3, factor: 5) }\nlet a = g()\nalias = other\n[a, g()]'
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.value.toString()).toBe('[15,2]');
  });

  // The positional `3` fills the first parameter of `other`, which is
  // `factor`, so `factor: 5` names a parameter that is already filled. The
  // call used to give `-2`: it kept the order of `bob_S`, `alias(3, 5)`.
  test('Epsil: a positional and a named argument', () => {
    const r = executeEpsil(
      new ComputeEngine(),
      DEFS +
        'let alias = bob_S\nfunction g() { alias(3, factor: 5) }\nalias = other\ng()'
    );
    expect(r.value.toString()).toBe(
      'Error(ErrorCode("argument-name-duplicate", "factor", "that parameter is already filled by a positional argument"))'
    );
    const direct = executeEpsil(
      new ComputeEngine(),
      DEFS + 'let alias = other\nalias(3, factor: 5)'
    );
    expect(direct.value.toString()).toBe(r.value.toString());
  });

  test('a variable that holds a function with the same names', () => {
    const r = executeEpsil(
      new ComputeEngine(),
      DEFS +
        'function twice(x: number, factor: number) -> number { 2 * x * factor }\n' +
        'let alias = bob_S\nfunction g() { alias(factor: 5, x: 3) }\nlet a = g()\nalias = twice\n[a, g()]'
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.value.toString()).toBe('[15,30]');
  });

  // The documented use of a named call through a variable with an inferred
  // type: the names are matched against the literal it holds.
  test('a variable assigned a literal with parameter names', () => {
    const r = executeEpsil(
      new ComputeEngine(),
      'let f = (x: number, y: string) => x\nf(y: "a", x: 1)'
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.value.toString()).toBe('1');

    const ce = new ComputeEngine();
    ce.assign('f', ce.parse('(x: \\mathrm{number}, y: \\mathrm{string}) \\mapsto x'));
    expect(ce.box(['f', N('y', "'a'"), N('x', 1)]).evaluate().toString()).toBe(
      '1'
    );
  });
});

describe('A NAMED CALL OF A USER FUNCTION MATCHES THE NAMES AT EVALUATION', () => {
  // The assignment of a function literal with annotated parameters makes `h`
  // an operator definition whose signature has the names of the parameters.
  // A later assignment of an annotated literal keeps these names (pinned in
  // `test/epsil/execute.test.ts`, "reassignment: the FIRST pinned signature
  // owns the names"). A later assignment of a literal with no annotation
  // replaces the signature, which then has no parameter names.
  //
  // The call keeps the names it was written with, and they are matched
  // again against the definition that `h` holds when the call is evaluated.
  // Without the names, the call was boxed again from its operands in
  // declaration order, `h(3, 5)`, and gave `2`.
  const XF = [
    'Function',
    ['Subtract', 'x', 'factor'],
    ['Typed', 'x', 'real'],
    ['Typed', 'factor', 'real'],
  ];
  const BARE_FX = ['Function', ['Subtract', 'x', 'factor'], 'factor', 'x'];

  test('box route', async () => {
    const ce = new ComputeEngine();
    ce.assign('h', ce.box(XF));
    const call = ce.box(['h', N('factor', 5), N('x', 3)]);
    expect(call.evaluate().toString()).toBe('-2');

    ce.assign('h', ce.box(BARE_FX));
    const fresh = ce.box(['h', N('factor', 5), N('x', 3)]);
    expect(fresh.evaluate().toString()).toContain('argument-name-unknown');
    expect(await observe(call)).toEqual(await observe(fresh));

    // The names are matched again against an annotated literal.
    ce.assign('h', ce.box(XF));
    expect(call.evaluate().toString()).toBe('-2');
  });

  test('`ce.function` route: a positional and a named argument', () => {
    const ce = new ComputeEngine();
    ce.assign('h', ce.box(XF));
    const call = ce.function('h', [
      ce.number(3),
      ce.box(N('factor', 5), { form: 'raw' }),
    ]);
    expect(call.evaluate().toString()).toBe('-2');
    ce.assign('h', ce.box(BARE_FX));
    const fresh = ce.function('h', [
      ce.number(3),
      ce.box(N('factor', 5), { form: 'raw' }),
    ]);
    expect(call.evaluate().toString()).toBe(fresh.evaluate().toString());
    expect(call.evaluate().toString()).toContain('argument-name-unknown');
  });

  test('Epsil: a `function` redefined by an assignment', () => {
    const r = executeEpsil(
      new ComputeEngine(),
      'function h(x: number, factor: number) { x - factor }\n' +
        'function g() { h(factor: 5, x: 3) }\nlet a = g()\n' +
        'h = (factor, x) => x - factor\n[a, g()]'
    );
    expect(r.diagnostics).toEqual([]);
    const direct = executeEpsil(
      new ComputeEngine(),
      'function h(x: number, factor: number) { x - factor }\n' +
        'h = (factor, x) => x - factor\nh(factor: 5, x: 3)'
    );
    expect(direct.value.toString()).toContain('argument-name-unknown');
    expect(r.value.toString()).toBe(`[-2,${direct.value.toString()}]`);
  });
});

describe('A CALL THROUGH A VARIABLE THAT HOLDS A LAZY OPERATOR', () => {
  // `bob_H` is lazy: its handler receives its operand unevaluated. A call
  // through a variable that holds `bob_H` must hold the operand too, as the
  // direct call does. The operands used to be evaluated before the held
  // operator was applied: with `y := 10`, `aliasH(y·z)` gave `Hold(10z)`.
  function engine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('bob_H', {
      lazy: true,
      signature: '(x: any) -> any',
      evaluate: (ops, { engine }) => engine.box(['Hold', ops[0]]),
    });
    ce.assign('y', 10);
    return ce;
  }

  test.each([
    ['declared `function`', true],
    ['with no declaration', false],
  ])('a variable %s, box and parse routes', async (_, declared) => {
    const ce = engine();
    if (declared) ce.declare('aliasH', 'function');
    ce.assign('aliasH', ce.symbol('bob_H'));
    const direct = ce.box(['bob_H', ['Multiply', 'y', 'z']]);
    expect(direct.evaluate().toString()).toBe('Hold(y * z)');
    for (const call of [
      ce.box(['aliasH', ['Multiply', 'y', 'z']]),
      ce.parse('\\operatorname{aliasH}(y\\cdot z)'),
    ]) {
      expect(call.evaluate().toString()).toBe('Hold(y * z)');
      expect((await call.evaluateAsync()).toString()).toBe('Hold(y * z)');
    }
  });

  test('Epsil', () => {
    const r = executeEpsil(engine(), 'let aliasH = bob_H\naliasH(y * z)');
    expect(r.diagnostics).toEqual([]);
    expect(r.value.toString()).toBe('Hold(y * z)');
  });

  test('a variable that holds `Hold`', () => {
    const ce = engine();
    ce.assign('aliasH', ce.symbol('Hold'));
    expect(
      ce.box(['aliasH', ['Multiply', 'y', 'z']]).evaluate().toString()
    ).toBe('Hold(y * z)');
  });
});
