// Value kinds, phase 1: the acceptance cases of
// `docs/plans/2026-10-26-value-kinds.md` (sections 3 and 7) that the test
// files of the steps (`value-kinds.test.ts`, `value-kinds-admission.test.ts`,
// `value-kinds-arithmetic.test.ts`, `value-kinds-comparison-apply.test.ts`,
// `value-kinds-compile.test.ts`) do not already cover.
//
// The test kinds are in `value-kinds-helpers.ts`: `GF8` (the field with 8
// elements, a user nominal type `gf8` admitted as nothing), `MyMod` (a class
// of ℤ/nℤ of the library type `residue`, the head of issue #477) and
// `UserMeasurement` (a user nominal type `umeasurement` admitted as a
// number, with `compare` and `apply`).
//

import { ComputeEngine, compile } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';
import {
  isFunction,
  isNumber,
  isSymbol,
} from '../../src/compute-engine/boxed-expression/type-guards';
import {
  engineHasKindValues,
  isKindType,
  kindTypesOf,
} from '../../src/compute-engine/boxed-expression/value-kinds';
import { deriveApplicationType } from '../../src/compute-engine/boxed-expression/derive-application-type';
import { describeType } from '../../src/compute-engine/boxed-expression/operand-descriptor';
import {
  GF8_ARITHMETIC,
  MYMOD_ARITHMETIC,
  declareGF8,
  declareMyMod,
  declareUserMeasurement,
} from './value-kinds-helpers';

type Json = MathJsonExpression;

const RC = (k: number, n: number): Json => ['ResidueClass', k, n];
const GF = (k: number): Json => ['GF8', k];
const M = (k: number, n: number): Json => ['MyMod', k, n];
const U = (nominal: number, sigma: number): Json => [
  'UserMeasurement',
  nominal,
  sigma,
];

/** A MathJSON function literal as the `evaluate` of a definition. The engine
 * accepts the MathJSON form and boxes it with the definition; the declared
 * type of the field names only a boxed expression. */
const functionBody = (json: Json): Expression => json as unknown as Expression;

/** The nominal and the uncertainty of the measurement `x`, as numbers. */
function measurementOf(x: Expression): [number, number] {
  if (!isFunction(x, 'UserMeasurement'))
    throw new Error(`not a measurement: ${x}`);
  return [x.op1.N().re, x.op2.N().re];
}

/** The code of the error `x`, or `undefined` when `x` is not an error. */
function errorCode(x: Expression): string | undefined {
  if (!isFunction(x, 'Error')) return undefined;
  const code = x.op1;
  const head = isFunction(code, 'ErrorCode') ? code.op1 : code;
  return head.toString().replace(/^"|"$/g, '');
}

function kindEngine(): ComputeEngine {
  const ce = new ComputeEngine();
  declareGF8(ce);
  declareMyMod(ce);
  declareUserMeasurement(ce);
  return ce;
}

describe('VALUE KINDS ACCEPTANCE: issue #477 as filed', () => {
  // The issue declares the head over `any` operands.
  function issueEngine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('MyMod', {
      signature: '(any, any) -> residue',
      arithmetic: MYMOD_ARITHMETIC,
    });
    return ce;
  }

  const sum: Json = ['Add', 'x', M(2, 4), M(1, 4)];
  const expected: Json = ['Add', 'x', M(3, 4)];

  test('x + MyMod(2, 4) + MyMod(1, 4) through simplify(), evaluate() and N()', () => {
    const ce = issueEngine();
    expect(ce.box(sum).simplify().json).toEqual(expected);
    expect(ce.box(sum).evaluate().json).toEqual(expected);
    expect(ce.box(sum).N().json).toEqual(expected);
    expect(ce.box(sum).type.toString()).toBe('residue');
  });

  test('MyMod(2, 4) · MyMod(3, 4) is a MyMod', () => {
    const ce = issueEngine();
    // 2 · 3 = 6 = 2 in ℤ/4ℤ.
    const product: Json = ['Multiply', M(2, 4), M(3, 4)];
    expect(ce.box(product).evaluate().json).toEqual(M(2, 4));
    expect(ce.box(product).simplify().json).toEqual(M(2, 4));
    expect(ce.box(M(2, 4)).mul(ce.box(M(3, 4))).json).toEqual(M(2, 4));
  });

  test('both LaTeX spellings of the head parse to a MyMod call', () => {
    const ce = issueEngine();
    expect(ce.parse('\\operatorname{MyMod}(2,4)').json).toEqual(M(2, 4));
    expect(ce.parse('\\mathrm{MyMod}(2, 4)').json).toEqual(M(2, 4));
  });

  test('the box, parse, function and method routes give one value', () => {
    const ce = issueEngine();
    const target = ce.box(expected);
    const pre = [ce.symbol('x'), ce.box(M(2, 4)), ce.box(M(1, 4))];
    const routes: [string, Expression][] = [
      ['box', ce.box(sum).evaluate()],
      [
        'parse operatorname',
        ce
          .parse('x + \\operatorname{MyMod}(2,4) + \\operatorname{MyMod}(1,4)')
          .evaluate(),
      ],
      [
        'parse mathrm',
        ce
          .parse('x + \\mathrm{MyMod}(2, 4) + \\mathrm{MyMod}(1, 4)')
          .evaluate(),
      ],
      ['function', ce.function('Add', pre).evaluate()],
      ['method', pre[0].add(pre[1]).add(pre[2])],
    ];
    for (const [route, value] of routes)
      expect([route, value.isSame(target)]).toEqual([route, true]);
    // The method route on the two classes alone.
    expect(pre[1].add(pre[2]).json).toEqual(M(3, 4));
  });

  test('x + x + 1 + 2 is 2x + 3: no extension of `Add` is needed', () => {
    const ce = issueEngine();
    const twoXPlus3: Json = ['Add', ['Multiply', 2, 'x'], 3];
    expect(ce.box(['Add', 'x', 'x', 1, 2]).evaluate().json).toEqual(twoXPlus3);
    expect(ce.parse('x+x+1+2').evaluate().json).toEqual(twoXPlus3);
    expect(ce.parse('x+x+1+2').simplify().json).toEqual(twoXPlus3);
  });
});

