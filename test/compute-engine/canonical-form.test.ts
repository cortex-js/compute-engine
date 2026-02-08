import { ComputeEngine, NumericType } from '../../src/compute-engine';
import { _BoxedExpression } from '../../src/compute-engine/boxed-expression/abstract-boxed-expression';
import { check, exprToString, engine as TEST_ENGINE } from '../utils';
import type {
  CanonicalForm,
  SemiBoxedExpression,
} from '../../src/compute-engine/global-types';

describe('CANONICAL FORM RESTRICTIONS', () => {
  // Some operations are not allowed in non-canonical form
  test("Can't set value of non-canonical", () => {
    expect(() => {
      TEST_ENGINE.box('m', { form: 'raw' }).value = 1;
    }).toThrow();
  });
  test('Non-canonical expressions evaluate to themselves', () => {
    expect(
      TEST_ENGINE.parse('2 + 3', { form: 'raw' }).evaluate().toString()
    ).toEqual('2 + 3');
  });
});

describe('CANONICAL FORMS', () => {
  test('-0', () => {
    expect(check('-0')).toMatchInlineSnapshot(`0`);
  });

  // Addition/substraction of 0 gets simplified in canonical  form
  test('a-0', () => {
    expect(check('a-0')).toMatchInlineSnapshot(`
      box       = ["Add", "a", 0]
      canonical = a
    `);
  });

  test('0-a', () => {
    expect(check('0-a')).toMatchInlineSnapshot(`
      box       = ["Add", 0, ["Negate", "a"]]
      canonical = ["Negate", "a"]
    `);
  });

  // Small integers are *not* coalesced in canonical form
  test('7 + 2 + 5"', () => {
    expect(check('7 + 2 + 5')).toMatchInlineSnapshot(`
      box       = ["Add", 7, 2, 5]
      canonical = ["Add", 2, 5, 7]
      simplify  = 14
    `);
  });

  // This one is tricky:
  // the simplifications of POWER and MULTIPLY
  // have to be done in the right order to get the correct result
  test('2^3x"', () => {
    expect(check('2^3x')).toMatchInlineSnapshot(`
      box       = ["InvisibleOperator", ["Power", 2, 3], "x"]
      canonical = ["Multiply", "x", ["Power", 2, 3]]
      simplify  = 8x
    `);
  });

  // Negative sign on denom, numer or both
  test('\\frac{-x}{-n}"', () => {
    expect(check('\\frac{-x}{-n}')).toMatchInlineSnapshot(`
      box       = ["Divide", ["Negate", "x"], ["Negate", "n"]]
      canonical = ["Divide", "x", "n"]
    `);
  });

  test('\\frac{x}{-n}"', () => {
    expect(check('\\frac{x}{-n}')).toMatchInlineSnapshot(`
      box       = ["Divide", "x", ["Negate", "n"]]
      canonical = ["Divide", ["Negate", "x"], "n"]
    `);
  });

  test('\\frac{-x}{n}"', () => {
    expect(check('\\frac{-x}{n}')).toMatchInlineSnapshot(
      `["Divide", ["Negate", "x"], "n"]`
    );
  });

  test('\\frac{-101}{10^{\\frac{2}{3}}}', () => {
    expect(check('\\frac{-101}{10^{\\frac{2}{3}}}')).toMatchInlineSnapshot(`
      box       = ["Divide", -101, ["Power", 10, ["Divide", 2, 3]]]
      canonical = ["Divide", -101, ["Power", 10, ["Rational", 2, 3]]]
      eval-auto = -101 / 10^(2/3)
      eval-mach = -101 / 10^(2/3)
      N-auto    = -21.7597903693220255898
      N-mach    = -21.75979036932202
    `);
  });

  test('Prefer (numeric value) x (term) over (term / numeric value)', () => {
    expect(check('\\frac{x}{3}')).toMatchInlineSnapshot(`
      box       = ["Divide", "x", 3]
      canonical = ["Multiply", ["Rational", 1, 3], "x"]
      eval-auto = 1/3 * x
      eval-mach = 1/3 * x
      N-auto    = 0.333333333333333333333 * x
      N-mach    = 0.333333333333333 * x
    `);
  });

  test('Prefer (numeric value) x (term) over (integer x √(integer) x term)', () => {
    expect(check('3 \\sqrt{5} x')).toMatchInlineSnapshot(`
      box       = ["InvisibleOperator", 3, ["Sqrt", 5], "x"]
      canonical = ["Multiply", 3, ["Sqrt", 5], "x"]
      eval-auto = 3sqrt(5) * x
      eval-mach = 3sqrt(5) * x
      N-auto    = 6.70820393249936908923 * x
      N-mach    = 6.70820393249937 * x
    `);
  });

  test('Prefer (numeric value) x (term) over (integer x √(integer) x (term/integer))', () => {
    expect(check('3 \\sqrt{5} \\frac{x}{7}')).toMatchInlineSnapshot(`
      box       = ["InvisibleOperator", 3, ["Sqrt", 5], ["Divide", "x", 7]]
      canonical = ["Multiply", 3, ["Rational", 1, 7], ["Sqrt", 5], "x"]
      simplify  = 3/7sqrt(5) * x
      eval-auto = 3/7sqrt(5) * x
      eval-mach = 3/7sqrt(5) * x
      N-auto    = 0.958314847499909869891 * x
      N-mach    = 0.958314847499911 * x
    `);
  });

  test('Prefer (numeric value) x (term) over (integer x √(integer) x (term/integer))', () => {
    expect(check('3 \\sqrt{5} \\frac{x}{3}')).toMatchInlineSnapshot(`
      box       = ["InvisibleOperator", 3, ["Sqrt", 5], ["Divide", "x", 3]]
      canonical = ["Multiply", 3, ["Rational", 1, 3], ["Sqrt", 5], "x"]
      simplify  = sqrt(5) * x
      eval-auto = sqrt(5) * x
      eval-mach = sqrt(5) * x
      N-auto    = 2.23606797749978969641 * x
      N-mach    = 2.23606797749979 * x
    `);
  });

  test('Prefer (numeric value) x (term) over ((numeric value) x negate(term))', () => {
    expect(check('3 \\sqrt{5} (-x)')).toMatchInlineSnapshot(`
      box       = ["InvisibleOperator", 3, ["Sqrt", 5], ["Delimiter", ["Negate", "x"]]]
      canonical = ["Multiply", -3, ["Sqrt", 5], "x"]
      eval-auto = -3sqrt(5) * x
      eval-mach = -3sqrt(5) * x
      N-auto    = -6.70820393249936908923 * x
      N-mach    = -6.70820393249937 * x
    `);
  });

  test('Convert numbers followed by imaginary unit or radical to complex', () => {
    expect(check('3i+1.5i')).toMatchInlineSnapshot(`
      box       = ["Add", ["InvisibleOperator", 3, "i"], ["InvisibleOperator", 1.5, "i"]]
      canonical = ["Add", ["Complex", 0, 1.5], ["Complex", 0, 3]]
      simplify  = 4.5i
    `);
  });

  test('Convert numbers followed by radical to numeric value', () => {
    expect(check('5\\sqrt3\\frac17\\frac27\\sqrt5')).toMatchInlineSnapshot(`
      box       = [
        "InvisibleOperator",
        5,
        ["Sqrt", 3],
        ["Divide", 1, 7],
        ["Divide", 2, 7],
        ["Sqrt", 5]
      ]
      canonical = [
        "Multiply",
        5,
        ["Rational", 1, 7],
        ["Rational", 2, 7],
        ["Sqrt", 3],
        ["Sqrt", 5]
      ]
      simplify  = 10/49sqrt(15)
      eval-auto = 10/49sqrt(15)
      eval-mach = 10/49sqrt(15)
      N-auto    = 0.790404764532125894938
      N-mach    = 0.790404764532129
    `);
  });

  // Flatten, to multiple levels
  test('(1+(2+(3+4)))(((5+6)+7)((8+(9+10)))(11+(12+13)+14))', () => {
    expect(check('(1+(2+(3+4)))(((5+6)+7)((8+(9+10)))(11+(12+13)+14))'))
      .toMatchInlineSnapshot(`
      box       = [
        "InvisibleOperator",
        [
          "Delimiter",
          ["Add", 1, ["Delimiter", ["Add", 2, ["Delimiter", ["Add", 3, 4]]]]]
        ],
        [
          "Delimiter",
          [
            "InvisibleOperator",
            ["Delimiter", ["Add", ["Delimiter", ["Add", 5, 6]], 7]],
            [
              "Delimiter",
              ["Delimiter", ["Add", 8, ["Delimiter", ["Add", 9, 10]]]]
            ],
            ["Delimiter", ["Add", 11, ["Delimiter", ["Add", 12, 13]], 14]]
          ]
        ]
      ]
      canonical = [
        "Multiply",
        ["Add", 1, 2, 3, 4],
        ["Add", 11, 12, 13, 14],
        ["Add", 5, 6, 7],
        ["Add", 8, 9, 10]
      ]
      simplify  = 243000
    `);
  });

  // \frac should get hoisted with multiply, but not cancel
  // (multiplication by 0 does not always = 0)
  test('2x\\frac{0}{5}"', () => {
    expect(check('2x\\frac{0}{5}')).toMatchInlineSnapshot(`
      box       = ["InvisibleOperator", 2, "x", ["Divide", 0, 5]]
      canonical = ["Multiply", 0, 2, "x"]
      simplify  = 0
    `);
  });

  test('"2\\times0\\times5\\times4"', () => {
    expect(check('2\\times0\\times5\\times4')).toMatchInlineSnapshot(`
      box       = ["Multiply", 2, 0, 5, 4]
      canonical = ["Multiply", 0, 2, 4, 5]
      simplify  = 0
    `);
  });

  test('"2\\times(5-5)\\times5\\times4"', () => {
    expect(check('2\\times(5-5)\\times5\\times4')).toMatchInlineSnapshot(`
      box       = ["Multiply", 2, ["Delimiter", ["Subtract", 5, 5]], 5, 4]
      canonical = ["Multiply", 2, 4, 5, ["Subtract", 5, 5]]
      simplify  = 0
    `);
  });

  test('"2\\frac{x}{a}\\frac{y}{b}"', () => {
    expect(check('2\\frac{x}{a}\\frac{y}{b}')).toMatchInlineSnapshot(`
      box       = ["InvisibleOperator", 2, ["Divide", "x", "a"], ["Divide", "y", "b"]]
      canonical = ["Divide", ["Multiply", 2, "x", "y"], ["Multiply", "a", "b"]]
      simplify  = (2x * y) / (a * b)
    `);
  });

  describe('Power', () => {
    const engine = new ComputeEngine();

    /*
     * 'Power'-scoped symbol declarations
     */
    //@note: declarations are necessarily marked with 'holdUntil: never' - for these test cases - in
    //order to permit substitution during (before) application of canonical-forms.
    //^Necessary because 'a^x' is not a valid simplification (cannot assume that 'x' is bound), but
    //if x is substituted, then that's fine...
    engine.declare('x', { isConstant: true, value: 0, holdUntil: 'never' });
    engine.declare('y', { isConstant: true, value: 1, holdUntil: 'never' });

    engine.declare('p', {
      isConstant: true,
      value: Infinity,
      holdUntil: 'never',
    });
    engine.declare('n', {
      isConstant: true,
      value: -Infinity,
      holdUntil: 'never',
    });
    engine.declare('c', {
      isConstant: true,
      value: -Infinity,
      holdUntil: 'never',
    });

    //Control-case symbols (holdUntil value of default 'evaluate', and henceforth 'value' not to be
    //consulted at this stage)
    engine.declare('j', { isConstant: true, value: 0 });
    engine.declare('k', { isConstant: true, value: 1 });

    const checkPower = (
      input: string,
      priorForms: CanonicalForm[] = ['Number']
    ) => checkForms(input, [...priorForms, 'Power'], engine);

    test('0^x', () => {
      expect(checkPower('0^0')).toMatchInlineSnapshot(`
        box        = ["Power", 0, 0]
        canonForms = NaN
        canonical  = NaN
      `);
      expect(checkPower('0^{1.1}')).toMatchInlineSnapshot(`
        box        = ["Power", 0, 1.1]
        canonForms = 0
        canonical  = 0
      `);
      expect(checkPower('0^{-1}')).toMatchInlineSnapshot(`
        box        = ["Power", 0, -1]
        canonForms = ComplexInfinity
        canonical  = ComplexInfinity
      `);
      // x === 0 (simplifies because is substituted beforehand ('holdUntil = never'))
      expect(checkPower('x^3')).toMatchInlineSnapshot(`
        box        = ["Power", "x", 3]
        canonForms = 0
        canonical  = 0
      `);

      // Control
      //
      //'j=0', but should _not_ substitute (i.e. beforehand) & therefore no op. should take place
      //(its 'holdUntil' property is set to the default 'evaluate')
      expect(checkPower('j^3')).toMatchInlineSnapshot(`
        box        = ["Power", "j", 3]
        canonForms = ["Power", "j", 3]
      `);
    });

    test('x^0', () => {
      expect(checkPower('\\infty^0')).toMatchInlineSnapshot(`
        box        = ["Power", "PositiveInfinity", 0]
        canonForms = NaN
        canonical  = NaN
      `);
      expect(checkPower('\\operatorname{NaN}^0')).toMatchInlineSnapshot(`
        box        = ["Power", "NaN", 0]
        canonForms = NaN
        canonical  = NaN
      `);
      //↓Only simplifies because 'x' substitutes with its value during partial-canonicalization;
      //prior to app. of CanonicalForms.
      expect(checkPower('16^x')).toMatchInlineSnapshot(`
        box        = ["Power", 16, "x"]
        canonForms = 1
        canonical  = 1
      `);
      //!@note: this should be ok to apply, despite 'Pi' being a constant which does *not* have a
      //!'holdUntil' value set to 'never', because... this is a library/engine-level defined
      //!constant in which its type/value is always known: even in non-canonical expressions.
      //I.e., if this were a user-defined constant, this would not be OK, since its value would have
      //to be referenced.
      expect(checkPower('\\pi^0')).toMatchInlineSnapshot(`
        box        = ["Power", "Pi", 0]
        canonForms = 1
        canonical  = 1
      `);
      expect(checkPower('{-2.7243631}^0')).toMatchInlineSnapshot(`
        box        = ["Power", ["Negate", 2.7243631], 0]
        canonForms = 1
        canonical  = 1
      `);

      /*
       * Control-case
       */
      //j===0, but is *held*
      expect(checkPower('2^j')).toMatchInlineSnapshot(`
        box        = ["Power", 2, "j"]
        canonForms = ["Power", 2, "j"]
      `);
    });

    test('1^x', () => {
      expect(checkPower('1^{\\infty}')).toMatchInlineSnapshot(`
        box        = ["Power", 1, "PositiveInfinity"]
        canonForms = NaN
        canonical  = NaN
      `);
      expect(checkPower('1^{0}')).toMatchInlineSnapshot(`
        box        = ["Power", 1, 0]
        canonForms = 1
        canonical  = 1
      `);
      expect(checkPower('1^{6}')).toMatchInlineSnapshot(`
        box        = ["Power", 1, 6]
        canonForms = 1
        canonical  = 1
      `);
      expect(checkPower('1^{-0.001}')).toMatchInlineSnapshot(`
        box        = ["Power", 1, ["Negate", 0.001]]
        canonForms = 1
        canonical  = 1
      `);
    });

    test('x^1', () => {
      expect(checkPower('0^1')).toMatchInlineSnapshot(`
        box        = ["Power", 0, 1]
        canonForms = 0
        canonical  = 0
      `);
      expect(checkPower('1^1')).toMatchInlineSnapshot(`
        box        = ["Power", 1, 1]
        canonForms = 1
        canonical  = 1
      `);
      expect(checkPower('\\infty^1')).toMatchInlineSnapshot(`
        box        = ["Power", "PositiveInfinity", 1]
        canonForms = PositiveInfinity
        canonical  = PositiveInfinity
      `);

      //@note: This correctly simplifies, unlike would be expected of 'x^1' (where x is a
      //user-declared numeric constant with a default 'holdUntil' value of 'evaluate'), because 'Pi'
      //is a library-defined constant, consequently always being canonical & bound (and ∴ having a
      //type/value), even in *non-canonical* exprs.
      //^!Note that currently, 'x^1' *will simplify* at present, but this would not be considered
      //correct behaviour (compute-engine/pull/238#discussion_r2034335185). This is because
      //canonicalization of symbols (including partial-canonicalization) is presently, erroneously,
      //synonymous with 'binding': permitting its type/value to be determined at this stage.
      expect(checkPower('{\\pi}^1')).toMatchInlineSnapshot(`
        box        = ["Power", "Pi", 1]
        canonForms = Pi
        canonical  = Pi
      `);

      //↓🙁: cannot be simplified, at least via the route of checking the 'type' of the base/'-\pi',
      //because is a non-canonical function-expr. (non-bound to 'Power' definition)

      // expect(checkPower('{-\\pi}^1')).toMatchInlineSnapshot(`
      //   box        = ["Power", "Pi", 1]
      //   canonForms = Pi
      //   canonical  = Pi
      // `);

      /*
       * Control: j is declared as a constant with value 0 (see line 286).
       * Canonicalization maintains the structure; simplification would evaluate to 0.
       */
      expect(checkPower('{-j/4}^1')).toMatchInlineSnapshot(`
        box        = ["Power", ["Divide", ["Negate", "j"], 4], 1]
        canonForms = ["Power", ["Divide", ["Negate", "j"], 4], 1]
        canonical  = ["Multiply", ["Rational", -1, 4], "j"]
      `);
    });

    test(`x^{-1}`, () => {
      expect(checkPower('\\infty^{-1}')).toMatchInlineSnapshot(`
        box        = ["Power", "PositiveInfinity", -1]
        canonForms = 0
        canonical  = 0
      `);
      expect(checkPower('{-\\infty}^{-1}')).toMatchInlineSnapshot(`
        box        = ["Power", ["Negate", "PositiveInfinity"], -1]
        canonForms = 0
        canonical  = 0
      `);
      expect(checkPower('1^{-1}')).toMatchInlineSnapshot(`
        box        = ["Power", 1, -1]
        canonForms = 1
        canonical  = 1
      `);
      //note:'Rational' in place of a number because 'Number' (or fully canonical) not applied
      //subsequently
      expect(checkPower('3^{-1}')).toMatchInlineSnapshot(`
        box        = ["Power", 3, -1]
        canonForms = ["Rational", 1, 3]
        canonical  = ["Rational", 1, 3]
      `);
      expect(checkPower('{j * 4}^{-1}')).toMatchInlineSnapshot(`
        box        = ["Power", ["Multiply", "j", 4], -1]
        canonForms = ["Power", ["Multiply", "j", 4], -1]
        canonical  = ["Divide", 1, ["Multiply", 4, "j"]]
      `);
    });

    test('x^{oo}', () => {
      expect(checkPower('0^\\infty')).toMatchInlineSnapshot(`
        box        = ["Power", 0, "PositiveInfinity"]
        canonForms = 0
        canonical  = 0
      `);
      expect(checkPower('0.3^\\infty')).toMatchInlineSnapshot(`
        box        = ["Power", 0.3, "PositiveInfinity"]
        canonForms = 0
        canonical  = 0
      `);
      expect(checkPower('1^\\infty')).toMatchInlineSnapshot(`
        box        = ["Power", 1, "PositiveInfinity"]
        canonForms = NaN
        canonical  = NaN
      `);
      expect(checkPower('{-1}^\\infty')).toMatchInlineSnapshot(`
        box        = ["Power", -1, "PositiveInfinity"]
        canonForms = NaN
        canonical  = NaN
      `);
      expect(checkPower('{\\infty}^\\infty')).toMatchInlineSnapshot(`
        box        = ["Power", "PositiveInfinity", "PositiveInfinity"]
        canonForms = ComplexInfinity
        canonical  = ComplexInfinity
      `);
      expect(checkPower('{-\\infty}^\\infty')).toMatchInlineSnapshot(`
        box        = ["Power", ["Negate", "PositiveInfinity"], "PositiveInfinity"]
        canonForms = ComplexInfinity
        canonical  = ComplexInfinity
      `);
      expect(checkPower('6^\\infty')).toMatchInlineSnapshot(`
        box        = ["Power", 6, "PositiveInfinity"]
        canonForms = PositiveInfinity
        canonical  = PositiveInfinity
      `);
      expect(checkPower('{-2.46345162}^\\infty')).toMatchInlineSnapshot(`
        box        = ["Power", ["Negate", 2.46345162], "PositiveInfinity"]
        canonForms = ComplexInfinity
        canonical  = ComplexInfinity
      `);

      /*
       * Constant-symbol value cases.
       */
      // p === +Infinity (& 'holdUntil: never')
      expect(checkPower('1^{p}')).toMatchInlineSnapshot(`
        box        = ["Power", 1, "p"]
        canonForms = NaN
        canonical  = NaN
      `);
    });

    test(`x^{-oo}`, () => {
      expect(checkPower('0^{-\\infty}')).toMatchInlineSnapshot(`
        box        = ["Power", 0, ["Negate", "PositiveInfinity"]]
        canonForms = ComplexInfinity
        canonical  = ComplexInfinity
      `);
      expect(checkPower('0.3^{-\\infty}')).toMatchInlineSnapshot(`
        box        = ["Power", 0.3, ["Negate", "PositiveInfinity"]]
        canonForms = PositiveInfinity
        canonical  = PositiveInfinity
      `);
      expect(checkPower('1^{-\\infty}')).toMatchInlineSnapshot(`
        box        = ["Power", 1, ["Negate", "PositiveInfinity"]]
        canonForms = NaN
        canonical  = NaN
      `);
      expect(checkPower('{-1}^{-\\infty}')).toMatchInlineSnapshot(`
        box        = ["Power", -1, ["Negate", "PositiveInfinity"]]
        canonForms = NaN
        canonical  = NaN
      `);
      expect(checkPower('{-\\infty}^{-\\infty}')).toMatchInlineSnapshot(`
        box        = [
          "Power",
          ["Negate", "PositiveInfinity"],
          ["Negate", "PositiveInfinity"]
        ]
        canonForms = 0
        canonical  = 0
      `);
      expect(checkPower('{-{-\\infty}}^{-\\infty}')).toMatchInlineSnapshot(`
        box        = [
          "Power",
          ["Negate", ["Negate", "PositiveInfinity"]],
          ["Negate", "PositiveInfinity"]
        ]
        canonForms = 0
        canonical  = 0
      `);
      expect(checkPower('6^{-\\infty}')).toMatchInlineSnapshot(`
        box        = ["Power", 6, ["Negate", "PositiveInfinity"]]
        canonForms = 0
        canonical  = 0
      `);
      //🙁: cannot be simplified, base/'Negate' is non-canonical and 'type' cannot be determined.
      // expect(checkPower('{-\\pi}^{-\\infty}')).toMatchInlineSnapshot(`
      //   box        = ["Power", ["Negate", "Pi"], "NegativeInfinity"]
      //   canonForms = ["Power", ["Negate", "Pi"], "NegativeInfinity"]
      //   canonical  = 0
      // `);

      /*
       * Constant-valued symbol operands
       */
      //x=0, n=NegativeInfinity ('holdUntil: never'),
      expect(checkPower('x^{n}')).toMatchInlineSnapshot(`
        box        = ["Power", "x", "n"]
        canonForms = ComplexInfinity
        canonical  = ComplexInfinity
      `);
    });

    test(`x^{~oo}`, () => {
      expect(checkPower('0^{\\operatorname{ComplexInfinity}}'))
        .toMatchInlineSnapshot(`
        box        = ["Power", 0, "ComplexInfinity"]
        canonForms = NaN
        canonical  = NaN
      `);
      expect(checkPower('1^{\\operatorname{ComplexInfinity}}'))
        .toMatchInlineSnapshot(`
        box        = ["Power", 1, "ComplexInfinity"]
        canonForms = NaN
        canonical  = NaN
      `);
      expect(checkPower('-1^{\\operatorname{ComplexInfinity}}'))
        .toMatchInlineSnapshot(`
        box        = ["Negate", ["Power", 1, "ComplexInfinity"]]
        canonForms = NaN
        canonical  = NaN
      `);
      expect(checkPower('\\infty^{\\operatorname{ComplexInfinity}}'))
        .toMatchInlineSnapshot(`
        box        = ["Power", "PositiveInfinity", "ComplexInfinity"]
        canonForms = NaN
        canonical  = NaN
      `);
      expect(checkPower('{-\\infty}^{\\operatorname{ComplexInfinity}}'))
        .toMatchInlineSnapshot(`
        box        = ["Power", ["Negate", "PositiveInfinity"], "ComplexInfinity"]
        canonForms = NaN
        canonical  = NaN
      `);
      expect(checkPower('{-\\mathrm{NaN}}^{\\operatorname{ComplexInfinity}}'))
        .toMatchInlineSnapshot(`
        box        = ["Power", ["Negate", "NaN"], "ComplexInfinity"]
        canonForms = NaN
        canonical  = NaN
      `);
    });

    test('Infinity^{a + bi}', () => {
      let check = (input: string) =>
        checkPower(input, ['InvisibleOperator', 'Number']);

      expect(check('\\infty^i')).toMatchInlineSnapshot(`
        box        = ["Power", "PositiveInfinity", "i"]
        canonForms = NaN
        canonical  = NaN
      `);

      expect(check('{\\operatorname{ComplexInfinity}}^{-3i}'))
        .toMatchInlineSnapshot(`
        box        = ["Power", "ComplexInfinity", ["InvisibleOperator", -3, "i"]]
        canonForms = NaN
        canonical  = NaN
      `);

      //Include 'Add' in order that complex-numbers may be identified for these cases.
      //(^note that this may later be included as part of the 'Number' form)
      check = (input: string) =>
        checkPower(input, ['InvisibleOperator', 'Number', 'Add']);

      expect(check('\\infty^{2 + i}')).toMatchInlineSnapshot(`
        box        = ["Power", "PositiveInfinity", ["Add", 2, "i"]]
        canonForms = ComplexInfinity
        canonical  = ComplexInfinity
      `);

      expect(check('\\infty^{-1 - 3i}')).toMatchInlineSnapshot(`
        box        = [
          "Power",
          "PositiveInfinity",
          ["Subtract", ["InvisibleOperator", -3, "i"], 1]
        ]
        canonForms = 0
        canonical  = 0
      `);
    });

    test('x^{1/y}', () => {
      expect(checkPower('a^{1/2}')).toMatchInlineSnapshot(`
        box        = ["Power", "a", ["Divide", 1, 2]]
        canonForms = ["Sqrt", "a"]
        canonical  = ["Sqrt", "a"]
      `);
      expect(checkPower('{7\\sqrt{13}}^{0.5}')).toMatchInlineSnapshot(`
        box        = ["Power", ["InvisibleOperator", 7, ["Sqrt", 13]], 0.5]
        canonForms = ["Sqrt", ["InvisibleOperator", 7, ["Sqrt", 13]]]
        canonical  = ["Sqrt", ["Multiply", 7, ["Sqrt", 13]]]
      `);
      //note: for the following two cases, 'fully'-canonical transforms 'Divide -> Multiply' (this
      //being preferred to facilitate further ops.)
      expect(checkPower('{a/3}^{1/3}')).toMatchInlineSnapshot(`
        box        = ["Power", ["Divide", "a", 3], ["Divide", 1, 3]]
        canonForms = ["Root", ["Divide", "a", 3], 3]
        canonical  = ["Root", ["Multiply", ["Rational", 1, 3], "a"], 3]
      `);
    });

    test(`(a^b)^c -> a^(b*c)`, () => {
      // expect(checkPower('')).toMatchInlineSnapshot();
      expect(checkPower('{a^3}^4')).toMatchInlineSnapshot(`
        box        = ["Power", ["Power", "a", 3], 4]
        canonForms = ["Power", "a", ["Multiply", 3, 4]]
        canonical  = ["Power", "a", ["Multiply", 3, 4]]
      `);
      //note: 'Multiply' args. are ordered in the output JSON: but the result 'Power'
      //BoxedExpression still has (ordered) operands [b, c].
      expect(checkPower('{a^{{b^2}^e}}^{0.5*\\pi}')).toMatchInlineSnapshot(`
        box        = [
          "Power",
          ["Power", "a", ["Power", ["Square", "b"], "e"]],
          ["Multiply", 0.5, "Pi"]
        ]
        canonForms = [
          "Power",
          "a",
          [
            "Multiply",
            ["Power", "b", ["Multiply", 2, "ExponentialE"]],
            ["Multiply", 0.5, "Pi"]
          ]
        ]
        canonical  = [
          "Power",
          "a",
          [
            "Multiply",
            0.5,
            "Pi",
            ["Power", "b", ["Multiply", 2, "ExponentialE"]]
          ]
        ]
      `);
    });
  });

  describe('Number', () => {
    const ce = TEST_ENGINE;
    let expr: string | SemiBoxedExpression;

    const nonCanon = (input: string | SemiBoxedExpression) =>
      typeof input === 'string'
        ? ce.parse(input, { form: 'raw' })
        : ce.box(input, { form: 'raw' });
    const checkNumber = (input: string | SemiBoxedExpression) =>
      checkForms(input, ['Number'], ce);
    const canonNumber = (input: string | SemiBoxedExpression) =>
      typeof input === 'string'
        ? ce.parse(input, { form: 'Number' })
        : ce.box(input, { form: 'Number' });

    //*note*: BoxedNumbers may get JSON serialized as ['Rational',...] ('check' outputs JSON): so
    //need to additionally test for the result 'operator' as 'Number' for desired result.
    test(`'Rational' or 'Divide' (expr.) -> number (when valid)`, () => {
      expr = '1/3';
      //(•see above note: both 'canonForms' & 'canonical' are serialized as 'Rational', but may still
      //be numbers)
      expect(checkNumber(expr)).toMatchInlineSnapshot(`
        box        = ["Divide", 1, 3]
        canonForms = ["Rational", 1, 3]
        canonical  = ["Rational", 1, 3]
      `);
      expect(canonNumber(expr).operator).toBe('Number');

      expr = '3/7';
      expect(checkNumber(expr)).toMatchInlineSnapshot(`
        box        = ["Divide", 3, 7]
        canonForms = ["Rational", 3, 7]
        canonical  = ["Rational", 3, 7]
      `);
      expect(canonNumber(expr).operator).toBe('Number');

      //(case of direct number serialization (denominator of 1))
      expr = '2/1';
      expect(checkNumber(expr)).toMatchInlineSnapshot(`
        box        = ["Divide", 2, 1]
        canonForms = 2
        canonical  = 2
      `);
      expect(canonNumber(expr).operator).toBe('Number');

      /*
       * BigNum (Decimal)
       */
      //@note: as of time of writing (CE 0.29.1), the test engine which test-cases in this block use
      //has a precision set to `100`: so all BigNum/Int digits are output.
      const bigRational: SemiBoxedExpression = [
        'Divide',
        '318982460862894267352492496399',
        '-358796515092200247647243',
      ];
      expect(checkNumber(bigRational)).toMatchInlineSnapshot(`
        box        = [
          "Divide",
          {num: "318982460862894267352492496399"},
          {num: "-358796515092200247647243"}
        ]
        canonForms = [
          "Rational",
          {num: "-318982460862894267352492496399"},
          {num: "358796515092200247647243"}
        ]
        canonical  = [
          "Rational",
          {num: "-318982460862894267352492496399"},
          {num: "358796515092200247647243"}
        ]
      `);
      expect(canonNumber(expr).operator).toBe('Number'); // ✔

      /*
       * Control
       */
      expr = '13.19/7.7';
      expect(checkNumber(expr)).toMatchInlineSnapshot(`
        box        = ["Divide", 13.19, 7.7]
        canonForms = ["Divide", 13.19, 7.7]
      `);
    });

    test(`'Rational' (expr.) -> Divide (when non-rational)`, () => {
      expect(checkNumber(['Rational', 1, 'Pi'])).toMatchInlineSnapshot(`
        box        = ["Rational", 1, "Pi"]
        canonForms = ["Divide", 1, "Pi"]
        canonical  = ["Divide", 1, "Pi"]
      `);
      expect(checkNumber(['Rational', 7.01, 3])).toMatchInlineSnapshot(`
        box        = ["Rational", 7.01, 3]
        canonForms = ["Divide", 7.01, 3]
        canonical  = ["Divide", 7.01, 3]
      `);
      //(↓For full-canonical, additional simplifications applied (hence 'Multiply'))
      expect(checkNumber(['Rational', 'ExponentialE', 2]))
        .toMatchInlineSnapshot(`
        box        = ["Rational", "ExponentialE", 2]
        canonForms = ["Divide", "ExponentialE", 2]
        canonical  = ["Multiply", ["Rational", 1, 2], "ExponentialE"]
      `);
    });

    // @wip?
    // -Presently, 'Complex'-operator exprs. are the only ones cast as BoxedNumber for this form.
    // Later potential candidates include those related which take place in Add/Multiply (see
    // https://github.com/cortex-js/compute-engine/pull/238#discussion_r2033792056)
    describe("'Complex' exprs.", () => {
      //@note: 'check' is not helpful here, since a `['Complex', ...]` expr. is 'pretty'-printed for
      //each variant: whereas we want to test the 'operator'/type
      test(`Convert to eqv. BoxedNumbers`, () => {
        const expComplexNum = (
          expr: string | SemiBoxedExpression,
          type?: NumericType
        ) => {
          expect(nonCanon(expr).operator).toMatchInlineSnapshot(`Complex`);
          expect(canonNumber(expr).operator).toBe(`Number`);
          expect(canonNumber(expr).type.matches(type ?? 'complex')).toBe(true);
        };

        // Imaginary (only)
        expr = ['Complex', 1];
        expComplexNum(expr, 'imaginary');

        expr = ['Complex', ['Rational', 1, 43]];
        expComplexNum(expr, 'imaginary');

        // finite_complex / complex
        expr = ['Complex', 3, 4];
        expComplexNum(expr, 'finite_complex');

        //@fixme
        //(A present bug: that bignum args. get truncated when canonicalized as a complex-number:
        //regardless of set precision)
        //@note: precision is '100' for the engine used here...
        expr = ['Complex', '22975850700614579948873711', 4]; // bigIntRe
        expComplexNum(expr, 'finite_complex');

        expr = ['Complex', Infinity, 4]; // bigIntRe
        expComplexNum(expr, 'complex');
      });

      test(`Convert to 'Add', when imaginary arg. is non-numeric`, () => {
        expr = ['Complex', 4, 'x'];
        expect(checkNumber(expr)).toMatchInlineSnapshot(`
          box        = ["Complex", 4, "x"]
          canonForms = ["Add", 4, ["Multiply", "x", ["Complex", 0, 1]]]
          canonical  = ["Add", ["Multiply", ["Complex", 0, 1], "x"], 4]
        `);

        expr = ['Complex', 1, ['Multiply', 'n', 4]];
        expect(checkNumber(expr)).toMatchInlineSnapshot(`
          box        = ["Complex", 1, ["Multiply", "n", 4]]
          canonForms = ["Add", 1, ["Multiply", ["Multiply", "n", 4], ["Complex", 0, 1]]]
          canonical  = ["Add", ["Multiply", ["Complex", 0, 4], "n"], 1]
        `);
      });
    });

    test("Cast 'Negate' wrapped numbers as number exprs. ", () => {
      expect(checkNumber('-1')).toMatchInlineSnapshot(`
        box        = -1
        canonForms = -1
      `);

      expect(checkNumber('-3.6')).toMatchInlineSnapshot(`
        box        = ["Negate", 3.6]
        canonForms = -3.6
        canonical  = -3.6
      `);

      expr = ['Negate', ['Complex', 1, 4]];
      expect(checkNumber(expr)).toMatchInlineSnapshot(`
        box        = ["Negate", ["Complex", 1, 4]]
        canonForms = ["Complex", -1, -4]
        canonical  = ["Complex", -1, -4]
      `);
      expect(canonNumber(expr).operator).toBe('Number');

      expr = ['Negate', ['Rational', 9, 16]];
      expect(checkNumber(expr)).toMatchInlineSnapshot(`
        box        = ["Negate", ["Rational", 9, 16]]
        canonForms = ["Rational", -9, 16]
        canonical  = ["Rational", -9, 16]
      `);
      expect(canonNumber(expr).operator).toBe('Number');
    });

    //(↓Only replaces for the *unit*, including negated...)
    //@wip?: maybe 'InvisibleOperator' case of '3i' etc. should be covered
    test(`Replace 'ImaginaryUnit' symbol instances with a number`, () => {
      expect(checkNumber('i')).toMatchInlineSnapshot(`
        box        = i
        canonForms = ["Complex", 0, 1]
        canonical  = ["Complex", 0, 1]
      `);

      expect(checkNumber('-i')).toMatchInlineSnapshot(`
        box        = ["Negate", "i"]
        canonForms = ["Complex", 0, -1]
        canonical  = ["Complex", 0, -1]
      `);
    });
  });
});

