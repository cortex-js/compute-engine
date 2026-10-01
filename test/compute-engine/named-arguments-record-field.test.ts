import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { serializeEpsil } from '../../src/epsil/serialize-epsil';

/**
 * Named arguments and `lazy` on a call through a FIELD of a record or a
 * dictionary: `bob.S(3, factor: 5)` in Epsil, `MemberCall(bob, "S", …)` or
 * `Apply(Field(bob, "S"), …)` in MathJSON (GitHub issue #390).
 *
 * `Apply` is normally excluded from named-argument matching, because its
 * callee is an expression whose parameter names are not known while the call
 * is made canonical. The decision of 2026-10-01 adds two cases where they are
 * known (`resolveFieldCallee`, `boxed-expression/field-callee.ts`):
 *
 * 1. The receiver is a CONSTANT whose value is a dictionary. A field that
 *    holds a symbol naming an operator turns the call into the direct call
 *    `bob_S(…)` before any argument is made canonical, so named arguments,
 *    `lazy` and the argument checks work as for the direct call. A field that
 *    holds a `Function` literal applies the literal, and the names are
 *    matched against the literal's parameters.
 * 2. The receiver's TYPE is a record whose field has a signature with named
 *    parameters. The names are matched against that signature and the call
 *    stays `Apply(Field(…), …)`. `lazy` is not honored on this route: a
 *    signature type has no `lazy` flag.
 */

/** A `NamedArgument` carrier in raw MathJSON. */
const N = (name: string, value: unknown): unknown => [
  'NamedArgument',
  { str: name },
  value,
];

/** Every error code embedded anywhere in `expr`, outermost first. */
function errorCodes(expr: any): string[] {
  const out: string[] = [];
  const visit = (e: any): void => {
    if (!e) return;
    if (e.operator === 'Error') {
      const cause = e.ops?.[0];
      if (cause?.operator === 'ErrorCode')
        out.push(cause.ops?.[0]?.string ?? '');
      else if (cause?.string) out.push(cause.string);
    }
    for (const op of e.ops ?? []) visit(op);
  };
  visit(expr);
  return out;
}

const RECORD_TYPE =
  'record{S: (x: number, factor: number?) -> number, H: (x: any) -> any}';

/** An engine with the host operators of the issue, and receivers of each
 * kind holding them: `bob` (a constant), `rec` (a variable typed as a record
 * with named signatures) and `dyn` (a variable typed `dictionary<function>`).
 * `y` holds 10, to observe whether an argument was evaluated. */
function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('bob_S', {
    signature: '(x: number, factor: number?) -> number',
    evaluate: (ops, { engine }) => engine.number(ops[0].re * (ops[1]?.re ?? 2)),
  });
  ce.declare('other_S', {
    signature: '(x: number, factor: number?) -> number',
    evaluate: (ops, { engine }) =>
      engine.number(ops[0].re + (ops[1]?.re ?? 100)),
  });
  ce.declare('bob_H', {
    lazy: true,
    signature: '(x: any) -> any',
    evaluate: (ops, { engine }) => engine.box(['Hold', ops[0]]),
  });
  const fields = [
    'Dictionary',
    ['Tuple', "'S'", 'bob_S'],
    ['Tuple', "'H'", 'bob_H'],
  ];
  ce.declare('bob', { isConstant: true, value: fields } as any);
  ce.declare('rec', { type: RECORD_TYPE, value: fields } as any);
  ce.declare('dyn', { type: 'dictionary<function>', value: fields } as any);
  ce.assign('y', 10);
  return ce;
}