describe('VALUE KINDS ACCEPTANCE: residue classes', () => {
  // The index of an `Element` clause is narrowed to the element type of the
  // collection (`residue`) before the body is made canonical. The narrowing
  // opens the declaration gate of the kind type (`bindIndexAuthoritatively()`,
  // `library/utils.ts`), so the body recognizes the index as a class and
  // keeps `k/k`: 1/1 and 2/2 are both the class of 1 in ℤ/5ℤ (plan, section
  // 4.2). Until 2026-10-26 the gate stayed closed in an engine with no
  // declaration of a kind type, `k/k` folded to `1`, and the sum was `2`.
  test('Sum(k/k, k ∈ [c1, c2]) is ResidueClass(2, 5) in a fresh engine', () => {
    const ce = new ComputeEngine();
    const sum = ce.box([
      'Sum',
      ['Divide', 'k', 'k'],
      ['Element', 'k', ['List', RC(1, 5), RC(2, 5)]],
    ]);
    expect(sum.json).toEqual([
      'Sum',
      ['Divide', 'k', 'k'],
      ['Element', 'k', ['List', RC(1, 5), RC(2, 5)]],
    ]);
    expect(sum.evaluate().json).toEqual(RC(2, 5));
  });

  test('Product and Comprehension over classes keep k/k; Sum over integers folds it', () => {
    const ce = new ComputeEngine();
    const L: Json = ['List', RC(2, 5), RC(3, 5)];
    expect(
      ce.box(['Product', ['Divide', 'k', 'k'], ['Element', 'k', L]]).evaluate()
        .json
    ).toEqual(RC(1, 5));
    expect(
      ce
        .box(['Comprehension', ['Divide', 'k', 'k'], ['Element', 'k', L]])
        .evaluate()
        .toString()
    ).toBe('[ResidueClass(1, 5),ResidueClass(1, 5)]');
    const overIntegers = ce.box([
      'Sum',
      ['Divide', 'k', 'k'],
      ['Element', 'k', ['List', 1, 2]],
    ]);
    expect(overIntegers.json).toEqual([
      'Sum',
      1,
      ['Element', 'k', ['List', 1, 2]],
    ]);
    expect(overIntegers.evaluate().json).toBe(2);
  });

  test('Sum(k/k, k ∈ [GF8(1), GF8(2)]) is GF8(0)', () => {
    const ce = new ComputeEngine();
    declareGF8(ce);
    // 1/1 = 2/2 = 1, and 1 + 1 = 0 in GF(8).
    expect(
      ce
        .box([
          'Sum',
          ['Divide', 'k', 'k'],
          ['Element', 'k', ['List', GF(1), GF(2)]],
        ])
        .evaluate().json
    ).toEqual(GF(0));
  });

  test('a MyMod with only `compile.value` declines to compile', () => {
    const ce = new ComputeEngine();
    ce.declare('MyMod', {
      signature: '(integer, integer) -> residue',
      arithmetic: { ...MYMOD_ARITHMETIC, compile: { value: () => '0' } },
    });
    ce.declare('x', 'real');
    expect(() =>
      compile(ce.box(['Add', 'x', M(2, 5)]), { fallback: false })
    ).toThrow("holds a residue class (type 'residue')");
  });
});

describe('VALUE KINDS ACCEPTANCE: the per-kind engine shortcut', () => {
  test('a fresh engine joins for `residue` only when a class is made', () => {
    const ce = new ComputeEngine();
    expect(engineHasKindValues(ce, 'residue')).toBe(false);
    // A head that returns `value` and declares no kind does not join.
    ce.declare('QuantityLike', { signature: '(real, string) -> value' });
    ce.box(['QuantityLike', 2, "'m'"]);
    expect(engineHasKindValues(ce)).toBe(false);
    expect([...kindTypesOf(ce)]).toEqual([
      'residue',
      'measurement',
      'enclosure',
      'quantity',
    ]);
    ce.box(RC(1, 5));
    expect(engineHasKindValues(ce, 'residue')).toBe(true);
  });

  test('registering a user kind joins the engine for its type only', () => {
    const ce = new ComputeEngine();
    declareGF8(ce);
    expect(engineHasKindValues(ce, 'gf8')).toBe(true);
    expect(engineHasKindValues(ce, 'residue')).toBe(false);
  });
});