//
// COMMUTATIVE ORDER
// (for multiplication, and other commutative functios, except addition)
//
describe('COMMUTATIVE ORDER', () => {
  // multiply is commutative and regular canonical sort order applies
  // (numbers before symbols)
  test(`Canonical form yx5z`, () => {
    expect(check('yx5z')).toMatchInlineSnapshot(`
      box       = ["InvisibleOperator", "y", "x", 5, "z"]
      canonical = ["Multiply", 5, "x", "y", "z"]
    `);
  });

  // The arguments of commutative functions are sorted lexicographically
  // numerical constants (by value), then constants (lexicographically),
  // then free variables (lex),
  test(`Canonical form '-2x5z\\sqrt{y}\\frac{3}{4}3\\pi y'`, () => {
    expect(check('-2x5z\\sqrt{y}\\frac{3}{4}3\\pi y')).toMatchInlineSnapshot(`
      box       = [
        "InvisibleOperator",
        -2,
        "x",
        5,
        "z",
        ["Sqrt", "y"],
        ["Divide", 3, 4],
        3,
        "Pi",
        "y"
      ]
      canonical = [
        "Multiply",
        -2,
        3,
        5,
        ["Rational", 3, 4],
        "Pi",
        "x",
        "y",
        "z",
        ["Sqrt", "y"]
      ]
      simplify  = -45/2 * pi * x * z * y^(3/2)
      eval-auto = -45/2 * pi * x * z * y^(3/2)
      eval-mach = -45/2 * pi * x * z * y^(3/2)
      N-auto    = -70.6858347057703478658 * x * z * y^2
      N-mach    = -70.6858347057702 * x * z * y^2
    `);
  });

  test(`Canonical form '(b^3c^2d)(x^7y)(a^5g)(b^2x^5b3)'`, () => {
    expect(check('(b^3c^2d)(x^7y)(a^5g)(b^2x^5b3)')).toMatchInlineSnapshot(`
      box       = [
        "InvisibleOperator",
        [
          "Delimiter",
          ["InvisibleOperator", ["Power", "b", 3], ["Square", "c"], "d"]
        ],
        ["Delimiter", ["InvisibleOperator", ["Power", "x", 7], "y"]],
        ["Delimiter", ["InvisibleOperator", ["Power", "a", 5], "g"]],
        [
          "Delimiter",
          ["InvisibleOperator", ["Square", "b"], ["Power", "x", 5], "b", 3]
        ]
      ]
      canonical = [
        "Multiply",
        3,
        "b",
        "d",
        "g",
        "y",
        ["Power", "x", 7],
        ["Power", "a", 5],
        ["Power", "x", 5],
        ["Power", "b", 3],
        ["Square", "b"],
        ["Square", "c"]
      ]
      simplify  = 3d * g * y * x^(12) * b^6 * a^5 * c^2
    `);
  });
});

