/**
 * A function literal applied to a collection maps element by element, like a
 * named user function with the same body, on every route (user decision
 * 2026-09-26, Tycho item 327). It used to bind each argument whole, so
 * `Apply(i ↦ Sum(Cos(n), Limits(n, 1, i)), [1, 2, 3])` was an
 * `incompatible-type` error while the named call and the compiled code
 * mapped.
 */

import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { harvestCse } from '../../src/compute-engine/compilation/cse';
import { expressionParameterReadAt } from '../../src/compute-engine/compilation/compile-user-calls';
import { typeAcceptsValue } from '../../src/compute-engine/boxed-expression/value-membership';

const SUM_BODY = ['Sum', ['Cos', 'n'], ['Limits', 'n', 1, 'i']];

describe('A FUNCTION LITERAL APPLIED TO A COLLECTION', () => {
  test.each([
    ['a list', ['List', 1, 2, 3], 3],
    ['a range', ['Range', 1, 5], 5],
  ])('the literal and the named call agree over %s', (_, arg, n) => {
    const ce = new ComputeEngine();
    const f = ['Function', SUM_BODY, 'i'];
    ce.declare('X', 'function');
    ce.assign('X', ce.box(f as never));
    const literal = ce.box(['Apply', f, arg] as never);
    const named = ce.box(['X', arg] as never);
    expect(literal.type.toString()).toBe(named.type.toString());
    expect(literal.evaluate().toString()).toBe(named.evaluate().toString());
    const run = compile(literal, { fallback: false } as never)!.run!;
    expect((run({}) as number[]).length).toBe(n);
  });

  test('a scalar argument is unchanged', () => {
    const ce = new ComputeEngine();
    const call = ce.box(['Apply', ['Function', SUM_BODY, 'i'], 3] as never);
    // The upper bound `i` is not known to be finite, so the sum may also
    // diverge or have no limit (`bigOpOverDomainType`).
    expect(call.type.toString()).toBe('nan | real | signed_infinity');
    expect(call.evaluate().toString()).toBe('cos(1) + cos(2) + cos(3)');
  });

  test('a body that builds a tuple maps too', () => {
    const ce = new ComputeEngine();
    const call = ce.box([
      'Apply',
      ['Function', ['Tuple', 'x', 'x'], 'x'],
      ['List', 1, 2],
    ] as never);
    expect(call.evaluate().toString()).toBe('[(1, 1),(2, 2)]');
    // The body is typed with its parameter bound to the element type.
    expect(call.type.toString()).toBe('list<tuple<integer, integer>>');
  });

  test('a nested list is mapped at its leaves, and typed so', () => {
    const ce = new ComputeEngine();
    const f = ['Function', ['Tuple', 'x', 'x'], 'x'];
    ce.declare('D', 'function');
    ce.assign('D', ce.box(f as never));
    const arg = ['List', ['List', 1, 2], ['List', 3, 4]];
    for (const e of [['Apply', f, arg], ['D', arg]]) {
      const call = ce.box(e as never);
      const value = call.evaluate();
      expect(value.toString()).toBe('[[(1, 1),(2, 2)],[(3, 3),(4, 4)]]');
      expect(value.type.matches(call.type)).toBe(true);
    }
  });

  test('a tuple beside a list is repeated whole, on both routes', () => {
    const ce = new ComputeEngine();
    const f = ['Function', ['Tuple', 'x', 'y'], 'x', 'y'];
    ce.declare('P', 'function');
    ce.assign('P', ce.box(f as never));
    const args = [['List', 1, 2, 3], ['Tuple', 10, 20]];
    const expected = '[(1, (10, 20)),(2, (10, 20)),(3, (10, 20))]';
    expect(
      ce.box(['Apply', f, ...args] as never).evaluate().toString()
    ).toBe(expected);
    expect(ce.box(['P', ...args] as never).evaluate().toString()).toBe(
      expected
    );
  });

  test('collections of different lengths are an error on both routes', () => {
    const ce = new ComputeEngine();
    const f = ['Function', ['Add', 'x', 'y'], 'x', 'y'];
    ce.declare('Y', 'function');
    ce.assign('Y', ce.box(f as never));
    const args = [['List', 1, 2], ['List', 1, 2, 3]];
    expect(
      ce.box(['Apply', f, ...args] as never).evaluate().toString()
    ).toContain('incompatible-dimensions');
    expect(ce.box(['Y', ...args] as never).evaluate().toString()).toContain(
      'incompatible-dimensions'
    );
  });

  test('a parenthesized pipe stage maps', () => {
    const ce = new ComputeEngine();
    expect(
      ce.parse('[1,2,3] |> (x \\mapsto (x,x))').evaluate().toString()
    ).toBe('[(1, 1),(2, 2),(3, 3)]');
  });

  test('a collection parameter binds the argument whole', () => {
    const ce = new ComputeEngine();
    const call = ce.box([
      'Apply',
      ['Function', ['Length', 'x'], 'x'],
      ['List', 1, 2],
    ] as never);
    expect(call.evaluate().toString()).toBe('2');
  });

  test('several arguments zip, and a scalar argument repeats', () => {
    const ce = new ComputeEngine();
    const add = ['Function', ['Add', 'x', 'y'], 'x', 'y'];
    expect(
      ce.box(['Apply', add, ['List', 1, 2], 10] as never).evaluate().toString()
    ).toBe('[11,12]');
    expect(
      ce
        .box(['Apply', add, ['List', 1, 2], ['List', 1, 2, 3]] as never)
        .evaluate()
        .toString()
    ).toContain('incompatible-dimensions');
  });

  test.each(['value', 'unknown'])(
    'a large declared broadcastable<%s> map still maps one rank only',
    (t) => {
      const ce = new ComputeEngine();
      ce.declare('vf', `(broadcastable<${t}>) -> unknown` as never);
      ce.assign('vf', ce.box(['Function', ['Tuple', 'x', 'x'], 'x']));
      const rows = Array.from({ length: 150 }, (_, i) => ['List', i, i + 1]);
      const value = ce.box(['vf', ['List', ...rows]] as never).evaluate();
      expect(value.at(3)?.toString()).toBe('([2,3], [2,3])');
    }
  );

  test('a declared broadcastable slot still maps one rank only', () => {
    const ce = new ComputeEngine();
    ce.declare('vf', '(broadcastable<value>) -> unknown');
    ce.assign('vf', ce.box(['Function', ['Tuple', 'x', 'x'], 'x']));
    expect(
      ce
        .box(['vf', ['List', ['List', 1, 2], ['List', 3, 4, 5]]] as never)
        .evaluate()
        .toString()
    ).toBe('[([1,2], [1,2]),([3,4,5], [3,4,5])]');
  });

  test('a collection argument with no value holds the call, like the named route', () => {
    const ce = new ComputeEngine();
    ce.declare('s', 'list<number>');
    const f = ['Function', ['Tuple', 'x', 'y'], 'x', 'y'];
    expect(
      ce.box(['Apply', f, ['List', 1, 2], 's'] as never).evaluate().operator
    ).toBe('Apply');
  });

  // The type handler types the call as the mapped collection. Binding the
  // valueless symbol whole gave a value of another shape (`7`, or an
  // `incompatible-type` error for a `real` parameter), so the call is held,
  // and it maps once the symbol has a value.
  test.each([
    ['a body that ignores the parameter', 7, '[7,7]'],
    ['a body that reads the parameter', ['Multiply', 2, 'u'], '[6,8]'],
  ])(
    'a lone collection argument with no value holds the call: %s',
    (_, body, mapped) => {
      for (const param of ['u', ['Typed', 'u', 'real']]) {
        const ce = new ComputeEngine();
        ce.declare('v', 'list<real^2>');
        const call = ce.box(['Apply', ['Function', body, param], 'v'] as never);
        expect(call.type.matches('list')).toBe(true);
        const held = call.evaluate();
        expect(held.isSame(call)).toBe(true);
        ce.assign('v', ce.box(['List', 3, 4]));
        expect(held.evaluate().toString()).toBe(mapped);
        expect(call.evaluate().toString()).toBe(mapped);
      }
    }
  );

  // The same rule on the named route, for a function declared with a scalar
  // signature and then assigned a literal (a value definition): `f(w)` gave
  // `7` while its type was `list<real>`.
  test.each([
    ['a body that ignores the parameter', 7, '[7,7]'],
    ['a body that reads the parameter', ['Multiply', 2, 'u'], '[6,8]'],
  ])(
    'a declared function holds a lone collection argument with no value: %s',
    (_, body, mapped) => {
      for (const param of ['u', ['Typed', 'u', 'real']]) {
        const ce = new ComputeEngine();
        ce.declare('f', '(real) -> real');
        ce.assign('f', ce.box(['Function', body, param] as never));
        ce.declare('w', 'list<real>');
        const call = ce.box(['f', 'w']);
        expect(call.type.toString()).toBe('list<real>');
        const held = call.evaluate();
        expect(held.isSame(call)).toBe(true);
        // A scalar argument is applied at once.
        expect(ce.box(['f', 3]).evaluate().toString()).toBe(
          body === 7 ? '7' : '6'
        );
        ce.assign('w', ce.box(['List', 3, 4]));
        expect(held.evaluate().toString()).toBe(mapped);
        expect(call.evaluate().toString()).toBe(mapped);
      }
    }
  );

  // The three routes side by side: `h` is assigned a literal with no
  // declaration (an operator definition), `f` is declared `function` and
  // then assigned (a value definition), and `Apply` calls the literal
  // directly. The argument `q` is declared `real | list<real>` with no value,
  // so it can still become a list. The operator-definition route gave `7`,
  // which was wrong after `q := [1, 2]`.
  test.each([
    ['a body that ignores the parameter', 7, '7', '[7,7]'],
    ['a body that reads the parameter', ['Multiply', 2, 'u'], '6', '[2,4]'],
  ])(
    'a possibly-collection argument with no value holds the call on every route: %s',
    async (_, body, scalar, mapped) => {
      const ce = new ComputeEngine();
      const literal = ['Function', body, 'u'];
      ce.assign('h', ce.box(literal as never));
      ce.declare('f', 'function');
      ce.assign('f', ce.box(literal as never));
      ce.declare('q', 'real | list<real>');
      ce.declare('r', 'real');
      ce.declare('p', 'real | list<real>');
      ce.assign('p', 3);
      const calls = (arg: string) => [
        ce.box(['h', arg]),
        ce.box(['f', arg]),
        ce.box(['Apply', literal, arg] as never),
      ];
      const held = calls('q').map((call) => call.evaluate());
      for (const [i, call] of calls('q').entries()) {
        expect(held[i].isSame(call)).toBe(true);
        expect((await call.evaluateAsync()).isSame(call)).toBe(true);
      }
      // A scalar-typed argument, and a scalar value under the union
      // declaration, are applied at once.
      for (const call of [...calls('r'), ...calls('p')]) {
        if (body === 7) expect(call.evaluate().toString()).toBe('7');
        else expect(call.evaluate().operator).not.toBe(call.operator);
      }
      for (const call of calls('p'))
        expect(call.evaluate().toString()).toBe(scalar);
      ce.assign('q', ce.box(['List', 1, 2]));
      for (const x of [...held, ...calls('q')])
        expect(x.evaluate().toString()).toBe(mapped);
    }
  );

  // The three routes side by side, for each declared type of a valueless
  // argument `s`, an untyped and a `real` parameter, and a body that ignores
  // or reads the parameter. A call is held only when `s` can still get a
  // value that the call maps over (an indexed collection). A set or a
  // dictionary is never mapped over, so the call is applied at once on every
  // route; the literal and the declared-function routes used to hold it,
  // while the operator-definition route applied it.
  //
  // `held` is a call that evaluates to itself, `type-error` is an
  // `incompatible-type` error. The `Apply` route reports a typed parameter
  // that refuses its argument as an error in the argument of `Apply`, not as
  // the result: this is the same for a string or a boolean argument, so the
  // table only compares the error code.
  describe('a valueless argument: the same result on the three routes', () => {
    const HOLDS = { untyped: ['held', 'held'], typed: ['held', 'held'] };
    const REFUSED = {
      untyped: ['7', 'type-error'],
      typed: ['type-error', 'type-error'],
    };
    const cases: [string, { untyped: string[]; typed: string[] }][] = [
      ['set<real>', REFUSED],
      ['dictionary<real>', REFUSED],
      ['list<real>', HOLDS],
      ['real | list<real>', HOLDS],
      ['broadcastable<real>', HOLDS],
      ['collection<real>', HOLDS],
      ['real', { untyped: ['7', 's + 1'], typed: ['7', 's + 1'] }],
    ];
    const bodies = [7, ['Add', 'u', 1]];
    const params = { untyped: 'u', typed: ['Typed', 'u', 'real'] };
    const outcome = (call: Expression): string => {
      const result = call.evaluate();
      if (result.isSame(call)) return 'held';
      const json = JSON.stringify(result.json);
      if (json.includes('incompatible-type')) return 'type-error';
      return result.toString();
    };

    test.each(cases)('s: %s', (type, expected) => {
      for (const kind of ['untyped', 'typed'] as const) {
        for (const [i, body] of bodies.entries()) {
          const ce = new ComputeEngine();
          const literal = ['Function', body, params[kind]];
          ce.declare('s', type);
          ce.assign('h', ce.box(literal as never));
          ce.declare('f', 'function');
          ce.assign('f', ce.box(literal as never));
          const calls = [
            ce.box(['h', 's']),
            ce.box(['f', 's']),
            ce.box(['Apply', literal, 's'] as never),
          ];
          const label = `${kind} parameter, body ${JSON.stringify(body)}`;
          expect([label, ...calls.map(outcome)]).toEqual([
            label,
            ...Array(3).fill(expected[kind][i]),
          ]);
          if (expected[kind][i] !== 'held') continue;
          // A held call maps once `s` has a list value.
          ce.assign('s', ce.box(['List', 3, 4]));
          expect([label, ...calls.map((c) => c.evaluate().toString())]).toEqual(
            [label, ...Array(3).fill(i === 0 ? '[7,7]' : '[4,5]')]
          );
        }
      }
    });
  });

  // A parameter declared as a scalar (a number or a boolean) maps over a
  // TUPLE argument, as `Sin` does (user decision 2026-10-03), on the three
  // routes: `h` assigned a
  // literal with no declaration, `f` declared `function` and then assigned,
  // and `Apply` of the literal. A parameter with no declared type binds the
  // tuple whole. The type of the call is the type of its value.
  describe('a tuple at a parameter declared as a scalar (a number or a boolean)', () => {
    const routes = (
      ce: ComputeEngine,
      literal: unknown,
      ...args: unknown[]
    ): Expression[] => {
      ce.assign('h', ce.box(literal as never));
      ce.declare('f', 'function');
      ce.assign('f', ce.box(literal as never));
      return [
        ce.box(['h', ...args] as never),
        ce.box(['f', ...args] as never),
        ce.box(['Apply', literal, ...args] as never),
      ];
    };
    const typed = (body: unknown, type = 'real') => [
      'Function',
      body,
      ['Typed', 'u', type],
    ];

    test.each([
      ['(a, b)', ['Tuple', 'a', 'b'], 7, '(7, 7)', 'tuple<integer, integer>'],
      ['(a, b)', ['Tuple', 'a', 'b'], ['Multiply', 2, 'u'], '(2a, 2b)', 'tuple<real, real>'],
      ['(1, 2)', ['Tuple', 1, 2], ['Add', 'u', 1], '(2, 3)', 'tuple<real, real>'],
      ['a symbol with a tuple value', 'tv', 7, '(7, 7)', 'tuple<integer, integer>'],
      [
        'a list of tuples',
        ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]],
        ['Multiply', 2, 'u'],
        '[(2, 4),(6, 8)]',
        'list<tuple<real, real>^2>',
      ],
      [
        'a tuple of tuples',
        ['Tuple', ['Tuple', 1, 2], 3],
        ['Add', 'u', 1],
        '((2, 3), 4)',
        'tuple<tuple<real, real>, real>',
      ],
    ])('%s, body %j', (_, arg, body, value, type) => {
      const ce = new ComputeEngine();
      ce.declare('tv', 'tuple<real, real>');
      ce.assign('tv', ce.box(['Tuple', 3, 4]));
      for (const call of routes(ce, typed(body), arg)) {
        expect(call.type.toString()).toBe(type);
        expect(call.evaluate().toString()).toBe(value);
      }
    });

    test('a parameter with no declared type binds the tuple whole', () => {
      const ce = new ComputeEngine();
      for (const call of routes(ce, ['Function', 7, 'u'], ['Tuple', 1, 2]))
        expect(call.evaluate().toString()).toBe('7');
    });

    test('a signature declared for a named function counts', () => {
      const ce = new ComputeEngine();
      ce.declare('k', '(real) -> real');
      ce.assign('k', ce.box(['Function', 7, 'u']));
      const call = ce.box(['k', ['Tuple', 'a', 'b']]);
      expect(call.type.toString()).toBe('tuple<real, real>');
      expect(call.evaluate().toString()).toBe('(7, 7)');
    });

    test('a tuple symbol with no value holds the call', async () => {
      const ce = new ComputeEngine();
      ce.declare('tn', 'tuple<real, real>');
      const calls = routes(ce, typed(7), 'tn');
      for (const call of calls) {
        expect(call.type.toString()).toBe('tuple<integer, integer>');
        expect(call.evaluate().isSame(call)).toBe(true);
        expect((await call.evaluateAsync()).isSame(call)).toBe(true);
      }
      ce.assign('tn', ce.box(['Tuple', 3, 4]));
      for (const call of calls) expect(call.evaluate().toString()).toBe('(7, 7)');
    });

    test('the asynchronous evaluation maps too', async () => {
      const ce = new ComputeEngine();
      for (const call of routes(ce, typed(7), ['Tuple', 1, 2]))
        expect((await call.evaluateAsync()).toString()).toBe('(7, 7)');
    });

    test('a tuple with a list component is an error', () => {
      const ce = new ComputeEngine();
      const arg = ['Tuple', ['List', 1, 2], ['List', 3, 4]];
      for (const call of routes(ce, typed(7), arg)) {
        const result = call.evaluate();
        expect(result.operator).toBe('Error');
        expect(result.toString()).toMatch(/incompatible-type/);
      }
    });

    test('each component is checked against the declared type', () => {
      const ce = new ComputeEngine();
      const calls = routes(ce, typed(['Add', 'u', 1], 'integer'), [
        'Tuple',
        1.5,
        2,
      ]);
      for (const call of calls) {
        const result = call.evaluate();
        expect(result.operator).toBe('Tuple');
        expect(result.ops![0].operator).toBe('Error');
        expect(result.ops![0].toString()).toMatch(/incompatible-type/);
        expect(result.ops![1].toString()).toBe('3');
      }
    });

    // An argument that the declared type refuses gives the same error value
    // on the three routes. The `Apply` route used to give the inert
    // application with the argument marked (`Apply((u) => 7,
    // Error(incompatible-type, …))`).
    test.each([
      ['a string', "'abc'", 'string'],
      ['a boolean', 'True', 'boolean'],
      ['a set', 'st', 'set<real>'],
    ])('%s argument is the same error on every route', (_, arg, type) => {
      const ce = new ComputeEngine();
      ce.declare('st', 'set<real>');
      for (const call of routes(ce, typed(7), arg)) {
        const result = call.evaluate();
        expect(result.operator).toBe('Error');
        expect(result.op1.toString()).toBe(
          `ErrorCode("incompatible-type", "real", "${type}")`
        );
      }
    });

    // A mismatch that the types already prove (a string or a boolean at a
    // `real` parameter) makes the call invalid when it is boxed, typed
    // `error`, on the three routes. A set is decided at evaluation, on the
    // three routes too.
    test.each([
      ["'abc'", false, 'error'],
      ['True', false, 'error'],
      ['st', true, 'integer'],
    ])('the type of a call with %s is the same on every route', (arg, valid, type) => {
      const ce = new ComputeEngine();
      ce.declare('st', 'set<real>');
      for (const call of routes(ce, typed(7), arg)) {
        expect(call.isValid).toBe(valid);
        expect(call.type.toString()).toBe(type);
      }
    });

    // The refusal states what the name held when the call was boxed. A call
    // boxed before an assignment that replaces the function is evaluated,
    // and typed, with the function that the name holds now: the same as a
    // call boxed after the assignment. `f` is declared `function` (a value
    // definition); `h` is assigned with no declaration (an operator
    // definition), which accepts only a function with a compatible
    // signature, here a literal with an untyped parameter.
    test.each([
      ['f', true, ['Function', 1, ['Typed', 'u', 'string']]],
      ['h', false, ['Function', 1, 'u']],
    ])(
      'a call of %s refused before a reassignment uses the new function',
      async (name, declared, replacement) => {
        const ce = new ComputeEngine();
        if (declared) ce.declare(name, 'function');
        ce.assign(name, ce.box(typed(7) as never));
        const call = ce.box([name, "'abc'"] as never);
        expect(call.type.toString()).toBe('error');
        expect(call.evaluate().operator).toBe('Error');
        ce.assign(name, ce.box(replacement as never));
        const fresh = ce.box([name, "'abc'"] as never);
        for (const c of [call, fresh]) {
          expect(c.type.toString()).toBe('integer');
          expect(c.evaluate().toString()).toBe('1');
          expect((await c.evaluateAsync()).toString()).toBe('1');
        }
      }
    );

    test('a call refused again after a reassignment stays an error', () => {
      const ce = new ComputeEngine();
      ce.declare('f', 'function');
      ce.assign('f', ce.box(typed(7) as never));
      const call = ce.box(['f', "'abc'"] as never);
      ce.assign('f', ce.box(typed(8) as never));
      expect(call.type.toString()).toBe('error');
      expect(call.evaluate().toString()).toBe(
        'Error(ErrorCode("incompatible-type", "real", "string"), "abc")'
      );
    });

    // The result does not depend on where the refused call is: a call in an
    // operand at any depth uses the new function too. The parent was boxed
    // invalid, and its evaluation used to bubble the error that the call
    // held, without evaluating the call again.
    test.each([
      ['f', true, ['Function', 1, ['Typed', 'u', 'string']]],
      ['h', false, ['Function', 1, 'u']],
    ])(
      'a refused call of %s in an operand uses the new function',
      async (name, declared, replacement) => {
        const ce = new ComputeEngine();
        if (declared) ce.declare(name, 'function');
        ce.assign(name, ce.box(typed(7) as never));
        const call = [name, "'abc'"];
        const sum = ce.box(['Add', call, 1] as never);
        const nested = ce.box(['Add', ['Multiply', 2, call], 1] as never);
        const list = ce.box(['List', call, 1] as never);
        for (const x of [sum, nested])
          expect(x.type.toString()).toBe('error');
        // A list keeps a failed cell: it is still a collection, and the
        // failed cell is left out of its element type, which describes the
        // successful cells (`docs/ERROR-MODEL.md` §4).
        expect(list.type.toString()).toBe('vector<integer^2>');
        expect(sum.evaluate().toString()).toBe(
          'Error(ErrorCode("incompatible-type", "real", "string"), "abc")'
        );
        expect(nested.evaluate().operator).toBe('Error');
        // The list evaluates its cells: the cell of the refused call is the
        // value of that call, the error.
        expect(list.evaluate().json).toEqual([
          'List',
          ce.box(call as never).evaluate().json,
          1,
        ]);

        ce.assign(name, ce.box(replacement as never));
        expect(sum.type.toString()).toBe('integer');
        expect(sum.evaluate().toString()).toBe('2');
        expect((await sum.evaluateAsync()).toString()).toBe('2');
        expect(nested.evaluate().toString()).toBe('3');
        expect(list.evaluate().json).toEqual(['List', 1, 1]);
      }
    );

    // The assignment that replaces the function is a statement of the same
    // `Block`, evaluated before the statement with the call.
    test('a refused call after a reassignment in the same block', () => {
      const ce = new ComputeEngine();
      ce.assign('h', ce.box(typed(7) as never));
      const block = ce.box([
        'Block',
        ['Assign', 'h', ['Function', 7, 'u']],
        ['Add', ['h', "'abc'"], 1],
      ] as never);
      expect(block.isValid).toBe(false);
      expect(block.evaluate().toString()).toBe('8');
    });

    test('a refused call in an operand that is still refused stays an error', () => {
      const ce = new ComputeEngine();
      ce.declare('f', 'function');
      ce.assign('f', ce.box(typed(7) as never));
      const sum = ce.box(['Add', ['Sin', ['f', "'abc'"]], 1] as never);
      ce.assign('f', ce.box(typed(8) as never));
      expect(sum.type.toString()).toBe('error');
      const result = sum.evaluate();
      expect(result.operator).toBe('Error');
      expect(result.op1.toString()).toBe(
        'ErrorCode("incompatible-type", "real", "string")'
      );
    });

    // "Scalar" means a number or a boolean (user decision 2026-10-03): the
    // library functions map over a tuple of booleans (`Not((True, False))`).
    test('a parameter declared `boolean` maps over a tuple of booleans', () => {
      const ce = new ComputeEngine();
      const literal = ['Function', ['Not', 'p'], ['Typed', 'p', 'boolean']];
      for (const call of routes(ce, literal, ['Tuple', 'True', 'False'])) {
        expect(call.type.toString()).toBe('tuple<boolean, boolean>');
        expect(call.evaluate().json).toEqual(['Tuple', 'False', 'True']);
      }
      expect(
        ce.box(['Not', ['Tuple', 'True', 'False']]).evaluate().json
      ).toEqual(['Tuple', 'False', 'True']);
    });

    test('a parameter declared `string` binds a tuple whole', () => {
      const ce = new ComputeEngine();
      const literal = ['Function', 7, ['Typed', 's', 'string']];
      for (const call of routes(ce, literal, ['Tuple', "'a'", "'b'"]))
        expect(call.evaluate().operator).not.toBe('Tuple');
    });

    // A list at a parameter declared as a collection is bound whole in each
    // cell: the value is a tuple, and the type says so.
    test('a tuple beside a list bound whole', () => {
      const ce = new ComputeEngine();
      ce.declare('V', 'list<real>');
      ce.assign('V', ce.box(['List', 10, 20]));
      const literal = [
        'Function',
        ['Add', 'u', ['Length', 'w']],
        ['Typed', 'u', 'real'],
        ['Typed', 'w', 'list<real>'],
      ];
      for (const call of routes(ce, literal, ['Tuple', 1, 2], 'V')) {
        expect(call.type.toString()).toMatch(/^tuple<.*, .*>$/);
        expect(call.evaluate().toString()).toBe('(3, 4)');
      }
    });

    // A failing component says that the call was applied component-wise,
    // on every route, as a failing element of a list does.
    test('a failing component carries the element-wise context', () => {
      const ce = new ComputeEngine();
      const literal = typed(['Add', 'u', 1], 'integer');
      for (const call of [
        ...routes(ce, literal, ['Tuple', 1.5, 2]),
        ce.box(['Apply', literal, ['List', 1.5, 2]] as never),
      ])
        expect(call.evaluate().toString()).toMatch(
          /while applying ('h'|'f'|the function literal) element-wise over 2 elements \(element 1\)/
        );
    });

    // The cells of `Apply` over a list are typed with the declared type of
    // the parameter, as on the named routes.
    test('a declared parameter types the cells of a mapped list', () => {
      const ce = new ComputeEngine();
      const literal = typed(['Add', 'u', 1], 'integer');
      for (const call of routes(ce, literal, ['List', 1.5, 2]))
        expect(call.type.toString()).toBe('vector<integer^2>');
    });
  });

  test('an error argument bubbles before the map', () => {
    const ce = new ComputeEngine();
    const call = ce.box([
      'Apply',
      ['Function', 'x', 'x', 'y'],
      ['List'],
      ['Error', "'boom'"],
    ] as never);
    expect(call.evaluate().toString()).toBe('Error("boom")');
  });

  // A parameter declared `value` admits a list, so it receives the list
  // whole (user decision 2026-10-30, GitHub issue #488). Before, it was
  // read as a scalar parameter and the call gave `[(1, 1),(2, 2)]`.
  test('an annotated `value` parameter receives a list whole, as on the named route', () => {
    const ce = new ComputeEngine();
    const f = ['Function', ['Tuple', 'x', 'x'], ['Typed', 'x', "'value'"]];
    ce.declare('V', 'function');
    ce.assign('V', ce.box(f as never));
    for (const e of [
      ['Apply', f, ['List', 1, 2]],
      ['V', ['List', 1, 2]],
    ]) {
      const call = ce.box(e as never);
      const value = call.evaluate();
      expect(value.toString()).toBe('([1,2], [1,2])');
      expect(value.type.matches(call.type)).toBe(true);
    }
  });

  test('a ragged list is typed so that its value is a member', () => {
    const ce = new ComputeEngine();
    const call = ce.box([
      'Apply',
      ['Function', ['Tuple', 'x', 'x'], 'x'],
      ['List', ['List', 1, 2], 3],
    ] as never);
    expect(call.evaluate().type.matches(call.type)).toBe(true);
  });

  test('a large declared broadcastable map compiles', () => {
    const ce = new ComputeEngine();
    ce.declare('S', '(broadcastable<real>) -> real' as never);
    ce.assign('S', ce.parse('x \\mapsto \\sin x'));
    const value = ce.box(['S', ['Range', 1, 300]] as never).evaluate();
    const r = compile(value, { fallback: false } as never)!;
    expect(r.success).toBe(true);
    expect((r.run!({}) as number[]).length).toBe(300);
  });

  // A known-infinite source maps lazily on both routes, so the value is the
  // infinite list its `list<tuple<…>>` type describes. `Apply`, and a
  // function declared `function` then assigned, used to bind it whole:
  // `(Range(1, +oo), Range(1, +oo))`.
  test.each([
    ['an infinite range', ['Range', 1, { num: '+Infinity' }], '(3, 3)'],
    ['a cycle', ['Cycle', ['List', 1, 2]], '(1, 1)'],
  ])('a known-infinite source maps lazily: %s', (_, arg, third) => {
    const ce = new ComputeEngine();
    const f = ['Function', ['Tuple', 'x', 'x'], 'x'];
    ce.declare('H', 'function');
    ce.assign('H', ce.box(f as never));
    for (const e of [['Apply', f, arg], ['H', arg]]) {
      const call = ce.box(e as never);
      const value = call.evaluate();
      expect(value.isFiniteCollection).toBe(false);
      expect(value.at(3)?.toString()).toBe(third);
      // `Cycle([1, 2])` is typed as a bare `list`, whose elements can be
      // lists, so an element of the result can be a list too.
      expect(call.type.toString()).toMatch(/^list<(list<any> \| )?tuple</);
    }
  });

  test('a finite list beside an infinite source is an error on both routes', () => {
    const ce = new ComputeEngine();
    const f = ['Function', ['Add', 'x', 'y'], 'x', 'y'];
    ce.declare('G', 'function');
    ce.assign('G', ce.box(f as never));
    const args = [['List', 1, 2, 3], ['Range', 1, { num: '+Infinity' }]];
    for (const e of [['Apply', f, ...args], ['G', ...args]])
      expect(ce.box(e as never).evaluate().toString()).toBe(
        'Error("incompatible-dimensions", "3 vs Infinity")'
      );
  });
});

