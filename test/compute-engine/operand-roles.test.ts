import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';

// The `operands` handler of an operator definition gives each operand a
// role. An `Assign` or a `Declare` is valid only at a `statement` or an
// `opaque` operand; a `statement` operand is canonicalized as a branch, and
// an operator that is not lazy evaluates only its `value` operands before
// its `evaluate` handler runs.

const ASSIGNMENT_IN_OPERAND = 'ErrorCode("assignment-in-operand"';
const FIRST_ASSIGNMENT_IN_BRANCH = 'ErrorCode("first-assignment-in-branch"';

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
      ['Assign', 's', 0],
      ['Do', ['Assign', 's', ['Add', 's', 1]], 5],
      's',
    ]);
    expect(e.isValid).toBe(true);
    expect(e.evaluate().toString()).toBe('5');
  });

  test('a first assignment in the body of `Do` is an error', () => {
    const { ce } = engine();
    expect(
      canonical(ce, ['Do', ['Assign', 's', ['Add', 's', 1]], 5])
    ).toContain(`${FIRST_ASSIGNMENT_IN_BRANCH}, "s")`);
  });

  test('a first assignment in a lazy operator without a `canonical` handler', () => {
    const { ce } = engine();
    expect(canonical(ce, ['Cell', ['Assign', 'a', 5]])).toContain(
      `${FIRST_ASSIGNMENT_IN_BRANCH}, "a")`
    );
    const e = ce.box([
      'Block',
      ['Assign', 'a', 0],
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
      ['Assign', 's', 0],
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
      ['Assign', 's', 0],
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
      ['Assign', 's', 0],
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
      ['Assign', 's', 0],
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
      ['Assign', 'b', 0],
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
        ['Assign', 'a', 0],
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
      ce.declare('HeldOp', {
        signature: '(any) -> any',
        operands: () => [{ kind: 'held' }],
      })
    ).toThrow(/"held" is not supported/);
    expect(() =>
      ce.declare('BoundOp', {
        signature: '(any) -> any',
        operands: () => [{ kind: 'bound' }],
      })
    ).toThrow(/"bound" is not supported/);
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
      ['Assign', 'a', 0],
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
