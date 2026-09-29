/**
 * The `Indeterminate` value (Phases 1 and 2 of
 * `docs/plans/2026-09-28-indeterminate-value.md`).
 *
 * `Indeterminate` is the exact answer to an indeterminate form such as `0/0`:
 * a number literal whose double value is `NaN`, marked `isIndeterminate`, and
 * a different value from the `NaN` literal (the result of a floating-point
 * computation that failed). Phase 1 added the value and every mechanism that
 * carries it; most tests here give `Indeterminate` as INPUT
 * (`ce.Indeterminate`, the MathJSON symbol `"Indeterminate"`, the LaTeX
 * `\operatorname{Indeterminate}` or the Epsil word `Indeterminate`). Phase 2
 * switched the exact producers (`0/0`, `0·∞`, `Mod(5, 0)` and the others): the
 * `describe` blocks named "the producers" pin them.
 *
 * One `describe` per row of the decision table (§5 of the design note), on the
 * box, parse and Epsil routes.
 */

import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { markAbsentPointCells } from '../../src/compute-engine/boxed-expression/validate';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import { serializeEpsil } from '../../src/epsil/serialize-epsil';
import { formatValue } from '../../src/cli/format';
import { makeEpsilSession } from '../../src/cli/session';
import { parseType } from '../../src/common/type/parse';
import { isSubtype } from '../../src/common/type/subtype';
import { typeToString } from '../../src/common/type/serialize';

const ce = new ComputeEngine();

/** Evaluate a MathJSON expression (the box route). */
function box(json: MathJsonExpression): Expression {
  return ce.box(json).evaluate();
}

/** `.N()` of a MathJSON expression. */
function boxN(json: MathJsonExpression): Expression {
  return ce.box(json).N();
}

/** Evaluate a LaTeX expression (the parse route). */
function parse(latex: string): Expression {
  return ce.parse(latex).evaluate();
}

/** Run an Epsil program on a fresh engine and return its value. */
function epsil(source: string): Expression {
  const { value, diagnostics } = executeEpsil(new ComputeEngine(), source);
  expect(diagnostics).toEqual([]);
  return value;
}

const I = '\\operatorname{Indeterminate}';

describe('INDETERMINATE — the value', () => {
  test('ce.Indeterminate is a NaN-valued number literal with its own mark', () => {
    const x = ce.Indeterminate;
    expect(x.isNumber).toBe(true);
    expect(x.isNaN).toBe(true);
    expect(x.isIndeterminate).toBe(true);
    expect(x.isFinite).toBe(false);
    expect(x.operator).toBe('Indeterminate');
    expect(x.toString()).toBe('Indeterminate');
    expect(x.json).toBe('Indeterminate');
    expect(x.re).toBeNaN();
  });

  test('isIndeterminate is false everywhere else', () => {
    expect(ce.NaN.isIndeterminate).toBe(false);
    expect(ce.number(NaN).isIndeterminate).toBe(false);
    expect(ce.box('x').isIndeterminate).toBe(false);
    expect(ce.box(['Divide', 1, 2]).isIndeterminate).toBe(false);
    expect(ce.box(['Sin', 'x']).isIndeterminate).toBe(false);
  });

  test('every input spelling gives the interned value', () => {
    expect(ce.box('Indeterminate')).toBe(ce.Indeterminate);
    expect(ce.parse(I).isIndeterminate).toBe(true);
    expect(ce.parse('\\mathrm{Indeterminate}').isIndeterminate).toBe(true);
    expect(epsil('Indeterminate').isIndeterminate).toBe(true);
  });

  test('`{num: "Indeterminate"}` is not a spelling of the value', () => {
    // `{num: …}` is numeric text only; a text that is not a number boxes
    // to `NaN`, as `{num: "foo"}` does.
    const x = ce.box({ num: 'Indeterminate' });
    expect(x.isIndeterminate).toBe(false);
    expect(x.isNaN).toBe(true);
  });

  test('the raw form keeps the symbol', () => {
    const raw = ce.box('Indeterminate', { form: 'raw' });
    expect(raw.symbol).toBe('Indeterminate');
    expect(raw.evaluate().isIndeterminate).toBe(true);
    expect(raw.canonical.isIndeterminate).toBe(true);
  });

  test('a symbol assigned the value holds it', () => {
    const ce2 = new ComputeEngine();
    ce2.assign('y', ce2.Indeterminate);
    expect(ce2.box('y').evaluate().isIndeterminate).toBe(true);
    expect(ce2.box(['Add', 'y', 1]).evaluate().isIndeterminate).toBe(true);
    expect(ce2.box('y').N().toString()).toBe('NaN');
  });
});

describe('INDETERMINATE — the propagate gate forwards it', () => {
  test.each(['Sin', 'Ln', 'Gamma', 'Arctan', 'Floor', 'Erf', 'Sqrt', 'Abs', 'Exp'])(
    '%s(Indeterminate) is Indeterminate, never inert',
    (head) => {
      expect(box([head, 'Indeterminate']).toString()).toBe('Indeterminate');
      expect(boxN([head, 'Indeterminate']).toString()).toBe('NaN');
    }
  );

  test('the parse and Epsil routes agree', () => {
    expect(parse(`\\sin(${I})`).toString()).toBe('Indeterminate');
    expect(parse(`\\sqrt{${I}}`).toString()).toBe('Indeterminate');
    expect(parse(`\\ln(${I})`).toString()).toBe('Indeterminate');
    expect(epsil('sin(Indeterminate)').toString()).toBe('Indeterminate');
    expect(epsil('gamma(Indeterminate)').toString()).toBe('Indeterminate');
  });

  test('an exact second operand keeps it', () => {
    expect(box(['Arctan2', 'Indeterminate', 1]).toString()).toBe('Indeterminate');
    expect(box(['Mod', 'Indeterminate', 2]).toString()).toBe('Indeterminate');
  });

  test('a list operand forwards it per cell', () => {
    expect(box(['Sin', ['List', 0, 'Indeterminate']]).toString()).toBe(
      '[0,Indeterminate]'
    );
  });
});

describe('INDETERMINATE — the gate answers NaN for a NaN or inexact operand', () => {
  test('Arctan2 with NaN or a float', () => {
    expect(box(['Arctan2', 'Indeterminate', 'NaN']).toString()).toBe('NaN');
    expect(box(['Arctan2', 'NaN', 'Indeterminate']).toString()).toBe('NaN');
    expect(box(['Arctan2', 'Indeterminate', { num: '1.5' }]).toString()).toBe(
      'NaN'
    );
  });
});

