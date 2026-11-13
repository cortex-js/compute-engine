import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';

// The `operands` handler of an operator definition gives each operand a
// role. An `Assign` or a `Declare` is valid only at a `statement` or an
// `opaque` operand; a `statement` operand is canonicalized as a branch, and
// an operator that is not lazy evaluates only its `value` operands before
// its `evaluate` handler runs.

const ASSIGNMENT_IN_OPERAND = 'ErrorCode("assignment-in-operand"';
const UNDECLARED = 'ErrorCode("assignment-to-undeclared-variable"';

/** An engine with the host operators of these tests:
 * - `Do(body, n)` runs `body` `n` times. It is not lazy: `n` is a value,
 *   `body` a statement.
 * - `Cell(body)` is lazy, without a `canonical` handler, and its operand is
 *   a statement.
 * - `Do2(body, n)` is lazy, without an `operands` handler: its operands are
 *   raw, so an assignment there is an error.
 * The `evaluate` handler of `Do` records the operands that it receives in
 * `received`. */
function engine(): {
  ce: ComputeEngine;
  received: Array<{ body: string; n: string }>;
} {
  const ce = new ComputeEngine();
  const received: Array<{ body: string; n: string }> = [];
  ce.declare('Do', {
    signature: '(expression, integer) -> nothing',
    operands: () => [{ kind: 'statement' }, { kind: 'value' }],
    evaluate: ([body, n], { engine }) => {
      received.push({ body: body.toString(), n: n.toString() });
      for (let i = 0; i < n.re; i++) body.evaluate();
      return engine.Nothing;
    },
  });
  ce.declare('Cell', {
    lazy: true,
    signature: '(expression) -> unknown',
    operands: () => [{ kind: 'statement' }],
    evaluate: ([body]) => body.evaluate(),
  });
  ce.declare('Do2', {
    lazy: true,
    signature: '(expression, integer) -> nothing',
    evaluate: ([body, n], { engine }) => {
      for (let i = 0; i < n.re; i++) body.evaluate();
      return engine.Nothing;
    },
  });
  return { ce, received };
}

function canonical(ce: ComputeEngine, expr: MathJsonExpression): string {
  return ce.box(expr).toString();
}