describe('constant receiver: the call becomes the direct call', () => {
  test('named argument, MemberCall spelling', () => {
    const ce = engine();
    const e = ce.box(['MemberCall', 'bob', "'S'", 3, N('factor', 5)] as any);
    expect(e.toString()).toBe('bob_S(3, 5)');
    expect(e.evaluate().toString()).toBe('15');
  });

  test('named arguments in another order, Apply(Field) spelling', () => {
    const ce = engine();
    const e = ce.box([
      'Apply',
      ['Field', 'bob', "'S'"],
      N('factor', 5),
      N('x', 3),
    ] as any);
    expect(e.toString()).toBe('bob_S(3, 5)');
    expect(e.evaluate().toString()).toBe('15');
  });

  test('an optional parameter left out takes its default', () => {
    const ce = engine();
    const e = ce.box(['MemberCall', 'bob', "'S'", N('x', 3)] as any);
    expect(e.evaluate().toString()).toBe('6');
  });

  test('the type of the call is the result type of the operator', () => {
    const ce = engine();
    const e = ce.box(['MemberCall', 'bob', "'S'", 3, N('factor', 5)] as any);
    expect(e.type.toString()).toBe('number');
  });

  test('a lazy operator receives its argument held, as in a direct call', () => {
    const ce = engine();
    const direct = ce.box(['bob_H', ['Multiply', 'y', 'z']] as any);
    expect(direct.evaluate().toString()).toBe('Hold(y * z)');
    for (const call of [
      ['MemberCall', 'bob', "'H'", ['Multiply', 'y', 'z']],
      ['Apply', ['Field', 'bob', "'H'"], ['Multiply', 'y', 'z']],
    ]) {
      const e = ce.box(call as any);
      expect(e.toString()).toBe('bob_H(y * z)');
      expect(e.evaluate().toString()).toBe('Hold(y * z)');
    }
  });

  test('a wrong name gives the same diagnostic as the direct call', () => {
    const ce = engine();
    const viaField = ce.box([
      'MemberCall',
      'bob',
      "'S'",
      3,
      N('factr', 5),
    ] as any);
    const direct = ce.box(['bob_S', 3, N('factr', 5)] as any);
    expect(errorCodes(viaField)).toEqual(['argument-name-unknown']);
    expect(viaField.toString()).toBe(direct.toString());
    expect(viaField.toString()).toContain('did you mean `factor`?');
  });

  test('a field that the value does not have is not resolved', () => {
    const ce = engine();
    const e = ce.box(['MemberCall', 'bob', "'T'", 3, N('factor', 5)] as any);
    expect(e.operator).toBe('Apply');
    expect(errorCodes(e)).toEqual(['argument-names-unavailable']);
  });

  test('a constant declared as dictionary<function> is resolved too', () => {
    const ce = engine();
    ce.declare('lib', {
      isConstant: true,
      type: 'dictionary<function>',
      value: ['Dictionary', ['Tuple', "'S'", 'bob_S']],
    } as any);
    const e = ce.box(['MemberCall', 'lib', "'S'", 3, N('factor', 5)] as any);
    expect(e.toString()).toBe('bob_S(3, 5)');
    expect(e.evaluate().toString()).toBe('15');
  });

  test('a field that holds a Function literal applies the literal', () => {
    const ce = engine();
    ce.declare('lib', {
      isConstant: true,
      value: [
        'Dictionary',
        ['Tuple', "'D'", ['Function', ['Subtract', 'x', 'k'], 'x', 'k']],
        ['Tuple', "'L'", ['Function', ['Hold', 'x'], 'x']],
      ],
    } as any);
    const e = ce.box([
      'MemberCall',
      'lib',
      "'D'",
      N('k', 1),
      N('x', 10),
    ] as any);
    expect(errorCodes(e)).toEqual([]);
    expect(e.evaluate().toString()).toBe('9');
    // A function literal cannot be lazy: its argument is evaluated, the same
    // as when the literal is applied directly.
    const held = ce.box([
      'MemberCall',
      'lib',
      "'L'",
      ['Multiply', 'y', 'z'],
    ] as any);
    const direct = ce.box([
      ['Function', ['Hold', 'x'], 'x'],
      ['Multiply', 'y', 'z'],
    ] as any);
    expect(held.evaluate().toString()).toBe(direct.evaluate().toString());
    expect(held.evaluate().toString()).toBe('Hold(10z)');
  });

  test('a parameter that shadows the constant is not resolved by value', () => {
    // In `(bob) => bob.S(…)` the name `bob` is the parameter, not the
    // constant, so the call is not rewritten.
    const ce = engine();
    const e = ce.box([
      'Function',
      ['MemberCall', 'bob', "'S'", 2, N('factor', 3)],
      'bob',
    ] as any);
    expect(e.toString()).toContain('Field("bob", "S")');
    expect(errorCodes(e)).toEqual(['argument-names-unavailable']);
  });

  test('a positional call through a literal field keeps its Field callee', () => {
    // The literal replaces the callee only to match names; a call without
    // names gains nothing from it.
    const ce = engine();
    ce.declare('lib', {
      isConstant: true,
      value: [
        'Dictionary',
        ['Tuple', "'D'", ['Function', ['Subtract', 'x', 'k'], 'x', 'k']],
      ],
    } as any);
    const e = ce.box(['MemberCall', 'lib', "'D'", 10, 1] as any);
    expect(e.toString()).toContain('Field("lib", "D")');
    expect(e.evaluate().toString()).toBe('9');
  });

  test('a parameter named like the operator is not rewritten', () => {
    // In `(bob_S) => bob.S(3)` the name `bob_S` is the parameter: the direct
    // call `bob_S(3)` would apply the parameter, not the operator.
    const ce = engine();
    const e = ce.box([
      'Function',
      ['MemberCall', 'bob', "'S'", 3],
      'bob_S',
    ] as any);
    expect(e.toString()).toContain('Field("bob", "S")');
  });

  test('a field symbol bound to a value is not rewritten to an inner operator', () => {
    // `g` holds a function value; an operator `g` declared in an inner scope
    // has the same name. The call keeps its `Field` callee: the rewrite is
    // made only when the stored symbol and the name in scope denote the same
    // operator. (Evaluation applies a stored symbol by NAME, in the scope
    // where the call is evaluated, as `apply()` does for every symbol callee,
    // so the call then reaches the inner `g`, exactly as `g(3)` there does.)
    const ce = engine();
    ce.declare('g', {
      type: 'function',
      value: ['Function', ['Multiply', 7, 'x'], 'x'],
    } as any);
    ce.declare('ns', {
      isConstant: true,
      value: ['Dictionary', ['Tuple', "'S'", 'g']],
    } as any);
    expect(ce.box(['MemberCall', 'ns', "'S'", 3] as any).evaluate().re).toBe(
      21
    );
    ce.pushScope();
    try {
      ce.declare('g', {
        signature: '(number) -> number',
        evaluate: (_ops, { engine }) => engine.number(-1),
      });
      const e = ce.box(['Apply', ['Field', 'ns', "'S'"], 3] as any);
      expect(e.toString()).toContain('Field("ns", "S")');
      expect(e.evaluate().re).toBe(ce.box(['g', 3]).evaluate().re);
    } finally {
      ce.popScope();
    }
  });

  test('a random operator in a field keeps its effects', () => {
    const ce = engine();
    ce.declare('lib', {
      isConstant: true,
      value: ['Dictionary', ['Tuple', "'R'", 'Random']],
    } as any);
    const e = ce.box(['MemberCall', 'lib', "'R'"] as any);
    expect(e.toString()).toBe('Random()');
    expect(e.isPure).toBe(false);
  });
});