describe('INDETERMINATE — the Add and Multiply folds', () => {
  test('an exact term keeps Indeterminate', () => {
    expect(box(['Add', 'Indeterminate', 1]).toString()).toBe('Indeterminate');
    expect(box(['Multiply', 2, 'Indeterminate']).toString()).toBe(
      'Indeterminate'
    );
    expect(box(['Add', 'Indeterminate', 'x']).toString()).toBe('Indeterminate');
    expect(box(['Multiply', 'x', 'Indeterminate']).toString()).toBe(
      'Indeterminate'
    );
    expect(box(['Subtract', 'Indeterminate', 1]).toString()).toBe(
      'Indeterminate'
    );
    expect(box(['Negate', 'Indeterminate']).toString()).toBe('Indeterminate');
    expect(box(['Divide', 'Indeterminate', 2]).toString()).toBe('Indeterminate');
    expect(box(['Divide', 2, 'Indeterminate']).toString()).toBe('Indeterminate');
    expect(box(['Power', 'Indeterminate', 2]).toString()).toBe('Indeterminate');
    expect(box(['Power', 2, 'Indeterminate']).toString()).toBe('Indeterminate');
    expect(box(['Power', 'Indeterminate', 0]).toString()).toBe('Indeterminate');
  });

  test('an inexact term (a float or NaN) gives NaN, in any position', () => {
    expect(box(['Add', 'Indeterminate', { num: '1.5' }]).toString()).toBe('NaN');
    expect(box(['Add', { num: '1.5' }, 'Indeterminate']).toString()).toBe('NaN');
    expect(box(['Add', 'Indeterminate', 'NaN']).toString()).toBe('NaN');
    expect(box(['Multiply', 'Indeterminate', { num: '2.0' }]).toString()).toBe(
      'NaN'
    );
    expect(box(['Multiply', { num: '2.0' }, 'Indeterminate']).toString()).toBe(
      'NaN'
    );
    expect(box(['Multiply', 'Indeterminate', 'NaN']).toString()).toBe('NaN');
    expect(box(['Multiply', 'NaN', 'Indeterminate']).toString()).toBe('NaN');
    expect(box(['Divide', 'Indeterminate', { num: '2.0' }]).toString()).toBe(
      'NaN'
    );
  });

  test('an absent term gives NaN (the absence rule is unchanged)', () => {
    expect(box(['Add', 'Indeterminate', 'Missing']).toString()).toBe('NaN');
  });

  test('the parse and Epsil routes agree', () => {
    expect(parse(`${I}+1`).toString()).toBe('Indeterminate');
    expect(parse(`${I}+1.5`).toString()).toBe('NaN');
    expect(parse(`2${I}`).toString()).toBe('Indeterminate');
    expect(epsil('Indeterminate + 1').toString()).toBe('Indeterminate');
    expect(epsil('Indeterminate + 1.5').toString()).toBe('NaN');
    expect(epsil('2 * Indeterminate').toString()).toBe('Indeterminate');
    expect(epsil('Indeterminate * 2.0').toString()).toBe('NaN');
  });

  test('the arithmetic methods follow the same rule', () => {
    const x = ce.Indeterminate;
    expect(x.add(1).toString()).toBe('Indeterminate');
    expect(x.add(1.5).toString()).toBe('NaN');
    expect(ce.number(3).add(x).toString()).toBe('Indeterminate');
    expect(ce.NaN.add(x).toString()).toBe('NaN');
    expect(x.mul(2).toString()).toBe('Indeterminate');
    expect(x.mul(ce.number(2.5)).toString()).toBe('NaN');
    expect(x.neg().toString()).toBe('Indeterminate');
    expect(x.inv().toString()).toBe('Indeterminate');
    expect(x.abs().toString()).toBe('Indeterminate');
    expect(x.sqrt().toString()).toBe('Indeterminate');
    expect(x.div(2).toString()).toBe('Indeterminate');
    expect(x.pow(2).toString()).toBe('Indeterminate');
    expect(x.pow(ce.number(0.5)).toString()).toBe('NaN');
  });
});

describe('INDETERMINATE — the reducers', () => {
  test('Max and Min', () => {
    expect(box(['Max', 1, 'Indeterminate']).toString()).toBe('Indeterminate');
    expect(box(['Min', 'Indeterminate', 2]).toString()).toBe('Indeterminate');
    expect(box(['Max', ['List', 1, 'Indeterminate']]).toString()).toBe(
      'Indeterminate'
    );
    expect(box(['Max', 'x', 'Indeterminate']).toString()).toBe('Indeterminate');
    // Only a NaN operand makes the extremum NaN, wherever it is in the walk.
    expect(box(['Max', 'Indeterminate', 'NaN']).toString()).toBe('NaN');
    expect(box(['Max', 'NaN', 'Indeterminate']).toString()).toBe('NaN');
    expect(box(['Max', ['List', 'Indeterminate', 'NaN']]).toString()).toBe(
      'NaN'
    );
    expect(parse(`\\max(1, ${I})`).toString()).toBe('Indeterminate');
    expect(epsil('max(Indeterminate, NaN)').toString()).toBe('NaN');
  });

  test('the statistics readers', () => {
    expect(box(['Mean', ['List', 1, 'Indeterminate']]).toString()).toBe(
      'Indeterminate'
    );
    expect(box(['Median', ['List', 1, 'Indeterminate']]).toString()).toBe(
      'Indeterminate'
    );
    expect(box(['Variance', ['List', 1, 'Indeterminate', 3]]).toString()).toBe(
      'Indeterminate'
    );
    expect(box(['Quartiles', ['List', 1, 'Indeterminate', 3]]).toString()).toBe(
      '(Indeterminate, Indeterminate, Indeterminate)'
    );
    expect(
      box([
        'Covariance',
        ['List', 1, 'Indeterminate', 3],
        ['List', 1, 2, 3],
      ]).toString()
    ).toBe('Indeterminate');
    expect(
      box([
        'Correlation',
        ['List', 1, 'Indeterminate', 3],
        ['List', 1, 2, 3],
      ]).toString()
    ).toBe('Indeterminate');
    expect(box(['Mean', ['List', 'Indeterminate', 'NaN']]).toString()).toBe(
      'NaN'
    );
    expect(box(['Mean', ['List', 1, 'Indeterminate', 'Missing']]).toString()).toBe(
      'NaN'
    );
    expect(epsil('mean([1, Indeterminate])').toString()).toBe('Indeterminate');
  });

  test('the empirical quantile', () => {
    expect(
      box(['Quantile', ['List', 1, 'Indeterminate', 3], ['Rational', 1, 2]]).toString()
    ).toBe('Indeterminate');
    expect(
      box(['Quantile', ['List', 1, 'NaN', 'Indeterminate'], ['Rational', 1, 2]]).toString()
    ).toBe('NaN');
  });
});

describe('INDETERMINATE — other handlers reached without the gate answer NaN', () => {
  test('inert or handle policies compute through their kernel', () => {
    expect(box(['Hypot', 3, 'Indeterminate']).toString()).toBe('NaN');
    expect(box(['GCD', 'Indeterminate', 2]).toString()).toBe('NaN');
  });
});

describe('INDETERMINATE — the reject policy is unchanged', () => {
  test('an operator that rejects NaN rejects Indeterminate', () => {
    const x = box(['DigitSum', 'Indeterminate']);
    expect(x.operator).toBe('Error');
    expect(box(['DigitSum', 'NaN']).operator).toBe('Error');
  });
});

describe('INDETERMINATE — .N() and numeric approximation', () => {
  test('the literal, a function of it and a list of it', () => {
    expect(ce.Indeterminate.N().toString()).toBe('NaN');
    expect(ce.Indeterminate.N().isIndeterminate).toBe(false);
    expect(
      ce.Indeterminate.evaluate({ numericApproximation: true }).toString()
    ).toBe('NaN');
    expect(boxN(['Add', 'Indeterminate', 1]).toString()).toBe('NaN');
    expect(boxN(['Multiply', 2, 'Indeterminate']).toString()).toBe('NaN');
    expect(
      ce
        .box(['Multiply', 2, 'Indeterminate'])
        .evaluate({ numericApproximation: true })
        .toString()
    ).toBe('NaN');
    expect(boxN(['List', 1, 'Indeterminate']).toString()).toBe('[1,NaN]');
    expect(ce.parse(`\\sin(${I})`).N().toString()).toBe('NaN');
    expect(epsil('N(Indeterminate)').toString()).toBe('NaN');
  });

  test('the asynchronous route maps too', async () => {
    const x = await ce
      .box(['Add', 'Indeterminate', 1])
      .evaluateAsync({ numericApproximation: true });
    expect(x.toString()).toBe('NaN');
    expect(
      (await ce.box(['Add', 'Indeterminate', 1]).evaluateAsync()).toString()
    ).toBe('Indeterminate');
  });
});

