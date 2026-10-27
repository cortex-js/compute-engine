// Value kinds, step 3: ADMISSION — where the values of a kind are accepted
// as operands (`docs/plans/2026-10-26-value-kinds.md`, section 4.2), and the
// APPLY-SITE predicate (section 4.3). The hooks are stubs: dispatch (step 4)
// is not wired yet, so an admitted call stays unevaluated.

import { ComputeEngine } from '../../src/compute-engine';
import type {
  ArithmeticDefinition,
  BoxedOperatorDefinition,
  Expression,
} from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';
import { isApplySiteCall } from '../../src/compute-engine/boxed-expression/apply-site';
import {
  someKindAdmittedByCarrier,
  someKindHasResultType,
} from '../../src/compute-engine/boxed-expression/value-kinds';
import { deriveApplicationType } from '../../src/compute-engine/boxed-expression/derive-application-type';
import { describeType } from '../../src/compute-engine/boxed-expression/operand-descriptor';
import {
  isFunction,
  isSymbol,
} from '../../src/compute-engine/boxed-expression/type-guards';

type Json = MathJsonExpression;

/** A MathJSON function literal as the `evaluate` of a definition. The engine
 * accepts the MathJSON form and boxes it with the definition; the declared
 * type of the field names only a boxed expression. */
const functionBody = (json: Json): Expression => json as unknown as Expression;

function operatorDef(ce: ComputeEngine, name: string): BoxedOperatorDefinition {
  const def = ce.lookupDefinition(name);
  if (def === undefined || !('operator' in def))
    throw new Error(`"${name}" is not an operator`);
  return def.operator;
}

/** Stub hooks of a kind with the five arithmetic hooks. */
const allHooks = (
  extra: Partial<ArithmeticDefinition> = {}
): ArithmeticDefinition => ({
  add: () => undefined,
  negate: () => undefined,
  multiply: () => undefined,
  divide: () => undefined,
  power: () => undefined,
  ...extra,
});

/**
 * An engine with three user kinds:
 * - `GF8: (integer) -> gf8`, `admittedAs: 'none'`, every arithmetic hook;
 * - `GF8b: (integer) -> gf8b`, `admittedAs: 'none'`, no `divide`, no `power`;
 * - `UserMeasurement: (real, real) -> umeasurement`, `admittedAs: 'number'`,
 *   with `apply` and `compare` stubs.
 */
function kindEngine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declareType('gf8', 'value', { mint: false });
  ce.declare('GF8', { signature: '(integer) -> gf8', arithmetic: allHooks() });
  ce.declareType('gf8b', 'value', { mint: false });
  ce.declare('GF8b', {
    signature: '(integer) -> gf8b',
    arithmetic: {
      add: () => undefined,
      negate: () => undefined,
      multiply: () => undefined,
    },
  });
  ce.declareType('umeasurement', 'value', { mint: false });
  ce.declare('UserMeasurement', {
    signature: '(real, real) -> umeasurement',
    arithmetic: allHooks({
      admittedAs: 'number',
      apply: () => undefined,
      compare: () => undefined,
    }),
  });
  return ce;
}

const U: Json = ['UserMeasurement', 2, 0.1];
const U2: Json = ['UserMeasurement', 3, 0.2];

/** The code and the expected type of the first `incompatible-type` error
 * in `expr`, or `undefined` when it is valid. */
function errorOf(expr: {
  isValid: boolean;
  json: unknown;
}): string | undefined {
  if (expr.isValid) return undefined;
  const m = JSON.stringify(expr.json).match(
    /"ErrorCode","'([^']+)'","'([^']*)'","'([^']*)'"/
  );
  return m ? `${m[1]}: expected ${m[2]}, got ${m[3]}` : 'invalid';
}

