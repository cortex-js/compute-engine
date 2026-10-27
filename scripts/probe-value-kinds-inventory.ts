/**
 * The phase-2 inventory of the value-kinds design
 * (`docs/plans/2026-10-26-value-kinds.md`, section 8).
 *
 *   npx tsx scripts/probe-value-kinds-inventory.ts            # all parts
 *   npx tsx scripts/probe-value-kinds-inventory.ts --part 2   # one part
 *
 * Prints markdown on stdout. The script only reads the source tree and
 * evaluates expressions in fresh engines; it changes no file.
 *
 * - Part 1 lists every site in `src/compute-engine/` that the plan's pattern
 *   finds (`Quantity`, `Measurement`, `isQuantity(`, …), grouped by the
 *   enclosing function (read from the TypeScript syntax tree), with what the
 *   site does and the hook it becomes under plan section 4.7. A group that
 *   the table `SITE_RULES` below does not classify is printed as
 *   `UNCLASSIFIED`, so a new site shows up at once.
 * - Part 2 walks the library operators of `src/math-json/OPERATORS.json`,
 *   finds each parameter that admits `real` (or `number`) once its absence
 *   arms are removed, probes a real and a complex measurement there (and two
 *   quantities), and states the answer the plan gives.
 * - Part 3 probes a measurement with an integer nominal at every parameter
 *   that does NOT admit `real`: each one that is admitted today is refused
 *   at boxing after phase 2.
 * - Part 4 counts the test and snapshot files that name a measurement or a
 *   quantity.
 * - Part 5 probes the comparisons and the extrema.
 *
 * The planned answers use the rules of plan sections 4.2 to 4.7; a row that
 * the plan does not decide is marked DECISION.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { ComputeEngine } from '../src/compute-engine';
import type { Expression } from '../src/compute-engine/global-types';
import type { FunctionSignature, Type } from '../src/common/type/types';
import { isSubtype } from '../src/common/type/subtype';
import {
  signatureArms,
  stripMissingFromType,
  resolveTypeAlias,
  collectionElementType,
} from '../src/common/type/utils';
import { readTypeVariablesAsBounds } from '../src/common/type/instantiate';
import { typeToString } from '../src/common/type/serialize';
import { unaryDerivativeFormula } from '../src/compute-engine/symbolic/derivative';
import { isApplySiteCall } from '../src/compute-engine/boxed-expression/apply-site';
import { declareUserMeasurement } from '../test/compute-engine/value-kinds-helpers';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

process.stdout.on('error', (err: { code?: string }) => {
  if (err.code === 'EPIPE') process.exit(0);
  throw err;
});

const args = process.argv.slice(2);
const onlyPart = args.includes('--part')
  ? Number(args[args.indexOf('--part') + 1])
  : undefined;
const wants = (n: number) => onlyPart === undefined || onlyPart === n;

// The engine prints a few diagnostics on the console for invalid input; they
// are not part of the inventory.
const quiet = <T>(f: () => T): T => {
  const saved = [console.warn, console.error, console.log];
  console.warn = console.error = console.log = () => {};
  try {
    return f();
  } finally {
    [console.warn, console.error, console.log] = saved;
  }
};

const cell = (s: string, max = 70): string => {
  const t = s.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
};

////////////////////////////////////////////////////////////////////////////////
// Part 1. The name-based sites
////////////////////////////////////////////////////////////////////////////////

/** The pattern of plan section 8, extended with the helper names that the
 * task lists. */
const SITE_PATTERN = [
  'Quantity',
  'Measurement',
  'isQuantity(',
  'isMeasurement(',
  'measurementNominal(',
  'measurementUnaryByHead(',
  'measurementArctan2(',
  'measurementLipschitzUnary(',
  'quantityCompare(',
  'compareQuantities(',
  'quantityAdd(',
  'quantityMultiply(',
  'quantityDivide(',
  'quantityPower(',
  'foldQuantityOperands(',
  'foldMeasurementOperands(',
].join('\\|');

/** Identifiers that the pattern above does not match (lowercase `m`) but
 * that are name-based measurement behavior. */
const EXTRA_PATTERN = 'measurementTypeOnTypes\\|export function measurementType(';

type Hit = { file: string; line: number; text: string };

function grep(pattern: string): Hit[] {
  let out = '';
  try {
    out = execFileSync(
      'grep',
      ['-rn', pattern, 'src/compute-engine', '--include=*.ts'],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 }
    );
  } catch (e) {
    out = (e as { stdout?: string }).stdout ?? '';
  }
  return out
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const m = /^([^:]+):(\d+):(.*)$/.exec(l)!;
      return {
        file: m[1].replace(/^src\/compute-engine\//, ''),
        line: Number(m[2]),
        text: m[3],
      };
    });
}

const SOURCES = new Map<string, ts.SourceFile>();
function sourceFile(file: string): ts.SourceFile {
  let sf = SOURCES.get(file);
  if (!sf) {
    sf = ts.createSourceFile(
      file,
      readFileSync(`${ROOT}/src/compute-engine/${file}`, 'utf8'),
      ts.ScriptTarget.Latest,
      true
    );
    SOURCES.set(file, sf);
  }
  return sf;
}

/** The chain of named declarations that contain the position `pos`:
 * `ARITHMETIC_LIBRARY.Floor.evaluate`, `quantityAdd`, `<import>`. */