describe('VALUE KINDS ACCEPTANCE: a kind declared in a scope', () => {
  test('the type keeps its protection after the pop', () => {
    const ce = new ComputeEngine();
    ce.declareType('gf8', 'value', { mint: false });
    ce.pushScope();
    ce.declare('GF8', {
      signature: '(integer) -> gf8',
      arithmetic: GF8_ARITHMETIC,
    });
    expect(ce.box(['Add', GF(1), GF(2)]).evaluate().json).toEqual(GF(3));
    ce.popScope();
    expect(isKindType(ce, ce.type('gf8').type)).toBe(true);
    ce.declare('r', 'gf8');
    expect(ce.box(['Subtract', 'r', 'r']).simplify().isSame(0)).toBe(false);
  });

  /** An engine with `GF8` (XOR addition) and, in an inner scope, a second
   * declaration of `GF8` whose `add` always gives `GF8(7)`. */
  function scopedEngine(): {
    ce: ComputeEngine;
    outer: Expression;
    inner: Expression;
  } {
    const ce = new ComputeEngine();
    declareGF8(ce);
    const outer = ce.box(['Add', GF(1), GF(2)]);
    ce.pushScope();
    ce.declare('GF8', {
      signature: '(integer) -> gf8',
      arithmetic: {
        ...GF8_ARITHMETIC,
        add: (ops, { engine }) => [
          {
            value: engine.box(GF(7)),
            operands: ops.evaluated.map((_, i) => i),
          },
        ],
      },
    });
    const inner = ce.box(['Add', GF(1), GF(2)]);
    return { ce, outer, inner };
  }

  test('a value boxed in a scope evaluates with the hooks of that scope', () => {
    const { ce, inner } = scopedEngine();
    expect(inner.evaluate().json).toEqual(GF(7));
    ce.popScope();
    expect(ce.box(['Add', GF(1), GF(2)]).evaluate().json).toEqual(GF(3));
  });

  // The evaluation of a call of a kind head that has no `evaluate` handler
  // (`GF8(1)`) builds the call again over its evaluated operands, and keeps
  // the definition the call was bound to (`withCallableBinding()` in
  // `boxed-function.ts`), not the head visible in the current scope. So the
  // dispatch reads the hooks of the bound definition (plan, section 4.6,
  // "The kind registry and its lifetime"): an inner redeclaration does not
  // change the outer expressions, and the inner values keep the inner hooks
  // after the pop.
  test('an outer value keeps the outer hooks inside the scope', () => {
    const { outer } = scopedEngine();
    expect(outer.evaluate().json).toEqual(GF(3));
  });

  test('an inner value keeps the inner hooks after the pop', () => {
    const { ce, inner } = scopedEngine();
    ce.popScope();
    expect(inner.evaluate().json).toEqual(GF(7));
  });

  // The admission of group 1 (`Add`, `Subtract`, …) and the rules of
  // `Max`, `Min`, `Sort` and `Clamp` belong to the LIBRARY definitions of
  // these names (`isLibraryKindOperator()`, `kind-admission.ts`). A host
  // operator declared with one of these names in a nested scope is an
  // ordinary operator: its `real` parameters refuse a `GF8` value, and its
  // handler does not run. Until 2026-10-26 the rule was selected by the
  // name, and the host `Add` admitted the two values and ran its handler.
  test('a host `Add` and `Max` in a nested scope refuse GF8 values', () => {
    const ce = new ComputeEngine();
    declareGF8(ce);
    const calls: string[] = [];
    ce.pushScope();
    for (const name of ['Add', 'Subtract', 'Max'])
      ce.declare(name, {
        signature: '(real, real) -> real',
        evaluate: () => {
          calls.push(name);
          return ce.Zero;
        },
      });
    for (const name of ['Add', 'Subtract', 'Max']) {
      const call = ce.box([name, GF(1), GF(2)]);
      expect([name, call.isValid]).toEqual([name, false]);
      expect([name, errorCode(call.op1)]).toEqual([name, 'incompatible-type']);
      expect([name, errorCode(call.evaluate())]).toEqual([
        name,
        'incompatible-type',
      ]);
    }
    // The host operators still take real numbers.
    expect(ce.box(['Add', 1, 2]).evaluate().isSame(0)).toBe(true);
    expect(calls).toEqual(['Add']);
    ce.popScope();
    // The library `Add` and `Subtract` fold the two values. The library
    // `Max` admits them at boxing; `GF8` declares no `compare`, so its
    // evaluation refuses them.
    expect(ce.box(['Add', GF(1), GF(2)]).evaluate().json).toEqual(GF(3));
    expect(ce.box(['Subtract', GF(1), GF(2)]).evaluate().json).toEqual(GF(3));
    expect(ce.box(['Max', GF(1), GF(2)]).isValid).toBe(true);
  });

  test('the library `Max` orders a kind with `compare` outside a scope that declares a host `Max`', () => {
    const ce = kindEngine();
    const U = (k: number): Json => ['UserMeasurement', k, 0.1];
    ce.pushScope();
    ce.declare('Max', {
      signature: '(integer, integer) -> integer',
      evaluate: () => ce.Zero,
    });
    // `integer` does not admit the carrier of a measurement.
    expect(ce.box(['Max', U(1), U(2)]).isValid).toBe(false);
    ce.popScope();
    expect(ce.box(['Max', U(1), U(2)]).evaluate().json).toEqual(U(2));
  });

  test('the value of a kind call keeps the definition it was bound to', () => {
    const { ce, outer, inner } = scopedEngine();
    const outerCall = (outer as Expression & { op1: Expression }).op1;
    const innerCall = (inner as Expression & { op1: Expression }).op1;
    expect(outerCall.operatorDefinition).not.toBe(innerCall.operatorDefinition);
    expect(outerCall.evaluate().operatorDefinition).toBe(
      outerCall.operatorDefinition
    );
    ce.popScope();
    expect(innerCall.evaluate().operatorDefinition).toBe(
      innerCall.operatorDefinition
    );
  });
});

