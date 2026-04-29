import { ComputeEngine, isFunction, isNumber } from '../../src/compute-engine';
import { add } from '../../src/compute-engine/boxed-expression/arithmetic-add';
import { mul } from '../../src/compute-engine/boxed-expression/arithmetic-mul-div';
import { getOp } from '../../src/compute-engine/boxed-expression/utils';
import type {
  Expression,
  TransformOptions,
} from '../../src/compute-engine/global-types';
// !@note: Ensure loading of Expression snapshot-serializer
import '../utils';
import { sym } from '../../src/compute-engine/boxed-expression/type-guards';
import {
  constructibleValues,
  isConstructible,
} from '../../src/compute-engine/boxed-expression/trigonometry';

const ce = new ComputeEngine({});
export type BoxedExpression = NonNullable<ReturnType<ComputeEngine['parse']>>;

type ReplaceValue = Extract<TransformOptions, { type: 'replace' }>['replace'];

/**
 * Apply a transform and assert it returned a result.
 * If `expected` is provided, also assert semantic equality with that expression. Returns the
 * transformed expression.
 */
function checkTransform(
  input: string | BoxedExpression,
  options: TransformOptions,
  expected?: string | BoxedExpression
): BoxedExpression {
  const expr =
    typeof input === 'string' ? ce.parse(input, { form: 'raw' }) : input;
  const result = expr.transform(options);
  expect(result).not.toBeNull();

  if (expected !== undefined) {
    const expectedExpr =
      typeof expected === 'string' ? ce.parse(expected) : expected;
    expect(result!.isSame(expectedExpr)).toBe(true);
  }

  return result!;
}

function expectNull(
  input: Parameters<typeof checkTransform>[0],
  options: Parameters<typeof checkTransform>[1]
): void {
  const expr =
    typeof input === 'string' ? ce.parse(input, { form: 'raw' }) : input;
  expect(expr.transform(options)).toBeNull();
}