function contextAt(sf: ts.SourceFile, pos: number): string {
  const names: string[] = [];
  const visit = (node: ts.Node) => {
    if (pos < node.getFullStart() || pos >= node.getEnd()) return;
    let name: string | undefined;
    if (
      (ts.isFunctionDeclaration(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        ts.isGetAccessor(node) ||
        ts.isPropertyAssignment(node) ||
        ts.isVariableDeclaration(node) ||
        ts.isInterfaceDeclaration(node) ||
        ts.isTypeAliasDeclaration(node) ||
        ts.isPropertySignature(node)) &&
      node.name
    )
      name = node.name.getText(sf);
    if (ts.isImportDeclaration(node)) name = '<import>';
    if (ts.isExportDeclaration(node)) name = '<export>';
    if (name) names.push(name);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return names.join('.') || '<top>';
}

/** True when the match on this line is in a comment. */
function isCommentLine(sf: ts.SourceFile, line: number, text: string): boolean {
  const t = text.trim();
  if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'))
    return true;
  // A code line with a trailing comment that holds the match.
  const code = text.replace(/\/\/.*$/, '');
  return !new RegExp(SITE_PATTERN.replace(/\\\|/g, '|').replace(/\(/g, '\\(')).test(
    code
  );
}

/**
 * The classification of a site group: what it does today and what it becomes
 * in phase 2. `file` and `ctx` are regular expressions on the file (relative
 * to `src/compute-engine/`) and on the context chain. The first rule that
 * matches wins.
 *
 * The hooks are those of plan section 4.3: `add`, `multiply`, `negate`,
 * `divide`, `power`, `compare` (with `eq`), `apply` at an operator,
 * `resultType`; "recognition" is the kind registry of section 4.6; "stays"
 * is code that is not kind behavior.
 */
type SiteRule = {
  file: RegExp;
  ctx: RegExp;
  does: string;
  becomes: string;
  /** The site is a name-based branch that phase 2 removes (or replaces by a
   * hook); `false` for code that stays. */
  removed: boolean;
};

const R = (
  file: string,
  ctx: string,
  does: string,
  becomes: string,
  removed = true
): SiteRule => ({
  file: new RegExp(`^${file}$`),
  ctx: new RegExp(`^(?:${ctx})$`),
  does,
  becomes,
  removed,
});

const SITE_RULES: SiteRule[] = [
  // measurement-arithmetic.ts
  R('library/measurement-arithmetic\\.ts', 'MeasurementExpr|isMeasurement', 'type guard on the head name `Measurement`', 'recognition: the kind registry (`isKindOperand`, 4.6)'),
  R('library/measurement-arithmetic\\.ts', 'toPair|square|makeMeasurement', 'internal helpers: (nominal, σ) pair; `makeMeasurement` collapses σ = 0 to the bare nominal', 'moves into the measurement hooks; the σ = 0 collapse is removed (4.7, section 6)'),
  R('library/measurement-arithmetic\\.ts', 'measurementAdd', 'quadrature sum of measurements and numbers', '`add` of the measurement kind'),
  R('library/measurement-arithmetic\\.ts', 'measurementMultiply', 'first-order product of measurements and numbers', '`multiply` of the measurement kind'),
  R('library/measurement-arithmetic\\.ts', 'foldMeasurementOperands(\\.cells)?', 're-dispatch after `addN`/`mulN` under `.N()` (a measurement that appears only once numericized), also per list cell', 'removed: the kind dispatch of `add`/`multiply` runs on the evaluated operands under `.N()` (4.4); the list-cell case needs a check in the broadcast'),
  R('library/measurement-arithmetic\\.ts', 'measurementDivide', 'first-order quotient', '`divide` of the measurement kind'),
  R('library/measurement-arithmetic\\.ts', 'measurementNegate', 'negation, σ kept', '`negate` of the measurement kind'),
  R('library/measurement-arithmetic\\.ts', 'measurementPower', 'first-order power (measurement base, exponent, or both)', '`power` of the measurement kind (also `Sqrt`, `Root`, `Square`, `Exp`)'),
  R('library/measurement-arithmetic\\.ts', 'measurementUnary|measurementSqrt|measurementRoot|measurementLn|measurementLog', 'generic `|f′(a)|·σ` propagation; drops σ where `f′` is undefined', '`power` (`Sqrt`, `Root`) and `apply` (`Ln`, `Log`); the drop of σ at a domain edge is a DECISION (see "Decisions needed")'),
  R('library/measurement-arithmetic\\.ts', 'measurementNominal', 'the nominal of a measurement, for a comparison or a step function', '`compare` (by nominal) and `apply` at the `Floor` family'),
  R('library/measurement-arithmetic\\.ts', 'measurementUnaryByHead', 'propagation through any unary head with a known derivative; `Factorial` as `Gamma(a + 1)`', '`apply` of the measurement kind (every unary operator with a derivative)'),
  R('library/measurement-arithmetic\\.ts', 'measurementArctan2', 'two-operand propagation for `Arctan2`', '`apply` at `Arctan2`'),
  R('library/measurement-arithmetic\\.ts', 'measurementLipschitzUnary', '`Real`, `Imaginary`, `Conjugate`, `Abs`: nominal mapped, σ kept', '`apply` at `Real`, `Imaginary`, `Conjugate`, `Abs`'),
  R('library/measurement-arithmetic\\.ts', 'measurementAffine', 'unit conversion of a measured magnitude (`x → f·x + c`)', 'stays: called by the quantity kind (conversion of a magnitude); may call the measurement hooks', false),

  // quantity-arithmetic.ts
  R('library/quantity-arithmetic\\.ts', '<import>', 'imports of the measurement helpers', 'follows the helpers'),
  R('library/quantity-arithmetic\\.ts', 'QuantityExpr|isQuantity', 'type guard on the head name `Quantity`', 'recognition: the kind registry (4.6)'),
  R('library/quantity-arithmetic\\.ts', 'quantityAdd|kelvinSum', 'sum of quantities: conversion to the first unit, offset temperatures', '`add` of the quantity kind, one fold per dimension (CE-508.3)'),
  R('library/quantity-arithmetic\\.ts', 'quantityMultiply', 'product of quantities and scalars; absorbs a measurement as magnitude', '`multiply` of the quantity kind (absorbs a measurement operand, 4.3)'),
  R('library/quantity-arithmetic\\.ts', 'foldQuantityOperands(\\.r)?', 're-dispatch after `addN`/`mulN` under `.N()`', 'removed: the kind dispatch under `.N()` (4.4)'),
  R('library/quantity-arithmetic\\.ts', 'quantityDivide|quantityDivideMeasurement', 'quotient of quantities; a dimensionless result is a number', '`divide` of the quantity kind; `resultType` `number | quantity`'),
  R('library/quantity-arithmetic\\.ts', 'quantityPower', 'power of a quantity (unit exponents)', '`power` of the quantity kind (`Power`, `Sqrt`, `Root`, `Square`); `resultType` `number | quantity`'),
  R('library/quantity-arithmetic\\.ts', 'unitSymbol|convertMagnitude|addMagnitudes|multiplyMagnitudes|divideMagnitudes|simplifyQuantityUnit|simplifyQuantityUnitMeasurement', 'internal helpers of the quantity arithmetic (magnitudes, units)', 'move with the quantity hooks'),

  // quantity-compare.ts
  R('library/quantity-compare\\.ts', '<import>', 'imports of `isMeasurement`, `measurementNominal`, `isQuantity`', 'follows the helpers'),
  R('library/quantity-compare\\.ts', 'QuantityCompareOptions|compareQuantities', 'order of two quantities after conversion (tolerance, exact and nominal options)', '`compare` of the quantity kind (engine tolerance for floats; the zero tolerance of the extrema is dropped)'),
  R('library/quantity-compare\\.ts', 'quantityDimensionsDiffer', 'two values of different dimensions (`2 m` and `2 s`, `2 m` and `2`)', '`eq` of the quantity kind (4.4)'),
  R('library/quantity-compare\\.ts', 'quantityOperands|quantityDimension', 'internal helpers of the comparison', 'move with `compare`'),

  // units.ts
  R('library/units\\.ts', '<import>', 'import of `isMeasurement`, `measurementAffine`', 'follows the helpers', false),
  R('library/units\\.ts', 'isSymbolicValue|usesExpressionArithmetic|affineMagnitude', 'choose expression or machine arithmetic for a magnitude (a measurement magnitude goes by expression)', 'stays: helpers of the quantity hooks and of `UnitConvert` (a measurement magnitude is detected by the registry)', false),
  R('library/units\\.ts', 'convertQuantity', 'conversion of a quantity to another unit', 'stays: `UnitConvert` (group 2, `value` parameters); used by `compare` after conversion', false),
  R('library/units\\.ts', 'UNITS_LIBRARY\\.Quantity', 'the definition of the head `Quantity`, `(value, value) -> value`', 'the kind head: `arithmetic` with `admittedAs: \'none\'`, result type `quantity` (section 6)'),
  R('library/units\\.ts', 'UNITS_LIBRARY\\.Quantity\\.(canonical|evaluate|evaluateAsync)', 'the constructor: canonical unit, evaluated magnitude', 'stays: constructor, not kind behavior', false),
  R('library/units\\.ts', 'UNITS_LIBRARY\\.(QuantityMagnitude|QuantityUnit|UnitConvert|UnitSimplify)(\\..*)?', 'unit operators over `value` parameters', 'stays: group 2 (a `value` parameter admits the kind type); the result type may name `quantity`', false),

  // arithmetic.ts
  R('library/arithmetic\\.ts', '<import>', 'imports of `foldQuantityOperands`, `isQuantity`, `foldMeasurementOperands`, `isMeasurement`', 'removed with the branches'),
  R('library/arithmetic\\.ts', 'evaluateGamma', 'measurement branch of `Gamma`', '`apply` at `Gamma`'),
  R('library/arithmetic\\.ts', 'ARITHMETIC_LIBRARY\\.(Ceil|Floor|Round|Truncate)\\.evaluate(\\.step|\\.original)?', 'a measurement rounds as its nominal (and the written operand is read through its nominal)', '`apply` at the `Floor` family, on the exact nominal (`ops.exact()`)'),
  R('library/arithmetic\\.ts', 'ARITHMETIC_LIBRARY\\.Divide\\.evaluate', 'quantity and measurement branches of `Divide`', '`divide` of each kind'),
  R('library/arithmetic\\.ts', 'ARITHMETIC_LIBRARY\\.Factorial\\.evaluate', 'measurement branch: `Gamma(a + 1)` propagation', '`apply` at `Factorial`'),
  R('library/arithmetic\\.ts', 'ARITHMETIC_LIBRARY\\.Fract\\.evaluate', 'measurement branch: `Fract` of the nominal, σ kept', '`apply` at `Fract`'),
  R('library/arithmetic\\.ts', 'ARITHMETIC_LIBRARY\\.(Ln|Log)\\.evaluate', 'measurement branch: `measurementLn`/`measurementLog`', '`apply` at `Ln`, `Log`'),
  R('library/arithmetic\\.ts', 'ARITHMETIC_LIBRARY\\.Mod\\.evaluate', 'a measurement operand stands for its nominal; the result is a bare number', '`apply` at `Mod`; the result is a DECISION (see "Decisions needed")'),
  R('library/arithmetic\\.ts', 'ARITHMETIC_LIBRARY\\.Negate\\.evaluate', 'quantity and measurement branches of `Negate`', '`negate` of each kind'),
  R('library/arithmetic\\.ts', 'ARITHMETIC_LIBRARY\\.Measurement(\\.examples)?', 'the definition of the head `Measurement`, `(value, value) -> value`, typed by its nominal', 'the kind head: `arithmetic` with `admittedAs: \'number\'`, result type `measurement` (section 6)'),
  R('library/arithmetic\\.ts', 'ARITHMETIC_LIBRARY\\.Measurement\\.(canonical|evaluate)', 'the constructor: σ = 0 collapses to the value, a unit on the error moves to the whole measurement', 'stays: constructor; the σ = 0 collapse here conflicts with "every hook returns a measurement" (DECISION)', false),
  R('library/arithmetic\\.ts', 'ARITHMETIC_LIBRARY\\.Power\\.evaluate', 'quantity and measurement branches of `Power`', '`power` of each kind'),
  R('library/arithmetic\\.ts', 'ARITHMETIC_LIBRARY\\.(Root|Sqrt)\\.evaluate', 'quantity and measurement branches of `Root`, `Sqrt`', '`power` of each kind (exponent `1/n`, `1/2`)'),
  R('library/arithmetic\\.ts', 'numericOfFold', 'a `Sum`/`Product` fold under `.N()` keeps a measurement, not the float of the exact value', 'generic: a kind value (by the registry) is kept; not a hook'),
  R('library/arithmetic\\.ts', 'evaluateAbs', 'measurement branch of `Abs` (Lipschitz)', '`apply` at `Abs` (measurement); `Abs` names `quantity` (4.7)'),
  R('library/arithmetic\\.ts', 'processMinMaxItem|scalarExtremum', '`Max`/`Min`: a measurement by its nominal, a quantity by its magnitude', '`compare` (one dispatch, 4.4)'),
  R('library/arithmetic\\.ts', 'addEvaluatedOperands', '`Add`: `quantityAdd`, then `measurementAdd`, then the `.N()` re-dispatch', '`add` of each kind through `kindSumOrProduct()`'),
  R('library/arithmetic\\.ts', 'mulEvaluatedOperands', '`Multiply`: `quantityMultiply`, then `measurementMultiply`, then the `.N()` re-dispatch', '`multiply` of each kind through `kindSumOrProduct()`'),
  R('library/arithmetic\\.ts', 'measurementTypeOnTypes|<import>\\.measurementTypeOnTypes', 'the `Measurement` call is typed by its nominal (`integer`, `real`, `complex`)', '`resultType`: the head is typed `measurement` (section 6)'),

  // type-handlers.ts (the extra pattern)
  R('library/type-handlers\\.ts', 'measurementType', 'the type of a `Measurement` call: the type of its nominal', 'removed: the head is typed `measurement` (section 6)'),

  // relational-operator.ts
  R('library/relational-operator\\.ts', 'quantityCompare|CHAIN_PAIR_IS_FALSE\\..*|decideEqual|decideNotEqual|decideLess|decideLessEqual|RELOP_LIBRARY\\.IdenticallyEqual\\.evaluate', 'the relational operators order two quantities, or a quantity and a number', '`compare` and `eq` of the quantity kind (4.4)'),
  R('library/relational-operator\\.ts', 'evaluateChainOperands(\\.ops|\\.stop)?|evaluateChainOperandsAsync', 'the relational operators replace each measurement operand by its nominal', '`compare` of the measurement kind (by nominal)'),
  R('library/relational-operator\\.ts', 'exactPairAtNearTie|exactQuantityPair|exactQuantityNumberPair|exactQuantityOf', 'near a tie under `.N()`, the exact magnitudes of two quantities decide', '`compare` of the quantity kind, reading `KindOperand.exact()`'),
  R('library/relational-operator\\.ts', 'nonRealKind', 'decides whether a value is a pole or non-real, reading the nominal of a numericized measurement', '`compare` (a kind value is not a non-real number; the kind decides)'),
  R('library/relational-operator\\.ts', 'undecidedCollectionComparison\\.unresolved', 'a quantity compared with a string is decided by dimensions, not kept as a possible collection', '`eq` of the quantity kind and the disjoint-type rule (4.4)'),

  // compare.ts, index.ts, the `.is()` methods
  R('boxed-expression/compare\\.ts', 'QuantityOrderFn|<top>|_setQuantityOrder|QuantityDimensionsDifferFn|_setQuantityDimensionsDiffer|quantityOrder|quantityComparableValue|quantityValue|cmp|exactOrder', 'the comparison methods and `exactOrder()` order quantities (injected `compareQuantities`) and measurements (nominal; unequal σ at a tie: no order)', '`compare` through `kind-compare.ts` (one order; a tie of two measurements is a tie, section 6)'),
  R('index\\.ts', '<import>|<top>', 'injects `compareQuantities` and `quantityDimensionsDiffer` into `compare.ts`', 'removed: the hooks live on the head definitions'),
  R('boxed-expression/abstract-boxed-expression\\.ts', '_BoxedExpression\\.is(\\..*)?', '`.is()`: a quantity against a number compares the comparable value', '`compare`: `.is()` through the `Equal` dispatch (4.4)'),
  R('boxed-expression/(boxed-number|boxed-symbol)\\.ts', 'Boxed(Number|Symbol)\\.is', '`.is()` delegates to the quantity side for symmetry', '`compare`: `.is()` through the `Equal` dispatch (4.4)'),

  // Other evaluation sites
  R('boxed-expression/boxed-function\\.ts', 'BoxedFunction\\._measurementNominal', '`re`, `im`, `bignumRe`, `bignumIm` of a measurement read its nominal', 'removed: a kind value answers `NaN`/`undefined` to the numeric queries (4.3); see "Decisions needed"'),
  R('library/collections\\.ts', 'withExactFoldFallback|withExactFoldFallbackAsync|machineStep', 'a fold under `.N()` keeps a measurement; a measurement is not machine-foldable', 'generic: a kind value (by the registry) is kept and not machine-folded; not a hook'),
  R('library/calculus\\.ts', 'measurementFromParts', 'numeric integration returns its result as a `Measurement`', 'stays: constructs a value, not kind behavior', false),
  R('library/library\\.ts', 'constantQuantity|STANDARD_LIBRARIES\\..*', 'the physical constants are built as quantities', 'stays: constructs values', false),
  R('library/trigonometry\\.ts', '<import>', 'imports of the measurement helpers', 'removed with the branches'),
  R('library/trigonometry\\.ts', 'TRIGONOMETRY_LIBRARY\\.(Arctan|Arctan2)\\.evaluate', 'measurement branches of `Arctan`, `Arctan2`', '`apply` at `Arctan`, `Arctan2`'),
  R('library/trigonometry\\.ts', 'angularQuantityToRadians|trigFunction\\.common\\.canonical', 'an angle quantity (`2 deg`) folds to radians at canonicalization', '`quantity` parameter of the trigonometric functions (4.7); the fold stays'),
  R('library/trigonometry\\.ts', 'trigFunction\\.common\\.evaluate', 'measurement branch of every trigonometric and hyperbolic head', '`apply` at the trigonometric family'),
  R('library/statistics\\.ts', '<import>', 'imports of the measurement helpers', 'removed with the branches'),
  R('library/statistics\\.ts', 'STATISTICS_LIBRARY\\.(Erf|Erfc)\\.evaluate', 'measurement branches of `Erf`, `Erfc`', '`apply` at `Erf`, `Erfc`'),
  R('library/statistics\\.ts', 'STATISTICS_LIBRARY\\.(Mean|Median|Variance|PopulationVariance|StandardDeviation|PopulationStandardDeviation)\\.evaluate', 'a list with a measurement element goes to `measurementStatistic`', '`apply` at a collection parameter (`ops.elements(i)`)'),
  R('library/statistics\\.ts', 'collectData(\\.isMeasurementDatum)?|measurementStatistic|sortByNominal\\.sorted|measurementVariance', 'collection of the data and the measurement statistics (median by nominal)', 'move into the `apply` of the measurement kind'),
  R('library/complex\\.ts', 'COMPLEX_LIBRARY\\.(Real|Imaginary|Conjugate)\\.evaluate', 'measurement branches (Lipschitz)', '`apply` at `Real`, `Imaginary`, `Conjugate`'),
  R('library/special-functions\\.ts', 'SPECIAL_FUNCTIONS_LIBRARY\\.LogGamma\\.evaluate', 'measurement branch of `LogGamma`', '`apply` at `LogGamma`'),
  R('boxed-expression/type-guards\\.ts', 'isInexactOperand|nanOperandAnswer', 'the NaN/Indeterminate rule reads the nominal of a measurement and the magnitude of a quantity', 'no hook in the plan: DECISION (see "Decisions needed")'),
  R('boxed-expression/validate\\.ts', 'checkNumericArgs', 'a `Quantity` operand is accepted at the arithmetic operators', 'removed: group-1 admission by rule (4.2)'),
  R('boxed-expression/invisible-operator\\.ts', 'canonicalJuxtaposition(\\.isMagnitude)?', 'a number (or a measurement) juxtaposed with a unit makes a `Quantity`', 'stays: parse sugar, not kind behavior', false),

  // Serialization and LaTeX
  R('numerics/strings\\.ts', 'roundMeasurementForDisplay', 'rounds a measurement for display', 'LaTeX/serialization: stays', false),
  R('boxed-expression/(ascii-math|serialize)\\.ts', '.*', 'ASCII-math and MathJSON serialization', 'LaTeX/serialization: stays', false),
  R('latex-syntax/.*', '.*', 'LaTeX parsing and serialization', 'LaTeX/serialization: stays', false),
];

type SiteGroup = {
  file: string;
  ctx: string;
  lines: number[];
  comment: boolean;
  rule?: SiteRule;
};

function siteGroups(): { hits: Hit[]; groups: SiteGroup[] } {
  const hits = [...grep(SITE_PATTERN), ...grep(EXTRA_PATTERN)];
  const seen = new Set<string>();
  const unique = hits.filter((h) => {
    const k = `${h.file}:${h.line}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const groups = new Map<string, SiteGroup>();
  for (const h of unique) {
    const sf = sourceFile(h.file);
    const pos =
      sf.getPositionOfLineAndCharacter(h.line - 1, 0) +
      Math.max(0, h.text.search(/\S/));
    const comment = isCommentLine(sf, h.line, h.text);
    const ctx = contextAt(sf, pos);
    const key = `${h.file}|${ctx}|${comment}`;
    let g = groups.get(key);
    if (!g) {
      g = { file: h.file, ctx, lines: [], comment };
      groups.set(key, g);
    }
    g.lines.push(h.line);
  }
  for (const g of groups.values())
    g.rule = SITE_RULES.find((r) => r.file.test(g.file) && r.ctx.test(g.ctx));
  return { hits: unique, groups: [...groups.values()] };
}

function part1(): string {
  const { hits, groups } = siteGroups();
  const code = groups.filter((g) => !g.comment);
  const comments = groups.filter((g) => g.comment);
  const codeLines = code.reduce((n, g) => n + g.lines.length, 0);
  const commentLines = comments.reduce((n, g) => n + g.lines.length, 0);
  const unclassified = code.filter((g) => !g.rule);
  const out: string[] = [];
  out.push('## Part 1. The name-based sites\n');
  out.push(
    `The pattern finds ${hits.length} lines in ${new Set(hits.map((h) => h.file)).size} files: ` +
      `${codeLines} lines of code in ${code.length} sites (a site is the enclosing ` +
      `function or definition), and ${commentLines} comment lines in ${comments.length} sites. ` +
      `Unclassified code sites: ${unclassified.length}.\n`
  );
  out.push('| File | Site | Lines | What it does today | Phase 2 |');
  out.push('| --- | --- | --- | --- | --- |');
  const byFile = [...code].sort(
    (a, b) => a.file.localeCompare(b.file) || a.lines[0] - b.lines[0]
  );
  for (const g of byFile) {
    out.push(
      `| \`${g.file}\` | \`${g.ctx}\` | ${g.lines.join(', ')} | ${cell(g.rule?.does ?? 'UNCLASSIFIED', 200)} | ${cell(g.rule?.becomes ?? 'UNCLASSIFIED', 200)} |`
    );
  }
  out.push('');
  out.push('### Comment lines\n');
  out.push(
    'Comment lines that name the heads. They are rewritten with the code they describe; a comment in a file that keeps its code (LaTeX, units) stays.\n'
  );
  const commentFiles = new Map<string, number[]>();
  for (const g of comments)
    commentFiles.set(g.file, [...(commentFiles.get(g.file) ?? []), ...g.lines]);
  out.push('| File | Comment lines |');
  out.push('| --- | --- |');
  for (const [f, ls] of [...commentFiles].sort((a, b) => a[0].localeCompare(b[0])))
    out.push(`| \`${f}\` | ${ls.length} (${ls.sort((a, b) => a - b).join(', ')}) |`);
  out.push('');
  out.push('### Sites that the phase-2 implementation removes, by file\n');
  out.push('| File | Code sites removed or replaced by a hook | Code lines | Sites that stay |');
  out.push('| --- | --- | --- | --- |');
  const perFile = new Map<string, { removed: number; lines: number; stays: number }>();
  for (const g of code) {
    const e = perFile.get(g.file) ?? { removed: 0, lines: 0, stays: 0 };
    if (g.rule?.removed !== false) {
      e.removed += 1;
      e.lines += g.lines.length;
    } else e.stays += 1;
    perFile.set(g.file, e);
  }
  let tr = 0,
    tl = 0,
    ts_ = 0;
  for (const [f, e] of [...perFile].sort((a, b) => b[1].removed - a[1].removed)) {
    out.push(`| \`${f}\` | ${e.removed} | ${e.lines} | ${e.stays} |`);
    tr += e.removed;
    tl += e.lines;
    ts_ += e.stays;
  }
  out.push(`| **Total** | **${tr}** | **${tl}** | **${ts_}** |`);
  out.push('');
  return out.join('\n');
}

////////////////////////////////////////////////////////////////////////////////
// Parts 2 and 3. The operators
////////////////////////////////////////////////////////////////////////////////

const GROUP_ONE: Record<string, string> = {
  Add: 'add',
  Subtract: 'add',
  Multiply: 'multiply',
  Negate: 'negate',
  Divide: 'divide',
  Power: 'power',
  Sqrt: 'power',
  Root: 'power',
  Square: 'power',
};
const COMPARE_OPS = new Set([
  'Equal',
  'NotEqual',
  'Less',
  'LessEqual',
  'Greater',
  'GreaterEqual',
  'Max',
  'Min',
  'Sort',
  'Clamp',
]);
const LIPSCHITZ_OPS = new Set(['Real', 'Imaginary', 'Conjugate', 'Abs']);
const STATISTICS_OPS = new Set([
  'Mean',
  'Median',
  'Variance',
  'PopulationVariance',
  'StandardDeviation',
  'PopulationStandardDeviation',
]);

/** `t` without its absence arms (`missing`, `nothing`). */
function withoutAbsence(t: Type): Type {
  const s = stripMissingFromType(t);
  if (typeof s !== 'object' || s.kind !== 'union') return s;
  const rest = s.types.filter((x) => x !== 'nothing');
  if (rest.length === s.types.length) return s;
  if (rest.length === 0) return 'never';
  return rest.length === 1 ? rest[0] : { kind: 'union', types: rest };
}

type ParamClass =
  | 'exempt' // value, any, expression, unknown: group 2
  | 'real' // admits real: group 3
  | 'collection-real' // a collection whose cells admit real
  | 'other'; // integer, a ranged type, boolean, string, …

const isExempt = (p: Type) =>
  p === 'value' || p === 'any' || p === 'expression' || p === 'unknown';

function cellsAdmitReal(p: Type, depth = 0): boolean {
  if (depth > 6) return false;
  const r = resolveTypeAlias(p);
  const arms = typeof r === 'object' && r.kind === 'union' ? r.types : [r];
  for (const arm of arms) {
    const e = collectionElementType(arm);
    if (e === undefined || e === 'any' || e === 'unknown') continue;
    const s = withoutAbsence(e);
    if (isSubtype('real', s)) return true;
    if (cellsAdmitReal(s, depth + 1)) return true;
  }
  return false;
}

function classify(param: Type): ParamClass {
  const p = withoutAbsence(param);
  if (isExempt(p)) return 'exempt';
  if (isSubtype('real', p)) return 'real';
  if (cellsAdmitReal(p)) return 'collection-real';
  return 'other';
}

/** The parameter types of `arm` at the positions of a probe call. */
function positions(arm: FunctionSignature): Type[] {
  const req = (arm.args ?? []).map((a) => a.type);
  if (req.length > 0) {
    if (arm.variadicArg && arm.variadicMin === 1) req.push(arm.variadicArg.type);
    return req;
  }
  if (arm.variadicArg) {
    const n = arm.variadicMin === 1 || (arm.optArgs ?? []).length === 0 ? 2 : 1;
    return Array(n).fill(arm.variadicArg.type);
  }
  return (arm.optArgs ?? []).slice(0, 1).map((a) => a.type);
}

/** Candidates for an operand that is not the probed one, in order. */
const CANDIDATES: unknown[] = [
  3,
  2,
  1,
  0,
  ['Rational', 1, 2],
  2.5,
  ['Complex', 2, 3],
  'True',
  "'a'",
  ['List', 1, 2, 3],
  ['List', ['List', 1, 2], ['List', 3, 4]],
  ['Tuple', 1, 2],
  ['Function', ['Multiply', 'x', 2], 'x'],
  ['Range', 1, 5],
  'x',
];

function fillerFor(ce: ComputeEngine, param: Type): unknown | undefined {
  const p = withoutAbsence(param);
  for (const c of CANDIDATES) {
    const t = quiet(() => ce.box(c as never)).type.type;
    if (isSubtype(t, p)) return c;
  }
  return undefined;
}

type Probe = {
  valid: boolean;
  type: string;
  evaluate: string;
  N: string;
  /** The operator of the canonical form (`Exp` boxes to `Power`). */
  canonicalOp?: string;
  /** `evaluate()` returned the canonical form unchanged. */
  unchanged: boolean;
  /** The result is an `Error` expression. */
  error: boolean;
  /** The canonical form has no `Quantity` although the input had one. */
  quantityFolded: boolean;
  /** For an invalid expression: the type the refusal expected and the
   * type it got (`number` / `umeasurement`). */
  refusal?: string;
  applySite?: boolean;
};

function probe(ce: ComputeEngine, json: unknown, applySite = false): Probe {
  return quiet(() => {
    let e: Expression;
    try {
      e = ce.box(json as never);
    } catch (err) {
      const m = `THROWS at boxing: ${(err as Error).message}`;
      return {
        valid: false,
        type: '',
        evaluate: m,
        N: m,
        unchanged: false,
        error: true,
        quantityFolded: false,
      };
    }
    let type: string;
    try {
      type = e.type.toString();
    } catch (err) {
      type = `THROWS: ${(err as Error).message.split('\n')[0]}`;
    }
    let evaluated: Expression | undefined;
    let evaluate: string;
    try {
      evaluated = e.evaluate();
      evaluate = evaluated.toString();
    } catch (err) {
      evaluate = `THROWS: ${(err as Error).message.split('\n')[0]}`;
    }
    let N: string;
    try {
      N = e.N().toString();
    } catch (err) {
      N = `THROWS: ${(err as Error).message.split('\n')[0]}`;
    }
    const canonical = JSON.stringify(e.json);
    // A random operator gives another value on each run: print a fixed
    // label, so that two runs of the script agree.
    if (
      Array.isArray(json) &&
      typeof json[0] === 'string' &&
      json[0].startsWith('Random') &&
      evaluated !== undefined &&
      JSON.stringify(evaluated.json) !== canonical
    )
      evaluate = N = '(a random value)';
    const refused =
      /"ErrorCode","'incompatible-type'","'([^']*)'","'([^']*)'"/.exec(canonical);
    return {
      refusal: refused ? `expected \`${refused[1]}\`, got \`${refused[2]}\`` : undefined,
      valid: e.isValid,
      type,
      evaluate,
      N,
      canonicalOp: e.operator,
      unchanged:
        evaluated !== undefined && JSON.stringify(evaluated.json) === canonical,
      error:
        evaluated === undefined ||
        evaluated.operator === 'Error' ||
        JSON.stringify(evaluated.json).includes('"Error"'),
      quantityFolded:
        JSON.stringify(json).includes('Quantity') &&
        !canonical.includes('Quantity'),
      applySite: applySite ? isApplySiteCall(e) : undefined,
    };
  });
}

const M_REAL = ['Measurement', 2.5, 0.1];
const M_COMPLEX = ['Measurement', ['Complex', 2, 3], 0.1];
const Q_M = ['Quantity', 2, 'm'];
const Q_DEG = ['Quantity', 2, 'deg'];
const U_REAL = ['UserMeasurement', 2.5, 0.1];

const fmt = (x: number): string =>
  Number.isFinite(x) ? String(Number(x.toPrecision(6))) : String(x);

const fmtComplex = (v: { re: number; im: number }): string =>
  Math.abs(v.im) > 1e-12
    ? `${fmt(v.re)} ${v.im < 0 ? '-' : '+'} ${fmt(Math.abs(v.im))}i`
    : fmt(v.re);

/** The numeric value of `e`, or `undefined` when it is not a finite number. */
function numeric(e: Expression): { re: number; im: number } | undefined {
  const n = quiet(() => e.N());
  if (!Number.isFinite(n.re)) return undefined;
  const im = Number.isFinite(n.im) ? n.im : 0;
  return { re: n.re, im };
}

/** The operators that jump at a point (CLAUDE.md, "Evaluate vs. N"): their
 * slope is zero almost everywhere, except `Fract` and the first operand of
 * `Mod`, whose slope is 1. */
const ZERO_SLOPE_OPS = new Set([
  'Floor',
  'Ceil',
  'Round',
  'Truncate',
  'Sign',
  'Heaviside',
  'PrimePi',
]);
const ELEMENT_EXTREMA = new Set(['ElementMax', 'ElementMin']);

type Plan = {
  answer: string;
  /** A short tag when the plan does not decide the answer. */
  decision?:
    | 'apply-unknown'
    | 'zero-slope'
    | 'unit-slope'
    | 'non-real'
    | 'edge'
    | 'element-extremum'
    | 'complex-nominal'
    | 'admission-gap';
};

/**
 * The planned answer for a measurement with nominal `a` (a real or complex
 * number) and uncertainty 0.1 as operand `at` of the operator `name`, under
 * plan sections 4.3, 4.4 and 4.7. `realOnly` is true when the parameter
 * does not admit a complex number. The value is computed with the
 * engine's derivative table (`unaryDerivativeFormula()`), as the `apply` of
 * the measurement kind will.
 */
function plan(
  name: string,
  info: OperatorInfo | undefined,
  at: number,
  arity: number,
  a: { re: number; im: number },
  realOnly: boolean
): Plan {
  const ce = new ComputeEngine();
  const complexNominal = Math.abs(a.im) > 0;
  if (GROUP_ONE[name]) return { answer: `\`${GROUP_ONE[name]}\` hook (group 1)` };
  if (COMPARE_OPS.has(name)) return { answer: '`compare` (Part 5)' };
  if (ELEMENT_EXTREMA.has(name))
    return {
      answer: 'an extremum: `compare` would decide it, but the plan lists only `Max`, `Min`, `Sort`, `Clamp`',
      decision: 'element-extremum',
    };
  if (!info) return { answer: 'unknown operator' };
  if (info.lazy)
    return { answer: 'admitted; the lazy handler sees the value (no `apply`, 4.2)' };
  if (!info.hasEvaluate) return { answer: 'admitted; unevaluated (no handler)' };
  if (complexNominal && realOnly)
    return { answer: '`incompatible-type` at evaluation (decision D)' };
  const nominal = complexNominal
    ? ce.function('Complex', [ce.number(a.re), ce.number(a.im)])
    : ce.number(a.re);
  if (LIPSCHITZ_OPS.has(name)) {
    const v = numeric(ce.function(name, [nominal]));
    if (name === 'Imaginary' && !complexNominal)
      return { answer: '`0` (σ on the real axis only; see the σ = 0 decision)' };
    return {
      answer: `\`${fmtComplex(v ?? { re: NaN, im: 0 })} ± 0.1\` (Lipschitz: σ kept)`,
    };
  }
  if (STATISTICS_OPS.has(name))
    return { answer: 'the measurement statistic of today, through `apply` with `ops.elements(0)`' };
  if (name === 'Arctan2' || name === 'Ln' || name === 'Log')
    return { answer: 'the propagation of today (`measurementArctan2`, `measurementLn`, `measurementLog`) through `apply`' };
  if (name === 'Fract' && arity === 1) {
    const v = numeric(ce.function('Fract', [nominal]));
    return { answer: `\`${fmtComplex(v ?? { re: NaN, im: 0 })} ± 0.1\` (today's branch: slope 1, σ kept)` };
  }
  if (name === 'Mod' && at === 0) {
    const v = numeric(ce.function('Mod', [nominal, ce.number(3)]));
    return {
      answer: `\`${fmtComplex(v ?? { re: NaN, im: 0 })} ± 0.1\` by first order (slope 1); today the bare nominal`,
      decision: 'unit-slope',
    };
  }
  if (ZERO_SLOPE_OPS.has(name) && arity === 1) {
    const v = numeric(ce.function(name, [nominal]));
    return {
      answer: `first order: \`${fmtComplex(v ?? { re: NaN, im: 0 })} ± 0\` (slope 0); plan section 3 keeps σ for \`Floor\``,
      decision: 'zero-slope',
    };
  }
  let head = name;
  let x = nominal;
  if (name === 'Factorial') {
    head = 'Gamma';
    x = ce.number(a.re + 1);
    if (complexNominal) x = ce.function('Complex', [ce.number(a.re + 1), ce.number(a.im)]);
  }
  if (arity === 1 || name === 'Factorial') {
    const d = quiet(() => unaryDerivativeFormula(ce, head, x));
    if (d !== undefined) {
      const dv = numeric(quiet(() => d.evaluate()));
      const v = numeric(ce.function(head, [x]));
      if (v === undefined || dv === undefined)
        return {
          answer: `no finite first-order answer: \`f(a)\` is ${quiet(() => ce.function(head, [x]).N().toString())}, \`f′(a)\` is ${quiet(() => d.evaluate().N().toString())}`,
          decision: 'edge',
        };
      const sigma = Math.hypot(dv.re, dv.im) * 0.1;
      const value = `\`${fmtComplex(v)} ± ${fmt(sigma)}\``;
      if (complexNominal)
        return { answer: `${value} (|f′(a)|·σ)`, decision: 'complex-nominal' };
      if (Math.abs(v.im) > 1e-12 || Math.abs(dv.im) > 1e-12)
        return {
          answer: `${value} (|f′(a)|·σ; the value is not real)`,
          decision: 'non-real',
        };
      return { answer: `${value} (first order${name === 'Factorial' ? ', `Gamma(a + 1)`' : ''})` };
    }
  }
  return {
    answer: 'unevaluated (`apply` does not know the operator)',
    decision: 'apply-unknown',
  };
}

type OperatorInfo = {
  name: string;
  signature: string;
  lazy: boolean;
  hasEvaluate: boolean;
  resultType: Type;
  arms: FunctionSignature[];
};

function operatorInfos(): {
  infos: OperatorInfo[];
  skipped: string[];
  finiteRealInJson: string[];
} {
  const json = JSON.parse(
    readFileSync(`${ROOT}/src/math-json/OPERATORS.json`, 'utf8')
  ) as { operators: { name: string; signature?: string }[] };
  const finiteRealInJson = json.operators
    .filter((o) => (o.signature ?? '').includes('finite_real'))
    .map((o) => o.name);
  const ce = new ComputeEngine();
  const infos: OperatorInfo[] = [];
  const skipped: string[] = [];
  for (const { name } of json.operators) {
    const def = ce.lookupDefinition(name);
    if (!def || !('operator' in def)) {
      skipped.push(name);
      continue;
    }
    const op = def.operator as unknown as Record<string, unknown>;
    const sigBox = op.signature as { type: Type; toString(): string } | undefined;
    const sig = sigBox?.type;
    const arms = signatureArms(sig ? readTypeVariablesAsBounds(sig) : undefined);
    if (!arms) {
      skipped.push(name);
      continue;
    }
    infos.push({
      name,
      signature: sigBox!.toString(),
      lazy: op.lazy === true,
      hasEvaluate: typeof op.evaluate === 'function',
      resultType: arms[0].result,
      arms: [...arms],
    });
  }
  return { infos, skipped, finiteRealInJson };
}

/** `json` with its first number leaf replaced by `operand`. */
function replaceFirstLeaf(json: unknown, operand: unknown): [unknown, boolean] {
  if (typeof json === 'number') return [operand, true];
  if (!Array.isArray(json)) return [json, false];
  const out: unknown[] = [json[0]];
  let done = false;
  for (const x of json.slice(1)) {
    if (done) {
      out.push(x);
      continue;
    }
    const [y, d] = replaceFirstLeaf(x, operand);
    out.push(y);
    done = d;
  }
  return [out, done];
}

/** A call of `name` with `operand` at position `at` (inside a collection of
 * the shape the parameter wants when `inCollection`), and a sample operand
 * that fits at every other position. */
function buildCall(
  ce: ComputeEngine,
  name: string,
  types: Type[],
  at: number,
  operand: unknown,
  inCollection: boolean
): unknown[] | undefined {
  const call: unknown[] = [name];
  for (let i = 0; i < types.length; i++) {
    if (i === at) {
      if (!inCollection) call.push(operand);
      else {
        const shape = fillerFor(ce, types[i]);
        const [c, done] =
          shape === undefined ? [undefined, false] : replaceFirstLeaf(shape, operand);
        call.push(done ? c : ['List', operand, 3]);
      }
      continue;
    }
    const f = fillerFor(ce, types[i]);
    if (f === undefined) return undefined;
    call.push(f);
  }
  return call;
}

function isNumericResult(t: Type): boolean {
  const s = withoutAbsence(t);
  return s !== 'never' && isSubtype(s, 'number');
}

type Part2Row = {
  name: string;
  signature: string;
  position: number;
  arity: number;
  paramClass: ParamClass;
  param: string;
  real: Probe;
  complex: Probe;
  user: Probe;
  qm: Probe;
  qdeg: Probe;
  planReal: Plan;
  planComplex: Plan;
  planType: string;
  /** Today computes a value (not unchanged, not an error) and the plan
   * leaves the call unevaluated. */
  regression: boolean;
};

type Part3Row = {
  name: string;
  signature: string;
  position: number;
  param: string;
  operand: string;
  today: Probe;
  user: Probe;
};

/** Nominals tried for the refusal probe of Part 3, in order. */
const PART3_NOMINALS: unknown[] = [5, 1, 0, ['Rational', 1, 2], 0.5, -1, 2.5];

function parts2and3(infos: OperatorInfo[]): {
  part2: Part2Row[];
  part3: Part3Row[];
  notBuilt: string[];
} {
  const part2: Part2Row[] = [];
  const part3: Part3Row[] = [];
  const notBuilt: string[] = [];
  const byName = new Map(infos.map((i) => [i.name, i]));
  for (const info of infos) {
    // Part 2: the first arm and position whose parameter admits `real`,
    // else whose collection cells admit `real`.
    let found:
      | { types: Type[]; at: number; cls: ParamClass }
      | undefined;
    for (const cls of ['real', 'collection-real'] as const) {
      for (const arm of info.arms) {
        const types = positions(arm);
        const at = types.findIndex((t) => classify(t) === cls);
        if (at >= 0) {
          found = { types, at, cls };
          break;
        }
      }
      if (found) break;
    }
    if (found) {
      const today = new ComputeEngine();
      const model = new ComputeEngine();
      declareUserMeasurement(model);
      const inCollection = found.cls === 'collection-real';
      const call = (operand: unknown, ce = today) =>
        buildCall(ce, info.name, found!.types, found!.at, operand, inCollection);
      const callR = call(M_REAL);
      const callU = call(U_REAL, model);
      if (!callR || !callU) {
        notBuilt.push(`\`${info.name}\` (\`${info.signature}\`)`);
      } else {
        process.stderr.write(`${info.name} `);
        const real = probe(today, callR);
        const complex = probe(new ComputeEngine(), call(M_COMPLEX));
        const user = probe(model, callU, true);
        const qm = probe(new ComputeEngine(), call(Q_M));
        const qdeg = probe(new ComputeEngine(), call(Q_DEG));
        // A head that canonicalizes to another (`Exp` to `Power`, `Log10`
        // to `Log`) is planned as that head.
        const head =
          real.valid && real.canonicalOp && real.canonicalOp !== info.name
            ? real.canonicalOp
            : info.name;
        const headInfo = byName.get(head);
        const p = withoutAbsence(found.types[found.at]);
        const realOnly = !inCollection && !isSubtype('complex', p);
        const arity = found.types.length;
        // The phase-1 machinery (the model kind) says whether the call is
        // admitted and whether it is an apply site: an admitted call that is
        // not an apply site runs the operator's own handler.
        const byHooksOrCompare =
          GROUP_ONE[head] !== undefined ||
          COMPARE_OPS.has(head) ||
          headInfo?.lazy === true ||
          headInfo?.hasEvaluate === false;
        let planReal: Plan;
        if (!user.valid && real.valid)
          planReal = {
            answer: `REFUSED at boxing by the phase-1 admission (${user.refusal ?? 'invalid'}), although the parameter admits \`real\``,
            decision: 'admission-gap',
          };
        else if (byHooksOrCompare)
          planReal = plan(head, headInfo, found.at, arity, { re: 2.5, im: 0 }, realOnly);
        else if (user.valid && user.applySite === false)
          planReal = {
            answer: 'not an apply site (phase-1 rule): the handler runs and sees the value, as today',
          };
        else if (inCollection && !STATISTICS_OPS.has(head))
          planReal = {
            answer: 'collection parameter: `apply` with `ops.elements(i)`; unevaluated unless `apply` knows the operator',
            decision: 'apply-unknown',
          };
        else
          planReal = plan(head, headInfo, found.at, arity, { re: 2.5, im: 0 }, realOnly);
        const planComplex = inCollection
          ? { answer: 'as for a real nominal (collection parameter)' }
          : plan(head, headInfo, found.at, arity, { re: 2, im: 3 }, realOnly);
        const planType = isNumericResult(info.resultType)
          ? 'measurement'
          : `${typeToString(info.resultType)} (declared, 4.5 rule 4)`;
        part2.push({
          name: info.name,
          signature: info.signature,
          position: found.at,
          arity,
          paramClass: found.cls,
          param: typeToString(found.types[found.at]),
          real,
          complex,
          user,
          qm,
          qdeg,
          planReal:
            head === info.name
              ? planReal
              : { ...planReal, answer: `(canonical \`${head}\`) ${planReal.answer}` },
          planComplex,
          planType,
          regression:
            planReal.decision === 'apply-unknown' &&
            real.valid &&
            !real.unchanged &&
            !real.error,
        });
      }
    }
    // Part 3: every position whose parameter admits `real` in NO arm, is not
    // exempt, and admits a number or a collection of numbers that a
    // measurement nominal can stand for today.
    if (GROUP_ONE[info.name] || COMPARE_OPS.has(info.name)) continue;
    const types0 = positions(info.arms[0]);
    for (let at = 0; at < types0.length; at++) {
      const admitsSomewhere = info.arms.some((a) => {
        const t = positions(a)[at];
        return t !== undefined && classify(t) !== 'other';
      });
      if (admitsSomewhere) continue;
      const p = withoutAbsence(types0[at]);
      const element = (() => {
        const e = collectionElementType(resolveTypeAlias(p));
        return e === undefined || e === 'any' || e === 'unknown'
          ? undefined
          : withoutAbsence(e);
      })();
      const ce = new ComputeEngine();
      const nominal = PART3_NOMINALS.find((n) => {
        const t = quiet(() => ce.box(n as never)).type.type;
        return isSubtype(t, p) || (element !== undefined && isSubtype(t, element));
      });
      if (nominal === undefined) continue;
      const inCollection = !isSubtype(quiet(() => ce.box(nominal as never)).type.type, p);
      const m = ['Measurement', nominal, 0.1];
      const callM = buildCall(ce, info.name, types0, at, m, inCollection);
      const model = new ComputeEngine();
      declareUserMeasurement(model);
      const callU = buildCall(model, info.name, types0, at, ['UserMeasurement', nominal, 0.1], inCollection);
      if (!callM || !callU) continue;
      process.stderr.write(`[3]${info.name} `);
      const t = probe(new ComputeEngine(), callM);
      if (!t.valid) continue;
      part3.push({
        name: info.name,
        signature: info.signature,
        position: at,
        param: typeToString(types0[at]),
        operand: quiet(() => ce.box(m as never).toString()),
        today: t,
        user: probe(model, callU),
      });
    }
  }
  process.stderr.write('\n');
  return { part2, part3, notBuilt };
}

/** The edge cases of plan section 6, with the answer this inventory
 * proposes (see "Decisions needed" in the inventory document). */
const EDGE_CASES: [unknown, string][] = [
  [['Sqrt', ['Measurement', 0, 0.1]], 'f′ infinite at the nominal: DECISION (proposed: unevaluated, the `power` hook declines)'],
  [['Arcsin', ['Measurement', 1, 0.1]], 'f′ infinite at the nominal: DECISION (proposed: unevaluated)'],
  [['Ln', ['Measurement', 0, 0.1]], 'f(a) is −∞: DECISION (proposed: unevaluated)'],
  [['Ln', ['Measurement', -1, 0.1]], 'complex value `iπ`, f′ = −1: DECISION (proposed: `iπ ± 0.1`, |f′(a)|·σ)'],
  [['Arccos', ['Measurement', 2.5, 0.1]], 'complex value: DECISION (proposed: `1.5668i ± 0.0436`, |f′(a)|·σ)'],
  [['Gamma', ['Measurement', 0, 0.1]], 'pole: DECISION (proposed: unevaluated)'],
  [['Tan', ['Measurement', ['Divide', 'Pi', 2], 0.1]], 'pole: DECISION (proposed: unevaluated)'],
  [['Cos', ['Measurement', 0, 0.1]], 'plan section 6: `1 ± 0` (conflicts with the σ = 0 collapse of the constructor: DECISION)'],
  [['Power', 1, ['Measurement', 2, 0.1]], 'plan section 6: `1 ± 0` (same conflict)'],
  [['Abs', ['Measurement', 0, 0.1]], '`0 ± 0.1` (Lipschitz; no change)'],
  [['Sign', ['Measurement', 0, 0.1]], 'jump at the nominal: DECISION (proposed: unevaluated)'],
  [['Sign', ['Measurement', 5, 0.1]], 'first order `1 ± 0`: DECISION (zero slope)'],
  [['Round', ['Measurement', 2.5, 0.1]], 'first order `3 ± 0`: DECISION (zero slope; `Round(2.5)` is 3 today)'],
  [['Floor', ['Measurement', 2.95, 0.1]], 'first order `2 ± 0`, although `2.95 ± 0.1` crosses 3: DECISION (zero slope)'],
  [['Floor', ['Measurement', 2.5, 0.1]], 'plan section 3: `Measurement(2, 0.1)`; first order `2 ± 0`: DECISION'],
  [['Mod', ['Measurement', 5, 0.1], 3], 'plan section 6 lists it; first order `2 ± 0.1` (slope 1): DECISION'],
  [['Mod', 7, ['Measurement', 3, 0.1]], 'second operand: slope −⌊a/b⌋ = −2, first order `1 ± 0.2`: DECISION'],
  [['Fract', ['Measurement', 2.5, 0.01]], '`0.5 ± 0.01` (slope 1; no change)'],
  [['Clamp', ['Measurement', 5, 0.1], 0, 3], '`3`, the bound as written (4.4; no change)'],
  [['Factorial', ['Measurement', 5, 0.1]], '`120 ± 20.47…` (`Gamma(a + 1)`; no change)'],
  [['Factorial', ['Measurement', -1, 0.1]], 'pole of `Gamma(a + 1)`: DECISION (proposed: unevaluated)'],
];

function renderParts2and3(
  infos: OperatorInfo[],
  skipped: string[],
  finiteRealInJson: string[],
  r: ReturnType<typeof parts2and3>
): string {
  const out: string[] = [];
  const { part2, part3 } = r;
  const flag = (p: Plan, x?: Part2Row) =>
    p.decision === 'apply-unknown'
      ? x?.regression
        ? 'REGRESSION'
        : ''
      : p.decision
        ? `DECISION (${p.decision})`
        : '';
  const today = (p: Probe) =>
    !p.valid
      ? `refused at boxing: ${cell(p.evaluate, 40)}`
      : p.unchanged
        ? 'unchanged'
        : cell(p.evaluate, 55);
  out.push('## Part 2. The operators whose parameter admits `real`\n');
  out.push(
    `Operators read from \`src/math-json/OPERATORS.json\`: ${infos.length + skipped.length}; ` +
      `with a function signature in a fresh engine: ${infos.length}; ` +
      `with a parameter that admits \`real\` (or a collection of reals): ${part2.length + r.notBuilt.length}; ` +
      `probed: ${part2.length}. ` +
      `Signatures in \`OPERATORS.json\` that spell \`finite_real\`: ${finiteRealInJson.length} ` +
      `(the type parser reads \`finite_real\` as \`real\`, so a live signature never carries it).\n`
  );
  if (r.notBuilt.length)
    out.push(
      `Not probed (no sample operand fits another required parameter): ${r.notBuilt.join(', ')}.\n`
    );
  out.push(
    'Probes: `M = Measurement(2.5, 0.1)` and `Mc = Measurement(Complex(2, 3), 0.1)` at the first parameter that admits `real` ' +
      '(as the first cell of a sample collection for a collection parameter); every other operand is the first of `3, 2, 1, 0, 1/2, 2.5, …` that fits its parameter. ' +
      '"Model" is the phase-1 test kind `UserMeasurement(2.5, 0.1)` (`admittedAs: \'number\'`, ' +
      '`test/compute-engine/value-kinds-helpers.ts`): its admission is what phase 2 gives a measurement, and "apply" says the call is an apply site. ' +
      '"unchanged" means that `evaluate()` returned the canonical form. ' +
      'REGRESSION: today computes a value and the plan leaves the call unevaluated (`apply` does not know the operator). ' +
      'DECISION: the plan does not decide the answer (see "Decisions needed").\n'
  );
  out.push('### 2a. Real measurement `M = Measurement(2.5, 0.1)`\n');
  out.push('| Operator | Param | Type today | `evaluate()` today | `.N()` today | Model | Planned `evaluate()` | Planned type | Flag |');
  out.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const x of part2) {
    out.push(
      `| \`${x.name}\` | ${x.position}: \`${cell(x.param, 30)}\` | ${x.real.valid ? cell(x.real.type, 28) : '—'} | ${today(x.real)} | ${x.real.valid && !x.real.unchanged ? cell(x.real.N, 40) : ''} | ${x.user.valid ? 'admitted' : 'REFUSED'}${x.user.applySite ? ', apply' : ''} | ${cell(x.planReal.answer, 110)} | ${cell(x.planType, 40)} | ${flag(x.planReal, x)} |`
    );
  }
  out.push('');
  out.push('### 2b. Complex measurement `Mc = Measurement(Complex(2, 3), 0.1)`\n');
  out.push('| Operator | Param | `evaluate()` today | Planned | Flag |');
  out.push('| --- | --- | --- | --- | --- |');
  for (const x of part2)
    out.push(
      `| \`${x.name}\` | \`${cell(x.param, 30)}\` | ${today(x.complex)} | ${cell(x.planComplex.answer, 100)} | ${x.planComplex.decision && x.planComplex.decision !== 'apply-unknown' ? `DECISION (${x.planComplex.decision})` : ''} |`
    );
  out.push('');
  out.push('### 2c. Edge cases\n');
  out.push('| Call | Valid | Type today | `evaluate()` today | `.N()` today | Proposed answer |');
  out.push('| --- | --- | --- | --- | --- | --- |');
  for (const [json, planned] of EDGE_CASES) {
    const p = probe(new ComputeEngine(), json);
    out.push(
      `| \`${JSON.stringify(json)}\` | ${p.valid ? 'yes' : 'NO'} | ${cell(p.type, 30)} | ${cell(p.evaluate, 50)} | ${cell(p.N, 40)} | ${planned} |`
    );
  }
  out.push('');
  out.push('### 2d. Quantities at a parameter that admits `real`\n');
  out.push(
    '`Quantity(2, m)` and `Quantity(2, deg)` at the same parameter, in the rows where today does something with them. A quantity is `admittedAs: \'none\'`: after phase 2 every row of this table is refused at boxing unless the operator names `quantity` in its parameter (group 2). "folded" means that canonicalization removed the `Quantity` head (an angle converted to radians).\n'
  );
  const byNameForQ = new Map(infos.map((i) => [i.name, i]));
  out.push('| Operator | `2 m` today | `2 deg` today | Kind of special case |');
  out.push('| --- | --- | --- | --- |');
  for (const x of part2) {
    if (GROUP_ONE[x.name] || COMPARE_OPS.has(x.name)) continue;
    const q = (p: Probe) =>
      !p.valid
        ? 'refused'
        : p.quantityFolded
          ? `folded: ${cell(p.evaluate, 40)}`
          : p.unchanged
            ? 'unchanged'
            : cell(p.evaluate, 45);
    const active = (p: Probe) => p.valid && (p.quantityFolded || !p.unchanged);
    if (!active(x.qm) && !active(x.qdeg)) continue;
    const kind = byNameForQ.get(x.name)?.lazy
      ? 'held operands (lazy operator)'
      : x.qdeg.quantityFolded && !x.qm.quantityFolded
      ? 'angle fold at canonicalization'
      : x.qm.error || x.qdeg.error
        ? 'error'
        : ELEMENT_EXTREMA.has(x.name)
          ? 'comparison'
          : 'arithmetic in the handler or the canonical form';
    out.push(`| \`${x.name}\` | ${q(x.qm)} | ${q(x.qdeg)} | ${kind} |`);
  }
  out.push('');
  const validQ = part2.filter(
    (x) => !GROUP_ONE[x.name] && !COMPARE_OPS.has(x.name) && x.qm.valid
  ).length;
  out.push(
    `Quantity \`2 m\` admitted at boxing today at ${validQ} of the ${part2.length} probed operators (a quantity is typed \`value\`, which the numeric parameters accept).\n`
  );
  out.push('### 2e. Phase-1 admission gaps\n');
  out.push(
    'The calls that admit a measurement today and that the phase-1 admission refuses for the model kind (`admittedAs: \'number\'`), although the parameter admits `real` (plan 4.2, group 3). Each one would be refused at boxing after phase 2.\n'
  );
  out.push('| Operator | Signature | Refusal of the model kind | `evaluate()` today |');
  out.push('| --- | --- | --- | --- |');
  const gaps = part2.filter((x) => x.planReal.decision === 'admission-gap');
  for (const x of gaps)
    out.push(
      `| \`${x.name}\` | \`${cell(x.signature, 60)}\` | ${x.user.refusal ?? 'invalid'} | ${today(x.real)} |`
    );
  out.push('');
  out.push('### 2f. Summary of Part 2\n');
  const tally = new Map<string, string[]>();
  for (const x of part2) {
    const k =
      x.planReal.decision === 'apply-unknown'
        ? x.regression
          ? 'REGRESSION: today computes a value, `apply` would not know the operator'
          : 'unevaluated today and after (or an error today)'
        : x.planReal.decision
          ? `DECISION (${x.planReal.decision})`
          : 'decided by the plan';
    tally.set(k, [...(tally.get(k) ?? []), `\`${x.name}\``]);
  }
  out.push('| Class (real measurement) | Count | Operators |');
  out.push('| --- | --- | --- |');
  for (const [k, v] of [...tally].sort((a, b) => a[0].localeCompare(b[0])))
    out.push(`| ${k} | ${v.length} | ${v.join(', ')} |`);
  out.push('');
  const ctally = new Map<string, string[]>();
  for (const x of part2) {
    const d = x.planComplex.decision;
    if (!d || d === 'apply-unknown') continue;
    ctally.set(d, [...(ctally.get(d) ?? []), `\`${x.name}\``]);
  }
  out.push('| Class (complex measurement) | Count | Operators |');
  out.push('| --- | --- | --- |');
  for (const [k, v] of ctally) out.push(`| DECISION (${k}) | ${v.length} | ${v.join(', ')} |`);
  const dRefused = part2.filter(
    (x) => x.complex.valid && x.planComplex.answer.startsWith('`incompatible-type`')
  );
  out.push(
    `| \`incompatible-type\` at evaluation (decision D), admitted at boxing today | ${dRefused.length} | ${dRefused.map((x) => `\`${x.name}\``).join(', ')} |`
  );
  out.push('');
  out.push('## Part 3. The parameters that refuse a measurement after phase 2\n');
  out.push(
    `Every parameter that admits \`real\` in no arm (and is not \`value\`, \`any\`, \`expression\`, \`unknown\`), probed with a measurement whose nominal fits it (\`Measurement(5, 0.1)\` is typed \`integer\` today). ` +
      `Rows: ${part3.length} parameters of ${new Set(part3.map((x) => x.name)).size} operators that admit the measurement today. ` +
      `"Model" is the same probe with \`UserMeasurement\`: "refused" is the phase-2 answer.\n`
  );
  out.push('| Operator | Param | Probe | Type today | `evaluate()` today | Model |');
  out.push('| --- | --- | --- | --- | --- | --- |');
  for (const x of part3)
    out.push(
      `| \`${x.name}\` | ${x.position}: \`${cell(x.param, 40)}\` | ${cell(x.operand, 20)} | ${cell(x.today.type, 25)} | ${x.today.unchanged ? 'unchanged' : cell(x.today.evaluate, 55)} | ${x.user.valid ? 'ADMITTED' : 'refused'} |`
    );
  out.push('');
  const computes = part3.filter((x) => !x.today.unchanged && !x.today.error);
  out.push(
    `Of these, ${computes.length} compute a value today (the others stay unchanged or answer an error): ${[...new Set(computes.map((x) => `\`${x.name}\``))].join(', ')}.\n`
  );
  return out.join('\n');
}

////////////////////////////////////////////////////////////////////////////////
// Part 4. The snapshot risk
////////////////////////////////////////////////////////////////////////////////

function part4(): string {
  const sh = (cmd: string) =>
    execFileSync('sh', ['-c', cmd], { cwd: ROOT, encoding: 'utf8' }).trim();
  const tests = sh(
    "grep -l 'Measurement\\|Quantity' test/compute-engine/*.test.ts | wc -l"
  );
  const snaps = sh(
    "grep -rl 'Measurement\\|Quantity' test/compute-engine/__snapshots__ | wc -l"
  );
  const allTests = sh(
    "grep -rl 'Measurement\\|Quantity' test --include='*.ts' | wc -l"
  );
  const occurrences = sh(
    "grep -o 'Measurement\\|Quantity' test/compute-engine/*.test.ts | wc -l"
  );
  const snapFiles = sh("find test -name '*.snap' | wc -l");
  const docs = sh(
    "grep -rl 'Measurement\\|Quantity' src/epsil doc docs/TYPE-SYSTEM.md --include='*.md' --include='*.ts' 2>/dev/null | wc -l"
  );
  // Per test file that names a head: the lines that name one, the type
  // reads (`.type.toString()`, `.type.matches(`, `.type)`), the inline
  // snapshots, and the numeric reads `.re`/`.im` (a kind value answers
  // `NaN` after phase 2, plan 4.3).
  const files = sh(
    "grep -rl 'Measurement\\|Quantity' test --include='*.test.ts'"
  ).split('\n');
  const count = (re: RegExp, text: string) => (text.match(re) ?? []).length;
  const rows = files.map((f) => {
    const text = readFileSync(`${ROOT}/${f}`, 'utf8');
    return {
      f,
      heads: count(/Measurement|Quantity/g, text),
      types: count(/\.type(\.toString\(\)|\.matches\(|\)|\.type\b)/g, text),
      inline: count(/toMatchInlineSnapshot\(/g, text),
      numeric: count(/\.(re|im)\b(?!\w)/g, text),
    };
  });
  rows.sort((a, b) => b.heads - a.heads);
  const sum = (k: 'heads' | 'types' | 'inline' | 'numeric') =>
    rows.reduce((n, r) => n + r[k], 0);
  const out: string[] = [];
  out.push('## Part 4. The snapshot risk\n');
  out.push(
    'The repository keeps most snapshots INLINE (`toMatchInlineSnapshot`), so the risk is in the test files themselves; the `.snap` files hold none of the two heads.\n'
  );
  out.push('| Count | Value |');
  out.push('| --- | --- |');
  out.push(`| \`test/compute-engine/*.test.ts\` files that name \`Measurement\` or \`Quantity\` | ${tests} |`);
  out.push(`| All \`.test.ts\` files under \`test/\` that name them | ${files.length} (all \`.ts\` files: ${allTests}) |`);
  out.push(`| \`.snap\` files in the repository / those that name a head | ${snapFiles} / ${snaps} |`);
  out.push(`| Occurrences of the two names in \`test/compute-engine/*.test.ts\` | ${occurrences} |`);
  out.push(`| Type reads (\`.type.toString()\`, \`.type.matches(\`) in those files | ${sum('types')} |`);
  out.push(`| Inline snapshots in those files | ${sum('inline')} |`);
  out.push(`| \`.re\`/\`.im\` reads in those files | ${sum('numeric')} |`);
  out.push(`| Files under \`src/epsil\`, \`doc/\` and \`docs/TYPE-SYSTEM.md\` that name them | ${docs} |`);
  out.push('');
  out.push(
    'Per file (a type read or an inline snapshot in a file that names a head is a candidate change; not every one is on a measurement or a quantity):\n'
  );
  out.push('| File | Occurrences of a head | Type reads | Inline snapshots | `.re`/`.im` reads |');
  out.push('| --- | --- | --- | --- | --- |');
  for (const r of rows)
    out.push(`| \`${r.f}\` | ${r.heads} | ${r.types} | ${r.inline} | ${r.numeric} |`);
  out.push('');
  return out.join('\n');
}