describe('A STATEMENT OPERAND OF A HOST OPERATOR', () => {
  test('an assignment in the body of `Do` writes a local of the block', () => {
    const { ce } = engine();
    const e = ce.box([
      'Block',
      ['Declare', 's', "'unknown'", 0],
      ['Do', ['Assign', 's', ['Add', 's', 1]], 5],
      's',
    ]);
    expect(e.isValid).toBe(true);
    expect(e.evaluate().toString()).toBe('5');
  });

  test('an assignment of an undeclared name in the body of `Do` is an error', () => {
    const { ce } = engine();
    expect(
      canonical(ce, ['Do', ['Assign', 's', ['Add', 's', 1]], 5])
    ).toContain(`${UNDECLARED}, "s")`);
  });

  test('an assignment in a lazy operator without a `canonical` handler', () => {
    const { ce } = engine();
    expect(canonical(ce, ['Cell', ['Assign', 'a', 5]])).toContain(
      `${UNDECLARED}, "a")`
    );
    const e = ce.box([
      'Block',
      ['Declare', 'a', "'unknown'", 0],
      ['Cell', ['Assign', 'a', 5]],
      'a',
    ]);
    expect(e.isValid).toBe(true);
    expect(e.evaluate().toString()).toBe('5');
  });

  test('a lazy operator without roles keeps the error', () => {
    const { ce } = engine();
    const e = ce.box([
      'Block',
      ['Declare', 's', "'unknown'", 0],
      ['Do2', ['Assign', 's', ['Add', 's', 1]], 5],
      's',
    ]);
    expect(e.toString()).toContain(`${ASSIGNMENT_IN_OPERAND}, "s")`);
  });

  test('a bare `Break` symbol in the body of `Do` is refused', () => {
    const { ce } = engine();
    const e = ce.box(['Do', 'Break', 3]);
    expect(e.isValid).toBe(false);
    expect(e.toString()).toContain('must be written as a function');
  });

  test('the handler receives the count evaluated and the body as written', () => {
    const { ce, received } = engine();
    const e = ce.box([
      'Block',
      ['Declare', 's', "'unknown'", 0],
      ['Do', ['Assign', 's', ['Add', 's', 2]], ['Add', 1, 2]],
      's',
    ]);
    expect(e.evaluate().toString()).toBe('6');
    expect(received).toEqual([{ body: 'Assign(s, s + 2)', n: '3' }]);
  });

  test('the body is not evaluated before the handler under `N()`', () => {
    const { ce, received } = engine();
    const e = ce.box([
      'Block',
      ['Declare', 's', "'unknown'", 0],
      ['Do', ['Assign', 's', ['Add', 's', 1]], 2],
      's',
    ]);
    expect(e.N().toString()).toBe('2');
    expect(received.map((r) => r.body)).toEqual(['Assign(s, s + 1)']);
  });

  test('the body is not evaluated before the handler under `evaluateAsync()`', async () => {
    const { ce, received } = engine();
    const e = ce.box([
      'Block',
      ['Declare', 's', "'unknown'", 0],
      ['Do', ['Assign', 's', ['Add', 's', 1]], 4],
      's',
    ]);
    expect((await e.evaluateAsync()).toString()).toBe('4');
    expect(received.map((r) => r.body)).toEqual(['Assign(s, s + 1)']);
  });

  test('a `canonical` handler that passes its statement through', () => {
    const ce = new ComputeEngine();
    // Lazy: the handler receives the statement as written.
    ce.declare('Keep', {
      lazy: true,
      signature: '(expression) -> unknown',
      operands: () => [{ kind: 'statement' }],
      canonical: (ops, { engine }) => engine._fn('Keep', ops),
    });
    // Not lazy: the handler receives the statement canonicalized as a
    // branch.
    let seen: Expression | undefined;
    ce.declare('KeepStrict', {
      signature: '(expression) -> unknown',
      operands: () => [{ kind: 'statement' }],
      canonical: (ops, { engine }) => {
        seen = ops[0];
        return engine._fn('KeepStrict', ops);
      },
    });
    const keep = ce.box(['Keep', ['Assign', 'a', 2]]);
    expect(keep.toString()).not.toContain('assignment-in-operand');
    expect(keep.toString()).toBe('Keep(Assign(a, 2))');

    const strict = ce.box([
      'Block',
      ['Declare', 'b', "'unknown'", 0],
      ['KeepStrict', ['Assign', 'b', 2]],
      'b',
    ]);
    expect(strict.isValid).toBe(true);
    expect(seen?.isCanonical).toBe(true);
    expect(seen?.toString()).toBe('Assign(b, 2)');
  });
});

describe('AN ASSIGNMENT AT A VALUE OPERAND', () => {
  test.each<[string, MathJsonExpression, string]>([
    ['a list element', ['List', ['Assign', 'a', 2], 3], 'a'],
    ['an argument of an undeclared function', ['f', ['Assign', 'a', 2]], 'a'],
    [
      'the body of a sum',
      ['Sum', ['Assign', 's', ['Add', 's', 'i']], ['Tuple', 'i', 1, 5]],
      's',
    ],
    ['the condition of an `If`', ['If', ['Assign', 'c', 'True'], 1, 2], 'c'],
  ])('%s is an error', (_, expr, name) => {
    const ce = new ComputeEngine();
    expect(canonical(ce, expr)).toContain(
      `${ASSIGNMENT_IN_OPERAND}, "${name}")`
    );
  });

  test('`Hold` keeps an assignment as written', () => {
    const ce = new ComputeEngine();
    const e = ce.box(['Hold', ['Assign', 'a', 2]]);
    expect(e.isValid).toBe(true);
    expect(e.toString()).not.toContain('assignment-in-operand');
  });

  test('the body of a `MatchCase` is a statement', () => {
    for (const [x, value] of [
      [1, '2'],
      [3, '0'],
    ] as const) {
      const ce = new ComputeEngine();
      const e = ce.box([
        'Block',
        ['Declare', 'a', "'unknown'", 0],
        [
          'Match',
          x,
          ['MatchCase', 1, ['Assign', 'a', 2]],
          ['MatchCase', '_', 'Nothing'],
        ],
        'a',
      ]);
      expect(e.isValid).toBe(true);
      expect(e.evaluate().toString()).toBe(value);
    }
  });
});