// A parameter declared with one of the wide types `any`, `expression` or
// `value` admits a collection, so it receives a collection argument whole. A
// parameter with no declared type, or declared `unknown`, is still mapped
// over the leaves of a list, and so is a parameter declared with a scalar
// type (user decision 2026-10-30, GitHub issue #488).
describe('A PARAMETER DECLARED WITH A WIDE TYPE', () => {
  const ARG = ['List', ['List', 0, 0], 5];
  const BODY = ['If', ['Element', 't', 'Integers'], 0, 1];
  const param = (type: string | undefined) =>
    type === undefined ? 't' : ['Typed', 't', `'${type}'`];

  test.each([
    [undefined, '[[0,0],0]'],
    ['unknown', '[[0,0],0]'],
    ['integer', '[[0,0],0]'],
    ['any', '1'],
    ['expression', '1'],
    ['value', '1'],
    ['list', '1'],
  ])('a list at a parameter declared %s', (type, expected) => {
    const ce = new ComputeEngine();
    const f = ['Function', BODY, param(type)];
    for (const e of [
      [f, ARG],
      ['Apply', f, ARG],
    ]) {
      const call = ce.box(e as never);
      const value = call.evaluate();
      expect(value.toString()).toBe(expected);
      expect(value.type.matches(call.type)).toBe(true);
    }
  });

  // The recursion descends into the list only when the list reaches the body
  // whole. Mapped at the leaves, each leaf gives `1`, and the result is
  // `[[1,1],1]`.
  //
  // With `t: expression`, the definition was refused: `At` did not admit a
  // base typed `expression`, although `expression` includes the
  // collections.
  //
  // The call is checked on the three routes: the named call, the call of
  // the literal and `Apply`, and its type agrees with its value on each.
  test.each([
    [undefined],
    ['any'],
    ['expression'],
    ['value'],
    ['integer | list'],
  ])(
    'a recursive function with a parameter declared %s receives the list whole',
    (type) => {
      const ce = new ComputeEngine();
      const f = [
        'Function',
        [
          'If',
          ['Element', 't', 'Integers'],
          1,
          ['Add', ['leaves', ['At', 't', 1]], ['leaves', ['At', 't', 2]]],
        ],
        param(type),
      ];
      ce.box(['Assign', 'leaves', f] as never).evaluate();
      const arg = ['List', ['List', 0, 0], 0];
      for (const e of [
        ['leaves', arg],
        [f, arg],
        ['Apply', f, arg],
      ]) {
        const call = ce.box(e as never);
        const value = call.evaluate();
        expect(value.toString()).toBe('3');
        expect(value.type.matches(call.type)).toBe(true);
      }
    }
  );

  // A base typed `expression` can be a collection, so `At` keeps it, as it
  // keeps a base typed `value`, and the evaluation reads the value. A
  // scalar value is refused there.
  test.each([['expression'], ['value']])(
    'an access into a parameter declared %s',
    (type) => {
      const ce = new ComputeEngine();
      const f = ['Function', ['At', 't', 1], param(type)];
      const list = ce.box([f, ['List', 5, 6]] as never);
      expect(list.evaluate().toString()).toBe('5');
      expect(list.evaluate().type.matches(list.type)).toBe(true);
      const scalar = ce.box([f, 5] as never).evaluate();
      expect(scalar.operator).toBe('Error');
    }
  );

  test.each([['any'], ['expression'], ['value'], ['unknown'], [undefined]])(
    'a tuple at a parameter declared %s is bound whole',
    (type) => {
      const ce = new ComputeEngine();
      const u = type === undefined ? 'u' : ['Typed', 'u', `'${type}'`];
      const call = ce.box([
        ['Function', ['Length', 'u'], u],
        ['Tuple', 3, 4],
      ] as never);
      const value = call.evaluate();
      expect(value.toString()).toBe('2');
      expect(value.type.matches(call.type)).toBe(true);
    }
  );

  // With `t: expression`, the body `2t` is typed `number`. A collection
  // argument is bound whole, so the call is typed from the body with `t`
  // typed as the argument, on the three routes.
  test.each([
    ['any', ['List', 1, 2, 3], '[2,4,6]'],
    ['expression', ['List', 1, 2, 3], '[2,4,6]'],
    ['value', ['List', 1, 2, 3], '[2,4,6]'],
    ['any', ['Tuple', 3, 4], '(6, 8)'],
    ['expression', ['Tuple', 3, 4], '(6, 8)'],
    ['value', ['Tuple', 3, 4], '(6, 8)'],
  ])(
    'the type of a call with a parameter declared %s agrees with its value for %j',
    (type, arg, expected) => {
      const ce = new ComputeEngine();
      const f = ['Function', ['Multiply', 't', 2], param(type)];
      ce.declare('W', 'function');
      ce.assign('W', ce.box(f as never));
      for (const e of [
        [f, arg],
        ['Apply', f, arg],
        ['W', arg],
      ]) {
        const call = ce.box(e as never);
        const value = call.evaluate();
        expect(value.toString()).toBe(expected);
        expect(value.type.matches(call.type)).toBe(true);
      }
    }
  );

  test.each([['any'], ['expression'], ['value']])(
    'compiled code receives the list whole at a parameter declared %s',
    (type) => {
      const ce = new ComputeEngine();
      const call = ce.box([
        ['Function', ['Sum', 't'], param(type)],
        ['List', 1, 2, 3],
      ] as never);
      expect(call.evaluate().toString()).toBe('6');
      // Without constant folding, the generated code would compute the sum.
      // The value of a parameter declared `any`, `value` or `expression` can
      // be a number or a list, and compiled code does not test the shape of
      // a value at run time, so the compilation declines, and the
      // interpreter computes the sum. The list is summed whole, not mapped.
      const result = compile(call, {
        to: 'javascript',
        constantFold: false,
      } as never)!;
      expect(result.success).toBe(false);
      expect(result.run!({})).toBe(6);
    }
  );

  // The body `2t` maps over the list. On the literal route (with constant
  // folding off, so that the generated code would compute it), the value of
  // the parameter declared `any` or `value` can be a number or a list, and
  // compiled code does not test the shape of a value at run time, so the
  // compilation declines, and the interpreter fallback gives the value. On
  // the named route, the argument is the input `L` declared `list`, and the
  // compiled value is the value of the interpreter. The same calls with a
  // parameter declared `expression` are declined (see the tests below).
  test.each([
    ['any', [[0, 0], 5], [[0, 0], 10]],
    ['value', [[0, 0], 5], [[0, 0], 10]],
    [
      'any',
      [
        [1, 2],
        [3, 4],
      ],
      [
        [2, 4],
        [6, 8],
      ],
    ],
    [
      'value',
      [
        [1, 2],
        [3, 4],
      ],
      [
        [2, 4],
        [6, 8],
      ],
    ],
  ])(
    'compiled code maps the body over a nested list at a parameter declared %s (%j)',
    (type, arg, expected) => {
      const ce = new ComputeEngine();
      const toList = (x: unknown): unknown =>
        Array.isArray(x) ? ['List', ...x.map(toList)] : x;
      const f = ['Function', ['Multiply', 2, 't'], param(type)];
      const literalCall = ce.box([f, toList(arg)] as never);
      expect(literalCall.evaluate().json).toEqual(toList(expected));
      expect(() =>
        compile(literalCall, {
          to: 'javascript',
          fallback: false,
          constantFold: false,
        } as never)
      ).toThrow(/declared `any` or `value`/);
      const literal = compile(literalCall, {
        to: 'javascript',
        constantFold: false,
      } as never)!;
      expect(literal.success).toBe(false);
      expect(literal.run!({})).toEqual(expected);

      ce.declare('W', 'function');
      ce.assign('W', ce.box(f as never));
      ce.declare('L', 'list');
      const namedCall = ce.box(['W', 'L'] as never);
      const namedRun = compile(namedCall, {
        to: 'javascript',
        fallback: false,
      } as never)!.run!;
      expect(namedRun({ L: arg })).toEqual(expected);
      ce.assign('L', ce.box(toList(arg) as never));
      expect(namedCall.evaluate().json).toEqual(toList(expected));
    }
  );

  // Compiled code reads a parameter declared `expression` as a scalar, and
  // it does not test the argument at run time. So a call where an argument that can be a collection reaches
  // such a parameter is declined, and the interpreter computes the value.
  // The routes: a function literal (with constant folding off, so that the
  // generated code would compute it), a named function with the list as a
  // run-time input, a host-declared `(expression) -> any` with an untyped
  // literal, an alias of `expression`, and the function literal compiled
  // as a function value.
  describe('compiled code declines a collection at a parameter declared `expression`', () => {
    const NESTED = [
      [1, 2],
      [3, 4],
    ];
    const DOUBLED = [
      [2, 4],
      [6, 8],
    ];
    const NESTED_LIST = ['List', ['List', 1, 2], ['List', 3, 4]];
    const literal = (type = 'expression') => [
      'Function',
      ['Multiply', 2, 't'],
      ['Typed', 't', `'${type}'`],
    ];

    test('a function literal applied to a nested list', () => {
      const ce = new ComputeEngine();
      const call = ce.box([literal(), NESTED_LIST] as never);
      expect(call.evaluate().json).toEqual([
        'List',
        ['List', 2, 4],
        ['List', 6, 8],
      ]);
      const result = compile(call, {
        to: 'javascript',
        constantFold: false,
      } as never)!;
      expect(result.success).toBe(false);
      expect(result.run!({})).toEqual(DOUBLED);
    });

    test('a named function applied to a list input', () => {
      const ce = new ComputeEngine();
      ce.declare('W', 'function');
      ce.assign('W', ce.box(literal() as never));
      ce.declare('L', 'list');
      const result = compile(ce.box(['W', 'L'] as never), {
        to: 'javascript',
      } as never)!;
      expect(result.success).toBe(false);
      expect(result.run!({ L: NESTED })).toEqual(DOUBLED);
    });

    test('a host-declared `(expression) -> any` with an untyped literal', () => {
      const ce = new ComputeEngine();
      ce.declare('h', '(expression) -> any');
      ce.assign('h', ce.box(['Function', ['Multiply', 2, 't'], 't'] as never));
      const result = compile(ce.box(['h', NESTED_LIST] as never), {
        to: 'javascript',
        constantFold: false,
      } as never)!;
      expect(result.success).toBe(false);
      expect(result.run!({})).toEqual(DOUBLED);
    });

    test('a parameter declared with an alias of `expression`', () => {
      const ce = new ComputeEngine();
      ce.declareType('A', 'expression', { alias: true });
      const result = compile(ce.box([literal('A'), NESTED_LIST] as never), {
        to: 'javascript',
        constantFold: false,
      } as never)!;
      expect(result.success).toBe(false);
      expect(result.run!({})).toEqual(DOUBLED);
    });

    test('the function literal compiled as a function value', () => {
      const ce = new ComputeEngine();
      const result = compile(ce.box(literal() as never), {
        to: 'javascript',
      } as never)!;
      expect(result.success).toBe(false);
    });

    test.each([['javascript'], ['interval-js'], ['python']])(
      'target %s declines a nested list at the function literal',
      (to) => {
        const ce = new ComputeEngine();
        const result = compile(ce.box([literal(), NESTED_LIST] as never), {
          to,
          constantFold: false,
        } as never)!;
        expect(result.success).toBe(false);
      }
    );

    // A scalar argument at such a parameter compiles as before.
    test('a function literal applied to a scalar still compiles', () => {
      const ce = new ComputeEngine();
      const result = compile(ce.box([literal(), 5] as never), {
        to: 'javascript',
        constantFold: false,
      } as never)!;
      expect(result.success).toBe(true);
      expect(result.run!({})).toBe(10);
    });

    test('a named function applied to a real input still compiles', () => {
      const ce = new ComputeEngine();
      ce.declare('W', 'function');
      ce.assign('W', ce.box(literal() as never));
      ce.declare('x', 'real');
      const result = compile(ce.box(['W', 'x'] as never), {
        to: 'javascript',
      } as never)!;
      expect(result.success).toBe(true);
      expect(result.run!({ x: 5 })).toBe(10);
    });

    test('an alias of `expression` with a real input still compiles', () => {
      const ce = new ComputeEngine();
      ce.declareType('A', 'expression', { alias: true });
      ce.declare('x', 'real');
      const result = compile(ce.box([literal('A'), 'x'] as never), {
        to: 'javascript',
      } as never)!;
      expect(result.success).toBe(true);
      expect(result.run!({ x: 5 })).toBe(10);
    });
  });

  // The host declares the parameter type, and the literal has no
  // annotation. The engine does not copy a declared `any` onto the
  // parameter of the literal, but the parameter still receives the list
  // whole, and the call is typed from the body as for `value` and
  // `expression`.
  test.each([['any'], ['expression'], ['value']])(
    'a host-declared `(%s) -> number` with an untyped literal: the type agrees with the value',
    (type) => {
      const ce = new ComputeEngine();
      ce.declare('h', `(${type}) -> number`);
      ce.assign('h', ce.box(['Function', ['Multiply', 2, 't'], 't'] as never));
      const call = ce.box(['h', ['List', 1, 2, 3]] as never);
      const value = call.evaluate();
      expect(value.toString()).toBe('[2,4,6]');
      expect(value.type.matches(call.type)).toBe(true);
    }
  );

  // A transparent alias of a wide type is a wide type.
  test('a parameter declared with an alias of `expression` receives the list whole', () => {
    const ce = new ComputeEngine();
    ce.declareType('A', 'expression', { alias: true });
    const f = ['Function', ['Multiply', 2, 't'], ['Typed', 't', "'A'"]];
    ce.declare('W', 'function');
    ce.assign('W', ce.box(f as never));
    for (const e of [
      [f, ['List', 1, 2]],
      ['Apply', f, ['List', 1, 2]],
      ['W', ['List', 1, 2]],
    ]) {
      const call = ce.box(e as never);
      const value = call.evaluate();
      expect(value.toString()).toBe('[2,4]');
      expect(value.type.matches(call.type)).toBe(true);
    }
    const g = ['Function', BODY, ['Typed', 't', "'A'"]];
    expect(ce.box([g, ARG] as never).evaluate().toString()).toBe('1');
  });

  // The argument `L` is declared with a wide type, and its value is a list.
  // The walk of the body cannot tell whether `2t` is a list, so the call is
  // typed with a wide type that holds the value.
  test.each([
    ['any', 'expression'],
    ['any', 'any'],
    ['any', 'value'],
    ['value', 'expression'],
    ['value', 'any'],
    ['value', 'value'],
  ])(
    'an argument declared %s at a parameter declared %s: the type holds the value',
    (argType, type) => {
      const ce = new ComputeEngine();
      ce.declare('L', argType);
      ce.assign('L', ce.box(['List', 1, 2] as never));
      const f = ['Function', ['Multiply', 2, 't'], param(type)];
      ce.declare('W', 'function');
      ce.assign('W', ce.box(f as never));
      for (const e of [
        [f, 'L'],
        ['Apply', f, 'L'],
        ['W', 'L'],
      ]) {
        const call = ce.box(e as never);
        const value = call.evaluate();
        expect(value.toString()).toBe('[2,4]');
        expect(value.type.matches(call.type)).toBe(true);
      }
    }
  );

  // A function with a parameter declared `expression`, passed as a VALUE to
  // a callback consumer. The static type of the element that reaches the
  // parameter selects the variant: over `L` declared `list<real>` the
  // function itself, and over `rows` declared `list<list<real>>` the
  // variant with the parameter typed `list<real>`, which binds each row
  // whole as the interpreter does (CE-693). Before, the named function
  // compiled to a plain reference, and `Map(h, rows)` gave `[null, null]`
  // where the interpreter gives `[[2, 4], [6, 8]]`.
  describe('a function with a parameter declared `expression` as a callback', () => {
    const LITERAL = ['Function', ['Multiply', 2, 't'], ['Typed', 't', "'expression'"]];
    const setup = (route: string) => {
      const ce = new ComputeEngine();
      if (route === 'host') {
        ce.declare('h', '(expression) -> any');
        ce.assign('h', ce.box(['Function', ['Multiply', 2, 't'], 't'] as never));
      } else {
        ce.declare('h', 'function');
        ce.assign('h', ce.box(LITERAL as never));
      }
      ce.declare('L', 'list<real>');
      ce.declare('rows', 'list<list<real>>');
      ce.assign('L', ce.box(['List', 1, 2] as never));
      ce.assign(
        'rows',
        ce.box(['List', ['List', 1, 2], ['List', 3, 4]] as never)
      );
      return ce;
    };
    const VARS = {
      L: [1, 2],
      rows: [
        [1, 2],
        [3, 4],
      ],
    };

    test.each([
      ['named', 'h'],
      ['host', 'h'],
      ['named', 'literal'],
    ])('%s %s over a list of reals compiles', (route, callee) => {
      const ce = setup(route);
      const e = ce.box(['Map', callee === 'h' ? 'h' : LITERAL, 'L'] as never);
      expect(e.evaluate().toString()).toBe('[2,4]');
      const result = compile(e, {
        to: 'javascript',
        constantFold: false,
        fallback: false,
      } as never)!;
      expect(result.success).toBe(true);
      expect(result.run!(VARS)).toEqual([2, 4]);
    });

    test.each([
      ['named', 'h'],
      ['host', 'h'],
      ['named', 'literal'],
    ])('%s %s over a list of lists is the variant typed by the row', (route, callee) => {
      const ce = setup(route);
      const e = ce.box(['Map', callee === 'h' ? 'h' : LITERAL, 'rows'] as never);
      expect(e.evaluate().toString()).toBe('[[2,4],[6,8]]');
      const result = compile(e, {
        to: 'javascript',
        constantFold: false,
        fallback: false,
      } as never)!;
      expect(result.success).toBe(true);
      expect(result.code).not.toContain('Array.isArray');
      expect(result.run!(VARS)).toEqual([
        [2, 4],
        [6, 8],
      ]);
    });

    test.each([['named'], ['host']])(
      'the %s function compiled as a value is declined',
      (route) => {
        const ce = setup(route);
        for (const to of ['javascript', 'interval-js', 'python', 'glsl'])
          expect(compile(ce.box('h'), { to } as never)!.success).toBe(false);
      }
    );

    test('a combiner with a parameter declared `expression`', () => {
      const ce = setup('named');
      const step = ['Function', ['Add', 'a', 't'], 'a', ['Typed', 't', "'expression'"]];
      const ok = compile(ce.box(['Reduce', 'L', step, 0] as never), {
        to: 'javascript',
        constantFold: false,
        fallback: false,
      } as never)!;
      expect(ok.success).toBe(true);
      expect(ok.run!(VARS)).toBe(3);
      // Over `rows`, the parameter `t` takes the variant typed `list<real>`,
      // and the accumulator, `0` then a row, is read by the operator
      // broadcast of `a + t`.
      const e = ce.box(['Reduce', 'rows', step, 0] as never);
      expect(e.evaluate().toString()).toBe('[4,6]');
      const rows = compile(e, {
        to: 'javascript',
        constantFold: false,
        fallback: false,
      } as never)!;
      expect(rows.success).toBe(true);
      expect(rows.run!(VARS)).toEqual([4, 6]);
    });

    // A function local to a block, used as the callback of a consumer. The
    // block checks the type of the element that reaches the parameter
    // (`callOnlyLocalFunctionLiterals`): over a list of reals the local
    // compiles, and over a list of lists, or when the block returns the
    // local, it is declined. `Map` of a local does not compile on
    // interval-js and Python for other reasons, so these tests are on JS.
    describe('a block-local function used as a callback', () => {
      const G = [
        'Assign',
        'g',
        ['Function', ['Multiply', 2, 't'], ['Typed', 't', "'expression'"]],
      ];
      const run = (e: unknown) => {
        const ce = setup('named');
        const expr = ce.box(e as never);
        const result = compile(expr, {
          to: 'javascript',
          constantFold: false,
        } as never)!;
        return { expr, result, value: result.run!(VARS) };
      };

      test('over a list of reals it compiles', () => {
        const { expr, result, value } = run(['Block', G, ['Map', 'g', 'L']]);
        expect(result.success).toBe(true);
        expect(value).toEqual([2, 4]);
        expect(expr.evaluate().toString()).toBe('[2,4]');
      });

      test('with a call and a callback use it compiles', () => {
        const { result, value } = run([
          'Block',
          G,
          ['Add', ['Sum', ['Map', 'g', 'L']], ['g', 3]],
        ]);
        expect(result.success).toBe(true);
        expect(value).toBe(12);
      });

      test('as the element of a Reduce combiner it compiles', () => {
        const { result, value } = run([
          'Block',
          G,
          ['Reduce', 'L', ['Function', ['Add', 'a', ['g', 'x']], 'a', 'x'], 0],
        ]);
        expect(result.success).toBe(true);
        expect(value).toBe(6);
      });

      test('over a list of lists it is declined', () => {
        const { expr, result, value } = run([
          'Block',
          G,
          ['Map', 'g', 'rows'],
        ]);
        expect(result.success).toBe(false);
        expect(value).toEqual([
          [2, 4],
          [6, 8],
        ]);
        expect(expr.evaluate().toString()).toBe('[[2,4],[6,8]]');
      });

      test('with one use over a list of lists it is declined', () => {
        const { result } = run([
          'Block',
          G,
          ['List', ['Map', 'g', 'L'], ['Map', 'g', 'rows']],
        ]);
        expect(result.success).toBe(false);
      });

      // The first block marks its local; the mark does not reach the second
      // block, which returns its own local as a value.
      test('a block that returns the local is declined', () => {
        const { result } = run([
          'List',
          ['Block', G, ['Map', 'g', 'L']],
          [
            'Block',
            [
              'Assign',
              'k',
              [
                'Function',
                ['Multiply', 2, 't'],
                ['Typed', 't', "'expression'"],
              ],
            ],
            'k',
          ],
        ]);
        expect(result.success).toBe(false);
      });
    });

    // Common subexpression elimination binds equal literals once. A
    // literal with a parameter declared `expression` is not harvested, so
    // the check made at the `Map` or the `Apply` does not reach the other
    // copy, which is a function value and declines. Before, the second
    // element of `Tuple(Map(G, L), G)` was the checked arrow, which gives
    // `NaN` for `[1, 2]`. The fallback cannot express a function value, and
    // gives `NaN` in its place.
    test.each([
      ['Tuple(Map(G, L), G)', ['Tuple', ['Map', LITERAL, 'L'], LITERAL], 0, [2, 4]],
      ['Tuple(G, Map(G, L))', ['Tuple', LITERAL, ['Map', LITERAL, 'L']], 1, [2, 4]],
      ['Tuple(Apply(G, x), G)', ['Tuple', ['Apply', LITERAL, 'x'], LITERAL], 0, 6],
    ])('%s with CSE is declined', (_, e, at, expected) => {
      const ce = setup('named');
      ce.declare('x', 'real');
      const result = compile(ce.box(e as never), {
        to: 'javascript',
        constantFold: false,
      } as never)!;
      expect(result.success).toBe(false);
      const value = result.run!({ ...VARS, x: 3 }) as unknown[];
      expect(value[at as number]).toEqual(expected);
      expect(value[1 - (at as number)]).toBeNaN();
    });

    // Only the bare literal is not a candidate of the common subexpression
    // elimination. An application that holds it is: two equal applications
    // hold the literal at the same consumer position, which checks it again
    // when the shared binding is compiled. So an invariant `Max(Map(G, L))`
    // in a `Sum` is computed once, before the loop, and two equal uses
    // share one binding.
    test('an invariant consumer of the literal is hoisted out of a loop', () => {
      // `L` has no value here, so the code reads it from the input.
      const ce = new ComputeEngine();
      ce.declare('L', 'list<real>');
      ce.declare('n', 'integer');
      const result = compile(
        ce.box([
          'Sum',
          ['Add', ['Max', ['Map', LITERAL, 'L']], 'k'],
          ['Limits', 'k', 1, 'n'],
        ] as never),
        { to: 'javascript', constantFold: false, fallback: false } as never
      )!;
      expect(result.success).toBe(true);
      const code = result.code as string;
      const loop = code.indexOf('while (');
      expect(loop).toBeGreaterThan(0);
      expect(code.indexOf('(_.L).map(')).toBeGreaterThan(0);
      expect(code.indexOf('(_.L).map(')).toBeLessThan(loop);
      expect(code.split('(_.L).map(').length).toBe(2);
      // max(2, 4) + k, for k = 1..3.
      expect(result.run!({ ...VARS, n: 3 })).toBe(18);
    });

    test('two equal consumers of the literal share one binding', () => {
      const ce = new ComputeEngine();
      ce.declare('L', 'list<real>');
      const result = compile(
        ce.box([
          'Add',
          ['Max', ['Map', LITERAL, 'L']],
          ['Max', ['Map', LITERAL, 'L']],
        ] as never),
        { to: 'javascript', constantFold: false, fallback: false } as never
      )!;
      expect(result.success).toBe(true);
      expect((result.code as string).split('(_.L).map(').length).toBe(2);
      expect(result.run!(VARS)).toBe(8);
    });

    // The test for a parameter declared `expression` reads each distinct
    // subtree of the body once. The body below is a doubling DAG of 40
    // levels (`e_k = e_(k-1) + e_(k-1)`, with the same node twice) that
    // reads `t` only after it. A walk of every path has 2^40 steps.
    test('the parameter test reads a shared body in linear time', () => {
      const ce = new ComputeEngine();
      let e: Expression = ce._fn('Add', [ce.symbol('x'), ce.One]);
      for (let k = 0; k < 40; k++) e = ce._fn('Add', [e, e]);
      const raw = { canonical: false } as never;
      const literal = ce._fn(
        'Function',
        [
          ce._fn('Add', [e, ce.symbol('t')]),
          ce._fn(
            'Typed',
            [ce.symbol('t', raw), ce.string('expression')],
            raw
          ),
        ],
        raw
      );
      expect(expressionParameterReadAt(literal)).toBe(0);
      const harvest = harvestCse(ce._fn('Tuple', [literal, literal]));
      expect(
        harvest.candidates.some((c) =>
          c.representative.operator === 'Function'
        )
      ).toBe(false);
    });

    // A block local declared with a type that admits a list of numbers and
    // a list of lists, assigned one, then the other: the element type of the
    // local is not provable, and the consumer declines.
    test.each([
      [
        'an inline literal',
        [
          'Block',
          ['Declare', 'M', "'list<integer | list<integer>>'", ['List', 1, 2]],
          ['Assign', 'M', ['List', ['List', 1, 2]]],
          ['Map', LITERAL, 'M'],
        ],
      ],
      [
        'a block-local function',
        [
          'Block',
          ['Assign', 'g', LITERAL],
          ['Declare', 'M', "'list<integer | list<integer>>'", ['List', 1, 2]],
          ['Assign', 'M', ['List', ['List', 1, 2]]],
          ['Map', 'g', 'M'],
        ],
      ],
    ])('a reassigned block local with %s is declined', (_, e) => {
      const ce = setup('named');
      const result = compile(ce.box(e as never), {
        to: 'javascript',
        constantFold: false,
      } as never)!;
      expect(result.success).toBe(false);
      expect(result.run!(VARS)).toEqual([[2, 4]]);
    });

    test.each([['interval-js'], ['python']])(
      'target %s compiles the literal over a list of reals',
      (to) => {
        const ce = setup('named');
        const options = { to, constantFold: false } as never;
        expect(
          compile(ce.box(['Map', LITERAL, 'L'] as never), options)!.success
        ).toBe(true);
      }
    );

    // Over a list of lists, interval-js compiles the variant typed by the
    // row, and gives the interpreter's values as point intervals. Python
    // declines (`assertPyCallbackWideParams` in `python-target.ts`): its
    // lambda reads a parameter declared `expression` as a scalar.
    test('the literal over a list of lists', () => {
      const ce = setup('named');
      const options = { constantFold: false } as never;
      const interval = compile(ce.box(['Map', LITERAL, 'rows'] as never), {
        ...(options as object),
        to: 'interval-js',
      } as never)!;
      expect(interval.success).toBe(true);
      const point = (v: number) => ({
        kind: 'interval',
        value: { lo: v, hi: v },
      });
      expect(interval.run!({})).toEqual([
        [point(2), point(4)],
        [point(6), point(8)],
      ]);
      expect(
        compile(ce.box(['Map', LITERAL, 'rows'] as never), {
          ...(options as object),
          to: 'python',
        } as never)!.success
      ).toBe(false);
    });
  });

  // An argument that can be a collection or a scalar (`M` declared
  // `list<integer> | integer`) at a wide parameter: the walk of the body
  // types `2t` as a number for such an argument, so the call is typed
  // `any`, on the three routes.
  test.each([['any'], ['expression'], ['value']])(
    'an argument that can be a list or an integer at a parameter declared %s',
    (type) => {
      const ce = new ComputeEngine();
      ce.declare('h', `(${type}) -> number`);
      ce.assign('h', ce.box(['Function', ['Multiply', 2, 't'], 't'] as never));
      const f = ['Function', ['Multiply', 2, 't'], param(type)];
      ce.declare('g', 'function');
      ce.assign('g', ce.box(f as never));
      ce.declare('M', 'list<integer> | integer');
      ce.assign('M', ce.box(['List', 1, 2] as never));
      for (const e of [
        ['h', 'M'],
        ['g', 'M'],
        [f, 'M'],
      ]) {
        const call = ce.box(e as never);
        const value = call.evaluate();
        expect(value.toString()).toBe('[2,4]');
        expect(value.type.matches(call.type)).toBe(true);
      }
    }
  );

  // A result of the signature that is not a scalar does not describe the
  // call either: `(t: expression) ↦ [2t]` has a list of numbers as its
  // result, and applied to `[1, 2]` its value is `[[2, 4]]`.
  test.each([['any'], ['expression'], ['value']])(
    'a list result at a parameter declared %s agrees with its value',
    (type) => {
      const ce = new ComputeEngine();
      const f = ['Function', ['List', ['Multiply', 2, 't']], param(type)];
      ce.declare('g', 'function');
      ce.assign('g', ce.box(f as never));
      ce.declare('L', 'any');
      ce.assign('L', ce.box(['List', 1, 2] as never));
      ce.declare('N', 'list<integer>');
      ce.assign('N', ce.box(['List', 1, 2] as never));
      for (const e of [
        [f, 'L'],
        ['g', 'L'],
        [f, 'N'],
        ['g', 'N'],
      ]) {
        const call = ce.box(e as never);
        const value = call.evaluate();
        expect(value.toString()).toBe('[[2,4]]');
        expect(value.type.matches(call.type)).toBe(true);
      }
    }
  );

  // An element of a `list<unknown>` can be a list: with `L` declared
  // `list<unknown>` and the value `[[1, 2]]`, `L[1]` is `[1, 2]`. At a
  // parameter declared `expression`, such an argument types the call
  // `any`, on the literal and the named routes.
  test.each([['literal'], ['named']])(
    'an unknown argument at a parameter declared `expression` (%s)',
    (route) => {
      const ce = new ComputeEngine();
      const f = ['Function', ['Multiply', 2, 't'], param('expression')];
      ce.declare('g', 'function');
      ce.assign('g', ce.box(f as never));
      ce.declare('L', 'list<unknown>');
      const call = ce.box([route === 'named' ? 'g' : f, ['At', 'L', 1]] as never);
      const type = call.type;
      ce.assign('L', ce.box(['List', ['List', 1, 2]] as never));
      const value = call.evaluate();
      expect(value.toString()).toBe('[2,4]');
      expect(value.type.matches(type)).toBe(true);
    }
  );

  // At an untyped parameter, an argument whose type says nothing about its
  // value (an index read typed `unknown`, a symbol declared `any`) can hold
  // a list, which the call maps at its leaves, or a point, which binds whole
  // and which the body maps. The call of the literal, `Apply` and `Pipe`
  // are typed as the named call is. They were typed `number`, which holds
  // none of these values.
  describe('an argument of a top type at an untyped parameter', () => {
    const U = ['Function', ['Multiply', 2, 't'], 't'];
    const OPEN = 'list<list<any> | number | tuple> | number | tuple';
    const ROUTES = (arg: unknown) => [
      ['k', arg],
      [U, arg],
      ['Apply', U, arg],
      ['Pipe', arg, U],
    ];

    test.each([
      ['list<unknown>', ['At', 'L', 1], ['List', ['List', 1, 2]], '[2,4]', OPEN],
      [
        'list<unknown>',
        ['At', 'L', 1],
        ['List', ['List', ['List', 1], ['List', 2, 3]]],
        '[[2],[4,6]]',
        OPEN,
      ],
      ['list<unknown>', ['At', 'L', 1], ['List', ['Tuple', 1, 2]], '(2, 4)', OPEN],
      ['list<any>', ['At', 'L', 1], ['List', ['List', 1, 2]], '[2,4]', 'any'],
      ['any', 'L', ['List', 1, 2], '[2,4]', 'any'],
    ])('`L: %s`, the argument %j', (decl, arg, value, expected, type) => {
      for (const e of ROUTES(arg)) {
        const ce = new ComputeEngine();
        ce.declare('k', 'function');
        ce.assign('k', ce.box(U as never));
        ce.declare('L', decl);
        const call = ce.box(e as never);
        const t = call.type;
        expect(t.toString()).toBe(type);
        ce.assign('L', ce.box(value as never));
        const result = call.evaluate();
        expect(result.toString()).toBe(expected);
        expect(result.type.matches(t)).toBe(true);
      }
    });

    // A known scalar, and a free symbol, keep the scalar result.
    test.each([
      [3, 'number'],
      [1.5, 'number'],
      ['x', 'number'],
    ])('the argument %j', (arg, type) => {
      const ce = new ComputeEngine();
      ce.declare('k', 'function');
      ce.assign('k', ce.box(U as never));
      for (const e of ROUTES(arg))
        expect(ce.box(e as never).type.toString()).toBe(type);
    });

    // A symbol of type `unknown` with no value that the body of an enclosing
    // literal reads from outside it can get a list before the call.
    test('a captured symbol of type `unknown`', () => {
      const ce = new ComputeEngine();
      ce.declare('z', 'unknown');
      const call = ce.box([['Function', [U, 'z'], 's'], 1] as never);
      const t = call.type;
      expect(t.toString()).toBe(OPEN);
      ce.assign('z', ce.box(['List', 1, 2] as never));
      const result = call.evaluate();
      expect(result.toString()).toBe('[2,4]');
      expect(result.type.matches(t)).toBe(true);
    });
  });

  // A parameter declared with a collection type (`list`) also receives a
  // list whole. When the body does not satisfy the declared scalar result
  // (`2t` is not a number for a list `t`), the engine checks each value
  // against the result, and that check admits a list whose elements conform
  // to it: the result computed once per element of the list. So the call is
  // typed from the body, on the named route, the `Apply` route, and a named
  // call inside another function body. It was typed `number` for the value
  // `[2,4,6]`.
  describe('a list at a parameter declared with a collection type, under a scalar result', () => {
    const ROUTES = (name: string, arg: unknown) => [
      [name, arg],
      ['Apply', name, arg],
      ['Apply', ['Function', ['Add', [name, 'u'], 0], 'u'], arg],
    ];

    test.each([
      ['(list) -> number', ['Multiply', 2, 't'], '[2,4,6]'],
      ['(list) -> number', 't', '[1,2,3]'],
      ['(list<number>) -> number', ['Multiply', 2, 't'], '[2,4,6]'],
    ])('%s with the body %j', (signature, body, expected) => {
      const ce = new ComputeEngine();
      ce.declare('h', signature);
      ce.assign('h', ce.box(['Function', body, 't'] as never));
      for (const e of ROUTES('h', ['List', 1, 2, 3])) {
        const call = ce.box(e as never);
        const value = call.evaluate();
        expect(value.toString()).toBe(expected);
        expect(call.type.toString()).toBe('vector<integer^3>');
        expect(value.type.matches(call.type)).toBe(true);
      }
    });

    // The declared result computed once per point of a list of points
    // (`declared-result-checked-at-application.test.ts`). The static type
    // has a range, so the test asks whether the type accepts the value
    // (`docs/TYPE-SYSTEM.md`, "Number literal types"). A single point keeps
    // the declared result, and the compiled code gives the same list.
    test('a list of points under a scalar result', () => {
      const ce = new ComputeEngine();
      ce.declare(
        'norm',
        '(list<tuple<number, number>> | tuple<number, number>) -> number'
      );
      ce.assign(
        'norm',
        ce.box(['Function', ['Abs', ['Subtract', 'P', ['Tuple', 1, 2]]], 'P'])
      );
      const points = ['List', ['Tuple', 4, 6], ['Tuple', 1, 2]];
      for (const e of ROUTES('norm', points)) {
        const call = ce.box(e as never);
        const value = call.evaluate();
        expect(value.toString()).toBe('[5,0]');
        expect(call.type.toString()).toMatch(/^list</);
        expect(typeAcceptsValue(value, call.type.type)).toBe(true);
      }
      expect(ce.box(['norm', ['Tuple', 4, 6]]).type.toString()).toBe(
        'number'
      );
      ce.declare('L', 'list<tuple<number, number>>');
      const compiled = compile(ce.box(['norm', 'L']), {
        to: 'javascript',
        fallback: false,
      } as never)!;
      expect(compiled.run!({ L: [[4, 6], [1, 2]] })).toEqual([5, 0]);
    });

    // A body whose type satisfies the declared result is not checked, and
    // it keeps the result. A body that the walk cannot type gives the
    // declared result or a list.
    test.each([
      ['(list<integer>) -> integer', ['Sum', 't'], '6', 'integer'],
      ['(list) -> number', ['Length', 't'], '3', 'number'],
      [
        '(list) -> number',
        ['If', ['Greater', ['Length', 't'], 1], ['Multiply', 2, 't'], 0],
        '[2,4,6]',
        'list<any> | number',
      ],
    ])('%s with the body %j', (signature, body, expected, type) => {
      const ce = new ComputeEngine();
      ce.declare('h', signature);
      ce.assign('h', ce.box(['Function', body, 't'] as never));
      const call = ce.box(['h', ['List', 1, 2, 3]]);
      const value = call.evaluate();
      expect(value.toString()).toBe(expected);
      expect(call.type.toString()).toBe(type);
      expect(value.type.matches(call.type)).toBe(true);
    });

    // In a `Block` body the result ascription holds only the last statement.
    // An early `Return` gives a value that this statement does not give, so
    // the walk gives no type and the call is typed `list<any> | number`.
    test('a block body with an early return', () => {
      const ce = new ComputeEngine();
      ce.declare('h', '(list) -> number');
      ce.assign(
        'h',
        ce.box([
          'Function',
          [
            'Block',
            ['If', ['Equal', ['Length', 't'], 0], ['Return', 0]],
            ['Multiply', 2, 't'],
          ],
          't',
        ] as never)
      );
      for (const [arg, expected] of [
        [['List'], '0'],
        [['List', 1, 2], '[2,4]'],
      ] as const) {
        const call = ce.box(['h', arg] as never);
        const value = call.evaluate();
        expect(value.toString()).toBe(expected);
        expect(call.type.toString()).toBe('list<any> | number');
        expect(value.type.matches(call.type)).toBe(true);
      }
    });

    // The check refuses a list whose elements do not conform to the scalar
    // result, so a list type with such leaves does not type the call.
    test.each([
      [['List', { str: 'a' }, { str: 'b' }]],
      [['List', ['List', { str: 'a' }]]],
    ])('a body of type list of strings under `number`: %j', (body) => {
      const ce = new ComputeEngine();
      ce.declare('h', '(list) -> number');
      ce.assign('h', ce.box(['Function', body, 't'] as never));
      const call = ce.box(['h', ['List', 1, 2]]);
      expect(call.type.toString()).toBe('list<any> | number');
      expect(call.evaluate().toString()).toMatch(/incompatible-type/);
    });
  });
});