describe('INDETERMINATE — compiled routes', () => {
  test('JavaScript: a constant, a divisor, an exponent, a folded constant', () => {
    const lit = compile(ce.Indeterminate);
    expect(lit.success).toBe(true);
    expect(lit.run!({})).toBeNaN();
    const div = compile(ce.box(['Divide', 'x', 'Indeterminate']));
    expect(div.run!({ x: 2 })).toBeNaN();
    const pow = compile(ce.box(['Power', 'x', 'Indeterminate']));
    expect(pow.run!({ x: 2 })).toBeNaN();
    const folded = compile(ce.box(['Add', ['Multiply', 2, 'Indeterminate'], 1]));
    expect(folded.code).toBe('NaN');
    const sum = compile(ce.box(['Add', ['Sin', 'x'], 'Indeterminate']));
    expect(sum.code).toBe('Math.sin(_.x) + NaN');
    expect(sum.run!({ x: 1 })).toBeNaN();
  });

  test('JavaScript: a raw MathJSON symbol reaches the symbol table', () => {
    const raw = ce.function(
      'Add',
      [ce.symbol('x'), ce.box('Indeterminate', { form: 'raw' })],
      { form: 'raw' }
    );
    const r = compile(raw);
    expect(r.code).toBe('_.x + Number.NaN');
    expect(r.run!({ x: 1 })).toBeNaN();
  });

  test('a computation that produces 0/0 at run time gives the target NaN', () => {
    expect(compile(ce.box(['Divide', 'x', 'y'])).run!({ x: 0, y: 0 })).toBeNaN();
  });

  test.each([
    ['glsl', 'x + _gpu_nan()'],
    ['wgsl', 'x + bitcast<f32>(0x7fc00000u)'],
    ['python', 'x + np.nan'],
    ['interval-js', '_IA.add(_.x, _k1)'],
  ])('%s spells it as the target NaN', (to, code) => {
    const r = compile(ce.box(['Add', 'x', 'Indeterminate']), { to } as never);
    expect(r.success).toBe(true);
    expect(r.code).toBe(code);
    const raw = ce.function(
      'Add',
      [ce.symbol('x'), ce.box('Indeterminate', { form: 'raw' })],
      { form: 'raw' }
    );
    expect(compile(raw, { to } as never).code).toBe(code);
  });
});

describe('INDETERMINATE — isSame and the hash', () => {
  test('the same only as itself', () => {
    const x = ce.Indeterminate;
    expect(x.isSame(x)).toBe(true);
    expect(x.isSame(ce.box('Indeterminate'))).toBe(true);
    expect(x.isSame(ce.NaN)).toBe(false);
    expect(ce.NaN.isSame(x)).toBe(false);
    // A JavaScript NaN stands for the NaN literal only.
    expect(x.isSame(NaN)).toBe(false);
    expect(ce.NaN.isSame(NaN)).toBe(true);
    // An unshared copy (a literal with metadata) keeps the mark.
    const parsed = ce.parse(I, { preserveLatex: true } as never);
    expect(parsed.isIndeterminate).toBe(true);
    expect(parsed.isSame(x)).toBe(true);
  });

  test('the hash has the kind', () => {
    expect(ce.Indeterminate.hash).not.toBe(ce.NaN.hash);
    expect(ce.Indeterminate.hash).toBe(ce.box('Indeterminate').hash);
  });
});

describe('INDETERMINATE — .is()', () => {
  test('the same answer as isSame', () => {
    expect(ce.Indeterminate.is(ce.Indeterminate)).toBe(true);
    expect(ce.Indeterminate.is(ce.NaN)).toBe(false);
    expect(ce.NaN.is(ce.Indeterminate)).toBe(false);
  });
});

describe('INDETERMINATE — Equal, isEqual and IdenticallyEqual', () => {
  test('False for both values and across them, as for NaN', () => {
    expect(box(['Equal', 'Indeterminate', 'Indeterminate']).symbol).toBe('False');
    expect(box(['Equal', 'Indeterminate', 'NaN']).symbol).toBe('False');
    expect(box(['NotEqual', 'Indeterminate', 'Indeterminate']).symbol).toBe(
      'True'
    );
    expect(ce.Indeterminate.isEqual(ce.Indeterminate)).toBe(false);
    expect(ce.Indeterminate.isEqual(ce.NaN)).toBe(false);
    expect(
      box(['IdenticallyEqual', 'Indeterminate', 'Indeterminate']).symbol
    ).toBe('False');
    expect(epsil('Indeterminate == Indeterminate').symbol).toBe('False');
    // `===` is the structural `isSame`.
    expect(epsil('Indeterminate === Indeterminate').symbol).toBe('True');
    expect(epsil('Indeterminate === NaN').symbol).toBe('False');
  });
});

describe('INDETERMINATE — search by structural identity', () => {
  test('Element, IndexOf, Contains, Tally, Unique', () => {
    expect(box(['Element', 'Indeterminate', ['List', 'NaN']]).symbol).toBe(
      'False'
    );
    expect(
      box(['Element', 'Indeterminate', ['List', 1, 'Indeterminate']]).symbol
    ).toBe('True');
    expect(
      box(['IndexOf', ['List', 1, 'NaN', 'Indeterminate'], 'Indeterminate']).toString()
    ).toBe('3');
    expect(
      box(['Contains', ['List', 1, 'Indeterminate'], 'Indeterminate']).symbol
    ).toBe('True');
    expect(
      box(['Tally', ['List', 'NaN', 'Indeterminate', 'Indeterminate']]).toString()
    ).toBe('([NaN,Indeterminate], [1,2])');
    expect(
      box(['Unique', ['List', 'NaN', 'Indeterminate', 'NaN', 'Indeterminate']]).toString()
    ).toBe('[NaN,Indeterminate]');
  });
});

describe('INDETERMINATE — ordering', () => {
  test('comparisons are False', () => {
    expect(box(['Less', 'Indeterminate', 1]).symbol).toBe('False');
    expect(box(['Greater', 1, 'Indeterminate']).symbol).toBe('False');
  });

  test('Sort places it where it places NaN, keeping the input order', () => {
    expect(box(['Sort', ['List', 3, 'Indeterminate', 1, 'NaN']]).toString()).toBe(
      '[1,3,Indeterminate,NaN]'
    );
    expect(box(['Sort', ['List', 'NaN', 3, 'Indeterminate', 1]]).toString()).toBe(
      '[1,3,NaN,Indeterminate]'
    );
  });
});

describe('INDETERMINATE — type', () => {
  test('the value type Indeterminate, which widens to nan', () => {
    const t = ce.Indeterminate.type;
    expect(t.toString()).toBe('Indeterminate');
    expect(t.matches('nan')).toBe(true);
    expect(t.matches('number')).toBe(true);
    expect(t.matches('real')).toBe(false);
    expect(ce.NaN.type.toString()).toBe('NaN');
  });

  test('the type grammar reads the value type', () => {
    const t = parseType('Indeterminate');
    expect(typeToString(t)).toBe('Indeterminate');
    expect(isSubtype(t, 'nan')).toBe(true);
    expect(isSubtype(t, t)).toBe(true);
    expect(isSubtype(t, parseType('NaN'))).toBe(false);
    expect(isSubtype(parseType('NaN'), t)).toBe(false);
    expect(isSubtype('nan', t)).toBe(false);
    expect(ce.Indeterminate.type.matches(parseType('Indeterminate'))).toBe(true);
    expect(ce.NaN.type.matches(parseType('Indeterminate'))).toBe(false);
  });

  test('a list keeps the nan element type', () => {
    expect(ce.box(['List', 1, 'Indeterminate']).type.toString()).toBe(
      'list<integer | nan^2>'
    );
  });

  test('an Epsil literal parameter dispatches on the value type', () => {
    expect(
      epsil('f(Indeterminate) = 1\nf(x) = 2\n[f(Indeterminate), f(NaN)]').toString()
    ).toBe('[1,2]');
    expect(
      epsil('f(NaN) = 1\nf(x) = 2\n[f(Indeterminate), f(NaN)]').toString()
    ).toBe('[2,1]');
  });
});

