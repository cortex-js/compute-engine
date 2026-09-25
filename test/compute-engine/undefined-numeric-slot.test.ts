import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

// `Undefined` in a NUMERIC slot is normalized like `Missing` (user ruling of
// 2026-09-21, recorded in `docs/ERROR-MODEL.md` §3). The absence gate turns an
// absent scalar operand of a `propagate` operator into the marker of the
// operator's own codomain, and both absence symbols — `Missing` and
// `Undefined` — take that route.
//
// The ruling of 2026-09-22 extends the reading to the operators that OWN their
// absence semantics (`missingBehavior: 'handle'`): where such an operator
// reads a `Missing` element or operand as absent, an `Undefined` one is absent
// in the same way. `Undefined` keeps its own meaning outside an absence test:
// it still evaluates to itself and its declared type is still `unknown`.

const ce = new ComputeEngine();

describe('UNDEFINED in a numeric slot', () => {
  describe('interpreter, evaluate() and N()', () => {
    it('Cos(Undefined) is NaN, as Cos(Missing) is', () => {
      expect(ce.box(['Cos', 'Undefined']).evaluate().isNaN).toBe(true);
      expect(ce.box(['Cos', 'Undefined']).N().isNaN).toBe(true);
      expect(ce.box(['Cos', 'Missing']).evaluate().isNaN).toBe(true);
      expect(ce.box(['Cos', 'Missing']).N().isNaN).toBe(true);
    });

    it('Undefined + 1 is NaN', () => {
      expect(ce.box(['Add', 'Undefined', 1]).evaluate().isNaN).toBe(true);
      expect(ce.box(['Add', 'Undefined', 1]).N().isNaN).toBe(true);
    });

    it('a product, a quotient and a root of Undefined are NaN', () => {
      expect(ce.box(['Multiply', 'Undefined', 2]).evaluate().isNaN).toBe(true);
      expect(ce.box(['Divide', 1, 'Undefined']).evaluate().isNaN).toBe(true);
      expect(ce.box(['Sqrt', 'Undefined']).evaluate().isNaN).toBe(true);
      expect(ce.box(['Power', 'Undefined', 2]).evaluate().isNaN).toBe(true);
    });

    it('evaluateAsync answers NaN too — the async gate is the lockstep twin of the sync one', async () => {
      const r = await ce.box(['Cos', 'Undefined']).evaluateAsync();
      expect(r.isNaN).toBe(true);
    });

    it('Sin(When(1, False)) is NaN', () => {
      // `When` masks to `Missing`; the numeric slot of `Sin` absorbs it.
      expect(ce.box(['Sin', ['When', 1, 'False']]).evaluate().isNaN).toBe(true);
      expect(ce.box(['Sin', ['When', 1, 'False']]).N().isNaN).toBe(true);
    });

    it('an Undefined cell under a broadcast head is NaN at that position, as a Missing cell is', () => {
      const withUndefined = ce
        .box(['Sin', ['List', 1, 'Undefined', 3]])
        .evaluate();
      const withMissing = ce.box(['Sin', ['List', 1, 'Missing', 3]]).evaluate();
      expect(withUndefined.toString()).toEqual(withMissing.toString());
      expect(withUndefined.ops![1].isNaN).toBe(true);

      const nUndefined = ce.box(['Sin', ['List', 1, 'Undefined', 3]]).N();
      const nMissing = ce.box(['Sin', ['List', 1, 'Missing', 3]]).N();
      expect(nUndefined.toString()).toEqual(nMissing.toString());
      expect(nUndefined.ops![1].isNaN).toBe(true);
    });
  });

  describe('static type', () => {
    // The declared type of `Undefined` is `unknown`, which a type join drops.
    // So the type of an arithmetic application with an `Undefined` operand
    // was the type of its PRESENT operands: `Undefined · [1, 2, 3]` claimed
    // `vector<integer^3>` while its value is `[NaN, NaN, NaN]`. The operand
    // is now typed like `Missing`, and each numeric cell widens to `number`.
    it('an application with an Undefined operand types as the Missing one does', () => {
      for (const head of ['Add', 'Subtract', 'Multiply', 'Divide', 'Power']) {
        for (const ops of [
          ['@', ['List', 1, 2, 3]],
          [['List', 1, 2, 3], '@'],
          ['@', 2],
        ]) {
          const [withMissing, withUndefined] = ['Missing', 'Undefined'].map(
            (m) =>
              ce
                .box([head, ...ops.map((x) => (x === '@' ? m : x))] as any)
                .type.toString()
          );
          expect(withUndefined).toEqual(withMissing);
        }
      }
      expect(
        ce.box(['Multiply', 'Undefined', ['List', 1, 2, 3]]).type.toString()
      ).toBe('vector<3>');
      expect(ce.box(['Add', 'Undefined', 1]).type.toString()).toBe('number');
      expect(ce.box(['Negate', 'Undefined']).type.toString()).toBe('number');
    });

    it('the static type admits the evaluated value', () => {
      for (const expr of [
        ['Multiply', 'Undefined', ['List', 1, 2, 3]],
        ['Add', ['List', 1, 2, 3], 'Undefined'],
        ['Divide', ['List', 1, 2, 3], 'Undefined'],
        ['Power', 'Undefined', ['List', 1, 2, 3]],
        ['Add', 'Undefined', 1],
        ['Negate', 'Undefined'],
      ]) {
        const boxed = ce.box(expr as any);
        expect(boxed.evaluate().type.matches(boxed.type)).toBe(true);
      }
    });
  });

  describe('compiled JavaScript lane', () => {
    it('answers NaN for the same rows', () => {
      for (const expr of [
        ['Cos', 'Undefined'],
        ['Add', 'Undefined', 1],
        ['Sin', ['When', 1, 'False']],
      ]) {
        const result = compile(ce.expr(expr as any))!;
        expect(result.success).toBe(true);
        expect(Number.isNaN(result.run!({}) as number)).toBe(true);
      }
    });
  });

  describe('outside an absence test, Undefined is unchanged', () => {
    it('a bare Undefined evaluates to itself', () => {
      expect(ce.box('Undefined').evaluate().symbol).toBe('Undefined');
    });

    it('its declared type is still `unknown`', () => {
      expect(ce.box('Undefined').type.toString()).toBe('unknown');
    });
  });

  describe('the When restriction', () => {
    // The masking answer of `When` is `Missing`, not `Undefined`: the 2026-09-09
    // ruling aligned it with a default-less `Which` and the else-less `If`.
    it('When(1, False) answers Missing', () => {
      expect(ce.box(['When', 1, 'False']).evaluate().symbol).toBe('Missing');
    });

    it('its result type carries the `missing` arm', () => {
      expect(ce.box(['When', 1, 'False']).type.toString()).toBe(
        'integer | missing'
      );
      expect(ce.box(['When', 1, 'True']).type.toString()).toBe('integer');
    });
  });
});

