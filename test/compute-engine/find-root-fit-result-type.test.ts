import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';
import { isSubtype } from '../../src/common/type/subtype';
import { executeEpsil } from '../../src/epsil/execute-epsil';

//
// The static type of the result of `FindRoot` and `FindFit`.
//
// The signatures of the two operators declare a bare `dictionary`. Their
// `type` handlers (`fitRecordType()` in `src/compute-engine/nonlinear-fit.ts`)
// give the record that the evaluate handlers build, with one field per
// parameter named by the parameter-spec operand:
//
//   record{parameters: record{x: real}, converged: boolean,
//          residualNorm: nan | real | signed_infinity,
//          iterations: integer, stationary: boolean}
//
// `stationary` is in the `FindRoot` record only. `residualNorm` is `NaN`
// when no residual was computed (a timeout) and `+∞` when the sum of squares
// overflows; a record field that holds `+∞` is typed by its tier, the signed
// pair `signed_infinity`. The keys `timedOut` and `phase` of a
// call cut short by a deadline are not in the type (a record type has no
// optional fields); width subtyping admits the record that has them.
//
// Each test checks the static type of the call AND that the type of the
// value is a subtype of it. An error value (a malformed spec, a start that
// is not finite) is outside both the record and the declared `dictionary`:
// the result type of a signature describes the successful values
// (`docs/ERROR-MODEL.md`, "The declared result type of a signature
// constrains successful values").
//

const ce = new ComputeEngine();

const RESIDUAL_NORM = 'nan | real | signed_infinity';

const rootType = (params: string) =>
  `record{parameters: ${params}, converged: boolean, residualNorm: ${RESIDUAL_NORM}, iterations: integer, stationary: boolean}`;

const fitType = (params: string) =>
  `record{parameters: ${params}, converged: boolean, residualNorm: ${RESIDUAL_NORM}, iterations: integer}`;

/** Check the static type of `expr`, evaluate it, and check that the type of
 * the value is a subtype of the static type. Returns the value. */
function check(expr: Expression, expected: string): Expression {
  expect(expr.type.toString()).toBe(expected);
  const value = expr.evaluate();
  expect(isSubtype(value.type.type, expr.type.type)).toBe(true);
  return value;
}

async function checkAsync(
  expr: Expression,
  expected: string
): Promise<Expression> {
  expect(expr.type.toString()).toBe(expected);
  const value = await expr.evaluateAsync();
  expect(isSubtype(value.type.type, expr.type.type)).toBe(true);
  return value;
}

const flag = (rec: Expression, key: string) => rec.get(key)?.symbol;

/** An operator that waits `ms` milliseconds and answers 0. */
function declareSpender(name: string, ms: number) {
  if (ce.lookupDefinition(name) !== undefined) return;
  ce.declare(name, {
    signature: '(number?) -> number',
    evaluate: () => {
      const end = Date.now() + ms;
      while (Date.now() < end);
      return ce.Zero;
    },
  } as any);
}