describe('THE ROLES OF A DEFINITION', () => {
  test('a role that is not implemented is refused at declaration', () => {
    const ce = new ComputeEngine();
    expect(() =>
      ce.declare('UnknownRoleOp', {
        signature: '(any) -> any',
        operands: () => [{ kind: 'nonsense' } as never],
      })
    ).toThrow(/unknown operand role "nonsense"/);
  });

  test('a `raw` role requires `lazy`', () => {
    const ce = new ComputeEngine();
    expect(() =>
      ce.declare('RawOp', {
        signature: '(any) -> any',
        operands: () => [{ kind: 'raw' }],
      })
    ).toThrow(/requires 'lazy'/);
    // A handler that gives one role per operand is checked at declaration
    // too.
    expect(() =>
      ce.declare('RawEach', {
        signature: '(any*) -> any',
        operands: (ops) => ops.map(() => ({ kind: 'raw' })),
      })
    ).toThrow(/requires 'lazy'/);
  });

  test('a `held` role on a lazy operator is refused', () => {
    const ce = new ComputeEngine();
    expect(() =>
      ce.declare('HeldLazy', {
        lazy: true,
        signature: '(any) -> any',
        operands: () => [{ kind: 'held' }],
      })
    ).toThrow(/"held" is not valid on a 'lazy' operator.*"raw"/);
  });

  test('a handler that does not return an array is refused', () => {
    const ce = new ComputeEngine();
    expect(() =>
      ce.declare('NotArray', {
        signature: '(any) -> any',
        operands: () => 'statement' as never,
      })
    ).toThrow(/must return an array of operand roles/);
  });

  test('a handler that throws on the placeholder operands is accepted', () => {
    const ce = new ComputeEngine();
    ce.declare('ReadsSymbol', {
      lazy: true,
      signature: '(expression) -> unknown',
      operands: (ops) =>
        ops.map((op) => {
          if (op.symbol === 'Nothing') throw new Error('placeholder');
          return { kind: 'statement' };
        }),
    });
    const e = ce.box([
      'Block',
      ['Declare', 'a', "'unknown'", 0],
      ['ReadsSymbol', ['Assign', 'a', 5]],
      'a',
    ]);
    expect(e.isValid).toBe(true);
  });

  test('the default role fills a position that the handler leaves out', () => {
    const { ce } = engine();
    const def = ce.lookupDefinition('Do2');
    expect(
      def && 'operator' in def ? def.operator.operandRoles([]) : null
    ).toBe(undefined);
    const doDef = ce.lookupDefinition('Do');
    const ops = [ce.box('x'), ce.box(1), ce.box(2)];
    expect(
      doDef && 'operator' in doDef ? doDef.operator.operandRoles(ops) : null
    ).toEqual(['statement', 'value', 'value']);
  });
});

/** An engine with `ModH`, a host copy of `Mod` that is not lazy and whose
 * first operand is `held`: the signature, the `broadcastable` flag and the
 * `type` handler are those of the library `Mod`. Its `evaluate` handler
 * records the operands that it receives in `received`, then evaluates the
 * held operand and gives the value of `Mod`. */
function modEngine(): {
  ce: ComputeEngine;
  received: Array<{ x: string; head: string; p: string }>;
} {
  const ce = new ComputeEngine();
  const received: Array<{ x: string; head: string; p: string }> = [];
  const def = ce.lookupDefinition('Mod');
  if (!def || !('operator' in def)) throw new Error('no definition of Mod');
  const mod = def.operator;
  ce.declare('ModH', {
    signature: mod.signature.toString(),
    broadcastable: mod.broadcastable,
    type: mod.type,
    operands: () => [{ kind: 'held' }, { kind: 'value' }],
    evaluate: ([x, p], { engine, numericApproximation }) => {
      received.push({ x: x.toString(), head: x.operator, p: p.toString() });
      const value = engine.function('Mod', [x.evaluate(), p]);
      return numericApproximation ? value.N() : value.evaluate();
    },
  });
  return { ce, received };
}