describe('VALUE KINDS ADMISSION: group 1, the arithmetic operators', () => {
  test('a kind value beside numbers, absent, or in a list is admitted at `Add`', () => {
    const ce = kindEngine();
    ce.declare('a', 'integer | gf8');
    ce.declare('b', 'gf8 | missing');
    ce.declare('c', 'list<integer | gf8>');
    for (const x of ['a', 'b', 'c'])
      expect([x, ce.box(['Add', x, 1]).isValid]).toEqual([x, true]);
    expect(ce.box(['Add', ['GF8', 1], 1]).isValid).toBe(true);
  });

  test('a kind value beside a string is refused at `Add`', () => {
    const ce = kindEngine();
    ce.declare('s', 'string | gf8');
    expect(errorOf(ce.box(['Add', 's', 1]))).toBe(
      'incompatible-type: expected number, got gf8 | string'
    );
  });

  test('a declared list of classes is admitted and typed by its cells', () => {
    const ce = kindEngine();
    ce.declare('L', 'list<residue>');
    const sum = ce.box(['Add', 'L', 'L']);
    expect(sum.isValid).toBe(true);
    expect(sum.type.toString()).toBe('list<residue>');
  });

  test('the hook decides: `Divide` admits a kind with `divide` only', () => {
    const ce = kindEngine();
    expect(ce.box(['Divide', ['GF8', 1], ['GF8', 2]]).isValid).toBe(true);
    expect(errorOf(ce.box(['Divide', ['GF8b', 1], ['GF8b', 2]]))).toBe(
      'incompatible-type: expected number, got gf8b'
    );
    expect(errorOf(ce.box(['Power', ['GF8b', 1], 2]))).toBe(
      'incompatible-type: expected number, got gf8b'
    );
    // `Add` reads `add`, which `GF8b` declares.
    expect(ce.box(['Add', ['GF8b', 1], ['GF8b', 2]]).isValid).toBe(true);
  });

  test('the nine library signatures name no kind type', () => {
    const ce = kindEngine();
    for (const name of [
      'Add',
      'Subtract',
      'Multiply',
      'Divide',
      'Negate',
      'Power',
      'Root',
      'Sqrt',
      'Square',
    ])
      expect([
        name,
        operatorDef(ce, name).signature.toString(),
      ]).not.toContainEqual(expect.stringContaining('residue'));
  });

  test('the message of a refused string is unchanged', () => {
    const ce = kindEngine();
    expect(errorOf(ce.box(['Sqrt', "'banana'"]))).toBe(
      'incompatible-type: expected number, got string'
    );
  });

  test('an expression refused before the hook is registered is not revisited', () => {
    const ce = new ComputeEngine();
    ce.declareType('gf8', 'value', { mint: false });
    ce.declare('r', 'gf8');
    const before = ce.box(['Add', 'r', 1]);
    expect(errorOf(before)).toBe('incompatible-type: expected number, got gf8');
    ce.declare('GF8', {
      signature: '(integer) -> gf8',
      arithmetic: { add: () => undefined, negate: () => undefined },
    });
    // The expression boxed before stays an error.
    expect(before.isValid).toBe(false);
    // The same boxed after is admitted and stays an unevaluated sum.
    const after = ce.box(['Add', 'r', 1]);
    expect(after.isValid).toBe(true);
    expect(after.evaluate().operator).toBe('Add');
  });

  test('an arithmetic operator used as a function value admits kind values', () => {
    const ce = kindEngine();
    const L: Json = ['List', ['ResidueClass', 2, 5], ['ResidueClass', 3, 5]];
    expect(ce.box(['Map', 'Negate', L]).evaluate().toString()).toBe(
      '[ResidueClass(3, 5),ResidueClass(2, 5)]'
    );
    expect(ce.box(['Reduce', L, 'Multiply']).evaluate().toString()).toBe(
      'ResidueClass(1, 5)'
    );
  });
});