describe('FindRoot result type', () => {
  test('converged, box route', () => {
    const r = check(
      ce.box([
        'FindRoot',
        ['Subtract', ['Power', 'x', 2], 2],
        ['List', ['Tuple', 'x', 1]],
      ]),
      rootType('record{x: real}')
    );
    expect(flag(r, 'converged')).toBe('True');
    expect(flag(r, 'stationary')).toBe('True');
  });

  test('not converged: a minimum that is not a root', () => {
    const r = check(
      ce.box([
        'FindRoot',
        ['Add', ['Power', 'a', 2], 1],
        ['List', ['Tuple', 'a', 1]],
      ]),
      rootType('record{a: real}')
    );
    expect(flag(r, 'converged')).toBe('False');
  });

  test('several variables, parse route (specs as delimiters)', () => {
    const r = check(
      ce.parse('\\operatorname{FindRoot}([x+y-3, x-y-1], [(x,1),(y,1,0,5)])'),
      rootType('record{x: real, y: real}')
    );
    expect(flag(r, 'converged')).toBe('True');
  });

  test('the variables as a bare symbol and as a list of symbols', () => {
    check(
      ce.parse('\\operatorname{FindRoot}(x^2-2, x)'),
      rootType('record{x: real}')
    );
    check(
      ce.parse('\\operatorname{FindRoot}([x+y-3, x-y-1], [x, y])'),
      rootType('record{x: real, y: real}')
    );
  });

  test('the function route, and specs written as Pair and List', () => {
    check(
      ce.function('FindRoot', [ce.parse('x^2-2'), ce.parse('[(x,1)]')]),
      rootType('record{x: real}')
    );
    check(
      ce.box([
        'FindRoot',
        ['Subtract', ['Power', 'x', 2], 2],
        ['List', ['Pair', 'x', 1]],
      ]),
      rootType('record{x: real}')
    );
    check(
      ce.box([
        'FindRoot',
        ['Subtract', ['Power', 'x', 2], 2],
        ['Set', ['List', 'x', 1]],
      ]),
      rootType('record{x: real}')
    );
  });

  test('the residual norm overflows to +oo', () => {
    const r = check(
      ce.box([
        'FindRoot',
        ['Add', ['Power', 'x', 2], ['Power', 10, 200]],
        ['List', ['Tuple', 'x', 1]],
      ]),
      rootType('record{x: real}')
    );
    expect(r.get('residualNorm')?.re).toBe(Infinity);
  });

  test('the `global` option', () => {
    const X = [1, 3.22, 5.27, 10.49, 7.12];
    const Y = [4.3, 1.18, 0.01, 1.48, 3.44];
    const model = (x: number): unknown => [
      'Add',
      ['Multiply', 'a', ['Cos', ['Add', ['Multiply', 'b', x], 'c']]],
      ['Multiply', 'd', x],
      'ExponentialE',
    ];
    const r = check(
      ce.box([
        'FindRoot',
        [
          'List',
          ...X.map((x, i) => ['Equal', model(x), Y[i]]),
          ['Equal', 'd', 0],
        ],
        ['List', 'a', 'b', 'c', 'd'],
        { dict: { global: { dict: { b: [0.1, 6] } } } },
      ] as any),
      rootType('record{a: real, b: real, c: real, d: real}')
    );
    expect(r.operator).toBe('Dictionary');
  });

  test('evaluateAsync', async () => {
    const r = await checkAsync(
      ce.box([
        'FindRoot',
        ['Subtract', ['Power', 'x', 2], 2],
        ['List', ['Tuple', 'x', 1]],
      ]),
      rootType('record{x: real}')
    );
    expect(flag(r, 'converged')).toBe('True');
  });

  test('a timeout: the record has timedOut and phase, and a NaN norm', () => {
    declareSpender('SpendRootBudget', 120);
    const expr = ce.box([
      'FindRoot',
      ['Subtract', ['Add', ['Power', 'x', 2], ['SpendRootBudget', 'x']], 2],
      ['List', ['Tuple', 'x', 1]],
    ]);
    expect(expr.type.toString()).toBe(rootType('record{x: real}'));
    const r = ce.withTimeLimit({ ms: 60, label: 'test:root-type' }, () =>
      expr.evaluate()
    );
    expect(flag(r, 'timedOut')).toBe('True');
    expect(isSubtype(r.type.type, expr.type.type)).toBe(true);
  });

  test('an invalid call: inert, malformed spec, non-finite start', () => {
    // A parameter operand that is not a spec list: the call stays
    // unevaluated, and no parameter name can be read.
    const inert = check(
      ce.box(['FindRoot', ['Subtract', ['Power', 'x', 2], 2], 3]),
      rootType('dictionary<real>')
    );
    expect(inert.operator).toBe('FindRoot');

    // A 3-tuple spec is an error: the handler declines.
    const malformed = ce.box([
      'FindRoot',
      ['Subtract', ['Power', 'x', 2], 2],
      ['List', ['Tuple', 'x', 1, 2]],
    ]);
    expect(malformed.type.toString()).toBe('dictionary');
    expect(malformed.evaluate().operator).toBe('Error');

    // The start is a pole: an error value, outside the record type.
    const pole = ce.box([
      'FindRoot',
      ['Divide', 1, 'x'],
      ['List', ['Tuple', 'x', 0]],
    ]);
    expect(pole.type.toString()).toBe(rootType('record{x: real}'));
    expect(pole.evaluate().operator).toBe('Error');
  });
});