////////////////////////////////////////////////////////////////////////////////
// Part 5. Comparisons and extrema
////////////////////////////////////////////////////////////////////////////////

type Pair = {
  label: string;
  a: unknown;
  b: unknown;
  /** The planned `compare(a, b)` (section 4.4): by nominal for a
   * measurement, after conversion for a quantity, with the engine tolerance
   * for floats. */
  cmp: -1 | 0 | 1 | undefined;
  /** The planned `eq` answer when `cmp` is undefined. */
  eq?: boolean;
  note?: string;
};

const PAIRS: Pair[] = [
  { label: 'two measurements', a: ['Measurement', 2, 0.1], b: ['Measurement', 3, 0.2], cmp: -1 },
  { label: 'measurement, number', a: ['Measurement', 2, 0.1], b: 3, cmp: -1 },
  { label: 'measurement = its nominal', a: ['Measurement', 2, 0.1], b: 2, cmp: 0 },
  { label: 'equal nominals, other σ', a: ['Measurement', 1, 0.1], b: ['Measurement', 1, 0.5], cmp: 0, note: 'section 6: `Max` is the first' },
  { label: 'equal nominals, other σ, reversed', a: ['Measurement', 1, 0.5], b: ['Measurement', 1, 0.1], cmp: 0 },
  { label: 'float nominals within tolerance', a: ['Measurement', 1.0, 0.1], b: ['Measurement', 1.000000000001, 0.1], cmp: 0 },
  { label: 'complex measurement, number', a: ['Measurement', ['Complex', 2, 3], 0.1], b: 3, cmp: undefined, eq: false, note: 'a complex nominal has no order; `Equal` by the disjoint-type rule' },
  { label: 'quantities, one dimension', a: ['Quantity', 2, 'm'], b: ['Quantity', 300, 'cm'], cmp: -1 },
  { label: 'quantities, equal after conversion', a: ['Quantity', 2, 'm'], b: ['Quantity', 200, 'cm'], cmp: 0 },
  { label: 'quantities, two dimensions', a: ['Quantity', 2, 'm'], b: ['Quantity', 2, 's'], cmp: undefined, eq: false },
  { label: 'quantity, number', a: ['Quantity', 2, 'm'], b: 2, cmp: undefined, eq: false },
  { label: 'dimensionless quantity, number', a: ['Quantity', 6, 'percent'], b: 0.07, cmp: -1 },
  { label: 'quantities closer than the tolerance', a: ['Quantity', 1, 'm'], b: ['Quantity', 1.000000000001, 'm'], cmp: 0, note: 'section 6: the extrema use the engine tolerance' },
  { label: 'quantities closer than the tolerance, two units', a: ['Quantity', 1, 'm'], b: ['Quantity', 100.0000000001, 'cm'], cmp: 0 },
  { label: 'quantities with measurement magnitudes, equal nominals', a: ['Quantity', ['Measurement', 1, 0.1], 'm'], b: ['Quantity', ['Measurement', 1, 0.5], 'm'], cmp: 0 },
  { label: 'measurement, quantity', a: ['Measurement', 2, 0.1], b: ['Quantity', 2, 'm'], cmp: undefined, eq: false, note: 'two kinds: neither compares' },
];