//
// POLYNOMIAL ORDER
// (for addition)
// Arguments of addition use the deglex sorting order:
// - by total degree (sum of the degrees of the factors),
// - by max degree (largest degree of the factors),
// - by lexicographic order of the factors.
// - by rank (constants, non-algebraic functions, numbers, etc...)
//

describe('POLYNOMIAL ORDER', () => {
  // -> a+b+c+5+7
  test(`Canonical form c+7+a+5+b`, () => {
    expect(check('c+7+a+5+b')).toMatchInlineSnapshot(`
      box       = ["Add", "c", 7, "a", 5, "b"]
      canonical = ["Add", "a", "b", "c", 5, 7]
      simplify  = a + b + c + 12
    `);
  });

  // 7a -> degree 1 > degree 0
  // 2b -> degree 1, b > a
  // 5c -> degree 1, c > b
  // 6 -> degree 0
  test(`Canonical form 6+5c+2b+3+7a'`, () => {
    expect(check('6+5c+2b+3+7a')).toMatchInlineSnapshot(`
      box       = [
        "Add",
        6,
        ["InvisibleOperator", 5, "c"],
        ["InvisibleOperator", 2, "b"],
        3,
        ["InvisibleOperator", 7, "a"]
      ]
      canonical = [
        "Add",
        ["Multiply", 7, "a"],
        ["Multiply", 2, "b"],
        ["Multiply", 5, "c"],
        3,
        6
      ]
      simplify  = 7a + 2b + 5c + 9
    `);
  });

  // Arguments sorted by value
  test(`Canonical form 5a+3a+7a`, () => {
    expect(check('5a+3a+7a')).toMatchInlineSnapshot(`
      box       = [
        "Add",
        ["InvisibleOperator", 5, "a"],
        ["InvisibleOperator", 3, "a"],
        ["InvisibleOperator", 7, "a"]
      ]
      canonical = [
        "Add",
        ["Multiply", 3, "a"],
        ["Multiply", 5, "a"],
        ["Multiply", 7, "a"]
      ]
      simplify  = 15a
    `);
  });

  test(`Canonical form x^{3}2\\pi+3x^{3}4\\pi+x^3`, () => {
    expect(check('x^{3}2\\pi+3x^{3}4\\pi+x^3')).toMatchInlineSnapshot(`
      box       = [
        "Add",
        ["InvisibleOperator", ["Power", "x", 3], 2, "Pi"],
        ["InvisibleOperator", 3, ["Power", "x", 3], 4, "Pi"],
        ["Power", "x", 3]
      ]
      canonical = [
        "Add",
        ["Multiply", 3, 4, "Pi", ["Power", "x", 3]],
        ["Multiply", 2, "Pi", ["Power", "x", 3]],
        ["Power", "x", 3]
      ]
      simplify  = 14pi * x^3 + x^3
      eval-auto = 14pi * x^3 + x^3
      eval-mach = 14pi * x^3 + x^3
      N-auto    = 44.9822971502571053383 * x^3
      N-mach    = 44.982297150257104 * x^3
    `);
  });

  test(`Canonical form 'x^2y^3+x^3y^2+xy^4+x^4y+x^2y^2'`, () => {
    expect(check('x^2y^3+x^3y^2+xy^4+x^4y+x^2y^2')).toMatchInlineSnapshot(`
      box       = [
        "Add",
        ["InvisibleOperator", ["Square", "x"], ["Power", "y", 3]],
        ["InvisibleOperator", ["Power", "x", 3], ["Square", "y"]],
        ["InvisibleOperator", "x", ["Power", "y", 4]],
        ["InvisibleOperator", ["Power", "x", 4], "y"],
        ["InvisibleOperator", ["Square", "x"], ["Square", "y"]]
      ]
      canonical = [
        "Add",
        ["Multiply", "y", ["Power", "x", 4]],
        ["Multiply", "x", ["Power", "y", 4]],
        ["Multiply", ["Power", "y", 3], ["Square", "x"]],
        ["Multiply", ["Power", "x", 3], ["Square", "y"]],
        ["Multiply", ["Square", "x"], ["Square", "y"]]
      ]
    `);
  });

  test(`Canonical form '(b^3b^2)+(a^3a^2)+(b^6)+(a^5b)+(a^5)'`, () => {
    expect(check('(b^3b^2)+(a^3a^2)+(b^6)+(a^5b)+(a^5)'))
      .toMatchInlineSnapshot(`
      box       = [
        "Add",
        [
          "Delimiter",
          ["InvisibleOperator", ["Power", "b", 3], ["Square", "b"]]
        ],
        [
          "Delimiter",
          ["InvisibleOperator", ["Power", "a", 3], ["Square", "a"]]
        ],
        ["Delimiter", ["Power", "b", 6]],
        ["Delimiter", ["InvisibleOperator", ["Power", "a", 5], "b"]],
        ["Delimiter", ["Power", "a", 5]]
      ]
      canonical = [
        "Add",
        ["Power", "b", 6],
        ["Multiply", "b", ["Power", "a", 5]],
        ["Power", "a", 5],
        ["Multiply", ["Power", "a", 3], ["Square", "a"]],
        ["Multiply", ["Power", "b", 3], ["Square", "b"]]
      ]
      simplify  = b^6 + b * a^5 + 2a^5 + b^5
    `);
  });

  test(`Canonical form '5c^2a^4+2b^8+7b^3a'`, () => {
    expect(check('5c^2a^4+2b^8+7b^3a')).toMatchInlineSnapshot(`
      box       = [
        "Add",
        ["InvisibleOperator", 5, ["Square", "c"], ["Power", "a", 4]],
        ["InvisibleOperator", 2, ["Power", "b", 8]],
        ["InvisibleOperator", 7, ["Power", "b", 3], "a"]
      ]
      canonical = [
        "Add",
        ["Multiply", 2, ["Power", "b", 8]],
        ["Multiply", 5, ["Power", "a", 4], ["Square", "c"]],
        ["Multiply", 7, "a", ["Power", "b", 3]]
      ]
    `);
  });
});