describe('INDETERMINATE — isExact and isMachineNumeric', () => {
  test('isExact is false, as for NaN', () => {
    expect(ce.Indeterminate.isExact).toBe(false);
    expect(ce.NaN.isExact).toBe(false);
  });

  test('isMachineNumeric is false: a list holding it leaves the machine lane', () => {
    expect(ce.Indeterminate.isMachineNumeric).toBe(false);
    expect(ce.NaN.isMachineNumeric).toBe(true);
    expect(ce.box(['List', 1, 'Indeterminate']).isMachineNumeric).toBe(false);
    expect(ce.box(['List', 1, 'NaN']).isMachineNumeric).toBe(true);
    const list = box(['List', 1, 'Indeterminate']);
    expect(list.toString()).toBe('[1,Indeterminate]');
    expect(list.json).toEqual(['List', 1, 'Indeterminate']);
  });
});

describe('INDETERMINATE — the absence rules are unchanged', () => {
  test('an absent operand still gives NaN, never Indeterminate', () => {
    expect(box(['Add', 'Missing', 2]).toString()).toBe('NaN');
    expect(box(['Length', 'Missing']).toString()).toBe('NaN');
    // A `Map` callback that errors per element gives an error or its absence
    // marker `NaN` per cell under `.N()`, never `Indeterminate` (the setup
    // of `compile-fold-error-value.test.ts`).
    const ce2 = new ComputeEngine();
    ce2.box(['DeclareType', 'meters', { str: 'number' }]).evaluate();
    ce2
      .box([
        'DefineFunction',
        'w',
        ['Function', 2, ['Typed', 'd', { str: 'meters' }]],
      ])
      .evaluate();
    ce2
      .box([
        'DefineFunction',
        'w',
        [
          'Function',
          ['Add', 'x', 'y'],
          ['Typed', 'x', { str: 'number' }],
          ['Typed', 'y', { str: 'number' }],
        ],
      ])
      .evaluate();
    const cells = [...ce2.box(['Map', 'w', ['List', 1, 2, 3]]).N().each()];
    expect(cells).toHaveLength(3);
    for (const cell of cells) {
      expect(cell.isIndeterminate).toBe(false);
      expect(cell.operator === 'Error' || Number.isNaN(cell.re)).toBe(true);
    }
    expect(box(['IsMissing', 'NaN']).symbol).toBe('True');
    expect(box(['Coalesce', 'NaN', 5]).toString()).toBe('5');
  });
});

describe('INDETERMINATE — absence discharge (D7)', () => {
  test('IsMissing and Coalesce read it as a value', () => {
    expect(box(['IsMissing', 'Indeterminate']).symbol).toBe('False');
    expect(box(['Coalesce', 'Indeterminate', 5]).toString()).toBe(
      'Indeterminate'
    );
    expect(parse(`\\operatorname{IsMissing}(${I})`).symbol).toBe('False');
    expect(epsil('isMissing(Indeterminate)').symbol).toBe('False');
    expect(epsil('Indeterminate ?? 5').toString()).toBe('Indeterminate');
  });

  test('under .N() the operand is NaN first, which is absent', () => {
    expect(boxN(['IsMissing', 'Indeterminate']).symbol).toBe('True');
    expect(boxN(['Coalesce', 'Indeterminate', 5]).toString()).toBe('5');
  });

  test('PointList keeps it as a coordinate', () => {
    expect(box(['PointList', ['List', 1, 2], 'Indeterminate']).toString()).toBe(
      '[(1, Indeterminate),(2, Indeterminate)]'
    );
  });

  test('Field and chained At do not absorb it as an absent base', () => {
    // A number has no field and no elements, so these are the errors the
    // same call on any number gives, where an absent base gives the marker.
    expect(box(['Field', 'Indeterminate', { str: 'x' }]).operator).toBe('Error');
    expect(box(['Field', 'NaN', { str: 'x' }]).toString()).toBe('NaN');
    expect(
      box(['At', ['List', ['List', 1, 2], 'Indeterminate'], 2, 1]).operator
    ).toBe('Error');
    expect(box(['At', ['List', ['List', 1, 2], 'NaN'], 2, 1]).symbol).toBe(
      'Missing'
    );
  });

  test('an Indeterminate index names no position', () => {
    expect(box(['At', ['List', 1, 2], 'Indeterminate']).toString()).toBe('NaN');
    expect(
      box(['At', ['List', { str: 'a' }, { str: 'b' }], 'Indeterminate']).symbol
    ).toBe('Missing');
  });
});

describe('INDETERMINATE — the list-cell repair keeps it', () => {
  test('a NaN cell of a list of points becomes Missing, an Indeterminate cell stays', () => {
    const expression = ce.box([
      'Multiply',
      2,
      ['List', 'Missing', ['Tuple', 1, 2]],
    ]);
    expect(expression.type.toString()).toBe(
      'list<missing | tuple<number, number>>'
    );
    const result = markAbsentPointCells(
      ce,
      expression,
      ce._fn('List', [ce.NaN, ce.Indeterminate, ce.tuple(2, 4)])
    );
    expect(result.toString()).toBe('["Missing",Indeterminate,(2, 4)]');
  });
});

describe('INDETERMINATE — boolean context', () => {
  test('the incompatible-type error of NaN', () => {
    for (const json of [
      ['And', 'Indeterminate', 'True'],
      ['Or', 'Indeterminate', 'False'],
      ['Not', 'Indeterminate'],
      ['If', 'Indeterminate', 1, 2],
    ] as MathJsonExpression[]) {
      const x = box(json);
      expect(x.operator).toBe('Error');
      expect(x.toString()).toContain('incompatible-type');
    }
    expect(box(['And', 'NaN', 'True']).toString()).toContain('incompatible-type');
  });
});

describe('INDETERMINATE — serialization round trip', () => {
  test('MathJSON', () => {
    expect(ce.Indeterminate.json).toBe('Indeterminate');
    expect(ce.box(ce.Indeterminate.json).isIndeterminate).toBe(true);
    expect(ce.box(['Add', 'x', 'Indeterminate']).json).toEqual([
      'Add',
      'x',
      'Indeterminate',
    ]);
    expect(ce.NaN.json).toBe('NaN');
    expect(ce.box(ce.NaN.json).isIndeterminate).toBe(false);
  });

  test('LaTeX', () => {
    expect(ce.Indeterminate.latex).toBe(I);
    expect(ce.parse(ce.Indeterminate.latex).isIndeterminate).toBe(true);
    expect(ce.box(['Add', 'x', 'Indeterminate']).latex).toBe(`x+${I}`);
    expect(ce.parse(I, { form: 'raw' }).json).toBe('Indeterminate');
    expect(ce.NaN.latex).toBe('\\operatorname{NaN}');
  });

  test('Epsil', () => {
    expect(serializeEpsil(ce.Indeterminate.json)).toBe('Indeterminate');
    expect(serializeEpsil(ce.box(['Add', 'x', 'Indeterminate']).json)).toBe(
      'x + Indeterminate'
    );
    const [json] = parseEpsil('Indeterminate');
    expect(ce.box(json!).isIndeterminate).toBe(true);
    // `NaN` as a MathJSON symbol keeps its verbatim spelling.
    expect(serializeEpsil(ce.box(['List', 1, 'NaN', 'Indeterminate']).json)).toBe(
      '[1, `NaN`, Indeterminate]'
    );
  });

  test('the name is a reserved literal word in Epsil', () => {
    const codes = (src: string): string[] =>
      parseEpsil(src)[1].map((d) =>
        Array.isArray(d.message) ? String(d.message[0]) : String(d.message)
      );
    expect(codes('let Indeterminate = 2')).toContain('reserved-word');
    expect(codes('Indeterminate := 2')).toContain('reserved-word');
    expect(codes('let `Indeterminate` = 2')).toEqual([]);
  });

  test('String and NumberFrom', () => {
    expect(box(['String', 'Indeterminate']).toString()).toBe('"Indeterminate"');
    expect(box(['NumberFrom', { str: 'Indeterminate' }]).isIndeterminate).toBe(
      true
    );
    expect(epsil('String(Indeterminate)').string).toBe('Indeterminate');
    expect(epsil('numberFrom("Indeterminate")').isIndeterminate).toBe(true);
  });

  test('the CLI formatter', () => {
    const result = makeEpsilSession(0).evaluate('Indeterminate + 1');
    expect(formatValue(result, 'value')).toBe('Indeterminate');
    expect(formatValue(result, 'epsil')).toBe('Indeterminate');
    expect(JSON.parse(formatValue(result, 'json'))).toBe('Indeterminate');
    const nan = makeEpsilSession(0).evaluate('Indeterminate + 1.5');
    expect(formatValue(nan, 'value')).toBe('NaN');
  });
});

