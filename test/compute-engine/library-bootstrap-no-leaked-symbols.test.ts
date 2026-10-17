import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';

/**
 * The standard libraries must not declare a name as a side effect of their
 * own construction.
 *
 * The value of a physical constant (`PlanckConstant`, `BoltzmannConstant`, …)
 * is a `Quantity` whose unit is made of unit names (`J`, `s`, `K`, …). A unit
 * name is not a variable. Before the fix, the unit symbols were boxed with a
 * plain `ce.symbol(name)`, which declares a name that does not resolve as an
 * `unknown` symbol in the current scope. While the libraries load, that is
 * the system scope. Thus `K + 1` read `K` from the system scope, and
 * `ce.undeclare('K')` refused it.
 *
 * The same applies to every `Quantity`: its unit is boxed resolve-only, so the
 * unit names of a quantity do not get a declaration in the user's scope.
 *
 * A fresh engine is used per test, since a declaration lasts for the
 * engine's lifetime.
 */

/** The names in `scope` that were declared as a side effect of boxing. */
function autoDeclaredNames(scope: { bindings: Map<string, any> }): string[] {
  return [...scope.bindings.entries()]
    .filter(
      ([, def]) =>
        def.value !== undefined &&
        (def.value.inferredType === true ||
          def.value._typeProvenance?.some(
            (p: { kind: string }) => p.kind === 'auto-declared'
          ))
    )
    .map(([name]) => name);
}

const UNIT_NAMES = ['m', 's', 'J', 'A', 'C', 'K', 'mol', 'F', 'kg', 'W'];

/** Each physical constant, its value (MathJSON) and its value (LaTeX).
 * These values were captured before the fix: the fix must not change them. */
const CONSTANTS: [string, MathJsonExpression, string][] = [
  [
    'SpeedOfLight',
    ['Quantity', 299792458, ['Divide', 'm', 's']],
    '299\\,792\\,458\\,\\mathrm{m/s}',
  ],
  [
    'PlanckConstant',
    ['Quantity', 6.62607015e-34, ['Multiply', 'J', 's']],
    '6.626\\,070\\,15\\cdot10^{-34}\\,\\mathrm{J\\cdot s}',
  ],
  [
    'Mu0',
    ['Quantity', 0.00000125663706212, ['Divide', 'N', ['Power', 'A', 2]]],
    '0.000\\,001\\,256\\,637\\,062\\,12\\,\\mathrm{N/A^{2}}',
  ],
  [
    'StandardGravity',
    ['Quantity', 9.80665, ['Divide', 'm', ['Power', 's', 2]]],
    '9.806\\,65\\,\\mathrm{m/s^{2}}',
  ],
  [
    'ElementaryCharge',
    ['Quantity', 1.602176634e-19, 'C'],
    '1.602\\,176\\,634\\cdot10^{-19}\\,\\mathrm{C}',
  ],
  [
    'BoltzmannConstant',
    ['Quantity', 1.380649e-23, ['Divide', 'J', 'K']],
    '1.380\\,649\\cdot10^{-23}\\,\\mathrm{J/K}',
  ],
  [
    'AvogadroConstant',
    ['Quantity', 6.02214076e23, ['Power', 'mol', -1]],
    '6.022\\,140\\,76\\cdot10^{23}\\,\\mathrm{1/mol}',
  ],
  [
    'VacuumPermittivity',
    ['Quantity', 8.8541878128e-12, ['Divide', 'F', 'm']],
    '8.854\\,187\\,812\\,8\\cdot10^{-12}\\,\\mathrm{F/m}',
  ],
  [
    'GravitationalConstant',
    [
      'Quantity',
      6.6743e-11,
      ['Divide', ['Power', 'm', 3], ['Multiply', 'kg', ['Power', 's', 2]]],
    ],
    '6.674\\,3\\cdot10^{-11}\\,\\mathrm{m^{3}/kg\\cdot s^{2}}',
  ],
  [
    'StefanBoltzmannConstant',
    [
      'Quantity',
      5.670374419e-8,
      ['Divide', 'W', ['Multiply', ['Power', 'm', 2], ['Power', 'K', 4]]],
    ],
    '5.670\\,374\\,419\\cdot10^{-8}\\,\\mathrm{W/m^{2}\\cdot K^{4}}',
  ],
  [
    'GasConstant',
    ['Quantity', 8.314462618, ['Divide', 'J', ['Multiply', 'mol', 'K']]],
    '8.314\\,462\\,618\\,\\mathrm{J/mol\\cdot K}',
  ],
];

/** The unit names that have a binding in the system scope or in the
 * current scope. */
function boundUnitNames(ce: ComputeEngine): string[] {
  const root = ce.contextStack[0].lexicalScope.bindings;
  const user = ce.context.lexicalScope.bindings;
  return UNIT_NAMES.filter((n) => root.has(n) || user.has(n));
}

describe('LIBRARY BOOTSTRAP DECLARES NO NAME', () => {
  test('a fresh engine has no auto-declared name in the system scope', () => {
    const ce = new ComputeEngine();
    expect(autoDeclaredNames(ce.contextStack[0].lexicalScope)).toEqual([]);
    expect(boundUnitNames(ce)).toEqual([]);
  });

  test('a unit name does not resolve on a fresh engine', () => {
    const ce = new ComputeEngine();
    for (const name of UNIT_NAMES)
      expect(ce.lookupDefinition(name)).toBeUndefined();
  });

  test.each(CONSTANTS)(
    '%s keeps its value and declares no unit name',
    (name, json, latex) => {
      const ce = new ComputeEngine();
      const expr = ce.symbol(name);
      const value = expr.evaluate();
      const approx = expr.N();
      expect(value.json).toEqual(json);
      expect(value.latex).toBe(latex);
      expect(approx.json).toEqual(json);
      expect(approx.latex).toBe(latex);
      expect(boundUnitNames(ce)).toEqual([]);
    }
  );

  test('arithmetic on the constants declares no unit name', () => {
    const ce = new ComputeEngine();
    // The quotient cancels `J` and rebuilds the unit `K·s`
    expect(
      ce.box(['Divide', 'PlanckConstant', 'BoltzmannConstant']).evaluate().json
    ).toEqual(['Quantity', 4.799243073366221e-11, ['Multiply', 'K', 's']]);
    expect(
      ce.box(['Multiply', 'PlanckConstant', 'SpeedOfLight']).N().json
    ).toEqual(['Quantity', 1.9864458571489286e-25, ['Multiply', 'J', 'm']]);
    expect(boundUnitNames(ce)).toEqual([]);
  });

  test('a user quantity declares no unit name', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('3\\,\\mathrm{km}').json).toEqual(['Quantity', 3, 'km']);
    expect(ce.box(['Quantity', 5, 'km/h']).json).toEqual([
      'Quantity',
      5,
      ['Divide', 'km', 'h'],
    ]);
    expect(
      ce.box(['UnitConvert', ['Quantity', 5, 'km'], 'm']).evaluate().json
    ).toEqual(['Quantity', 5000, 'm']);
    const user = ce.context.lexicalScope.bindings;
    for (const name of ['km', 'h', 'm']) expect(user.has(name)).toBe(false);
  });

  test('a free `K` is declared in the current scope and can be undeclared', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('K + 1').json).toEqual(['Add', 'K', 1]);
    expect(ce.context.lexicalScope.bindings.has('K')).toBe(true);
    expect(ce.contextStack[0].lexicalScope.bindings.has('K')).toBe(false);
    expect(() => ce.undeclare('K')).not.toThrow();
    expect(ce.lookupDefinition('K')).toBeUndefined();
  });
});