describe('A TYPE ALIAS AT A CALL OF A FUNCTION LITERAL', () => {
  // A recursive alias reaches itself through its list elements. The walk
  // over the leaves of the body type stops there, and the call is typed
  // without a stack overflow.
  test('a list of a recursive alias at a parameter declared `list`', () => {
    const ce = new ComputeEngine();
    ce.declareType('nest', 'integer | list<nest>', { alias: true });
    ce.declare('L', 'list<nest>');
    ce.declare('h', '(list) -> number');
    ce.assign('h', ce.box(['Function', 't', 't'] as never));
    ce.assign('L', ce.box(['List', 1, ['List', 2]] as never));
    const call = ce.box(['h', 'L'] as never);
    const t = call.type;
    const value = call.evaluate();
    expect(value.toString()).toBe('[1,[2]]');
    expect(value.type.matches(t)).toBe(true);
  });

  // A captured symbol declared with an alias of `unknown` can get a list
  // before the call, the same as a symbol declared `unknown`.
  test('a captured symbol declared with an alias of `unknown`', () => {
    const ce = new ComputeEngine();
    ce.declareType('u', 'unknown', { alias: true });
    ce.declare('z', 'u');
    const U = ['Function', ['Multiply', 2, 't'], 't'];
    const call = ce.box([['Function', [U, 'z'], 's'], 1] as never);
    const t = call.type;
    expect(t.toString()).toBe(
      'list<list<any> | number | tuple> | number | tuple'
    );
    ce.assign('z', ce.box(['List', 1, 2] as never));
    const result = call.evaluate();
    expect(result.toString()).toBe('[2,4]');
    expect(result.type.matches(t)).toBe(true);
  });
});