// describe('OBJECT LITERAL FORM', () => {
//   test('Shorthand parse', () => {
//     expect(
//       engine.format(['Add', 'x', ['Sin', 'Pi'], 2], ['object-literal'])
//     ).toMatchInlineSnapshot(
//       `{fn: [{sym: 'Add'}, {sym: 'x'}, {fn: [{sym: 'Sin'}, {sym: 'Pi'}]}, {num: '2'}]}`
//     );
//   });
//   test('Expression with metadata', () => {
//     expect(
//       engine.format(
//         [
//           { sym: 'Add', metadata: 'add' },
//           { sym: 'x', metadata: 'ecks' },
//           { fn: ['Sin', 'Pi'], metadata: 'fn-md' },
//           { num: '1', metadata: 'one' },
//         ] as any,
//         ['object-literal']
//       )
//     ).toMatchInlineSnapshot(
//       `{fn: [{sym: 'Add', metadata: 'add'}, {sym: 'x', metadata: 'ecks'}, {fn: [{sym: 'Sin'}, {sym: 'Pi'}], metadata: 'fn-md'}, {num: '1', metadata: 'one'}]}`
//     );
//   });
// });

/**
 *
 * Print/check boxed expression variants in a similar way to function 'checkJson', but only prints
 * for variants 'boxed' (non-canonical), 'canonical', but also 'canonForms' (i.e. partial-canonical).
 *
 * Only prints 'canonical' if this differs from 'boxed'.
 *
 * <!--
 * **NOTE**:
 * -Unlike 'checkJson', does not temporarily set the engine's precision to 'auto' for printing.
 * (Save oneself some headaches...)
 * -->
 *
 * @param inExpr
 * @param forms
 * @param [engine]
 * @returns
 */