// The operators declared `missingBehavior: 'handle'` decide for themselves
// what an absent operand or element means. They all run one value-level test,
// `isAbsentValue` (`src/compute-engine/boxed-expression/type-guards.ts`),
// which reads both absence symbols and a `NaN`. Each row below is asserted for
// `Missing` and for `Undefined` side by side: the point of the 2026-09-22
// ruling is that the two answers are the SAME, so the comparison against the
// `Missing` answer is the assertion that matters, and the literal answer is
// pinned as well so a silent change of both at once is still caught.
describe('UNDEFINED for the operators that own their absence semantics', () => {
  // `'@'` stands for the absence symbol under test, at any depth of the
  // MathJSON. Each row is evaluated twice, once with `Missing` substituted and
  // once with `Undefined`, and the two answers are returned in that order.
  const substitute = (op: unknown, marker: string): unknown =>
    Array.isArray(op)
      ? op.map((x) => substitute(x, marker))
      : op === '@'
        ? marker
        : op;

  const evaluated = (head: string, ...rest: unknown[]): string[] =>
    ['Missing', 'Undefined'].map((marker) =>
      ce
        .box([head, ...rest.map((op) => substitute(op, marker))] as any)
        .evaluate()
        .toString()
    );

  describe('the statistics reducers answer NaN for an absent datum', () => {
    for (const head of [
      'Mean',
      'Median',
      'Variance',
      'StandardDeviation',
      'Max',
      'Min',
      'Sum',
      'Product',
    ]) {
      it(`${head} of [1, marker, 3]`, () => {
        const [withMissing, withUndefined] = evaluated(head, [
          'List',
          1,
          '@',
          3,
        ]);
        expect(withUndefined).toEqual(withMissing);
        expect(withMissing).toBe('NaN');
      });
    }

    it('Quantile of [1, marker, 3]', () => {
      const [withMissing, withUndefined] = evaluated(
        'Quantile',
        ['List', 1, '@', 3],
        0.5
      );
      expect(withUndefined).toEqual(withMissing);
      expect(withMissing).toBe('NaN');
    });

    it('Covariance against data with an absent datum', () => {
      const [withMissing, withUndefined] = evaluated(
        'Covariance',
        ['List', 1, 2, 3],
        ['List', 1, '@', 3]
      );
      expect(withUndefined).toEqual(withMissing);
      expect(withMissing).toBe('NaN');
    });
  });

  describe('the absence-discharge operators', () => {
    it('IsMissing(marker) is True', () => {
      const [withMissing, withUndefined] = evaluated('IsMissing', '@');
      expect(withUndefined).toEqual(withMissing);
      expect(ce.box(['IsMissing', 'Undefined']).evaluate().symbol).toBe('True');
    });

    it('Coalesce(marker, 2) is 2', () => {
      const [withMissing, withUndefined] = evaluated('Coalesce', '@', 2);
      expect(withUndefined).toEqual(withMissing);
      expect(withMissing).toBe('2');
    });

    it('Coalesce of absences alone stays absent, returning the last operand verbatim', () => {
      expect(
        ce.box(['Coalesce', 'Undefined', 'Undefined']).evaluate().symbol
      ).toBe('Undefined');
      expect(ce.box(['Coalesce', 'Missing', 'Missing']).evaluate().symbol).toBe(
        'Missing'
      );
    });
  });

  describe('chained At absorbs an absent base or index', () => {
    it('an absent INDEX absorbs into the numeric domain of the elements', () => {
      const [withMissing, withUndefined] = evaluated('At', ['List', 1, 2], '@');
      expect(withUndefined).toEqual(withMissing);
      expect(withMissing).toBe('NaN');
    });

    it('an absent BASE propagates the position-preserving marker', () => {
      const [withMissing, withUndefined] = evaluated('At', '@', 1);
      expect(withUndefined).toEqual(withMissing);
      expect(withMissing).toBe('"Missing"');
    });
  });

  describe('Count and Tally read an absent cell as a cell', () => {
    it('Count counts it — neither marker erases a position', () => {
      const [withMissing, withUndefined] = evaluated('Count', [
        'List',
        1,
        '@',
        3,
      ]);
      expect(withUndefined).toEqual(withMissing);
      expect(withMissing).toBe('3');
    });

    it('Tally keeps it as its own value, with a count of one', () => {
      expect(
        ce
          .box(['Tally', ['List', 1, 'Undefined', 3]])
          .evaluate()
          .toString()
      ).toBe('([1,"Undefined",3], [1,1,1])');
      expect(
        ce
          .box(['Tally', ['List', 1, 'Missing', 3]])
          .evaluate()
          .toString()
      ).toBe('([1,"Missing",3], [1,1,1])');
    });
  });

  describe('an absent operand beside a POINT makes the point absent', () => {
    // The tuple is atomic, so there is no cell for the absence to land in.
    it('marker + (1, 1, 1) is Missing', () => {
      const [withMissing, withUndefined] = evaluated('Add', '@', [
        'Tuple',
        1,
        1,
        1,
      ]);
      expect(withUndefined).toEqual(withMissing);
      expect(withMissing).toBe('"Missing"');
    });

    it('marker · (1, 1, 1) is Missing', () => {
      const [withMissing, withUndefined] = evaluated('Multiply', '@', [
        'Tuple',
        1,
        1,
        1,
      ]);
      expect(withUndefined).toEqual(withMissing);
      expect(withMissing).toBe('"Missing"');
    });
  });

  describe('compiled JavaScript lane', () => {
    // `Undefined` is a DECLARED engine symbol, so a row written with it has no
    // free symbol and the compiler folds the whole row to the interpreter's
    // answer. A written `Missing` reaches the compiler's symbol branch, which
    // since 2026-09-22 lowers BOTH absence symbols to the target's object null
    // (`undefined` on JavaScript). Each row below is pinned against the
    // INTERPRETER's answer for the same row — the contract the two lanes owe
    // each other. The rows that used to disagree for a written `Missing`
    // (`Median`, `IsMissing`, `Coalesce`) are pinned in
    // `compiled-absence-literal.test.ts`.
    const compiled = (expr: unknown): unknown =>
      compile(ce.expr(expr as any))!.run!({});

    for (const head of ['Mean', 'Median', 'Variance', 'Max', 'Min']) {
      it(`${head} of [1, Undefined, 3] compiles to NaN, as the interpreter answers`, () => {
        expect(compiled([head, ['List', 1, 'Undefined', 3]])).toBeNaN();
      });
    }

    it('Mean, Variance, Max and Min of [1, Missing, 3] compile to NaN too', () => {
      for (const head of ['Mean', 'Variance', 'Max', 'Min'])
        expect(compiled([head, ['List', 1, 'Missing', 3]])).toBeNaN();
    });

    it('IsMissing(Undefined) compiles to true', () => {
      expect(compiled(['IsMissing', 'Undefined'])).toBe(true);
    });

    it('Coalesce(Undefined, 2) compiles to 2', () => {
      expect(compiled(['Coalesce', 'Undefined', 2])).toBe(2);
    });

    it('Count of [1, Undefined, 3] compiles to 3, as it does for Missing', () => {
      expect(compiled(['Count', ['List', 1, 'Undefined', 3]])).toBe(3);
      expect(compiled(['Count', ['List', 1, 'Missing', 3]])).toBe(3);
    });

    it('At([1, 2], Undefined) compiles to NaN, as it does for Missing', () => {
      expect(compiled(['At', ['List', 1, 2], 'Undefined'])).toBeNaN();
      expect(compiled(['At', ['List', 1, 2], 'Missing'])).toBeNaN();
    });
  });
});