describe('A HELD OPERAND OF A HOST OPERATOR', () => {
  test('the handler receives the held operand unevaluated', () => {
    const { ce, received } = modEngine();
    const e = ce.box(['ModH', ['Factorial', 10], ['Fibonacci', 5]]);
    expect(e.evaluate().toString()).toBe(
      ce
        .box(['Mod', ['Factorial', 10], 5])
        .evaluate()
        .toString()
    );
    // The held operand is an application; the value operand is evaluated.
    expect(received).toEqual([{ x: '10!', head: 'Factorial', p: '5' }]);
  });

  test('the value and the type are those of `Mod`', () => {
    const { ce } = modEngine();
    const e = ce.box(['ModH', ['Multiply', 3, 4], 5]);
    expect(e.type.toString()).toBe('integer');
    const value = e.evaluate();
    expect(value.toString()).toBe('2');
    expect(value.type.matches('integer')).toBe(true);
  });

  test.each<[string, MathJsonExpression[]]>([
    ['an operand of the wrong type', ["'a'", 3]],
    ['a missing operand', [1]],
    ['a modulus of 0', [5, 0]],
  ])('%s gives what `Mod` gives', (_, ops) => {
    const { ce } = modEngine();
    expect(
      ce
        .box(['ModH', ...ops])
        .evaluate()
        .toString()
    ).toBe(
      ce
        .box(['Mod', ...ops])
        .evaluate()
        .toString()
    );
  });

  test('the errors of the wrong type and of a missing operand', () => {
    const { ce } = modEngine();
    expect(ce.box(['ModH', "'a'", 3]).evaluate().toString()).toContain(
      'ErrorCode("incompatible-type"'
    );
    expect(ce.box(['ModH', 1]).evaluate().toString()).toContain('"missing"');
  });

  test('a literal list at the held position is broadcast, each element held', () => {
    const { ce, received } = modEngine();
    const value = ce.box(['ModH', ['List', 1, 2, 3], 2]).evaluate();
    expect(value.toString()).toBe('[1,0,1]');
    expect(value.type.toString()).toBe('vector<integer^3>');

    received.length = 0;
    expect(
      ce
        .box(['ModH', ['List', ['Fibonacci', 10], 2], 7])
        .evaluate()
        .toString()
    ).toBe('[6,2]');
    expect(received.map((r) => r.x)).toEqual(['Fibonacci(10)', '2']);
  });

  test('a long literal list at the held position keeps its elements held', () => {
    // Past 100 elements, a broadcast takes the lazy `Map` form, which
    // evaluates each element before it applies the operator.
    const { ce, received } = modEngine();
    const list: MathJsonExpression = [
      'List',
      ...Array<MathJsonExpression>(101).fill(['Fibonacci', 10]),
    ];
    const value = ce.box(['ModH', list, 7]).evaluate();
    expect(value.at(1)?.toString()).toBe('6');
    expect(value.count).toBe(101);
    expect(received.length).toBe(101);
    expect(received.every((r) => r.x === 'Fibonacci(10)')).toBe(true);
  });

  test('a held literal list beside a collection that cannot be walked stays lazy', () => {
    // `Linspace(a, 1, 2)` with `a` undeclared has a count, but its elements
    // cannot be walked: the eager zip would read it as a scalar, so the
    // broadcast keeps the lazy `Map` form, as for `Mod`.
    const { ce, received } = modEngine();
    const ops: MathJsonExpression[] = [
      ['List', ['Fibonacci', 10], ['Fibonacci', 10]],
      ['Linspace', 'a', 1, 2],
    ];
    const value = ce.box(['ModH', ...ops]).evaluate();
    expect(value.operator).toBe('Map');
    expect(value.isLazyCollection).toBe(true);
    expect(value.toString()).toBe(
      'Map((_1, _2) => ModH(_1, _2), [Fibonacci(10),Fibonacci(10)], Linspace(a, 1, 2))'
    );
    expect(ce.box(['Mod', ...ops]).evaluate().operator).toBe('Map');
    expect(received).toEqual([]);
  });

  test('a held operand lifted into the cells of a broadcast is not evaluated', () => {
    const { ce, received } = modEngine();
    expect(
      ce
        .box(['ModH', ['Fibonacci', 10], ['List', 2, 3]])
        .evaluate()
        .toString()
    ).toBe('[1,1]');
    expect(received.map((r) => r.x)).toEqual([
      'Fibonacci(10)',
      'Fibonacci(10)',
    ]);
  });

  test('an operand that only its evaluation makes a list stays held', () => {
    const { ce, received } = modEngine();
    ce.declare('Neighbors', {
      signature: '(integer) -> list<integer>',
      evaluate: ([x], { engine }) => engine.box(['List', x, ['Add', x, 1]]),
    });
    expect(
      ce
        .box(['ModH', ['Neighbors', 4], 3])
        .evaluate()
        .toString()
    ).toBe('[1,2]');
    expect(received.map((r) => r.x)).toEqual(['Neighbors(4)']);
  });

  test('a range of unknown length is a lazy `Map`, as for `Mod`', () => {
    const { ce } = modEngine();
    const held = ce.box(['ModH', ['Range', 1, 'n'], 3]).evaluate();
    const library = ce.box(['Mod', ['Range', 1, 'n'], 3]).evaluate();
    expect(library.operator).toBe('Map');
    expect(held.operator).toBe('Map');
    expect(held.isLazyCollection).toBe(true);
    expect(held.op2.toString()).toBe(library.op2.toString());
  });

  test('`simplify()` recurses into the held operand', () => {
    const { ce } = modEngine();
    const e = ce.box([
      'ModH',
      ['Add', ['Multiply', 'x', 'x'], ['Negate', ['Power', 'x', 2]], 5],
      3,
    ]);
    expect(e.simplify().toString()).toBe('2');
  });

  test('the held operand is not evaluated before the handler under `N()`', () => {
    const { ce, received } = modEngine();
    expect(
      ce
        .box(['ModH', ['Fibonacci', 30], 7])
        .N()
        .toString()
    ).toBe(
      ce
        .box(['Mod', ['Fibonacci', 30], 7])
        .N()
        .toString()
    );
    expect(received.map((r) => r.x)).toEqual(['Fibonacci(30)']);
  });

  test('the held operand is not evaluated before the handler under `evaluateAsync()`', async () => {
    const { ce, received } = modEngine();
    expect(
      (await ce.box(['ModH', ['Fibonacci', 30], 7]).evaluateAsync()).toString()
    ).toBe(
      ce
        .box(['Mod', ['Fibonacci', 30], 7])
        .evaluate()
        .toString()
    );
    expect(received.map((r) => r.x)).toEqual(['Fibonacci(30)']);

    received.length = 0;
    expect(
      (
        await ce
          .box(['ModH', ['Fibonacci', 10], ['List', 2, 3]])
          .evaluateAsync()
      ).toString()
    ).toBe('[1,1]');
    expect(received.map((r) => r.x)).toEqual([
      'Fibonacci(10)',
      'Fibonacci(10)',
    ]);
  });

  test('an assignment at a held operand is an error', () => {
    const { ce } = modEngine();
    expect(canonical(ce, ['ModH', ['Assign', 'a', 2], 3])).toContain(
      `${ASSIGNMENT_IN_OPERAND}, "a")`
    );
  });
});