function plannedFor(p: Pair, op: string): string {
  const c = p.cmp;
  const show = (x: unknown) => quiet(() => new ComputeEngine().box(x as never).toString());
  const A = show(p.a);
  const B = show(p.b);
  switch (op) {
    case 'Equal':
      return c === undefined ? (p.eq === undefined ? 'unevaluated' : p.eq ? 'True' : 'False') : c === 0 ? 'True' : 'False';
    case 'Less':
      return c === undefined ? 'unevaluated' : c < 0 ? 'True' : 'False';
    case 'LessEqual':
      return c === undefined ? 'unevaluated' : c <= 0 ? 'True' : 'False';
    case 'Max':
      return c === undefined ? 'unevaluated' : c >= 0 ? A : B;
    case 'Min':
      return c === undefined ? 'unevaluated' : c <= 0 ? A : B;
    case 'Sort':
      return c === undefined ? 'unevaluated' : c <= 0 ? `[${A}, ${B}]` : `[${B}, ${A}]`;
    case 'isEqual':
      return c === undefined ? (p.eq === undefined ? 'undefined' : String(p.eq)) : String(c === 0);
    case 'isLess':
      return c === undefined ? 'undefined' : String(c < 0);
    case 'is':
      return c === undefined ? 'false' : String(c === 0);
  }
  return '';
}