describe('VALUE KINDS ACCEPTANCE: GF8, a user kind admitted as nothing', () => {
  const ce = kindEngine();

  test('a symbol of the kind type cannot be a number', () => {
    const e = kindEngine();
    e.declare('r', 'gf8');
    expect(e.box('r').type.facts.couldBeNumber).toBe(false);
  });

  test('GF8(1) + GF8(2) on the parse and function routes', () => {
    expect(
      ce.parse('\\operatorname{GF8}(1)+\\operatorname{GF8}(2)').evaluate().json
    ).toEqual(GF(3));
    expect(
      ce.function('Add', [ce.box(GF(1)), ce.box(GF(2))]).evaluate().json
    ).toEqual(GF(3));
  });

  test('Hold keeps a sum of kind values', () => {
    const held: Json = ['Hold', ['Add', GF(1), GF(2)]];
    expect(ce.box(held).evaluate().json).toEqual(held);
  });

  test('Less(GF8(1), GF8(2)) stays unevaluated, typed boolean', () => {
    const less = ce.box(['Less', GF(1), GF(2)]);
    expect(less.type.toString()).toBe('boolean');
    expect(less.evaluate().operator).toBe('Less');
  });

  test('Sort with an explicit `order` callback is evaluated', () => {
    const sorted = ce
      .box(['Sort', ['List', GF(2), GF(1)], ['Function', 'True', 'a', 'b']])
      .evaluate();
    expect(sorted.operator).toBe('List');
  });

  test('Sum([GF8(1), GF8(2)]) and Reduce(L, Add) are typed gf8', () => {
    const L: Json = ['List', GF(1), GF(2)];
    for (const json of [
      ['Sum', L],
      ['Reduce', L, 'Add'],
    ] as Json[]) {
      expect(ce.box(json).type.toString()).toBe('gf8');
      expect(ce.box(json).evaluate().json).toEqual(GF(3));
    }
  });

  test('two kinds in one sum and in one product, in both orders', () => {
    const sumValue: Json = ['Add', M(3, 4), GF(3)];
    expect(
      ce.box(['Add', GF(1), M(1, 4), GF(2), M(2, 4)]).evaluate().json
    ).toEqual(sumValue);
    expect(
      ce.box(['Add', M(2, 4), GF(2), M(1, 4), GF(1)]).evaluate().json
    ).toEqual(sumValue);
    // GF8(3)·GF8(5) = GF8(4) (x² modulo x³ + x + 1), 3·3 = 1 in ℤ/4ℤ.
    const productValue: Json = ['Multiply', M(1, 4), GF(4)];
    expect(
      ce.box(['Multiply', GF(3), M(3, 4), GF(5), M(3, 4)]).evaluate().json
    ).toEqual(productValue);
    expect(
      ce.box(['Multiply', M(3, 4), GF(5), M(3, 4), GF(3)]).evaluate().json
    ).toEqual(productValue);
  });

  test('Map(x ↦ x/x, …) keeps `x/x` on the function route too', () => {
    const lambda: Json = ['Function', ['Divide', 'x', 'x'], 'x'];
    const L: Json = ['List', GF(1), GF(2)];
    const viaFunction = ce.function('Map', [ce.box(lambda), ce.box(L)]);
    expect(viaFunction.json).toEqual([
      'Map',
      ['Function', ['Block', ['Divide', 'x', 'x']], 'x'],
      L,
    ]);
    // `divide` gives the unit of the field for each element.
    const expected = '[GF8(1),GF8(1)]';
    expect(viaFunction.evaluate().toString()).toBe(expected);
    expect(ce.box(['Map', lambda, L]).evaluate().toString()).toBe(expected);
    expect(
      ce
        .parse(
          '\\operatorname{Map}(x\\mapsto \\frac{x}{x}, [\\operatorname{GF8}(1), \\operatorname{GF8}(2)])'
        )
        .evaluate()
        .toString()
    ).toBe(expected);
  });

  test('k: (value) -> value with the body x/x gives 1 for GF8(3) (the documented fold)', () => {
    const e = kindEngine();
    e.declare('k', {
      signature: '(value) -> value',
      evaluate: functionBody(['Function', ['Divide', 'x', 'x'], 'x']),
    });
    expect(
      e
        .box(['k', GF(3)])
        .evaluate()
        .isSame(1)
    ).toBe(true);
  });

  test('Max of free gf8 symbols is typed by the heads that declare `compare`', () => {
    const withCompare = new ComputeEngine();
    declareGF8(withCompare);
    withCompare.declare('GF8c', {
      signature: '(integer) -> gf8',
      arithmetic: { compare: () => undefined },
    });
    withCompare.declare('s1', 'gf8');
    withCompare.declare('s2', 'gf8');
    expect(withCompare.box(['Max', 's1', 's2']).type.toString()).toBe('gf8');

    const without = new ComputeEngine();
    declareGF8(without);
    without.declare('s1', 'gf8');
    without.declare('s2', 'gf8');
    expect(without.box(['Max', 's1', 's2']).type.toString()).toBe('error');
  });

  test('a redeclaration of a head with another `compile.type` is refused while another head is live', () => {
    const e = new ComputeEngine();
    e.declareType('gf8', 'value', { mint: false });
    const contract = () => ({
      type: { lowered: () => 'gf8', entry: () => true },
    });
    e.declare('G', {
      signature: '(integer) -> gf8',
      arithmetic: { negate: () => undefined, compile: contract() },
    });
    e.declare('H', {
      signature: '(integer) -> gf8',
      arithmetic: { negate: () => undefined },
    });
    expect(() =>
      e.declare(
        'G',
        {
          signature: '(integer) -> gf8',
          arithmetic: { negate: () => undefined, compile: contract() },
        },
        { extend: true }
      )
    ).toThrow('another `compile.type`');
  });
});

