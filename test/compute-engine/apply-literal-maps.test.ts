/**
 * A function literal applied to a collection maps element by element, like a
 * named user function with the same body, on every route (user decision
 * 2026-09-26, Tycho item 327). It used to bind each argument whole, so
 * `Apply(i ↦ Sum(Cos(n), Limits(n, 1, i)), [1, 2, 3])` was an
 * `incompatible-type` error while the named call and the compiled code
 * mapped.
 */

import { ComputeEngine } from '../../src/compute-engine';
import type { BoxedExpression } from '../../src/compute-engine/global-types';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

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
    const outcome = (call: BoxedExpression): string => {
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
    ): BoxedExpression[] => {
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
        for (const x of [sum, nested, list])
          expect(x.type.toString()).toBe('error');
        expect(sum.evaluate().toString()).toBe(
          'Error(ErrorCode("incompatible-type", "real", "string"), "abc")'
        );
        expect(nested.evaluate().operator).toBe('Error');
        expect(list.evaluate().json).toEqual(list.json);

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

  test('an annotated `value` parameter maps, as on the named route', () => {
    const ce = new ComputeEngine();
    const f = ['Function', ['Tuple', 'x', 'x'], ['Typed', 'x', "'value'"]];
    expect(
      ce.box(['Apply', f, ['List', 1, 2]] as never).evaluate().toString()
    ).toBe('[(1, 1),(2, 2)]');
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
      expect(call.type.toString()).toMatch(/^list<tuple</);
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