describe('INDETERMINATE — .N() reaches the cells of a collection', () => {
  test('a list, a nested list and a dictionary whose cells are all inexact', () => {
    expect(boxN(['List', 'Indeterminate']).toString()).toBe('[NaN]');
    expect(boxN(['List', { num: '1.5' }, 'Indeterminate']).toString()).toBe(
      '[1.5,NaN]'
    );
    expect(
      boxN(['List', ['List', { num: '1.5' }, 'Indeterminate']]).toString()
    ).toBe('[[1.5,NaN]]');
    expect(
      boxN(['Dictionary', ['KeyValuePair', { str: 'a' }, 'Indeterminate']]).toString()
    ).toBe('{"a" -> NaN}');
    expect(ce.parse(`[1.5, ${I}]`).N().toString()).toBe('[1.5,NaN]');
    expect(epsil('N([1.5, Indeterminate])').toString()).toBe('[1.5,NaN]');
  });
});

describe('INDETERMINATE — a symbol that holds a NaN-valued literal', () => {
  test('the canonical folds act on number literals only', () => {
    const ce2 = new ComputeEngine();
    ce2.assign('y', ce2.Indeterminate);
    for (const json of [
      ['Divide', 'y', 2],
      ['Divide', 2, 'y'],
      ['Power', 'y', 0],
      ['Power', 'y', 'PositiveInfinity'],
      ['Power', 'y', 'NegativeInfinity'],
      ['Power', 0, 'y'],
    ] as MathJsonExpression[]) {
      expect(ce2.box(json).isNaN).not.toBe(true);
      expect(ce2.box(json).evaluate().toString()).toBe('Indeterminate');
    }
    expect(ce2.parse('\\frac{y}{2}').evaluate().toString()).toBe('Indeterminate');
  });

  test('literal operands still fold as before', () => {
    for (const json of [
      ['Divide', 'NaN', 2],
      ['Divide', 2, 'NaN'],
      ['Power', 'NaN', 0],
      ['Power', 0, 'NaN'],
      ['Power', 'NaN', 'PositiveInfinity'],
    ] as MathJsonExpression[])
      expect(ce.box(json).json).toBe('NaN');
    expect(ce.box(['Divide', 'Indeterminate', 2]).json).toBe('Indeterminate');
  });

  test('a quotient of a symbol follows a later assignment', () => {
    const ce2 = new ComputeEngine();
    ce2.assign('w', ce2.NaN);
    const q = ce2.box(['Divide', 'w', 2]);
    expect(q.evaluate().toString()).toBe('NaN');
    ce2.assign('w', 4);
    expect(q.evaluate().toString()).toBe('2');
  });
});

describe('INDETERMINATE — an inexact operand makes a reducer NaN', () => {
  test('Max, Min and ElementMax', () => {
    expect(box(['Max', { num: '1.5' }, 'Indeterminate']).toString()).toBe('NaN');
    expect(box(['Min', 'Indeterminate', { num: '1.5' }]).toString()).toBe('NaN');
    expect(box(['Max', ['List', { num: '1.5' }, 'Indeterminate']]).toString()).toBe(
      'NaN'
    );
    // A float element that is not the extremum still counts, also in a list
    // folded on its doubles; an exact rational element does not.
    expect(box(['Max', ['List', { num: '1.5' }, 3], 'Indeterminate']).toString()).toBe(
      'NaN'
    );
    expect(
      box(['Max', ['List', ['Rational', 1, 2], 3], 'Indeterminate']).toString()
    ).toBe('Indeterminate');
    expect(box(['ElementMax', 'Indeterminate', { num: '1.5' }]).toString()).toBe(
      'NaN'
    );
    expect(box(['ElementMax', 'Indeterminate', 1]).toString()).toBe(
      'Indeterminate'
    );
    expect(parse(`\\max(1.5, ${I})`).toString()).toBe('NaN');
    expect(epsil('max(1.5, Indeterminate)').toString()).toBe('NaN');
  });

  test('the statistics readers and the quantile', () => {
    expect(box(['Mean', ['List', { num: '1.5' }, 'Indeterminate']]).toString()).toBe(
      'NaN'
    );
    expect(
      box(['Quartiles', ['List', { num: '1.5' }, 'Indeterminate', 3]]).toString()
    ).toBe('(NaN, NaN, NaN)');
    expect(
      box([
        'Covariance',
        ['List', 1, 'Indeterminate', 3],
        ['List', { num: '1.5' }, 2, 3],
      ]).toString()
    ).toBe('NaN');
    expect(
      box([
        'Quantile',
        ['List', { num: '1.5' }, 'Indeterminate', 3],
        ['Rational', 1, 2],
      ]).toString()
    ).toBe('NaN');
    expect(epsil('mean([1.5, Indeterminate])').toString()).toBe('NaN');
  });
});

describe('INDETERMINATE — Ln of the literal', () => {
  test('keeps the value like the other unary methods', () => {
    expect(ce.Indeterminate.ln().toString()).toBe('Indeterminate');
    expect(ce.Indeterminate.ln(2).toString()).toBe('Indeterminate');
    expect(ce.Indeterminate.ln(2.5).toString()).toBe('NaN');
  });
});

describe('INDETERMINATE — the parse and Epsil routes of the identity rows', () => {
  test('isSame, the hash and .is()', () => {
    const p = ce.parse(I);
    expect(p.isSame(ce.Indeterminate)).toBe(true);
    expect(p.isSame(ce.parse('\\operatorname{NaN}'))).toBe(false);
    expect(p.hash).toBe(ce.Indeterminate.hash);
    expect(p.is(ce.Indeterminate)).toBe(true);
    expect(p.is(ce.NaN)).toBe(false);
    const e = epsil('Indeterminate');
    expect(e.isSame(ce.Indeterminate)).toBe(true);
    expect(e.hash).toBe(ce.Indeterminate.hash);
    expect(e.is(ce.NaN)).toBe(false);
  });

  test('Element, IndexOf, Tally, Unique', () => {
    expect(parse(`${I}\\in[\\operatorname{NaN}]`).symbol).toBe('False');
    expect(parse(`${I}\\in\\{1, ${I}\\}`).symbol).toBe('True');
    expect(epsil('Indeterminate in [NaN]').symbol).toBe('False');
    expect(epsil('Indeterminate in [1, Indeterminate]').symbol).toBe('True');
    expect(epsil('indexOf([1, NaN, Indeterminate], Indeterminate)').toString()).toBe(
      '3'
    );
    expect(epsil('tally([NaN, Indeterminate, Indeterminate])').toString()).toBe(
      '([NaN,Indeterminate], [1,2])'
    );
    expect(epsil('unique([NaN, Indeterminate, NaN, Indeterminate])').toString()).toBe(
      '[NaN,Indeterminate]'
    );
  });

  test('Sort', () => {
    expect(
      parse(`\\operatorname{Sort}([3, ${I}, 1, \\operatorname{NaN}])`).toString()
    ).toBe('[1,3,Indeterminate,NaN]');
    expect(epsil('sort([NaN, 3, Indeterminate, 1])').toString()).toBe(
      '[1,3,NaN,Indeterminate]'
    );
  });

  test('the list-cell repair, with the parse and Epsil spellings of the cell', () => {
    const expression = ce.box([
      'Multiply',
      2,
      ['List', 'Missing', ['Tuple', 1, 2]],
    ]);
    const cells = [ce.parse(I), epsil('Indeterminate')];
    for (const cell of cells)
      expect(
        markAbsentPointCells(ce, expression, ce._fn('List', [ce.NaN, cell]))
          .toString()
      ).toBe('["Missing",Indeterminate]');
  });

  test('boolean context', () => {
    expect(parse(`${I}\\land\\operatorname{True}`).toString()).toContain(
      'incompatible-type'
    );
    expect(parse(`\\lnot ${I}`).toString()).toContain('incompatible-type');
    const { value } = executeEpsil(new ComputeEngine(), 'Indeterminate && true');
    expect(value.toString()).toContain('incompatible-type');
  });

  test('isMachineNumeric', () => {
    expect(ce.parse(`[1, ${I}]`).isMachineNumeric).toBe(false);
    expect(ce.parse('[1, \\operatorname{NaN}]').isMachineNumeric).toBe(true);
    expect(epsil('[1, Indeterminate]').isMachineNumeric).toBe(false);
    expect(epsil('[1, NaN]').isMachineNumeric).toBe(true);
  });

  test('NumberFrom', () => {
    expect(
      parse('\\operatorname{NumberFrom}(\\text{Indeterminate})').isIndeterminate
    ).toBe(true);
    expect(epsil('NumberFrom("Indeterminate")').isIndeterminate).toBe(true);
    expect(epsil('NumberFrom("NaN")').isIndeterminate).toBe(false);
  });
});