describe('record-typed receiver: names from the declared type', () => {
  test('named arguments are put in declaration order', () => {
    const ce = engine();
    const e = ce.box([
      'MemberCall',
      'rec',
      "'S'",
      N('factor', 5),
      N('x', 3),
    ] as any);
    expect(e.toString()).toBe('Apply(Field("rec", "S"), 3, 5)');
    expect(e.evaluate().toString()).toBe('15');
    expect(e.type.toString()).toBe('number');
  });

  test('a field typed as an overload set matches the names of an arm', () => {
    const ce = engine();
    ce.declare('ovl_S', {
      signature:
        '((x: number, factor: number) -> number) & ((s: string) -> string)',
      evaluate: (ops, { engine }) =>
        ops[0].string !== undefined
          ? engine.string(ops[0].string.toUpperCase())
          : engine.number(ops[0].re * ops[1].re),
    });
    ce.declare('ovl', {
      type: 'record{S: ((x: number, factor: number) -> number) & ((s: string) -> string)}',
      value: ['Dictionary', ['Tuple', "'S'", 'ovl_S']],
    } as any);
    const e = ce.box([
      'MemberCall',
      'ovl',
      "'S'",
      N('factor', 5),
      N('x', 3),
    ] as any);
    expect(errorCodes(e)).toEqual([]);
    expect(e.toString()).toBe('Apply(Field("ovl", "S"), 3, 5)');
    expect(e.evaluate().toString()).toBe('15');
  });

  test('an optional parameter left out is not supplied', () => {
    const ce = engine();
    const e = ce.box(['Apply', ['Field', 'rec', "'S'"], N('x', 3)] as any);
    expect(e.toString()).toBe('Apply(Field("rec", "S"), 3)');
    expect(e.evaluate().toString()).toBe('6');
  });

  test('the match depends on the type, not on the value held', () => {
    // `other_S` adds instead of multiplying. After `rec` is given a new value
    // of the same type, the call made before and a new call both read
    // `x = 3, factor = 5` and call the new value.
    const ce = engine();
    const before = ce.box([
      'Apply',
      ['Field', 'rec', "'S'"],
      N('factor', 5),
      N('x', 3),
    ] as any);
    expect(before.evaluate().toString()).toBe('15');
    ce.assign(
      'rec',
      ce.box([
        'Dictionary',
        ['Tuple', "'S'", 'other_S'],
        ['Tuple', "'H'", 'bob_H'],
      ] as any)
    );
    expect(before.evaluate().toString()).toBe('8');
    const after = ce.box([
      'MemberCall',
      'rec',
      "'S'",
      N('factor', 5),
      N('x', 3),
    ] as any);
    expect(after.evaluate().toString()).toBe('8');
  });

  test('lazy is not honored: a signature type has no lazy flag', () => {
    const ce = engine();
    const e = ce.box([
      'MemberCall',
      'rec',
      "'H'",
      N('x', ['Multiply', 'y', 'z']),
    ] as any);
    expect(e.operator).toBe('Apply');
    expect(e.evaluate().toString()).toBe('Hold(10z)');
  });

  test('a wrong name gives the same diagnostic as the direct call', () => {
    const ce = engine();
    const e = ce.box(['MemberCall', 'rec', "'S'", 3, N('factr', 5)] as any);
    const direct = ce.box(['bob_S', 3, N('factr', 5)] as any);
    expect(errorCodes(e)).toEqual(['argument-name-unknown']);
    expect(e.ops![2].toString()).toBe(direct.ops![1].toString());
  });

  test('a required parameter left out is missing', () => {
    const ce = engine();
    const e = ce.box(['MemberCall', 'rec', "'S'", N('factor', 5)] as any);
    expect(errorCodes(e)).toEqual(['missing']);
  });

  test('compilation fails closed', () => {
    // A field read compiles as `At` on the receiver, and a dictionary held by
    // a variable has no compiled form. The positional call fails the same way.
    const ce = engine();
    for (const call of [
      ['MemberCall', 'rec', "'S'", 't', N('factor', 5)],
      ['MemberCall', 'rec', "'S'", 't', 5],
    ]) {
      expect(() =>
        compile(ce.box(call as any), { fallback: false } as any)
      ).toThrow(/Could not compile/);
    }
  });
});