describe('TRANSFORM', () => {
  let expr: BoxedExpression | undefined;
  let result: BoxedExpression | undefined;

  beforeEach(() => {
    expr = undefined;
    result = undefined;
  });

  test.only("Transformation 'Structural'", () => {
    // Case 1: whole-expression structural conversion on raw nested arithmetic.
    // (Employ 'Number' form such as to ensure BoxedNumbers, which should be *undone* by
    // structualisation *British spelling*)
    expr = ce.parse('(1/2+3/4)*(1/2 + x)', { form: 'raw' });
    result = checkTransform(expr, {
      type: 'structural',
      targets: expr,
    });
    // @fix?: As of version 55.6, there is inconsistency of 'structuralization' of forms depending
    // on whether input is 'raw' or 'canonical'... i.e. in this case, structural-form from a 'raw'
    // expression results in 'Divide' expressions for rational numbers; whereas the representation
    // remains as 'Rational' (BoxedNumber) when requested from already-canonical. .
    expect(result.subexpressions.every((x) => x.isStructural)).toBe(true);
    expect(result.getSubexpressions('Divide').length).toBe(3);

    // Case 2: targeted structural conversion on a nested, full-canonical additive branch.
    expr = ce.parse('(2/5+{\\pi}) * (e^{1/2 * \\pi * e})', {
      form: 'canonical',
    });
    result = checkTransform(expr, {
      type: 'structural',
      targets: getOp(expr, 1, true)!,
    });
    expect(result.isStructural).toBe(false);
    expect(getOp(result, 1, true)?.isStructural).toBe(true);
    expect(getOp(result, 2, true)?.isStructural).toBe(false);
    //↓@fix: cannot test for qty. of 'Divide' if structuralizing from 'canonical' (see note above)
    // expect(result.getSubexpressions('Divide').length).toBe(1);

    // Case 3: pattern-based matching on a partially-canonicalized expression, with `match`, and a
    // condition.
    //@fix: initially, this test was to carry this out on a *partially-canonical* expression:
    //problematically for this purpose however, at time of commit, partially-canonical expressions
    //are boxed as having 'structural' form...
    // expr = ce.parse('(1/3+x)/(2/7+y)', { form: 'canonical' /* Number' */ });
    expr = ce.parse('(x+1/3)/(y+3/7)', { form: 'canonical' /* Number' */ });
    result = checkTransform(expr, {
      type: 'structural',
      match: {
        pattern: ['Add', '_a', '_b'],
        condition: 'b > 1/3',
      },
    });
    expect(result.isStructural).toBe(false);
    expect(getOp(result, 1, true)?.isStructural).toBe(false);
    expect(getOp(result, 2, true)?.isStructural).toBe(true);
  });

  describe.only("Transformation 'Canonical'", () => {
    test('fully canonical', () => {
      // Whole-expression canonicalization from raw nested arithmetic.
      expr = ce.parse('6^{\\infty} + a/a + (1 * e) + 0', { form: 'raw' });
      //@note: absence of both 'match/targets' to indicate transformation to apply at top-level
      result = checkTransform(expr, {
        type: 'canonical',
        canonical: true,
      });
      expect(result).toMatchInlineSnapshot(
        `["Add", 1, "PositiveInfinity", "ExponentialE"]`
      );
    });

    //@note: As of *v55*, partially-canonicalized (CanonicalForm-applied) expressions are boxed as
    //'structural' (this carries with at least a couple of potential issues/inaccuracies)
    test('singular CanonicalForm', () => {
      // 'Multiply' on a nested branch.
      expr = ce.parse('(-1 * -1 * j * k)+\\sin(\\pi/2) + 0', { form: 'raw' });
      result = checkTransform(expr, {
        type: 'canonical',
        targets: getOp(expr, 1, true)!,
        canonical: ['Multiply'],
      });
      expect(result).toMatchInlineSnapshot(`
        [
          "Add",
          ["Delimiter", ["Multiply", -1, -1, "j", "k"]],
          ["Sin", ["Divide", "Pi", 2]],
          0
        ]
      `);
    });

    test('Multiple CanonicalForms', () => {
      // Canonicalize both additive and multiplicative forms in a nested input.
      // Target LHS only
      expr = ce.parse('(0 + (3*x*2)+(y * 1))+((z*1)+0)', { form: 'raw' });
      result = checkTransform(expr, {
        type: 'canonical',
        targets: getOp(expr, 1, true)!,
        canonical: ['Add', 'Multiply', 'Number'],
      });
      // RHS remain un-canonicalized
      expect(result).toMatchInlineSnapshot(`
        [
          "Add",
          [
            "Delimiter",
            [
              "Add",
              ["Delimiter", ["Multiply", 2, 3, "x"]],
              ["Delimiter", ["Multiply", 1, "y"]]
            ]
          ],
          ["Delimiter", ["Add", ["Delimiter", ["Multiply", "z", 1]], 0]]
        ]
      `);
    });
  });

  describe.only("Transformation 'Replace'", () => {
    test('replace with LatexString', () => {
      // Replace a nested trigonometric fragment with a parseable LatexString.
      const replace: ReplaceValue = '5';
      expr = ce.parse('(\\sin(\\pi/2)+2)+(3+4)', { form: 'raw' });
      result = checkTransform(expr, {
        type: 'replace',
        //@note: (bug?) at v55, cannot use a plain (non-parsed) string for match if using wildcards;
        //as these not auto-assumed as wildcards (unlike for the 'replace' pattern)
        match: ce.parse('\\sin(\\pi/2)+\\mathrm{_x}', { form: 'raw' }),
        replace,
        form: 'raw', // @note: this ensures against 'eager' canonicalization of containing
        // 'Delimiter' expr. (of replacement)
      });
      expect(result).toMatchInlineSnapshot(
        `["Add", ["Delimiter", 5], ["Delimiter", ["Add", 3, 4]]]`
      );
      // Ensure 'replace()' call does not wrongly mark entire expr. as canonical.
      expect(result.isCanonical).toBe(false);
      expect(result.isStructural).toBe(false);
    });

    test('replace with Expression', () => {
      // Replace an additive nested branch directly with an Expression.
      const replace: ReplaceValue = ce.parse('y^2', { form: 'raw' });
      expr = ce.parse('((x+x)+\\cos(\\pi))+e', { form: 'raw' });
      result = checkTransform(expr, {
        type: 'replace',
        //(@note: for this and many subsequent cases, use a boxed-expression over a string, in order
        //that wildcards not inferred from free symbols (when parsed as a Rule)) )
        match: ce.expr(['Add', 'x', 'x'], { form: 'raw' }),
        replace,
        form: 'raw',
      });
      expect(result).toMatchInlineSnapshot(`
        [
          "Add",
          ["Delimiter", ["Add", ["Delimiter", ["Square", "y"]], ["Cos", "Pi"]]],
          "e"
        ]
      `);
    });

    test('replace with RuleFunction & RuleReplaceFunction', () => {
      // RuleFunction: replace a nested 'Add' with a  trig-function
      // (Match with 'match'; input/output non-canonical ('raw'))
      let replace: ReplaceValue = () =>
        ce.parse('\\tan(\\pi/4)', { form: 'raw' });
      expr = ce.parse('(a+b)*(c+d)', { form: 'raw' });
      result = checkTransform(expr, {
        type: 'replace',
        match: ce.expr(['Add', 'c', 'd']), // *not* wildcards
        replace,
        form: 'raw',
      });
      expect(result).toMatchInlineSnapshot(`
        [
          "Multiply",
          ["Delimiter", ["Add", "a", "b"]],
          ["Delimiter", ["Tan", ["Divide", "Pi", 4]]]
        ]
      `);
      expect(result.isCanonical).toBe(false);
      expect(result.isStructural).toBe(false);
      expect(getOp(result, 1, true)!.isCanonical).toBe(false);
      expect(getOp(result, 2, true)!.isCanonical).toBe(false);

      // RuleFunction: Use in conjunction with 'targets' to conditionally replace parts of a 'Logic'
      // expression
      expr = ce.expr(['And', ['Or', 'P', 'Q'], ['Not', 'R']]);
      const left = getOp(expr, 1, true)!;
      const right = getOp(expr, 2, true)!;

      replace = (subexpr: BoxedExpression) =>
        subexpr === left
          ? ce.expr('True', { form: 'raw' })
          : ce.expr('False', { form: 'raw' });

      result = checkTransform(expr, {
        type: 'replace',
        targets: [left, right],
        replace,
        form: 'raw',
      });

      expect(result.json).toMatchInlineSnapshot(`
        [
          And,
          True,
          False,
        ]
      `);
    });
  });

  describe.only("Transformation 'Evaluate'", () => {
    test('via match+condition', () => {
      expr = ce.parse('(3!+\\ln(e))*(\\sin(\\pi/2)+\\cos(0))');
      result = checkTransform(expr, {
        type: 'evaluate',
        match: {
          pattern: ['_f', '__'],
          condition: ({ f }) =>
            !!f && (sym(f) === 'Factorial' || sym(f) === 'Sin'),
        },
      });
      expect(result).toMatchInlineSnapshot(`
        [
          "Multiply",
          ["Add", 1, ["Cos", 0]],
          ["Add", 6, ["Ln", "ExponentialE"]]
        ]
      `);
      // For an 'evaluate' transformation, input, and output, always canonical.
      expect(result.isCanonical).toBe(true);

      /*
       * Control
       */
      // (ensure that non-canonical input, still evaluates (even recursively))
      // (^note that this varies from *original* 'evaluate()' behaviour: in which a non-canonical
      // input is simply returned (as-is))
      expr = ce.parse('(3!+\\ln(e))*(\\sin(\\pi/2)+\\cos(0))', { form: 'raw' });
      expect(result).toMatchInlineSnapshot(`
        [
          "Multiply",
          ["Add", 1, ["Cos", 0]],
          ["Add", 6, ["Ln", "ExponentialE"]]
        ]
      `);
      expect(result.isCanonical).toBe(true);
    });

    test(`via 'targets'`, () => {
      expr = ce.parse('\\ln(e^2)+\\tan(\\pi/4)+\\sin(\\pi/2)');
      // expr = ce.parse('\\ln(e^2)+\\tan(\\pi/4)');

      // Obtain targets by operator lookup to avoid operand-order assumptions.
      const lnTarget = expr.getSubexpressions('Ln')[0];
      const tanTarget = expr.getSubexpressions('Tan')[0];
      expect(lnTarget).toBeDefined();
      expect(tanTarget).toBeDefined();
      const targets = [
        lnTarget as BoxedExpression,
        tanTarget as BoxedExpression,
      ];

      result = checkTransform(expr, {
        type: 'evaluate',
        targets,
      });
      //(canonical 'Add' folds numbers (time of writing / v55))
      expect(result).toMatchInlineSnapshot(
        `["Add", 3, ["Sin", ["Multiply", ["Rational", 1, 2], "Pi"]]]`
      );
      expect(result.isCanonical).toBe(true);
    });

    test(`evaluate with  'materialization' (evalOptions)`, () => {
      expr = ce.expr(['Map', 'Integers', ['Square', '_']]);
      result = checkTransform(expr, {
        type: 'evaluate',
        targets: expr,
        evalOptions: { materialization: true },
      });
      expect(result.json).toMatchInlineSnapshot(`
        [
          Set,
          0,
          1,
          4,
          ContinuationPlaceholder,
        ]
      `);

      /*
       * Control
       */
      // Same expr. (with materialization=false)- should not evaluate target - and hence should
      // return 'null'
      expectNull(expr, {
        type: 'evaluate',
        targets: expr,
        evalOptions: { materialization: false },
      });
    });
  });

  test.only("Transformation 'N'", () => {
    // Case 1: target top-level expr. (single-level; with constants)
    expr = ce.parse('\\pi+e');
    result = checkTransform(expr, {
      type: 'N',
      targets: expr,
    });
    expect(result).toMatchInlineSnapshot(`5.859874482048838473822643`);

    // Case 2: target nested trig function using 'targets' in 'callback' form.
    expr = ce.parse('(\\sin(\\pi/4)+\\ln(2))*\\tan(\\pi/6.2)');
    result = checkTransform(expr, {
      type: 'N',
      targets: (x) => x.operator === 'Tan',
    });
    expect(result).toMatchInlineSnapshot(`
      [
        "Multiply",
        "0.555045280178486334486",
        ["Add", ["Sin", ["Multiply", ["Rational", 1, 4], "Pi"]], ["Ln", 2]]
      ]
    `);
  });

  describe.only("Transformation 'Simplify'", () => {
    // Re-construction of the original constructible-values trig. rule
    const constructibleTrigRule = (x: Expression) =>
      !isConstructible(x) || !isFunction(x)
        ? undefined
        : constructibleValues(x.operator, x.op1);

    test('top-level expression with default rules', () => {
      expr = ce.parse('e^j * e^2 * (j + 1)^2 * j^2');
      result = checkTransform(expr, {
        type: 'simplify',
        targets: expr,
      });
      expect(result).toMatchInlineSnapshot(`
        [
          "Multiply",
          ["Square", "j"],
          ["Square", ["Add", "j", 1]],
          ["Exp", ["Add", "j", 2]]
        ]
      `);
      expect(result.isCanonical).toBe(true);
    });

    test(`top-level expression with options (custom rule-list)`, () => {
      expr = ce.parse('\\sin(\\pi/2)+\\cos(0)+\\ln(e)+\\ln(e)');
      result = checkTransform(expr, {
        // result = expr.transform({
        type: 'simplify',
        targets: expr,
        simplifyOptions: {
          // Target 'Add' and trig-functions, but do not reduce '\ln(e)' instances to '1'
          rules: [
            constructibleTrigRule,
            (x) => (isFunction(x, 'Add') ? add(...x.ops) : undefined),
          ],
        },
      });
      expect(result).toMatchInlineSnapshot(
        `["Add", 2, ["Multiply", 2, ["Ln", "ExponentialE"]]]`
      );
    });

    test(`nested simplify via 'targets'/'match' (default rules)`, () => {
      // Case 1 (target a single product operand to which 'expand' is applicable)
      expr = ce.parse('(q - 3)^2 + {x * (y + 2)} + 2! + 3!');
      result = checkTransform(expr, {
        type: 'simplify',
        targets: getOp(expr, 2, true)!,
      });
      expect(result).toMatchInlineSnapshot(`
        [
          "Add",
          ["Square", ["Subtract", "q", 3]],
          ["Multiply", "x", "y"],
          ["Multiply", 2, "x"],
          ["Factorial", 2],
          ["Factorial", 3]
        ]
      `);

      // Case 2 (target 'Sin' amongst other trig & transcendental FN's, using 'match')
      expr = ce.parse('\\sin(\\pi/2)+\\cos(0)+\\ln(e)+\\ln(e)');
      result = checkTransform(expr, {
        type: 'simplify',
        match: ce.expr(['Sin', '__'], { form: 'raw' }),
        simplifyOptions: {
          rules: [constructibleTrigRule],
        },
      });
      expect(result).toMatchInlineSnapshot(
        `["Add", 1, ["Cos", 0], ["Ln", "ExponentialE"], ["Ln", "ExponentialE"]]`
      );
    });

    test(`nested simplify via 'targets'/'match' with options (custom rule-list)`, () => {
      // Target a single term of a sum with (trigonometric) functions
      expr = ce.parse(
        '(\\cos{\\pi}\\cos^2{\\pi}) + (7\\cos{0}3\\sin{\\pi / 2})'
      );
      result = checkTransform(expr, {
        type: 'simplify',
        targets: getOp(expr, 2, true)!,
        simplifyOptions: {
          rules: [
            (x) =>
              isFunction(x, 'Cos') ? constructibleTrigRule(x) : undefined,
            (x) => (isFunction(x, 'Multiply') ? mul(...x.ops) : undefined),
          ],
        },
      });
      expect(result).toMatchInlineSnapshot(`
        [
          "Subtract",
          [
            "Multiply",
            7,
            ["Sin", ["Multiply", ["Rational", 1, 2], "Pi"]],
            ["Cos", 0]
          ],
          1
        ]
      `);
    });
  });

  describe('Other options', () => {
    test.only('direction', () => {
      // Direction may matter when multiple identity targets are transformed in sequence.
      /**
       * Case 1:
       * - Replace condition based on nth replacement occurence (stateful index)
       */
      // expr = ce.parse('(\\sin(\\pi/2)+x)+(\\cos(0)+y)', { form: 'raw' });
      expr = ce.parse('3x + 4y');
      const left = getOp(expr, 1, true)!;
      const right = getOp(expr, 2, true)!;

      let i = 0;
      const leftRight = checkTransform(expr, {
        type: 'replace',
        targets: [left, right],
        replace: (() => ce.parse(i++ === 0 ? 'A' : 'B')) as ReplaceValue,
        form: 'raw',
        direction: 'left-right',
      });

      i = 0;
      const rightLeft = checkTransform(expr, {
        type: 'replace',
        targets: [left, right],
        replace: (() => ce.parse(i++ === 0 ? 'A' : 'B')) as ReplaceValue,
        form: 'raw', // ! Explicit specification of 'raw' ensures that final, top-level result is
        // not eagerly canonicalized (- 'eager' because both replacemnts 'A' and 'B' are parsed as
        // canonical).
        direction: 'right-left',
      });

      expect(leftRight).toMatchInlineSnapshot(`["Add", "A", "B"]`);
      expect(rightLeft).toMatchInlineSnapshot(`["Add", "B", "A"]`);

      // @todo: more cases
      // (@note: the case of a Replace transformation with option 'once' set to 'one-replacement'
      // *would* be a viable case here... but this option is not made available in the context of
      // 'expr.transform()': due to this uniqely bearing 'targets'-based matching and therefore being
      // redundant)
    });
  });

  describe('Controls', () => {
    test.only(`transformation applies to input expression (directly) in absence of both 'match' and 'targets'`, () => {
      /*
       * Transformation 'Replace'
       */
      const eitheta = ce.parse('e^{i \\pi}');
      result = checkTransform(eitheta, {
        type: 'replace',
        replace: '-1',
        form: 'raw',
      });
      expect(result).toMatchInlineSnapshot(`-1`);

      /*
       * Transformation 'Evaluate'
       */
      result = checkTransform(eitheta, {
        type: 'evaluate',
      });
      expect(result).toMatchInlineSnapshot(`-1`);

      /*
       * Transformation 'Simplify'
       */
      result = checkTransform('\\sin^2{x} + \\cos^2{x}', {
        type: 'simplify',
      });
      expect(result).toMatchInlineSnapshot(`1`);
    });

    test.only(`returns 'null' for no match ('match' property)`, () => {
      // Case 1: transformation 'Replace'; Input `Expression` (i.e. boxed)
      expr = ce.expr(['Add', 'x', 'y', 'Pi']);
      expectNull(expr, {
        type: 'replace',
        match: {
          pattern: ce.expr(['Add', 'x', 'Pi', '__', 'e'], { form: 'raw' }),
          matchPermutations: true /* default */,
        },
        replace: '5',
        form: 'raw',
      });

      // Case 2: transformation 'evaluate'; Input `LatexString`
      expr = ce.parse('n + m', { form: 'raw' });
      expectNull(expr, {
        type: 'evaluate',
        match: ce.expr(['Add', 'n', 'm', '_'], { form: 'raw' }),
      });
    });

    test.only(`returns 'null' with non-locatable 'targets'`, () => {
      // Case 1: referential-identity targets (1)
      // (reference to another, identical expression instance should not match)
      expr = ce.parse('r^2 = a^2\\cos(2*\\theta)');
      const expr2 = ce.parse('r^2 = a^2\\cos(2*\\theta)');
      expectNull(expr, {
        type: 'replace',
        targets: expr2,
        replace: '\\text{matched}',
        form: 'raw',
      });

      // Case 2: referential-identity targets (2)
      // (reference to a matching sub-expression of a non-referentially matching, yet identical
      // expression instance should not match)
      expr = ce.parse('(x+y)+e', { form: 'raw' });
      expectNull(expr, {
        type: 'replace',
        targets: ce.parse('x + y', { form: 'raw' }),
        replace: 'z',
      });

      // Case 3: non-matching predicate
      expectNull('sin^2 {3}', {
        type: 'replace',
        targets: (expr) => isNumber(expr) && expr.toNumericValue()[0].re > 3,
        replace: '0',
        form: 'raw',
      });
    });

    test.only(`returns 'null' where a transformation results in no change (to target)`, () => {
      //@note: this is presently case for all transformation types with exception of 'replace'...

      // Case 1: canonical (where already canonical)
      expr = ce.parse('x + 0');
      expectNull(expr, {
        type: 'canonical',
        canonical: true,
      });

      // Case 2: structural (where already structural)
      const subExpr = ce.expr(['Multiply', ['Rational', 1, 2], 'Pi'], {
        form: 'structural',
      });
      expr = ce.expr(['Add', ['Rational', 3, 2], subExpr], { form: 'raw' });
      expectNull(expr, {
        type: 'structural',
        targets: subExpr, // Target a sub-expr.
      });

      // Case 3: evaluate (where transformation results remain the same / unevaluated)
      expr = ce.parse('{x^2 + 7x + 3} / {x - 1}');
      expectNull(expr, {
        type: 'evaluate',
        targets: getOp(expr, 2, true)!,
      });

      // Case 3: simplify (where no rules apply to targets)
      expr = ce.expr(['Multiply', ['Multiply', 2, 'x'], ['Add', 'x', 1]]);
      expectNull(expr, {
        type: 'simplify',
        targets: getOp(expr, 2, true)!,
      });
    });

    //Ideally, to be *@Fixed* (but this likely not possible)
    test.only(`(broken case): referential-identity targets with cached engine symbols`, () => {
      // Case 1: Zero
      expr = ce.expr('0');
      let expr2 = ce.expr('0');
      expect(
        checkTransform(expr, {
          type: 'replace',
          targets: expr2,
          replace: ce.expr('x'),
          form: 'raw',
        })
      ).toMatchInlineSnapshot(`x`);

      // Case 2: PositiveInfinity
      expr = ce.parse('\\sum_{n = 1}^{\\infty} 1 / {n^2}');
      expr2 = ce.parse('\\infty');
      expect(
        checkTransform(expr, {
          type: 'replace',
          targets: expr2, // Single 'Infinity'
          replace: ce.expr(['Power', 10, 3]),
          form: 'raw',
        })
      ).toMatchInlineSnapshot(
        `["Sum", ["Divide", 1, ["Square", "n"]], ["Limits", "n", 1, 1000]]`
      );
    });
  });

  describe.only('Error cases', () => {
    test(`specification of both 'match' and 'targets'`, () => {
      expect(() => {
        ce.parse('2+3').transform({
          type: 'replace',
          match: 'a+b',
          targets: ce.parse('2'),
          replace: '5',
        } as unknown as TransformOptions);
      }).toThrow('Cannot specify both `match` and `targets`');
    });

    test('missing options (transformation-specific)', () => {
      expect(() => {
        ce.parse('2+3').transform({
          type: 'replace',
          match: 'a+b',
          replace: undefined,
        } as unknown as TransformOptions);
      }).toThrow("Expected 'replace' option for transformation 'replace'");

      expect(() => {
        ce.parse('2+3').transform({
          type: 'canonical',
          match: 'a+b',
          canonical: undefined,
        } as unknown as TransformOptions);
      }).toThrow("Expected 'canonical' option for transformation 'canonical'");
    });

    test('unknown transform type', () => {
      expect(() => {
        ce.parse('2+3').transform({
          type: 'UNKNOWN',
          match: 'a+b',
        } as unknown as TransformOptions);
      }).toThrow("Unknown transform type: 'UNKNOWN'");
    });
  });
});