describe('INDETERMINATE — the arithmetic methods do not read a symbol value', () => {
  test('a symbol that holds Indeterminate or NaN stays a factor or a term', () => {
    const ce2 = new ComputeEngine();
    ce2.assign('y', ce2.Indeterminate);
    ce2.assign('z', ce2.NaN);
    const y = ce2.box('y');
    const z = ce2.box('z');
    for (const [e, value] of [
      [y.div(2), 'Indeterminate'],
      [y.mul(2), 'Indeterminate'],
      [y.add(1), 'Indeterminate'],
      [z.div(2), 'NaN'],
      [z.mul(2), 'NaN'],
      [z.add(1), 'NaN'],
    ] as [Expression, string][]) {
      expect(e.json).not.toBe('NaN');
      expect(e.evaluate().toString()).toBe(value);
    }
  });

  test('an expression built by a method follows a later assignment', () => {
    const ce2 = new ComputeEngine();
    ce2.assign('w', ce2.NaN);
    const q = ce2.box('w').div(2);
    const p = ce2.box('w').mul(2);
    const s = ce2.box('w').add(1);
    ce2.assign('w', 4);
    expect(q.evaluate().toString()).toBe('2');
    expect(p.evaluate().toString()).toBe('8');
    expect(s.evaluate().toString()).toBe('5');
  });
});

//
// Phase 2: the exact producers. An exact-route answer that was `NaN` because
// the form has no value is `Indeterminate`; a float operand, an absent
// operand, `.N()` and the compiled routes still give `NaN`.
//

describe('INDETERMINATE — the producers: the arithmetic forms', () => {
  const INDET = 'Indeterminate';
  // [input, canonical form]: the forms that fold at canonicalization give the
  // value itself, the others keep their structure until `evaluate()`.
  test.each([
    [['Divide', 0, 0], INDET],
    [['Rational', 0, 0], INDET],
    [['Divide', 'PositiveInfinity', 'PositiveInfinity'], INDET],
    [['Divide', 'NegativeInfinity', 'PositiveInfinity'], INDET],
    [
      ['Multiply', 0, 'PositiveInfinity'],
      ['Multiply', 0, 'PositiveInfinity'],
    ],
    [
      ['Multiply', 0, 'ComplexInfinity'],
      ['Multiply', 0, 'ComplexInfinity'],
    ],
    [['Multiply', 2, 0, 'PositiveInfinity'], INDET],
    [
      ['Subtract', 'PositiveInfinity', 'PositiveInfinity'],
      ['Add', 'NegativeInfinity', 'PositiveInfinity'],
    ],
    [['Power', 0, 0], INDET],
    [['Power', 'PositiveInfinity', 0], INDET],
    [['Power', 'ComplexInfinity', 0], INDET],
    [['Power', 1, 'PositiveInfinity'], INDET],
    [['Power', 1, 'NegativeInfinity'], INDET],
    [['Power', -1, 'PositiveInfinity'], INDET],
    [['Power', -1, 'NegativeInfinity'], INDET],
    [['Power', 'ImaginaryUnit', 'PositiveInfinity'], INDET],
    [['Power', 'PositiveInfinity', 'ImaginaryUnit'], INDET],
    [['Power', 0, 'ImaginaryUnit'], INDET],
    [
      ['Root', 0, 'PositiveInfinity'],
      ['Root', 0, 'PositiveInfinity'],
    ],
    [
      ['Mod', 5, 0],
      ['Mod', 5, 0],
    ],
    [
      ['Mod', 'x', 0],
      ['Mod', 'x', 0],
    ],
    [
      ['Fract', 'PositiveInfinity'],
      ['Fract', 'PositiveInfinity'],
    ],
    [
      ['Fract', 'NegativeInfinity'],
      ['Fract', 'NegativeInfinity'],
    ],
    [
      ['Log', 1, 1],
      ['Log', 1, 1],
    ],
    [
      ['Log', 'PositiveInfinity', 'PositiveInfinity'],
      ['Log', 'PositiveInfinity', 'PositiveInfinity'],
    ],
  ] as [MathJsonExpression, MathJsonExpression][])(
    '%j is Indeterminate, NaN under N()',
    (json, canonical) => {
      const boxed = ce.box(json);
      expect(boxed.json).toEqual(canonical);
      const value = boxed.evaluate();
      expect(value.isIndeterminate).toBe(true);
      expect(value.toString()).toBe('Indeterminate');
      // `isNaN` still holds; `isSame(ce.NaN)` does not.
      expect(value.isNaN).toBe(true);
      expect(value.isSame(ce.NaN)).toBe(false);
      expect(boxN(json).toString()).toBe('NaN');
      expect(
        ce.box(json).evaluate({ numericApproximation: true }).toString()
      ).toBe('NaN');
      // The raw form keeps the structure, and evaluates to the same value.
      const raw = ce.box(json, { form: 'raw' });
      expect(raw.json).toEqual(json);
      expect(raw.evaluate().toString()).toBe('Indeterminate');
    }
  );

  test('the parse route', () => {
    for (const latex of [
      '\\frac{0}{0}',
      '0^0',
      '\\infty-\\infty',
      '0\\cdot\\infty',
      '1^\\infty',
      '\\frac{\\infty}{\\infty}',
      '(-1)^\\infty',
      '\\infty^0',
      '\\operatorname{mod}(5,0)',
    ]) {
      expect([latex, parse(latex).toString()]).toEqual([
        latex,
        'Indeterminate',
      ]);
      expect([latex, ce.parse(latex).N().toString()]).toEqual([latex, 'NaN']);
    }
    expect(ce.parse('\\frac{0}{0}').latex).toBe(I);
  });

  test('the Epsil route', () => {
    for (const source of [
      '0/0',
      'oo - oo',
      '0 * oo',
      '0^0',
      '1^oo',
      '(-1)^oo',
      'oo^i',
      '0^i',
      'fract(oo)',
      'Mod(5, 0)',
      'x = 0; x/x',
    ])
      expect([source, epsil(source).toString()]).toEqual([
        source,
        'Indeterminate',
      ]);
    expect(epsil('N(0/0)').toString()).toBe('NaN');
  });
});