/** An engine with host binders, whose bound variables are declared with the
 * roles `bound` and `clause`. None of them has a `canonical` handler.
 * - `MySum(body, ...clauses)` is lazy: the body is `raw`, and each later
 *   operand is a `clause` whose index is an integer. Its `evaluate` handler
 *   gives the value of `Sum` with the same operands.
 * - `MyD(f, x)` is lazy: `f` is `raw` and `x` is `bound`. Its `evaluate`
 *   handler gives the value of `D` with the same operands.
 * - `Let(x, body)` is lazy: `x` is `bound` and `body` is a `statement`.
 *   Its `evaluate` handler gives the value of the body. */
function binderEngine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('MySum', {
    lazy: true,
    signature: '(any, any+) -> number',
    operands: (ops) =>
      ops.map((_, i) =>
        i === 0 ? { kind: 'raw' } : { kind: 'clause', type: 'integer' }
      ),
    evaluate: ([body, ...clauses], { engine }) =>
      engine.function('Sum', [body, ...clauses]).evaluate(),
  });
  ce.declare('MyD', {
    lazy: true,
    signature: '(expression, expression) -> expression',
    operands: () => [{ kind: 'raw' }, { kind: 'bound' }],
    evaluate: ([f, x], { engine }) =>
      engine.function('D', [f, x]).evaluate(),
  });
  ce.declare('Let', {
    lazy: true,
    signature: '(expression, expression) -> any',
    operands: () => [{ kind: 'bound' }, { kind: 'statement' }],
    evaluate: ([, body]) => body.evaluate(),
  });
  return ce;
}