describe('FindFit result type', () => {
  const DATA = [
    'List',
    ['Tuple', 1, 2.1],
    ['Tuple', 2, 3.9],
    ['Tuple', 3, 6.2],
  ];

  test('one parameter, box route', () => {
    const r = check(
      ce.box([
        'FindFit',
        DATA,
        ['Multiply', 'a', 'x'],
        ['List', ['Tuple', 'a', 1]],
        'x',
      ]),
      fitType('record{a: real}')
    );
    expect(flag(r, 'converged')).toBe('True');
    // No `stationary` key on a FindFit record.
    expect(r.get('stationary')).toBeUndefined();
  });

  test('two parameters as bare symbols', () => {
    check(
      ce.box([
        'FindFit',
        DATA,
        ['Add', ['Multiply', 'a', 'x'], 'b'],
        ['List', 'a', 'b'],
        ['List', 'x'],
      ]),
      fitType('record{a: real, b: real}')
    );
  });

  test('parse route, specs as delimiters with bounds', () => {
    check(
      ce.parse(
        '\\operatorname{FindFit}([(1,2),(2,4),(3,6.1)], a x + b, [(a, 1, 0, 5), (b, 0)], x)'
      ),
      fitType('record{a: real, b: real}')
    );
  });

  test('a plain list of y values, several variables', () => {
    check(
      ce.parse('\\operatorname{FindFit}([2, 4.1, 5.9], a x, [a], x)'),
      fitType('record{a: real}')
    );
    check(
      ce.box([
        'FindFit',
        ['List', ['Tuple', 1, 1, 3], ['Tuple', 2, 1, 5], ['Tuple', 1, 2, 4]],
        ['Add', ['Multiply', 'a', 'x'], ['Multiply', 'b', 'y']],
        ['List', 'a', 'b'],
        ['List', 'x', 'y'],
      ]),
      fitType('record{a: real, b: real}')
    );
  });

  test('the joint form: a list of models sharing a parameter', () => {
    check(
      ce.box([
        'FindFit',
        ['List', DATA, DATA],
        ['List', ['Multiply', 'a', 'x'], ['Add', ['Multiply', 'a', 'x'], 'c']],
        ['List', 'a', 'c'],
        'x',
      ]),
      fitType('record{a: real, c: real}')
    );
  });

  test('the `global` option', () => {
    const xs = Array.from({ length: 40 }, (_, i) => (10 * i) / 39);
    const ys = xs.map((x) => 2 * Math.cos(2.2 * x + 0.5) + 0.1 * x + Math.E);
    const r = check(
      ce.box([
        'FindFit',
        ['List', ...xs.map((x, i) => ['Tuple', x, ys[i]])],
        [
          'Add',
          ['Multiply', 'a', ['Cos', ['Add', ['Multiply', 'b', 'x'], 'c']]],
          ['Multiply', 'd', 'x'],
          'ExponentialE',
        ],
        ['List', 'a', 'b', 'c', 'd'],
        ['List', 'x'],
        { dict: { global: { dict: { b: [0.3, 6] } } } },
      ] as any),
      fitType('record{a: real, b: real, c: real, d: real}')
    );
    expect(r.operator).toBe('Dictionary');
  });

  test('evaluateAsync', async () => {
    const r = await checkAsync(
      ce.box([
        'FindFit',
        DATA,
        ['Multiply', 'a', 'x'],
        ['List', ['Tuple', 'a', 1]],
        'x',
      ]),
      fitType('record{a: real}')
    );
    expect(flag(r, 'converged')).toBe('True');
  });

  test('the asynchronous route evaluates a start once, as the synchronous route does', async () => {
    // The asynchronous route parses the specs before it evaluates the data,
    // and the setup reuses them: a start with a side effect is evaluated
    // as many times as on the synchronous route.
    let calls = 0;
    ce.declare('CountedStart', {
      signature: '() -> integer',
      evaluate: () => {
        calls += 1;
        return ce.number(1);
      },
    });
    const call = () =>
      ce.box([
        'FindFit',
        DATA,
        ['Multiply', 'a', 'x'],
        ['List', ['Tuple', 'a', ['CountedStart']]],
        'x',
      ]);
    call().evaluate();
    const sync = calls;
    calls = 0;
    await call().evaluateAsync();
    expect(calls).toBe(sync);
  });

  test('a malformed spec is an error on the asynchronous route too', async () => {
    const spec = ['List', ['Tuple', 'a', 1, 2]];
    const sync = ce
      .box(['FindFit', DATA, ['Multiply', 'a', 'x'], spec, 'x'])
      .evaluate();
    const async = await ce
      .box(['FindFit', DATA, ['Multiply', 'a', 'x'], spec, 'x'])
      .evaluateAsync();
    expect(sync.operator).toBe('Error');
    expect(async.toString()).toBe(sync.toString());
  });

  test('a setup timeout: not converged, NaN norm, timedOut and phase', () => {
    declareSpender('SpendFitBudget', 120);
    const expr = ce.box([
      'FindFit',
      [
        'List',
        ['Tuple', 1, 2],
        ['Tuple', 2, ['SpendFitBudget']],
        ['Tuple', 3, 6],
      ],
      ['Multiply', 'a', 'x'],
      ['List', ['Tuple', 'a', 1]],
      'x',
    ]);
    expect(expr.type.toString()).toBe(fitType('record{a: real}'));
    const r = ce.withTimeLimit({ ms: 60, label: 'test:fit-type' }, () =>
      expr.evaluate()
    );
    expect(flag(r, 'timedOut')).toBe('True');
    expect(flag(r, 'converged')).toBe('False');
    expect(r.get('residualNorm')?.isNaN).toBe(true);
    expect(isSubtype(r.type.type, expr.type.type)).toBe(true);
  });

  test('an invalid call: inert, malformed spec, empty model list', () => {
    // The variables are not symbols: the call stays unevaluated.
    const inert = check(
      ce.box(['FindFit', DATA, ['Multiply', 'a', 'x'], ['List', 'a'], 3]),
      fitType('record{a: real}')
    );
    expect(inert.operator).toBe('FindFit');

    const malformed = ce.box([
      'FindFit',
      DATA,
      ['Multiply', 'a', 'x'],
      ['List', ['Tuple', 'a', 1, 2]],
      'x',
    ]);
    expect(malformed.type.toString()).toBe('dictionary');
    expect(malformed.evaluate().operator).toBe('Error');

    const empty = ce.box(['FindFit', DATA, ['List'], ['List', 'a'], 'x']);
    expect(empty.type.toString()).toBe(fitType('record{a: real}'));
    expect(empty.evaluate().operator).toBe('Error');
  });
});

describe('the Epsil route reads the record fields statically', () => {
  const diagnostics = (source: string) =>
    executeEpsil(new ComputeEngine(), source).diagnostics.map((d) =>
      Array.isArray(d.message) ? d.message.join(' ') : String(d.message)
    );

  test('a boolean field into a boolean declaration', () => {
    expect(
      diagnostics(
        'let r = findRoot(x^2 - 2, [(x, 1)])\nlet c: boolean = r.converged\nc'
      )
    ).toEqual([]);
    expect(
      diagnostics(
        'let r = findRoot(x^2 - 2, [(x, 1)])\nlet p: real = r.parameters.x\np'
      )
    ).toEqual([]);
  });

  test('a boolean field into a string declaration is a static type error', () => {
    for (const call of [
      'findRoot(x^2 - 2, [(x, 1)])',
      'findFit([(1, 2), (2, 4)], a*x, [(a, 1)], x)',
    ])
      expect(
        diagnostics(`let r = ${call}\nlet c: string = r.converged\nc`).some(
          (d) => d.startsWith('static-type-error')
        )
      ).toBe(true);
  });
});