describe('VALUE KINDS ADMISSION: group 3, the carrier', () => {
  test.each([
    ['Sin', '(complex) -> number'],
    ['Factorial', '(complex | infinity) -> number'],
    ['Abs', 'complex | infinity'],
    ['Floor', 'real | signed_infinity | ~oo'],
  ])('a `number` kind is admitted at `%s`', (name) => {
    const ce = kindEngine();
    expect(errorOf(ce.box([name, U]))).toBeUndefined();
  });

  test('a list of a `number` kind is admitted at `Mean` and at `Sin`', () => {
    const ce = kindEngine();
    ce.declare('lu', 'list<umeasurement>');
    expect(ce.box(['Mean', 'lu']).isValid).toBe(true);
    expect(ce.box(['Mean', ['List', U, U2]]).isValid).toBe(true);
    expect(ce.box(['Sin', 'lu']).isValid).toBe(true);
  });

  test('a `number` kind is refused at an `integer` parameter', () => {
    const ce = kindEngine();
    expect(errorOf(ce.box(['Fibonacci', U]))).toBe(
      'incompatible-type: expected integer, got umeasurement'
    );
  });

  test('a union with a string arm is refused through its string arm', () => {
    const ce = kindEngine();
    ce.declare('su', 'string | umeasurement');
    expect(errorOf(ce.box(['Sin', 'su']))).toBe(
      'incompatible-type: expected complex | quantity, got string | umeasurement'
    );
  });

  test('admission is not subtyping: a symbol declared as a number refuses a kind value', () => {
    const ce = kindEngine();
    expect(ce.type('umeasurement').matches('real')).toBe(false);
    for (const t of ['real', 'number', 'integer']) {
      ce.declare(`s_${t}`, t);
      expect(() => ce.assign(`s_${t}`, ce.box(U))).toThrow();
    }
  });

  test('a `none` kind is refused at `Sin`', () => {
    const ce = kindEngine();
    expect(errorOf(ce.box(['Sin', ['GF8', 1]]))).toBe(
      'incompatible-type: expected complex | quantity, got gf8'
    );
    expect(errorOf(ce.box(['Sin', ['ResidueClass', 2, 5]]))).toBe(
      'incompatible-type: expected complex | quantity, got residue'
    );
  });

  test('a lazy operator over `real` admits a kind value and its handler sees it', () => {
    const ce = kindEngine();
    ce.declare('Choose2', {
      signature: '(boolean, real, real) -> real',
      lazy: true,
      evaluate: (ops) =>
        (isSymbol(ops[0].evaluate(), 'True') ? ops[1] : ops[2]).evaluate(),
    });
    const call = ce.box(['Choose2', 'True', U, 1]);
    expect(call.isValid).toBe(true);
    expect(call.evaluate().toString()).toBe('UserMeasurement(2, 0.1)');
  });

  test('an operator over `real` with no handler admits it and stays unevaluated', () => {
    const ce = kindEngine();
    ce.declare('NoHandler', { signature: '(real) -> real' });
    const call = ce.box(['NoHandler', U]);
    expect(call.isValid).toBe(true);
    expect(call.evaluate().operator).toBe('NoHandler');
  });
});