/** The names that the scope of `expr` binds. */
function scopeNames(expr: Expression): string[] {
  return [...(expr.localScope?.bindings.keys() ?? [])];
}

describe('A HOST BINDER DECLARED WITH OPERAND ROLES', () => {
  // The three routes give the same operator. An assigned `k` does not
  // reach the index, which the operator binds in its own scope.
  const mySumRoutes: Array<[string, (ce: ComputeEngine) => Expression]> = [
    ['ce.parse()', (ce) => ce.parse('\\mathrm{MySum}(k^2, (k, 1, 3))')],
    [
      'ce.box()',
      (ce) => ce.box(['MySum', ['Square', 'k'], ['Limits', 'k', 1, 3]]),
    ],
    [
      'ce.function()',
      (ce) =>
        ce.function('MySum', [
          ce.box(['Square', 'k']),
          ce.function('Limits', [ce.symbol('k'), ce.number(1), ce.number(3)]),
        ]),
    ],
  ];

  test.each(mySumRoutes)(
    'the index of a `clause` operand is bound by the operator (%s)',
    (_, make) => {
      const ce = binderEngine();
      ce.assign('k', 100);
      const e = make(ce);
      expect(e.isValid).toBe(true);
      expect(scopeNames(e)).toEqual(['k']);
      // The index is not a free variable of the expression.
      expect([...e.freeVariables]).toEqual([]);
      expect(e.evaluate().toString()).toBe('14');
    }
  );

  test('the index of a range clause with integer bounds has a ranged type', () => {
    const ce = binderEngine();
    const e = ce.box(['MySum', ['Square', 'k'], ['Limits', 'k', 1, 3]]);
    const k = e.localScope?.bindings.get('k');
    expect(
      k !== undefined && 'value' in k ? k.value.type.toString() : undefined
    ).toBe('integer<1..3>');
  });

  test('the index of the LaTeX `i` is not the imaginary unit', () => {
    const ce = binderEngine();
    const e = ce.parse('\\mathrm{MySum}(i^2, (i, 1, 3))');
    expect(scopeNames(e)).toEqual(['i']);
    expect(e.evaluate().toString()).toBe('14');
  });

  test('the operands after a flat index are its bounds, not indexes', () => {
    const ce = binderEngine();
    const e = ce.box(['MySum', ['Square', 'k'], 'k', 1, 'n']);
    expect(scopeNames(e)).toEqual(['k']);
    expect([...e.freeVariables]).toEqual(['n']);
  });

  test('an operand after the clauses does not change the flat clause', () => {
    // `x` from 0 to `b`, then a tolerance that is not a clause: `b` is the
    // upper bound of `x`, not a second index.
    const ce = new ComputeEngine();
    ce.declare('MyIntegrate', {
      lazy: true,
      signature: '(any, any, any, any, any) -> number',
      operands: () => [
        { kind: 'raw' },
        { kind: 'clause' },
        { kind: 'clause' },
        { kind: 'clause' },
        { kind: 'raw' },
      ],
    });
    const e = ce.box(['MyIntegrate', 'x', 'x', 0, 'b', 0.001]);
    expect(scopeNames(e)).toEqual(['x']);
    expect([...e.freeVariables]).toEqual(['b']);
  });

  test('a symbol outside the operator is not bound by it', () => {
    const ce = binderEngine();
    const e = ce.box([
      'Add',
      'k',
      ['MySum', ['Square', 'k'], ['Limits', 'k', 1, 3]],
    ]);
    expect([...e.freeVariables]).toEqual(['k']);
    expect(e.evaluate().toString()).toBe('k + 14');
  });

  const myDRoutes: Array<[string, (ce: ComputeEngine) => Expression]> = [
    ['ce.parse()', (ce) => ce.parse('\\mathrm{MyD}(x^2, x)')],
    ['ce.box()', (ce) => ce.box(['MyD', ['Square', 'x'], 'x'])],
    [
      'ce.function()',
      (ce) => ce.function('MyD', [ce.box(['Square', 'x']), ce.symbol('x')]),
    ],
  ];

  test.each(myDRoutes)(
    'a `bound` operand is bound by the operator (%s)',
    (_, make) => {
      const ce = binderEngine();
      ce.assign('x', 3);
      const e = make(ce);
      expect(e.isValid).toBe(true);
      expect(scopeNames(e)).toEqual(['x']);
      // As for `D`, the value is a function of the variable: a `bound` site
      // is not a clause, and its variable stays a free variable of the
      // expression.
      expect([...e.freeVariables]).toEqual(['x']);
      expect(e.evaluate().toString()).toBe('2x');
    }
  );

  test('a `bound` role on an operand that is not a symbol gives no site', () => {
    const ce = binderEngine();
    const e = ce.box(['MyD', ['Square', 'x'], ['Add', 'x', 1]]);
    expect(e.isValid).toBe(true);
    expect(scopeNames(e)).toEqual([]);
  });

  test('an assignment of the bound variable in a statement writes it', () => {
    const ce = binderEngine();
    ce.assign('x', 10);
    const e = ce.box(['Let', 'x', ['Assign', 'x', 5]]);
    expect(e.isValid).toBe(true);
    expect(e.evaluate().toString()).toBe('5');
    // The variable of the operator is not the global `x`.
    expect(ce.box('x').evaluate().toString()).toBe('10');
    // An assignment of a name that is not in scope is an error.
    expect(canonical(ce, ['Let', 'x', ['Assign', 'y', 5]])).toContain(
      `${UNDECLARED}, "y")`
    );
  });

  test('a statement body sees the index of every clause', () => {
    // A lazy operator without a `canonical` handler: its body is a
    // statement, and an assignment of the index of the second clause
    // writes that index.
    const ce = new ComputeEngine();
    ce.declare('MyLoop', {
      lazy: true,
      signature: '(expression, any+) -> any',
      operands: (ops) =>
        ops.map((_, i) =>
          i === 0 ? { kind: 'statement' } : { kind: 'clause' }
        ),
    });
    const e = ce.box([
      'MyLoop',
      ['Assign', 'y', 5],
      ['Limits', 'k', 1, 3],
      ['Limits', 'y', 1, 3],
    ]);
    expect(e.isValid).toBe(true);
    expect(scopeNames(e).sort()).toEqual(['k', 'y']);
  });

  test('a binding-site selector as `scoped` is refused at declaration', () => {
    const ce = new ComputeEngine();
    expect(() =>
      ce.declare('Selector', {
        signature: '(any, any) -> any',
        scoped: (() => []) as never,
      })
    ).toThrow(/'scoped' flag is a boolean.*'operands'/);
  });

  test('a `bound` role given only for an application is refused', () => {
    const ce = new ComputeEngine();
    // The roles depend on the number of operands, and the declaration calls
    // the handler with three operands at most: the operator is not declared
    // as a binder.
    ce.declare('Late', {
      lazy: true,
      signature: '(any*) -> any',
      operands: (ops) =>
        ops.map(() => (ops.length > 3 ? { kind: 'bound' } : { kind: 'raw' })),
    });
    expect(() => ce.box(['Late', 'a', 'b', 'c', 'd'])).toThrow(
      /"bound" is given for an application.*declared as a binder/
    );
  });
});