function part5(): string {
  const out: string[] = [];
  out.push('## Part 5. Comparisons and extrema\n');
  out.push(
    'Each pair `(a, b)` in a fresh engine. "Today" is `evaluate()` of the call (and the method result); "planned" follows plan section 4.4 with the `compare` value in the second column (`-1`, `0`, `1`, or none).\n'
  );
  out.push('| Pair | compare | Operation | Today | Planned | Same |');
  out.push('| --- | --- | --- | --- | --- | --- |');
  for (const p of PAIRS) {
    const ce = new ComputeEngine();
    const rows: [string, string][] = [];
    const ev = (json: unknown) =>
      quiet(() => {
        try {
          const e = ce.box(json as never);
          const v = e.evaluate();
          // A call that `evaluate()` returns as it was is "unevaluated",
          // the word the planned column uses.
          if (JSON.stringify(v.json) === JSON.stringify(e.json))
            return `unevaluated: ${v.toString()}`;
          return (e.isValid ? '' : 'INVALID: ') + v.toString();
        } catch (err) {
          return `THROWS: ${(err as Error).message.split('\n')[0]}`;
        }
      });
    for (const op of ['Equal', 'Less', 'LessEqual', 'Max', 'Min'])
      rows.push([op, ev([op, p.a, p.b])]);
    rows.push(['Sort', ev(['Sort', ['List', p.a, p.b]])]);
    const a = quiet(() => ce.box(p.a as never));
    const b = quiet(() => ce.box(p.b as never));
    const m = (f: () => unknown) =>
      quiet(() => {
        try {
          return String(f());
        } catch (err) {
          return `THROWS: ${(err as Error).message.split('\n')[0]}`;
        }
      });
    rows.push(['isEqual', m(() => a.isEqual(b))]);
    rows.push(['isLess', m(() => a.isLess(b))]);
    rows.push(['is', m(() => a.is(b))]);
    for (const [op, today] of rows) {
      const planned = plannedFor(p, op);
      const same =
        normalize(today) === normalize(planned) ||
        (planned === 'unevaluated' && today.startsWith('unevaluated: '))
          ? 'yes'
          : '**no**';
      out.push(
        `| ${p.label}${p.note ? ` (${p.note})` : ''} | ${p.cmp ?? '—'} | \`${op}\` | ${cell(today, 60)} | ${cell(planned, 60)} | ${same} |`
      );
    }
  }
  out.push('');
  out.push('### Undecided comparisons\n');
  out.push(
    'A comparison that stays unevaluated must keep its operands. Today the relational operators replace a measurement by its nominal before they decide (`evaluateChainOperands()` in `library/relational-operator.ts`), and an undecided result keeps the bare nominal.\n'
  );
  out.push('| Call | Today (MathJSON of `evaluate()`) | Planned |');
  out.push('| --- | --- | --- |');
  for (const json of [
    ['Less', ['Measurement', 2, 0.1], 'x'],
    ['Equal', ['Measurement', 2, 0.1], 'x'],
    ['Less', ['Measurement', 2, 0.1], ['Quantity', 2, 'm']],
  ]) {
    const ce = new ComputeEngine();
    const r = quiet(() => JSON.stringify(ce.box(json as never).evaluate().json));
    out.push(
      `| \`${JSON.stringify(json)}\` | \`${r}\` | unevaluated, the measurement kept (a wrong value today: the uncertainty is lost) |`
    );
  }
  out.push('');
  out.push('### Clamp\n');
  out.push('| Call | Today | Planned |');
  out.push('| --- | --- | --- |');
  const clamps: [unknown, string][] = [
    [['Clamp', ['Measurement', 5, 0.1], 0, 3], '3 (the bound as written, 4.4)'],
    [['Clamp', ['Measurement', 2, 0.1], 0, 3], '2 ± 0.1'],
    [['Clamp', ['Measurement', 3, 0.1], 0, 3], 'DECISION: the plan does not say what a tie with a bound returns (`x` or the bound)'],
    [['Clamp', ['Quantity', 5, 'm'], ['Quantity', 0, 'm'], ['Quantity', 3, 'm']], '3 m (admitted by the group-1 rule: the quantity kind has `compare`)'],
    [['Clamp', ['Quantity', 5, 'm'], 0, 3], 'unevaluated (not comparable)'],
  ];
  for (const [json, planned] of clamps) {
    const ce = new ComputeEngine();
    const r = quiet(() => {
      try {
        const e = ce.box(json as never);
        return `${e.isValid ? '' : 'INVALID: '}${e.evaluate().toString()} (type ${e.type.toString()})`;
      } catch (err) {
        return `THROWS: ${(err as Error).message}`;
      }
    });
    out.push(`| \`${JSON.stringify(json)}\` | ${cell(r, 70)} | ${planned} |`);
  }
  out.push('');
  return out.join('\n');
}

const normalize = (s: string) =>
  s
    .replace(/^INVALID: /, '')
    .replace(/"/g, '')
    .replace(/\s+/g, '')
    .replace(/^(\w+)\((.*)\)$/, '$1($2)')
    .toLowerCase();

////////////////////////////////////////////////////////////////////////////////
// Main
////////////////////////////////////////////////////////////////////////////////

const head = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: ROOT,
  encoding: 'utf8',
}).trim();
console.log('# Value kinds, phase 2: inventory (script output)\n');
console.log(
  `Produced by \`npx tsx scripts/probe-value-kinds-inventory.ts\` on commit \`${head}\`.\n`
);
if (wants(1)) console.log(part1());
if (wants(2) || wants(3)) {
  const { infos, skipped, finiteRealInJson } = operatorInfos();
  console.log(
    renderParts2and3(infos, skipped, finiteRealInJson, parts2and3(infos))
  );
}
if (wants(4)) console.log(part4());
if (wants(5)) console.log(part5());