describe('VALUE KINDS ADMISSION: functions with a body (decision B)', () => {
  test('a parameter typed `real` refuses a kind value', () => {
    const ce = kindEngine();
    ce.declare('f', {
      signature: '(real) -> real',
      evaluate: functionBody(['Function', ['Multiply', 'x', 2], 'x']),
    });
    expect(errorOf(ce.box(['f', U]))).toBe(
      'incompatible-type: expected real, got umeasurement'
    );
  });

  test('a parameter that names the kind type admits it', () => {
    const ce = kindEngine();
    ce.declare('f2', {
      signature: '(real | umeasurement) -> real',
      evaluate: functionBody(['Function', 'x', 'x']),
    });
    expect(ce.box(['f2', U]).isValid).toBe(true);
  });

  test('an untyped lambda and a `value` parameter admit it', () => {
    const ce = kindEngine();
    expect(
      ce
        .box([['Function', 'x', 'x'], U] as unknown as Json)
        .evaluate()
        .toString()
    ).toBe('UserMeasurement(2, 0.1)');
    ce.declare('g', {
      signature: '(value) -> value',
      evaluate: functionBody(['Function', 'x', 'x']),
    });
    expect(ce.box(['g', U]).isValid).toBe(true);
  });

  test('a pre-boxed untyped lambda over classes gives classes on every route', () => {
    const ce = kindEngine();
    const L: Json = ['List', ['ResidueClass', 2, 4], ['ResidueClass', 3, 4]];
    const body: Json = ['Function', ['Divide', 'x', 'x'], 'x'];
    const expected =
      '[ResidueClass(2, 4) / ResidueClass(2, 4),ResidueClass(1, 4)]';
    // The box route.
    expect(ce.box(['Map', body, L]).evaluate().toString()).toBe(expected);
    // The parse route.
    expect(
      ce
        .parse(
          '\\operatorname{Map}(x\\mapsto \\frac{x}{x}, [\\operatorname{ResidueClass}(2,4), \\operatorname{ResidueClass}(3,4)])'
        )
        .evaluate()
        .toString()
    ).toBe(expected);
    // A lambda boxed before the call: its canonical body is `1`, and it was
    // applied as such (`[1, 1]`).
    const lambda = ce.box(body);
    expect(
      ce
        .function('Map', [lambda, ce.box(L)])
        .evaluate()
        .toString()
    ).toBe(expected);
  });

  test('a pre-boxed lambda over numbers keeps its canonical body', () => {
    const ce = kindEngine();
    const lambda = ce.box(['Function', ['Divide', 'x', 'x'], 'x']);
    const call = ce.function('Map', [lambda, ce.box(['List', 2, 3])]);
    if (!isFunction(call)) throw new Error(`not a function: ${call}`);
    expect(call.op1).toBe(lambda);
    expect(call.evaluate().toString()).toBe('[1,1]');
  });
});

describe('VALUE KINDS ADMISSION: overloads', () => {
  test('an arm that names the kind is chosen over a carrier arm', () => {
    for (const signature of [
      '((real) -> real) & ((real | umeasurement) -> integer)',
      '((real | umeasurement) -> integer) & ((real) -> real)',
    ]) {
      const ce = kindEngine();
      ce.declare('Ov', { signature, evaluate: (ops) => ops[0] });
      const call = ce.box(['Ov', U]);
      expect(call.isValid).toBe(true);
      expect(call.type.toString()).toBe('integer');
      expect(isApplySiteCall(call)).toBe(false);
      // A number takes the more specific arm.
      expect(ce.box(['Ov', 2.5]).type.toString()).toBe('real');
      // The type-only route agrees.
      expect(
        ce
          .box(['Map', ['Function', ['Ov', 'x'], 'x'], ['List', U, U2]])
          .type.toString()
      ).toBe('vector<integer^2>');
    }
  });

  test('a carrier arm is taken when no arm names the kind', () => {
    const ce = kindEngine();
    ce.declare('Ov', {
      signature: '((real) -> real) & ((string) -> string)',
      evaluate: (ops) => ops[0],
    });
    const call = ce.box(['Ov', U]);
    expect(call.isValid).toBe(true);
    // An apply site of a kind that declares `apply` is typed by the kind
    // (`docs/plans/2026-10-26-value-kinds.md`, section 4.5, rule 2): the
    // hook answers in place of the handler.
    expect(call.type.toString()).toBe('umeasurement');
    expect(isApplySiteCall(call)).toBe(true);
  });
});

describe('VALUE KINDS ADMISSION: apply sites', () => {
  test('which calls are apply sites', () => {
    const ce = kindEngine();
    ce.declare('h', { signature: '(real) -> real', evaluate: (ops) => ops[0] });
    ce.declare('Choose2', {
      signature: '(boolean, real, real) -> real',
      lazy: true,
      evaluate: (ops) => ops[1].evaluate(),
    });
    const site = (json: unknown) => isApplySiteCall(ce.box(json as any));
    expect(site(['Sin', U])).toBe(true);
    expect(site(['Sin', ['List', U, U2]])).toBe(true);
    expect(site(['Mean', ['List', U, U2]])).toBe(true);
    expect(site(['h', U])).toBe(true);
    expect(site(['Max', U, 3])).toBe(false);
    expect(site(['Add', U, 1])).toBe(false);
    expect(site(['Choose2', 'True', U, 1])).toBe(false);
    expect(site(['List', U, 1])).toBe(false);
    expect(site(['Sin', 2])).toBe(false);
  });

  test('a function with a body is not reached: the call is refused', () => {
    const ce = kindEngine();
    ce.declare('f', {
      signature: '(real) -> real',
      evaluate: functionBody(['Function', 'x', 'x']),
    });
    const call = ce.box(['f', U]);
    expect(call.isValid).toBe(false);
    expect(isApplySiteCall(call)).toBe(false);
  });
});

