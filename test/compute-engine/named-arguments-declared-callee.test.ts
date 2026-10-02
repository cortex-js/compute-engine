import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';
import { executeEpsil } from '../../src/epsil/execute-epsil';

/**
 * Named arguments through a VARIABLE that holds a function (a value
 * definition, not an operator definition).
 *
 * Decision of 2026-10-01: the names are matched only against the variable's
 * DECLARED type, never against the value it holds when the call is made
 * canonical (`valueCalleeSignature`, `boxed-expression/named-arguments.ts`).
 * A declared type that gives no parameter names (the bare `function`
 * wildcard, a signature with no names) rejects the names with
 * `argument-names-unavailable`.
 *
 * Before, a variable declared `function` matched the names against its
 * CURRENT value and stored the call in that value's parameter order: with
 * `alias` holding `bob_S(x, factor)`, `alias(3, factor: 5)` was stored as
 * `alias(3, 5)`, and after `alias` was assigned `other(factor, x)` (which
 * computes `factor - x`) it evaluated to -2, while the names ask for 2.
 */

const N = (name: string, value: unknown): any => [
  'NamedArgument',
  { str: name },
  value,
];

/** Every error code embedded anywhere in `expr`, outermost first. */
function errorCodes(expr: Expression): string[] {
  const out: string[] = [];
  const visit = (e: Expression | undefined): void => {
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

const DETAIL = 'the declared type of this variable gives no parameter names';

describe('a variable declared `function`', () => {
  test('box route: the names are rejected', () => {
    const ce = engine();
    ce.declare('alias', 'function');
    ce.assign('alias', ce.symbol('bob_S'));
    const e = ce.box(['alias', 3, N('factor', 5)]);
    expect(errorCodes(e)).toEqual(['argument-names-unavailable']);
    expect(JSON.stringify(e.json)).toContain(DETAIL);
    // A later assignment cannot give the call a wrong meaning: it was never
    // stored in positional order.
    ce.assign('alias', ce.symbol('other'));
    expect(errorCodes(e.evaluate())).toContain('argument-names-unavailable');
  });

  test('`ce.function` route: the names are rejected', () => {
    const ce = engine();
    ce.declare('alias', 'function');
    ce.assign('alias', ce.symbol('bob_S'));
    const e = ce.function('alias', [
      ce.number(3),
      ce.box(N('factor', 5), { form: 'raw' }),
    ]);
    expect(errorCodes(e)).toEqual(['argument-names-unavailable']);
  });

  test('a positional call is unchanged', () => {
    const ce = engine();
    ce.declare('alias', 'function');
    ce.assign('alias', ce.symbol('bob_S'));
    expect(ce.box(['alias', 3, 5]).evaluate().toString()).toBe('15');
  });
});

describe('a variable declared with a signature', () => {
  test('with parameter names: the names are matched against it', () => {
    const ce = engine();
    ce.declare('alias', '(x: number, factor: number) -> number');
    ce.assign('alias', ce.symbol('bob_S'));
    const e = ce.box(['alias', N('factor', 5), N('x', 3)]);
    expect(errorCodes(e)).toEqual([]);
    expect(e.json).toEqual(['alias', 3, 5]);
    expect(e.evaluate().toString()).toBe('15');
  });

  test('through a type alias: the names are matched against its body', () => {
    const ce = engine();
    ce.declareType('Scaler', '(x: number, factor: number) -> number', {
      alias: true,
    });
    ce.declare('alias', 'Scaler');
    ce.assign('alias', ce.symbol('bob_S'));
    const e = ce.box(['alias', N('factor', 5), N('x', 3)]);
    expect(errorCodes(e)).toEqual([]);
    expect(e.evaluate().toString()).toBe('15');
  });

  test('an overload set of type aliases: the names are matched against an arm', () => {
    const ce = engine();
    ce.declare('ovl_S', {
      signature:
        '((x: number, factor: number) -> number) & ((s: string) -> string)',
      evaluate: (ops, { engine }) =>
        ops[0].string !== undefined
          ? engine.string(ops[0].string.toUpperCase())
          : engine.number(ops[0].re * ops[1].re),
    });
    ce.declareType('Sc', '(x: number, factor: number) -> number', {
      alias: true,
    });
    ce.declareType('Sd', '(s: string) -> string', { alias: true });
    ce.declare('z', 'Sc & Sd');
    ce.assign('z', ce.symbol('ovl_S'));
    const e = ce.box(['z', 3, N('factor', 5)]);
    expect(errorCodes(e)).toEqual([]);
    expect(e.json).toEqual(['z', 3, 5]);
    expect(e.evaluate().toString()).toBe('15');
  });

  test('with no parameter names: the names are rejected', () => {
    // Before: `argument-name-unknown` ("this function declares no parameter
    // names").
    const ce = engine();
    ce.declare('alias', '(number, number) -> number');
    ce.assign('alias', ce.symbol('bob_S'));
    const e = ce.box(['alias', 3, N('factor', 5)]);
    expect(errorCodes(e)).toEqual(['argument-names-unavailable']);
    expect(JSON.stringify(e.json)).toContain(DETAIL);
  });
});

describe('unchanged callees', () => {
  test('an operator definition', () => {
    const ce = engine();
    expect(
      ce
        .box(['bob_S', N('factor', 5), N('x', 3)])
        .evaluate()
        .toString()
    ).toBe('15');
  });

  test('a variable with an inferred type (no declaration)', () => {
    // The type inferred from the assignment carries the names of `bob_S`.
    const ce = engine();
    ce.assign('alias', ce.symbol('bob_S'));
    const e = ce.box(['alias', N('factor', 5), N('x', 3)]);
    expect(errorCodes(e)).toEqual([]);
    expect(e.evaluate().toString()).toBe('15');
  });
});

describe('Epsil', () => {
  const DEFS =
    'function bob_S(x: number, factor: number) -> number { x * factor }\n';

  function codes(r: ReturnType<typeof executeEpsil>): string[] {
    return r.diagnostics.map((d) => (d.message as string[])[3]);
  }

  test('`let alias: function`: the static check and the run agree', () => {
    const ce = new ComputeEngine();
    const r = executeEpsil(
      ce,
      DEFS + 'let alias: function = bob_S\nalias(3, factor: 5)'
    );
    expect(codes(r)).toEqual(['argument-names-unavailable']);
    expect(errorCodes(r.value)).toEqual(['argument-names-unavailable']);
  });

  test('`let alias: (number, number) -> number`: rejected', () => {
    const ce = new ComputeEngine();
    const r = executeEpsil(
      ce,
      DEFS +
        'let alias: (number, number) -> number = bob_S\nalias(3, factor: 5)'
    );
    expect(codes(r)).toEqual(['argument-names-unavailable']);
    expect(errorCodes(r.value)).toEqual(['argument-names-unavailable']);
  });

  test('a declared signature with names: matched', () => {
    const ce = new ComputeEngine();
    const r = executeEpsil(
      ce,
      'let alias: (x: number, factor: number) -> number = (x, factor) => x * factor\nalias(factor: 5, x: 3)'
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.value.toString()).toBe('15');
  });

  test('an untyped `let alias = bob_S`: matched against the inferred type', () => {
    const ce = new ComputeEngine();
    const r = executeEpsil(ce, DEFS + 'let alias = bob_S\nalias(3, factor: 5)');
    expect(r.diagnostics).toEqual([]);
    expect(r.value.toString()).toBe('15');
  });
});