describe('VALUE KINDS ACCEPTANCE: UserMeasurement, a user kind admitted as a number', () => {
  const ce = kindEngine();
  const U1 = U(1, 0.1);
  const U2 = U(2, 0.1);

  test('Sin(u) with u: real | umeasurement is typed real | umeasurement', () => {
    const e = kindEngine();
    e.declare('u', 'real | umeasurement');
    const t = e.box(['Sin', 'u']).type;
    expect(t.matches(e.type('real | umeasurement'))).toBe(true);
    expect(e.type('real | umeasurement').matches(t)).toBe(true);
  });

  test('Map(x ↦ Sin(x), [U1, U2]): the type-only route agrees with the calls', () => {
    const map = ce.box([
      'Map',
      ['Function', ['Sin', 'x'], 'x'],
      ['List', U1, U2],
    ]);
    expect(map.type.toString()).toBe('list<umeasurement^2>');
    expect(ce.box(['List', ['Sin', U1], ['Sin', U2]]).type.toString()).toBe(
      map.type.toString()
    );
  });

  test('Ln, Log and Exp admit a kind admitted as a number on the type-only route', () => {
    // The canonical forms of `Ln`, `Log` and `Exp` admit such a kind value
    // (`checkNumericArgs` with `carrier`), so the type-only route does not
    // type the application `error`. A kind admitted as nothing stays refused.
    const um = describeType(ce.type('umeasurement').type);
    const gf8 = describeType(ce.type('gf8').type);
    for (const op of ['Ln', 'Log', 'Exp']) {
      expect(deriveApplicationType(ce, op, [um])).not.toBe('error');
      expect(deriveApplicationType(ce, op, [gf8])).toBe('error');
    }
    const map = ce.box([
      'Map',
      ['Function', ['Ln', 'x'], 'x'],
      ['List', U1, U2],
    ]);
    expect(map.type.toString()).toBe('list<umeasurement^2>');
    expect(ce.box(['List', ['Ln', U1], ['Ln', U2]]).type.toString()).toBe(
      map.type.toString()
    );
  });

  test('L - L with L: list<umeasurement> is admitted, typed list<umeasurement>', () => {
    const e = kindEngine();
    e.declare('L', 'list<umeasurement>');
    const d = e.box(['Subtract', 'L', 'L']);
    expect(d.isValid).toBe(true);
    expect(d.type.toString()).toBe('list<umeasurement>');
  });

  test('Ln(U) is admitted and answered by `apply`', () => {
    expect(ce.box(['Ln', U2]).type.toString()).toBe('umeasurement');
    const [nominal, sigma] = measurementOf(ce.box(['Ln', U2]).evaluate());
    expect(nominal).toBeCloseTo(Math.log(2), 12);
    // d/dx ln x = 1/x: σ = 0.1/2.
    expect(sigma).toBeCloseTo(0.05, 12);
  });

  test('Exp(U) is admitted, and the `power` hook answers e^U', () => {
    const exp = ce.box(['Exp', U2]);
    expect(exp.isValid).toBe(true);
    // The canonical form of `Exp(x)` is `Power(e, x)`.
    expect(exp.json).toEqual(['Power', 'ExponentialE', U2]);
    expect(exp.type.toString()).toBe('umeasurement');
    // d/dx e^x = e^x: σ = e²·0.1.
    for (const value of [exp.evaluate(), exp.N()]) {
      const [nominal, sigma] = measurementOf(value);
      expect(nominal).toBeCloseTo(Math.exp(2), 12);
      expect(sigma).toBeCloseTo(Math.exp(2) * 0.1, 12);
    }
    // A kind admitted as nothing stays refused at `Exp`.
    expect(ce.box(['Exp', GF(1)]).isValid).toBe(false);
    expect(ce.box(['Exp', RC(2, 5)]).isValid).toBe(false);
  });

  test('Log(1, K(2)) is not folded and reaches `apply`', () => {
    const e = kindEngine();
    const calls: string[] = [];
    e.declareType('kk', 'value', { mint: false });
    e.declare('K', {
      signature: '(real) -> kk',
      arithmetic: {
        admittedAs: 'real',
        apply: (operator) => {
          calls.push(operator);
          return undefined;
        },
      },
    });
    const log = e.box(['Log', 1, ['K', 2]]);
    expect(log.isValid).toBe(true);
    expect(log.isSame(0)).toBe(false);
    expect(log.evaluate().operator).toBe('Log');
    expect(calls).toEqual(['Log']);
    // A residue class is admitted as nothing: it stays refused.
    expect(e.box(['Ln', RC(2, 5)]).isValid).toBe(false);
  });

  test('Exp(K(2)) is refused at boxing when the kind has no `power` hook', () => {
    // `Exp(x)` is rewritten to `Power(e, x)`, and `Power` gives a kind value
    // only to the `power` hook. A kind admitted as a real number with an
    // `apply` hook and no `power` hook is refused at `Exp` when the
    // expression is boxed, as at `Sqrt`. `Sin` and `Ln` give it to `apply`.
    const e = kindEngine();
    const calls: string[] = [];
    e.declareType('kp', 'value', { mint: false });
    e.declare('K', {
      signature: '(real) -> kp',
      arithmetic: {
        admittedAs: 'real',
        apply: (operator) => {
          calls.push(operator);
          return undefined;
        },
      },
    });
    const exp = e.box(['Exp', ['K', 2]]);
    expect(exp.isValid).toBe(false);
    expect(errorCode(exp.op1)).toBe('incompatible-type');
    expect(e.box(['Sqrt', ['K', 2]]).isValid).toBe(false);
    const sin = e.box(['Sin', ['K', 2]]);
    expect(sin.isValid).toBe(true);
    sin.evaluate();
    const ln = e.box(['Ln', ['K', 2]]);
    expect(ln.isValid).toBe(true);
    ln.evaluate();
    expect(calls).toEqual(['Sin', 'Ln']);
  });

  test('exact(i) under .N(): a pure operand is read exactly, an impure one as evaluated', () => {
    const e = new ComputeEngine();
    // For each numeric operand of the hook: its exact reading, and whether
    // that reading is the evaluated operand itself.
    const seen: [string, boolean][] = [];
    e.declareType('rec', 'value', { mint: false });
    e.declare('Rec', {
      signature: '(integer) -> rec',
      arithmetic: {
        negate: () => undefined,
        add: (ops) => {
          ops.evaluated.forEach((x, i) => {
            if (isNumber(x))
              seen.push([ops.exact(i).toString(), ops.exact(i) === x]);
          });
          return undefined;
        },
      },
    });
    e.box(['Add', ['Rec', 1], ['Random'], ['Rational', 1, 3]]).N();
    expect(seen).toHaveLength(2);
    // The rational is pure: it is evaluated again, exactly.
    expect(seen).toContainEqual(['1/3', false]);
    // The draw of `Random()` is impure: it is read as evaluated, not drawn
    // again.
    expect(seen.filter(([, same]) => same)).toHaveLength(1);
  });

  describe('a function with a body', () => {
    test('f(x) := x - x with x: real refuses a measurement at the call', () => {
      const e = kindEngine();
      e.declare('f', {
        signature: '(real) -> real',
        evaluate: functionBody(['Function', ['Subtract', 'x', 'x'], 'x']),
      });
      expect(errorCode(e.box(['f', U2]).evaluate())).toBe('incompatible-type');
      expect(e.box(['f', 3]).evaluate().isSame(0)).toBe(true);
    });

    test('an untyped parameter (`unknown`) admits it', () => {
      const [nominal, sigma] = measurementOf(
        ce
          .box([
            ['Function', ['Subtract', 'x', 'x'], 'x'],
            U2,
          ] as unknown as Json)
          .evaluate()
      );
      expect(nominal).toBe(0);
      expect(sigma).toBeCloseTo(Math.SQRT2 * 0.1, 12);
    });

    const typedParam: Json = ['Typed', 'x', "'real | umeasurement'"];

    test('x: real | umeasurement gives U(0, 0.141…) under evaluate() and simplify()', () => {
      const call = ce.box([
        ['Function', ['Subtract', 'x', 'x'], typedParam],
        U2,
      ] as unknown as Json);
      for (const value of [call.evaluate(), call.simplify()]) {
        const [nominal, sigma] = measurementOf(value);
        expect(nominal).toBe(0);
        expect(sigma).toBeCloseTo(Math.SQRT2 * 0.1, 12);
      }
    });

    test('x/x in a body over real | umeasurement is kept', () => {
      const lambda = ce.box(['Function', ['Divide', 'x', 'x'], typedParam]);
      expect(lambda.json).toEqual([
        'Function',
        ['Block', ['Divide', 'x', 'x']],
        typedParam,
      ]);
      // σ = √(σ²/a² + a²σ²/a⁴) for independent errors: 0.1·√2/2.
      const [nominal, sigma] = measurementOf(
        ce.box([lambda.json, U2] as unknown as Json).evaluate()
      );
      expect(nominal).toBe(1);
      expect(sigma).toBeCloseTo((0.1 * Math.SQRT2) / 2, 12);
    });

    test('a signature over real | umeasurement: x - x gives the measurement', () => {
      const e = kindEngine();
      e.declare('g', {
        signature: '(real | umeasurement) -> real | umeasurement',
        evaluate: functionBody(['Function', ['Subtract', 'x', 'x'], 'x']),
      });
      const [nominal, sigma] = measurementOf(e.box(['g', U2]).evaluate());
      expect(nominal).toBe(0);
      expect(sigma).toBeCloseTo(Math.SQRT2 * 0.1, 12);
    });

    // The body of a declared function is made canonical with each untyped
    // parameter that the signature types with a kind arm typed so
    // (`kindTypedFunctionLiteral()`, `function-utils.ts`), as a `Typed`
    // parameter is. So `x/x` is kept (plan, section 4.2). Until 2026-10-26
    // the parameter was `unknown` in the body, `x/x` folded to `1` at the
    // declaration, and `g2(U)` was `1`.
    test('a signature over real | umeasurement: x/x is kept', () => {
      const e = kindEngine();
      e.declare('g2', {
        signature: '(real | umeasurement) -> real | umeasurement',
        evaluate: functionBody(['Function', ['Divide', 'x', 'x'], 'x']),
      });
      const [nominal, sigma] = measurementOf(e.box(['g2', U2]).evaluate());
      expect(nominal).toBe(1);
      expect(sigma).toBeCloseTo((0.1 * Math.SQRT2) / 2, 12);
      // A number argument still gives 1.
      expect(e.box(['g2', 3]).evaluate().isSame(1)).toBe(true);
    });

    test('a signature over residue: x/x is the class of 1', () => {
      const e = new ComputeEngine();
      e.declare('h', {
        signature: '(residue) -> residue',
        evaluate: functionBody(['Function', ['Divide', 'x', 'x'], 'x']),
      });
      expect(e.box(['h', RC(2, 5)]).evaluate().json).toEqual(RC(1, 5));
    });

    test('a lambda assigned to a symbol of a function type over real | umeasurement keeps x/x', () => {
      const lambda: Json = ['Function', ['Divide', 'x', 'x'], 'x'];
      for (const preBoxed of [false, true]) {
        const e = kindEngine();
        e.declare('f', '(real | umeasurement) -> real | umeasurement');
        e.assign('f', preBoxed ? e.box(lambda) : functionBody(lambda));
        const [nominal, sigma] = measurementOf(e.box(['f', U2]).evaluate());
        expect([preBoxed, nominal]).toEqual([preBoxed, 1]);
        expect(sigma).toBeCloseTo((0.1 * Math.SQRT2) / 2, 12);
        expect(e.box(['f', 3]).evaluate().isSame(1)).toBe(true);
      }
    });
  });

  describe('a lazy operator over `real`', () => {
    /** `Choose2(True, U, Random())` and a counted draw. */
    function lazyEngine(): { e: ComputeEngine; draws: () => number } {
      const e = kindEngine();
      let draws = 0;
      e.declare('Draw', {
        signature: '() -> real',
        evaluate: () => {
          draws += 1;
          return e.number(0.5);
        },
      });
      e.declare('Choose2', {
        signature: '(boolean, real, real) -> real',
        lazy: true,
        evaluate: ([c, a, b]) =>
          isSymbol(c.evaluate(), 'True') ? a.evaluate() : b.evaluate(),
      });
      return { e, draws: () => draws };
    }

    const latex = (third: string) =>
      `\\operatorname{Choose2}(\\mathrm{True}, \\operatorname{UserMeasurement}(2, 0.1), ${third})`;

    test('Choose2(True, U, Random()) is U on the box and parse routes', () => {
      const { e } = lazyEngine();
      const u = e.box(U2);
      expect(
        e
          .box(['Choose2', 'True', U2, ['Random']])
          .evaluate()
          .isSame(u)
      ).toBe(true);
      expect(
        e.parse(latex('\\operatorname{Random}()')).evaluate().isSame(u)
      ).toBe(true);
    });

    test('the unselected operand is not evaluated: no draw, sync or async', async () => {
      const { e, draws } = lazyEngine();
      const u = e.box(U2);
      expect(
        e.parse(latex('\\operatorname{Draw}()')).evaluate().isSame(u)
      ).toBe(true);
      expect(
        (await e.box(['Choose2', 'True', U2, ['Draw']]).evaluateAsync()).isSame(
          u
        )
      ).toBe(true);
      expect(
        (await e.parse(latex('\\operatorname{Draw}()')).evaluateAsync()).isSame(
          u
        )
      ).toBe(true);
      expect(draws()).toBe(0);
    });
  });

  test('a quantity-like kind: `eq` beside `compare` decides Equal of two dimensions', () => {
    const e = new ComputeEngine();
    e.declareType('uq', 'value', { mint: false });
    const sameUnit = (a: Expression, b: Expression): boolean =>
      isFunction(a, 'Q') && isFunction(b, 'Q') && a.op2.isSame(b.op2);
    e.declare('Q', {
      signature: '(real, string) -> uq',
      // Two quantities of different dimensions are not equal.
      eq: (a, b) => (sameUnit(a, b) ? undefined : false),
      arithmetic: {
        // Only two quantities of one unit are ordered.
        compare: (a, b) => {
          const [x, y] = [a.evaluated, b.evaluated];
          if (!isFunction(x, 'Q') || !isFunction(y, 'Q') || !sameUnit(x, y))
            return undefined;
          return Math.sign(x.op1.re - y.op1.re) as -1 | 0 | 1;
        },
      },
    });
    const q = (v: number, unit: string): Json => ['Q', v, `'${unit}'`];
    expect(e.box(['Equal', q(2, 'm'), q(2, 'm')]).evaluate().json).toBe('True');
    expect(e.box(['Equal', q(2, 'm'), q(3, 'm')]).evaluate().json).toBe(
      'False'
    );
    // `compare` declines a pair of two dimensions; `eq` answers.
    expect(e.box(['Equal', q(2, 'm'), q(2, 's')]).evaluate().json).toBe(
      'False'
    );
    expect(e.box(['Less', q(2, 'm'), q(2, 's')]).evaluate().operator).toBe(
      'Less'
    );
  });
});