describe('a receiver that is neither constant nor record-typed', () => {
  test('dictionary<function>: the names stay unavailable', () => {
    const ce = engine();
    const e = ce.box(['MemberCall', 'dyn', "'S'", 3, N('factor', 5)] as any);
    expect(e.operator).toBe('Apply');
    expect(errorCodes(e)).toEqual(['argument-names-unavailable']);
    // The positional call works.
    const p = ce.box(['MemberCall', 'dyn', "'S'", 3, 5] as any);
    expect(p.evaluate().toString()).toBe('15');
  });

  test('its value is not read: a lazy operator gets an evaluated argument', () => {
    const ce = engine();
    const e = ce.box([
      'MemberCall',
      'dyn',
      "'H'",
      ['Multiply', 'y', 'z'],
    ] as any);
    expect(e.operator).toBe('Apply');
    expect(e.evaluate().toString()).toBe('Hold(10z)');
  });

  test('a bare symbol callee still declines', () => {
    // The `Apply` exclusion for a symbol callee is unchanged.
    const ce = engine();
    const e = ce.box(['Apply', 'bob_S', 3, N('factor', 5)] as any);
    expect(errorCodes(e)).toEqual(['argument-names-unavailable']);
  });
});

describe('route parity', () => {
  test('ce.function gives the same call as ce.box', () => {
    const ce = engine();
    const named = ce.function('Apply', [
      ce.box(['Field', 'bob', "'S'"] as any),
      ce.box(N('factor', 5) as any, { form: 'raw' }),
      ce.box(N('x', 3) as any, { form: 'raw' }),
    ]);
    expect(named.toString()).toBe('bob_S(3, 5)');
    expect(named.evaluate().toString()).toBe('15');

    const held = ce.function('MemberCall', [
      ce.symbol('bob'),
      ce.string('H'),
      ce.box(['Multiply', 'y', 'z'] as any, { form: 'raw' }),
    ]);
    expect(held.evaluate().toString()).toBe('Hold(y * z)');

    const typed = ce.function('Apply', [
      ce.box(['Field', 'rec', "'S'"] as any),
      ce.box(N('factor', 5) as any, { form: 'raw' }),
      ce.box(N('x', 3) as any, { form: 'raw' }),
    ]);
    expect(typed.toString()).toBe('Apply(Field("rec", "S"), 3, 5)');
    expect(typed.evaluate().toString()).toBe('15');
  });

  test('Epsil: a host-declared constant receiver', () => {
    const r = executeEpsil(engine(), 'bob.S(factor: 5, x: 3)');
    expect(r.diagnostics).toEqual([]);
    expect(String(r.value)).toBe('15');
  });

  test('Epsil: a const declared in the program', () => {
    const r = executeEpsil(
      engine(),
      'const ns = {S -> bob_S}\nns.S(3, factor: 5)'
    );
    expect(r.diagnostics).toEqual([]);
    expect(String(r.value)).toBe('15');
  });

  test('Epsil: a lazy operator through a const', () => {
    const r = executeEpsil(engine(), 'const ns = {H -> bob_H}\nns.H(y * z)');
    expect(r.diagnostics).toEqual([]);
    expect(String(r.value)).toBe('Hold(y * z)');
  });

  test('Epsil: a record-typed let binding', () => {
    const r = executeEpsil(
      engine(),
      'let r: record{S: (x: number, factor: number?) -> number} = {S -> bob_S}\nr.S(factor: 5, x: 3)'
    );
    expect(r.diagnostics).toEqual([]);
    expect(String(r.value)).toBe('15');
  });

  test('Epsil: inside a function body', () => {
    const r = executeEpsil(engine(), 'f := (t) => bob.S(t, factor: 5)\nf(3)');
    expect(r.diagnostics).toEqual([]);
    expect(String(r.value)).toBe('15');
  });

  test('the rewritten call prints as the direct call in Epsil', () => {
    // The canonical form is the direct call, so serializing it gives
    // `bob_S(…)`, not the `bob.S(…)` the author wrote.
    const ce = engine();
    const e = ce.box(['MemberCall', 'bob', "'S'", 3, N('factor', 5)] as any);
    expect(serializeEpsil(e.json)).toBe('bob_S(3, 5)');
  });
});

describe('compilation of the direct-call rewrite', () => {
  test('a constant receiver compiles like the direct call', () => {
    const ce = engine();
    ce.assign(
      'sc',
      ce.box([
        'Function',
        ['Multiply', 'x', 'factor'],
        ['Typed', 'x', { str: 'number' }],
        ['Typed', 'factor', { str: 'number' }],
      ] as any)
    );
    ce.declare('lib', {
      isConstant: true,
      value: ['Dictionary', ['Tuple', "'S'", 'sc']],
    } as any);
    const viaField = compile(
      ce.box(['MemberCall', 'lib', "'S'", 't', N('factor', 5)] as any)
    );
    const direct = compile(ce.box(['sc', 't', N('factor', 5)] as any));
    expect(viaField.success).toBe(true);
    expect(viaField.code).toBe(direct.code);
    expect((viaField as any).run({ t: 3 })).toBe(15);
  });
});