describe('INDETERMINATE — the producers: a float operand gives NaN', () => {
  test.each([
    [['Divide', { num: '0.0' }, { num: '0.0' }]],
    [['Divide', 0, { num: '0.0' }]],
    [['Divide', { num: '0.0' }, 0]],
    [['Multiply', { num: '0.0' }, 'PositiveInfinity']],
    [['Multiply', { num: '2.5' }, 'PositiveInfinity', 0]],
    [['Add', 'PositiveInfinity', 'NegativeInfinity', { num: '1.5' }]],
    [['Power', { num: '0.0' }, 0]],
    [['Power', 0, { num: '0.0' }]],
    [['Power', 'PositiveInfinity', { num: '0.0' }]],
    [['Power', { num: '1.0' }, 'PositiveInfinity']],
    [['Power', { num: '1.0' }, 'NegativeInfinity']],
    [['Power', { num: '-1.0' }, 'PositiveInfinity']],
    [['Power', 0, ['Complex', 0, 2.5]]],
    [['Mod', { num: '5.0' }, 0]],
    [['Mod', 5, { num: '0.0' }]],
    [['Log', { num: '1.0' }, 1]],
  ] as MathJsonExpression[][])('%j is NaN', (json) => {
    const value = box(json);
    expect(value.toString()).toBe('NaN');
    expect(value.isIndeterminate).toBe(false);
  });

  test('on the parse and Epsil routes', () => {
    expect(parse('\\frac{0.0}{0.0}').toString()).toBe('NaN');
    expect(parse('\\frac{0}{0.0}').toString()).toBe('NaN');
    expect(epsil('0.0/0.0').toString()).toBe('NaN');
    expect(epsil('0/0.0').toString()).toBe('NaN');
    expect(epsil('0.0 * oo').toString()).toBe('NaN');
  });
});

describe('INDETERMINATE — the producers: the poles and the other NaN are unchanged', () => {
  test('a pole is ~oo, not Indeterminate', () => {
    for (const json of [
      ['Divide', 5, 0],
      ['Rational', 5, 0],
      ['Divide', 1, 0],
      ['Divide', -1, 0],
      ['Tan', ['Divide', 'Pi', 2]],
      ['Gamma', 0],
      ['Gamma', -1],
      ['Zeta', 1],
    ] as MathJsonExpression[])
      expect([json, box(json).toString()]).toEqual([json, '~oo']);
    expect(box(['Ln', 0]).toString()).toBe('-oo');
    expect(parse('\\frac{5}{0}').toString()).toBe('~oo');
    expect(epsil('5/0').toString()).toBe('~oo');
  });

  test('the exact-lane funnel is not switched', () => {
    // `ce.number([5, 0])` reaches the exact numeric lane, where `n/0` is
    // `NaN` for every `n`: that `NaN` is kept, since it also spells a pole.
    expect(ce.number([5, 0]).toString()).toBe('NaN');
    expect(ce.number([0, 0]).toString()).toBe('NaN');
    expect(box(['Ln', -2]).toString()).toBe('ln(-2)');
  });

  test('an absent operand still gives NaN', () => {
    expect(box(['Add', 'Missing', 2]).toString()).toBe('NaN');
    expect(box(['Multiply', 'Missing', 0]).toString()).toBe('NaN');
    expect(box(['Divide', 'Missing', 0]).toString()).toBe('NaN');
    expect(box(['Length', 'Missing']).toString()).toBe('NaN');
    expect(box(['Multiply', 'NaN', 0]).toString()).toBe('NaN');
    expect(box(['Power', 'NaN', 0]).toString()).toBe('NaN');
  });

  test('0/∞ is 0, on the canonical route and through .div()', () => {
    expect(box(['Divide', 0, 'PositiveInfinity']).toString()).toBe('0');
    expect(ce.Zero.div(ce.PositiveInfinity).toString()).toBe('0');
    expect(ce.Zero.div(ce.ComplexInfinity).toString()).toBe('0');
    expect(ce.Zero.div(Infinity).toString()).toBe('0');
    expect(ce.Zero.div(0).toString()).toBe('Indeterminate');
    expect(ce.Zero.div(ce.Zero).toString()).toBe('Indeterminate');
  });
});

describe('INDETERMINATE — the producers: special functions at an infinite point', () => {
  test('no limit: Indeterminate, NaN under N()', () => {
    for (const json of [
      ['Gamma', 'NegativeInfinity'],
      ['Gamma', 'ComplexInfinity'],
      ['Factorial', 'NegativeInfinity'],
      ['Digamma', 'NegativeInfinity'],
      ['Zeta', 'NegativeInfinity'],
      ['Zeta', 'ComplexInfinity'],
      ['AiryAi', 'ComplexInfinity'],
      ['AiryAiPrime', 'NegativeInfinity'],
      ['BesselJ', 0, 'ComplexInfinity'],
      ['Beta', 'NegativeInfinity', ['Rational', 1, 2]],
      ['Gamma', 2, 'ComplexInfinity'],
      ['Gamma', 'PositiveInfinity', 'PositiveInfinity'],
      ['GammaRegularized', 'NegativeInfinity', 2],
      ['Binomial', 'NegativeInfinity', ['Rational', 1, 2]],
      ['Pochhammer', 2, 'ComplexInfinity'],
      ['ErfInv', 'PositiveInfinity'],
      ['SinIntegral', 'ComplexInfinity'],
      ['ExpIntegralEi', 'ComplexInfinity'],
      ['Real', 'ComplexInfinity'],
      ['Argument', 'ComplexInfinity'],
    ] as MathJsonExpression[]) {
      expect([json, box(json).toString()]).toEqual([json, 'Indeterminate']);
      expect([json, boxN(json).toString()]).toEqual([json, 'NaN']);
    }
    expect(parse('\\Gamma(-\\infty)').toString()).toBe('Indeterminate');
  });

  test('a divergence whose sign depends on the other operand stays NaN', () => {
    expect(box(['Gamma', 2, 'NegativeInfinity']).toString()).toBe('NaN');
    expect(
      box(['Beta', 'PositiveInfinity', ['Rational', -1, 2]]).toString()
    ).toBe('NaN');
    expect(
      box([
        'GammaRegularized',
        ['Rational', 1, 2],
        'NegativeInfinity',
      ]).toString()
    ).toBe('NaN');
  });

  test('an anonymous infinity (a float literal) gives NaN', () => {
    const anon: MathJsonExpression = ['Complex', 'PositiveInfinity', 1];
    for (const head of ['Gamma', 'Zeta', 'AiryAi', 'ErfInv'])
      expect([head, box([head, anon]).toString()]).toEqual([head, 'NaN']);
  });
});

describe('INDETERMINATE — the producers: library answers', () => {
  test('the sample variance of one datum', () => {
    expect(box(['Variance', ['List', 5]]).toString()).toBe('Indeterminate');
    expect(box(['StandardDeviation', ['List', 5]]).toString()).toBe(
      'Indeterminate'
    );
    expect(boxN(['Variance', ['List', 5]]).toString()).toBe('NaN');
    expect(box(['Variance', ['List', 5.5]]).toString()).toBe('NaN');
    expect(epsil('variance([5])').toString()).toBe('Indeterminate');
  });

  test('a broadcast quotient and product, a matrix power', () => {
    expect(box(['Divide', ['List', 0, 1], 0]).toString()).toBe(
      '[Indeterminate,~oo]'
    );
    expect(boxN(['Divide', ['List', 0, 1], 0]).toString()).toBe('[NaN,~oo]');
    expect(epsil('[0, 1]/0').toString()).toBe('[Indeterminate,~oo]');
    expect(
      box(['Multiply', ['List', 0, 1], 'PositiveInfinity']).toString()
    ).toBe('[Indeterminate,+oo]');
    // The final map of `.N()` reaches the cells a kernel computed.
    expect(
      boxN(['Multiply', ['List', 0, 1], 'PositiveInfinity']).toString()
    ).toBe('[NaN,+oo]');
    const power: MathJsonExpression = [
      'MatrixPower',
      ['List', ['List', 'PositiveInfinity', 0], ['List', 0, 1]],
      2,
    ];
    expect(box(power).toString()).toBe(
      '[[+oo,Indeterminate],[Indeterminate,1]]'
    );
    expect(boxN(power).toString()).toBe('[[+oo,NaN],[NaN,1]]');
  });
});