// A parameter declared `unknown` is a parameter with no declaration, on every
// route (user decision 2026-10-30, recorded with GitHub issue #488). The
// canonical literal does not keep the annotation, so the body narrows the
// type of the parameter as it does for a bare one: in the `leaves` recursion,
// `t[1]` makes `t` an indexed collection, and a list argument is bound whole.
// Before, `(t: unknown) ↦ …` read the body as if `t` could only be a scalar,
// mapped the call over the leaves of the list, and `leaves([[0, 0], 0])` was
// `[[1,1],1]`, not `3`.
describe('A PARAMETER DECLARED UNKNOWN IS A PARAMETER WITH NO DECLARATION', () => {
  const LEAVES_BODY = [
    'If',
    ['Element', 't', 'Integers'],
    1,
    ['Add', ['leaves', ['At', 't', 1]], ['leaves', ['At', 't', 2]]],
  ];
  const CASES: Array<[string, unknown, unknown, string, string]> = [
    [
      'the leaves recursion',
      LEAVES_BODY,
      ['List', ['List', 0, 0], 0],
      'leaves',
      '3',
    ],
    [
      'an integer test',
      ['If', ['Element', 't', 'Integers'], 0, 1],
      ['List', ['List', 0, 0], 5],
      'f',
      '[[0,0],0]',
    ],
    ['Count', ['Count', 't'], ['List', ['List', 0, 0], 5], 'f', '2'],
    ['Length of a tuple', ['Length', 't'], ['Tuple', 3, 4], 'f', '2'],
  ];
  const BARE = 't';
  const UNKNOWN = ['Typed', 't', "'unknown'"];

  /** Each route that defines the function and calls it with `arg`, as a
   * thunk that returns the call in a new engine. A function literal cannot
   * call itself, so the recursive body is given only the named routes. */
  function routes(body: unknown, param: unknown, arg: unknown, name: string) {
    const f = ['Function', body, param];
    const named = (define: (ce: ComputeEngine) => void) => () => {
      const ce = new ComputeEngine();
      define(ce);
      return ce.box([name, arg] as never);
    };
    const all: Record<string, () => Expression> = {
      Assign: named((ce) => {
        ce.box(['Assign', name, f] as never).evaluate();
      }),
      DefineFunction: named((ce) => {
        ce.box(['DefineFunction', name, f] as never).evaluate();
      }),
      'declared function, then assigned': named((ce) => {
        ce.declare(name, 'function');
        ce.assign(name, ce.box(f as never));
      }),
      'host signature (unknown) -> unknown, then assigned': named((ce) => {
        ce.declare(name, '(unknown) -> unknown');
        ce.assign(name, ce.box(f as never));
      }),
    };
    if (name !== 'leaves') {
      all['function literal'] = () =>
        new ComputeEngine().box([f, arg] as never);
      all['Apply'] = () => new ComputeEngine().box(['Apply', f, arg] as never);
    }
    return all;
  }

  const plain = (x: Expression): unknown =>
    x.operator === 'List' || x.operator === 'Tuple'
      ? x.ops!.map(plain)
      : x.re;

  test.each(CASES)(
    '%s: the value and the type are the same as for a bare parameter',
    (_, body, arg, name, expected) => {
      const bare = routes(body, BARE, arg, name);
      const unknown = routes(body, UNKNOWN, arg, name);
      for (const route of Object.keys(bare)) {
        const results = [bare[route](), unknown[route]()].map((call) => {
          const value = call.evaluate();
          expect([route, value.type.matches(call.type)]).toEqual([route, true]);
          // The compiled code gives the value of the interpreter, or declines.
          // With `fallback: false`, a decline throws. Only the compilation is
          // in the `try`, so a wrong compiled value fails the test.
          let compiled: unknown = 'declined';
          let result: ReturnType<typeof compile> | undefined;
          try {
            result = compile(call, {
              to: 'javascript',
              constantFold: false,
              fallback: false,
            } as never);
          } catch {
            result = undefined;
          }
          if (result?.success) {
            compiled = result.run!({});
            expect([route, compiled]).toEqual([route, plain(value)]);
          }
          return [value.toString(), call.type.toString(), compiled];
        });
        expect([route, results[0][0]]).toEqual([route, expected]);
        expect([route, ...results[1]]).toEqual([route, ...results[0]]);
      }
    }
  );

  // A function local to a `Block`. The type of the block is computed before
  // the block runs, so it is not compared with the value here; it is the
  // same for the two parameters.
  test.each(CASES)(
    '%s: a block-local function',
    (_, body, arg, name, expected) => {
      const results = [BARE, UNKNOWN].map((param) => {
        const call = new ComputeEngine().box([
          'Block',
          ['Assign', name, ['Function', body, param]],
          [name, arg],
        ] as never);
        return [call.evaluate().toString(), call.type.toString()];
      });
      expect(results[0][0]).toBe(expected);
      expect(results[1]).toEqual(results[0]);
    }
  );

  test('the parse route gives a bare parameter', () => {
    const ce = new ComputeEngine();
    const bare = ce.parse('(t)\\mapsto \\operatorname{Count}(t)');
    const unknown = ce.parse(
      '(t\\colon unknown)\\mapsto \\operatorname{Count}(t)'
    );
    expect(unknown.json).toEqual(bare.json);
    expect(unknown.type.toString()).toBe(bare.type.toString());
  });

  // A callback literal at a declared callback slot takes the parameter type
  // of the slot. The written literal is read before it is canonicalized
  // (`annotateFunctionLiteralParams()`), so that step reads `x: unknown` as
  // a bare `x` too.
  test('a declared callback slot types the parameter', () => {
    const types = ['x', ['Typed', 'x', "'unknown'"]].map((param) => {
      const ce = new ComputeEngine();
      ce.declare('h', '((integer) -> integer) -> integer');
      const call = ce.box([
        'h',
        ['Function', ['Add', 'x', 1], param],
      ] as never);
      return call.ops![0].type.toString();
    });
    expect(types).toEqual(['(x: integer) -> integer', '(x: integer) -> integer']);
  });

  // A function declared with a value-kind parameter (`residue`) is
  // canonicalized again from its written form, with the parameter typed by
  // the declaration, so that the body keeps `x/x` instead of `1`
  // (`kindTypedFunctionLiteral()`). The written form is recorded only for a
  // literal with no annotation, so `x: unknown` must be recorded as `x`.
  test('a value-kind declaration reads the written form', () => {
    const values = ['x', ['Typed', 'x', "'unknown'"]].map((param) => {
      const ce = new ComputeEngine();
      ce.declare('g', '(residue) -> residue');
      ce.assign(
        'g',
        ce.box([
          'Function',
          ['Divide', 'x', 'x'],
          param,
        ] as never)
      );
      return ce
        .box(['g', ['ResidueClass', 3, 4]] as never)
        .evaluate()
        .toString();
    });
    expect(values).toEqual(['ResidueClass(1, 4)', 'ResidueClass(1, 4)']);
  });

  // A transparent alias of `unknown` is `unknown`. A nominal type is not
  // unfolded, so it stays an annotation.
  test('a transparent alias of unknown is unknown', () => {
    const results = ["'unknown'", "'U'"].map((type) => {
      const ce = new ComputeEngine();
      ce.declareType('U', 'unknown', { alias: true });
      const f = ['Function', ['Count', 't'], ['Typed', 't', type]];
      const call = ce.box([f, ['List', ['List', 0, 0], 5]] as never);
      return [
        call.evaluate().toString(),
        call.type.toString(),
        JSON.stringify(ce.box(f as never).json),
      ];
    });
    expect(results[0][0]).toBe('2');
    expect(results[1]).toEqual(results[0]);

    // A nominal type `N` defined as `unknown` keeps its annotation.
    const ce = new ComputeEngine();
    ce.declareType('N', 'unknown');
    const nominal = ce.box([
      'Function',
      ['Count', 't'],
      ['Typed', 't', "'N'"],
    ] as never).json;
    expect(JSON.stringify(nominal)).toContain('"Typed"');
    expect(JSON.stringify(nominal)).not.toBe(results[0][2]);
  });
});