function checkForms(
  inExpr: string | SemiBoxedExpression,
  forms: CanonicalForm[],
  engine?: ComputeEngine
): string {
  //Throw, because forms will not apply to an expr. in which 'isCanonical === true' (either
  //partial,or full canonicalization)
  if (inExpr instanceof _BoxedExpression && inExpr.isCanonical)
    throw new Error(
      "Received an already canonical ('CanonicalForms' or full) expression"
    );

  //Fall-back on file-scoped engine
  engine ??= TEST_ENGINE;

  try {
    //Boxed, *non-canonical*
    const boxed =
      typeof inExpr === 'string'
        ? engine.parse(inExpr, { form: 'raw' })
        : engine.box(inExpr, { form: 'raw' });

    const boxedStr = exprToString(boxed);

    if (!boxed.isValid) {
      return `invalid   =${exprToString(boxed)}`;
    }

    const partialCanon = engine.box(boxed, { form: forms });
    const partialCanonStr = exprToString(partialCanon);

    const canonical = engine.box(boxed);
    const canonicalStr = exprToString(canonical);

    // boxed/non-canonical
    const result: string[] = ['box        = ' + boxedStr];

    result.push('canonForms = ' + partialCanonStr);
    if (canonicalStr !== boxedStr) result.push('canonical  = ' + canonicalStr);

    return result.join('\n');
  } catch (e) {
    return e.toString();
  }
}