describe('INDETERMINATE — the producers: symbols, simplification, compilation', () => {
  test('a symbol holding 0 evaluates the form', () => {
    const ce2 = new ComputeEngine();
    // Unassigned, `x/x` folds to 1 at canonicalization (the generic-symbol
    // convention), and that form survives a later assignment.
    const cached = ce2.box(['Divide', 'x', 'x']);
    expect(cached.json).toBe(1);
    ce2.assign('x', 0);
    expect(cached.evaluate().toString()).toBe('1');
    // Boxed after the assignment, the quotient keeps its structure and
    // evaluates to the indeterminate form.
    const quotient = ce2.box(['Divide', 'x', 'x']);
    expect(quotient.json).toEqual(['Divide', 'x', 'x']);
    expect(quotient.evaluate().toString()).toBe('Indeterminate');
    expect(quotient.N().toString()).toBe('NaN');
    expect(ce2.box(['Power', 'x', 'x']).evaluate().toString()).toBe(
      'Indeterminate'
    );
    ce2.assign('x', 0.0);
    ce2.assign('y', { num: '0.0' });
    expect(ce2.box(['Divide', 'y', 'y']).evaluate().toString()).toBe('NaN');
  });

  test('simplification absorbs the value', () => {
    const ce2 = new ComputeEngine();
    expect(ce2.parse('x + \\frac{0}{0}').simplify().toString()).toBe(
      'Indeterminate'
    );
    expect(ce2.parse('0 \\cdot \\infty + x').simplify().toString()).toBe(
      'Indeterminate'
    );
    expect(
      ce2
        .box(['Simplify', ['Add', 'x', ['Divide', 0, 0]]])
        .evaluate()
        .toString()
    ).toBe('Indeterminate');
  });

  test('the compiled routes answer the IEEE NaN', () => {
    const quotient = compile(ce.box(['Divide', 0, 0]));
    expect(quotient.success).toBe(true);
    expect(quotient.run!({})).toBeNaN();
    const product = compile(ce.box(['Multiply', 0, 'PositiveInfinity']));
    expect(product.run!({})).toBeNaN();
    expect(
      compile(ce.box(['Divide', 'x', 'y'])).run!({ x: 0, y: 0 })
    ).toBeNaN();
  });
});

describe('INDETERMINATE — the producers: review round', () => {
  test('a float order of a Bessel or polygamma head gives NaN', () => {
    expect(box(['BesselI', { num: '2.0' }, 'ComplexInfinity']).toString()).toBe(
      'NaN'
    );
    expect(box(['BesselJ', { num: '0.0' }, 'ComplexInfinity']).toString()).toBe(
      'NaN'
    );
    expect(
      box(['PolyGamma', { num: '1.0' }, 'NegativeInfinity']).toString()
    ).toBe('NaN');
    // The exact orders are the indeterminate form.
    expect(box(['BesselJ', 0, 'ComplexInfinity']).toString()).toBe(
      'Indeterminate'
    );
    expect(box(['PolyGamma', 1, 'NegativeInfinity']).toString()).toBe(
      'Indeterminate'
    );
  });

  test('∞ + (−∞) through .add() and the kernels that use it', () => {
    expect(ce.PositiveInfinity.add(ce.NegativeInfinity).toString()).toBe(
      'Indeterminate'
    );
    expect(ce.NegativeInfinity.add(ce.PositiveInfinity).toString()).toBe(
      'Indeterminate'
    );
    expect(ce.PositiveInfinity.add(-Infinity).toString()).toBe('Indeterminate');
    // `~oo` absorbs a sum, as in the `Add` fold.
    expect(ce.ComplexInfinity.add(ce.PositiveInfinity).toString()).toBe('~oo');
    expect(ce.PositiveInfinity.add(ce.PositiveInfinity).toString()).toBe('+oo');
    const cases: [MathJsonExpression, string][] = [
      [
        [
          'Add',
          ['List', 'PositiveInfinity', 1],
          ['List', 'NegativeInfinity', 2],
        ],
        '[Indeterminate,3]',
      ],
      [
        [
          'Subtract',
          ['List', 'PositiveInfinity'],
          ['List', 'PositiveInfinity'],
        ],
        '[Indeterminate]',
      ],
      [
        [
          'Add',
          ['List', ['List', 'PositiveInfinity']],
          ['List', ['List', 'NegativeInfinity']],
        ],
        '[[Indeterminate]]',
      ],
      [
        ['Mean', ['List', 'PositiveInfinity', 'NegativeInfinity']],
        'Indeterminate',
      ],
    ];
    for (const [json, expected] of cases) {
      expect([json, box(json).toString()]).toEqual([json, expected]);
      expect([json, boxN(json).toString()]).toEqual([
        json,
        expected.replace(/Indeterminate/g, 'NaN'),
      ]);
    }
    // A float in the same cell, or in the data, makes it NaN.
    expect(
      box([
        'Add',
        ['List', 'PositiveInfinity', 1],
        ['List', 'NegativeInfinity', 2],
        ['List', { num: '1.5' }, 0],
      ]).toString()
    ).toBe('[NaN,3]');
    expect(
      box([
        'Mean',
        ['List', 'PositiveInfinity', 'NegativeInfinity', { num: '1.5' }],
      ]).toString()
    ).toBe('NaN');
  });

  test('Beta with two infinite operands', () => {
    // B(a, b) ≤ 1/a for b ≥ 1, so B(+∞, +∞) = 0.
    expect(
      box(['Beta', 'PositiveInfinity', 'PositiveInfinity']).toString()
    ).toBe('0');
    for (const [a, b] of [
      ['PositiveInfinity', 'NegativeInfinity'],
      ['PositiveInfinity', 'ComplexInfinity'],
      ['NegativeInfinity', 'PositiveInfinity'],
    ])
      expect([a, b, box(['Beta', a, b]).toString()]).toEqual([
        a,
        b,
        'Indeterminate',
      ]);
    // One infinite operand with a finite b of non-positive real part keeps
    // the recorded NaN.
    expect(
      box(['Beta', 'PositiveInfinity', ['Rational', -1, 2]]).toString()
    ).toBe('NaN');
  });

  test('a float numerator over an infinity is the float 0', () => {
    expect(ce.box(['Divide', { num: '0.0' }, 'PositiveInfinity']).json).toEqual(
      { num: '0.0' }
    );
    expect(ce.box(['Divide', { num: '2.5' }, 'PositiveInfinity']).json).toEqual(
      { num: '0.0' }
    );
    expect(ce.box(['Divide', 2, 'PositiveInfinity']).json).toBe(0);
    expect(ce.box({ num: '0.0' }).div(ce.PositiveInfinity).json).toEqual({
      num: '0.0',
    });
  });

  test('Remainder by zero is the indeterminate form, as Mod', () => {
    expect(box(['Remainder', 5, 0]).toString()).toBe('Indeterminate');
    expect(boxN(['Remainder', 5, 0]).toString()).toBe('NaN');
    expect(box(['Remainder', 'x', 0]).toString()).toBe('Indeterminate');
    expect(box(['Remainder', { num: '5.0' }, 0]).toString()).toBe('NaN');
    expect(box(['Remainder', 5, { num: '0.0' }]).toString()).toBe('NaN');
    expect(box(['Remainder', 7, 3]).toString()).toBe('1');
  });

  test('a float absorbed by an infinity at canonicalization is not seen', () => {
    // A KNOWN LIMIT of the float rule, pinned as it is: the rule reads the
    // operands of the form as they are when the form is built, and `∞ + 0.5`
    // is the exact `∞` by then, so these answer `Indeterminate` although a
    // float was written. (`docs/plans/2026-09-28-indeterminate-value.md`,
    // Phase 2 results.)
    expect(
      box(['Fract', ['Add', 'PositiveInfinity', { num: '0.5' }]]).toString()
    ).toBe('Indeterminate');
    expect(
      box([
        'Multiply',
        0,
        ['Add', 'PositiveInfinity', { num: '0.5' }],
      ]).toString()
    ).toBe('Indeterminate');
  });
});