describe('VALUE KINDS ADMISSION: the type-only route', () => {
  test('`Map(x ↦ x + GF8(1), [GF8(2)])` is a list of `gf8`', () => {
    const ce = kindEngine();
    expect(
      ce
        .box([
          'Map',
          ['Function', ['Add', 'x', ['GF8', 1]], 'x'],
          ['List', ['GF8', 2]],
        ])
        .type.toString()
    ).toBe('list<gf8^1>');
  });

  test('the route does not refuse a `number` kind at `Sin`', () => {
    const ce = kindEngine();
    const t = ce.type('umeasurement').type;
    expect(deriveApplicationType(ce, 'Sin', [describeType(t)])).not.toBe(
      'error'
    );
    expect(deriveApplicationType(ce, 'Fibonacci', [describeType(t)])).toBe(
      'error'
    );
    expect(
      ce
        .box(['Map', ['Function', ['Sin', 'x'], 'x'], ['List', U, U2]])
        .type.toString()
    ).not.toBe('error');
  });

  test('group 1 reads the hook on the route', () => {
    const ce = kindEngine();
    const gf8b = ce.type('gf8b').type;
    const gf8 = ce.type('gf8').type;
    expect(
      deriveApplicationType(ce, 'Divide', [
        describeType(gf8b),
        describeType(gf8b),
      ])
    ).toBe('error');
    expect(
      deriveApplicationType(ce, 'Divide', [
        describeType(gf8),
        describeType(gf8),
      ])
    ).not.toBe('error');
  });
});

describe('VALUE KINDS ADMISSION: the missing-operand memo', () => {
  test('a parameter that names a kind registered later answers again', () => {
    const ce = new ComputeEngine();
    ce.declareType('gk', 'value', { mint: false });
    ce.declare('P', { signature: '(real | gk) -> real' });
    const def = operatorDef(ce, 'P');
    // `gk` is not a kind type yet: the parameter is not numeric.
    expect(def.resolvedMissingBehavior).toBe('pass-through');
    ce.declare('GK', {
      signature: '(integer) -> gk',
      arithmetic: { negate: () => undefined },
    });
    // `gk` is a kind type now: `real | gk` reads as numeric.
    expect(def.resolvedMissingBehavior).toBe('propagate');
  });
});

describe('VALUE KINDS ADMISSION: the per-engine shortcut', () => {
  test('the registry flags are false in a fresh engine', () => {
    // The library kind `residue` is admitted only by its own type and has
    // no `resultType` hook, so the apply-site readers return at once.
    const ce = new ComputeEngine();
    expect(someKindAdmittedByCarrier(ce)).toBe(false);
    expect(someKindHasResultType(ce)).toBe(false);
    expect(isApplySiteCall(ce.box(['Sin', 'x']))).toBe(false);
  });

  test("the registry flags are true after a 'number' kind is registered", () => {
    const ce = new ComputeEngine();
    ce.declareType('nk', 'value', { mint: false });
    ce.declare('NK', {
      signature: '(real) -> nk',
      arithmetic: {
        admittedAs: 'number',
        apply: () => undefined,
        resultType: () => undefined,
      },
    });
    expect(someKindAdmittedByCarrier(ce)).toBe(true);
    expect(someKindHasResultType(ce)).toBe(true);
    expect(isApplySiteCall(ce.box(['Sin', ['NK', 2]]))).toBe(true);
  });
});