describe('VALUE KINDS ACCEPTANCE: the written operands under simplify()', () => {
  // A temperature in degrees Celsius whose `negate` gives a value
  // (`Celsius(-t)`), and whose `add` reads `Negate(Celsius(…))` in
  // `ops.written[i]` to fold a difference of two temperatures to a number.
  // `simplify()` evaluates the constant term `Negate(Celsius(5))` to
  // `Celsius(-5)` before the hook runs; the hook still reads the term as it
  // was written, so the three routes give the same difference.
  const ce = new ComputeEngine();
  const isCelsius = (x: Expression | undefined) => x?.operator === 'Celsius';
  ce.declareType('celsius', 'value', { mint: false });
  ce.declare('Celsius', {
    signature: '(real) -> celsius',
    arithmetic: {
      negate: (x, { engine }) =>
        isFunction(x.evaluated, 'Celsius')
          ? engine.function('Celsius', [x.evaluated.op1.neg()])
          : undefined,
      add: (ops, { engine, numericApproximation }) => {
        const plus: { i: number; t: Expression }[] = [];
        const minus: { i: number; t: Expression }[] = [];
        ops.evaluated.forEach((x, i) => {
          const w = ops.written[i] ?? x;
          if (isFunction(w, 'Negate') && isCelsius(w.op1))
            minus.push({ i, t: w.op1 });
          else if (isCelsius(w)) plus.push({ i, t: w });
        });
        if (plus.length !== 1 || minus.length !== 1) return undefined;
        const [p, m] = [plus[0].t, minus[0].t];
        if (!isFunction(p) || !isFunction(m)) return undefined;
        const value = engine
          .function('Subtract', [p.op1, m.op1])
          .evaluate({ numericApproximation });
        return [{ value, operands: [plus[0].i, minus[0].i] }];
      },
    },
  });

  test.each([
    [['Subtract', ['Celsius', 20], ['Celsius', 5]], '15'],
    [['Add', 'x', ['Subtract', ['Celsius', 20], ['Celsius', 5]]], 'x + 15'],
  ] as [Json, string][])(
    '%j gives one value on the three routes',
    (json, expected) => {
      const expr = ce.box(json);
      expect(expr.evaluate().toString()).toBe(expected);
      expect(expr.N().toString()).toBe(expected);
      expect(expr.simplify().toString()).toBe(expected);
    }
  );

  test('the kind-free terms are simplified beside the difference', () => {
    const expr = ce.box([
      'Add',
      ['Power', ['Sin', 'x'], 2],
      ['Power', ['Cos', 'x'], 2],
      ['Subtract', ['Celsius', 20], ['Celsius', 5]],
    ]);
    expect(expr.simplify().toString()).toBe('16');
  });

  test('the negation alone is the value of `negate` on every route', () => {
    const expr = ce.box(['Negate', ['Celsius', 5]]);
    expect(expr.evaluate().toString()).toBe('Celsius(-5)');
    expect(expr.simplify().toString()).toBe('Celsius(-5)');
  });

  test('the library Quantity: 20 degC − 5 degC is 15 K on every route', () => {
    const e = new ComputeEngine();
    const expr = e.parse('20\\,\\mathrm{degC} - 5\\,\\mathrm{degC}');
    expect(expr.evaluate().toString()).toBe('15 K');
    expect(expr.N().toString()).toBe('15 K');
    expect(expr.simplify().toString()).toBe('15 K');
  });
});
