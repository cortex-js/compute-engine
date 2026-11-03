import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

// `Missing` is the one absent symbol (`docs/ERROR-MODEL.md`, "`Missing` is a
// result only"). An operator over `Missing` gives `Missing` in the
// interpreter, a broadcast gives a `Missing` cell, and the readers
// (`IsMissing`, `Coalesce`, the position-preserving accessors) see it.
//
// `Undefined` is not an absent value: it is an ordinary symbol with no value.
// From 2026-09-21 to 2026-11-02 an `Undefined` operand was read as `Missing`
// in a numeric slot and by the operators that handle absence themselves;
// that reading is gone.

const ce = new ComputeEngine();

describe('MISSING in a numeric slot', () => {
  describe('interpreter, evaluate() and N()', () => {
    it('an operator over Missing gives Missing', () => {
      for (const expr of [
        ['Cos', 'Missing'],
        ['Add', 'Missing', 1],
        ['Multiply', 'Missing', 2],
        ['Divide', 1, 'Missing'],
        ['Sqrt', 'Missing'],
        ['Power', 'Missing', 2],
        ['Negate', 'Missing'],
      ]) {
        const boxed = ce.box(expr as any);
        expect(boxed.evaluate().symbol).toBe('Missing');
        expect(boxed.N().symbol).toBe('Missing');
        expect(boxed.type.toString()).toBe('missing');
      }
    });

    it('evaluateAsync gives Missing too', async () => {
      const r = await ce.box(['Cos', 'Missing']).evaluateAsync();
      expect(r.symbol).toBe('Missing');
    });

    it('Sin(If(False, 1)) is NaN', () => {
      // A restriction whose condition is false gives `NaN` for a number.
      expect(ce.box(['Sin', ['If', 'False', 1]]).evaluate().isNaN).toBe(true);
      expect(ce.box(['Sin', ['If', 'False', 1]]).N().isNaN).toBe(true);
    });

    it('a Missing cell under a broadcast head is Missing at that position', () => {
      expect(
        ce.box(['Sin', ['List', 1, 'Missing', 3]]).evaluate().toString()
      ).toBe('[sin(1),"Missing",sin(3)]');
      expect(ce.box(['Sin', ['List', 1, 'Missing', 3]]).N().ops![1].symbol).toBe(
        'Missing'
      );
    });
  });

  describe('static type', () => {
    it('an application with a Missing operand', () => {
      expect(
        ce.box(['Multiply', 'Missing', ['List', 1, 2, 3]]).type.toString()
      ).toBe('list<integer | missing^3>');
      expect(ce.box(['Add', 'Missing', 1]).type.toString()).toBe('missing');
      expect(ce.box(['Negate', 'Missing']).type.toString()).toBe('missing');
    });

    it('the static type admits the evaluated value', () => {
      for (const expr of [
        ['Multiply', 'Missing', ['List', 1, 2, 3]],
        ['Add', ['List', 1, 2, 3], 'Missing'],
        ['Divide', ['List', 1, 2, 3], 'Missing'],
        ['Power', 'Missing', ['List', 1, 2, 3]],
        ['Add', 'Missing', 1],
        ['Negate', 'Missing'],
      ]) {
        const boxed = ce.box(expr as any);
        expect(boxed.evaluate().type.matches(boxed.type)).toBe(true);
      }
    });

    // A `Missing` cell of a list literal is typed `missing` (user ruling of
    // 2026-09-25).
    it('a list literal with a Missing cell', () => {
      expect(ce.box(['List', 1, 'Missing']).type.toString()).toBe(
        'list<integer | missing^2>'
      );
      expect(
        ce
          .box(['List', ['List', 1, 'Missing'], ['List', 1, 2]])
          .type.toString()
        // A list of rows keeps its levels: since ROADMAP CE-389 it is a matrix
        // whose cells may be absent (before, nested plain lists; and before
        // 2026-10-19, a flat list, which did not describe the value).
      ).toBe('matrix<integer | missing^(2x2)>');
      expect(ce.parse('[1, \\operatorname{Missing}]').type.toString()).toBe(
        'list<integer | missing^2>'
      );
    });

    it('a list literal with a Missing cell evaluates cell by cell', () => {
      expect(
        ce
          .box(['Multiply', 2, ['List', 1, 'Missing']])
          .N()
          .toString()
      ).toBe('[2,"Missing"]');
      expect(
        ce
          .box(['Multiply', ['List', 1, 'Missing'], ['List', 1, 2]])
          .N()
          .toString()
      ).toBe('[1,"Missing"]');
      expect(
        ce.box(['Reverse', ['List', 1, 'Missing']]).evaluate().toString()
      ).toBe('["Missing",1]');
      expect(
        ce.box(['Length', ['List', 1, 'Missing']]).evaluate().toString()
      ).toBe('2');
      for (const head of ['Sum', 'Max', 'Norm'])
        expect(
          ce.box([head, ['List', 1, 'Missing']]).evaluate().symbol
        ).toBe('Missing');
    });

    it('the static type of a list with a Missing cell admits its value', () => {
      for (const expr of [
        ['List', 1, 'Missing'],
        ['List', ['List', 1, 'Missing'], ['List', 1, 2]],
        ['Multiply', 2, ['List', 1, 'Missing']],
        ['Multiply', ['List', 1, 'Missing'], ['List', 1, 2]],
      ]) {
        const boxed = ce.box(expr as any);
        expect(boxed.evaluate().type.matches(boxed.type)).toBe(true);
        expect(boxed.N().type.matches(boxed.type)).toBe(true);
      }
    });

    // The determinant is computed by a kernel over a packed numeric matrix,
    // which reads a `Missing` cell as `NaN`: the value is `NaN`, and the
    // static type stays `integer`, since the `NaN` marker is implicit in a
    // numeric result type. This is a recorded choice, not the `Missing`
    // result that the element-wise operators give.
    it('the determinant of a matrix with a Missing cell is NaN', () => {
      const boxed = ce.box([
        'Determinant',
        ['List', ['List', 1, 'Missing'], ['List', 1, 2]],
      ]);
      expect(boxed.type.toString()).toBe('integer');
      expect(boxed.evaluate().toString()).toBe('NaN');
      expect(boxed.N().toString()).toBe('NaN');
    });

    // A `Missing` element of a `Tuple`, a `Set` or a `Sequence` is typed
    // `missing`. Before, a set join dropped it (`set<integer>`).
    it('a Tuple or Set with a Missing element', () => {
      expect(ce.box(['Tuple', 1, 'Missing']).type.toString()).toBe(
        'tuple<integer, missing>'
      );
      expect(ce.box(['Set', 1, 'Missing']).type.toString()).toBe(
        'set<integer | missing>'
      );
      expect(ce.parse('(1, \\operatorname{Missing})').type.toString()).toBe(
        'tuple<integer, missing>'
      );
    });

    // A point with an absent component: the component stays `Missing` in
    // the arithmetic. Before, `(3, 4) - (1, Missing)` stayed inert,
    // `(1, Missing) + (1, 1)` was `(2, Missing + 1)`, and from 2026-09-21
    // to 2026-11-02 it was `(2, NaN)`.
    it('a Tuple with a Missing element evaluates component by component', () => {
      const t = ['Tuple', 1, 'Missing'];
      for (const [expr, expected] of [
        [['Add', t, ['Tuple', 1, 1]], '(2, "Missing")'],
        [['Subtract', ['Tuple', 3, 4], t], '(2, "Missing")'],
        [['Negate', t], '(-1, "Missing")'],
        [['Multiply', 2, t], '(2, "Missing")'],
      ] as const) {
        const boxed = ce.box(expr as any);
        expect(boxed.evaluate().toString()).toBe(expected);
        expect(boxed.N().toString()).toBe(expected);
        expect(boxed.evaluate().type.matches(boxed.type)).toBe(true);
      }
    });
  });

  describe('compiled JavaScript lane', () => {
    // The interpreter gives `Missing` for the first two rows and `NaN` for
    // the third; compiled code may give `NaN` or `undefined` where the
    // interpreter gives `Missing` (`docs/COMPILATION-MODEL.md`, "Caveats of
    // compiled code").
    it('answers NaN or undefined for the same rows', () => {
      for (const expr of [
        ['Cos', 'Missing'],
        ['Add', 'Missing', 1],
        ['Sin', ['If', 'False', 1]],
      ]) {
        const result = compile(ce.expr(expr as any))!;
        expect(result.success).toBe(true);
        const value = result.run!({});
        expect(value === undefined || Number.isNaN(value as number)).toBe(
          true
        );
      }
    });
  });

  describe('the single-branch If restriction', () => {
    // The masking answer of a restriction is the absence marker of the value's own
    // type, never `Undefined`: `NaN` for a number (user decision 2026-09-25;
    // the 2026-09-09 ruling had aligned every value with the `Missing` of a
    // default-less `Which`, which a point or a list still answers).
    it('If(False, 1) answers NaN', () => {
      expect(ce.box(['If', 'False', 1]).evaluate().isNaN).toBe(true);
    });

    it('its result type is the type of its value, no `nan` arm and no `missing` arm', () => {
      expect(ce.box(['If', 'False', 1]).type.toString()).toBe('integer');
      expect(ce.box(['If', 'True', 1]).type.toString()).toBe('integer');
    });
  });
});

describe('UNDEFINED is an ordinary symbol, not an absent value', () => {
  it('an operator over Undefined stays unevaluated', () => {
    for (const [expr, expected] of [
      [['Cos', 'Undefined'], 'cos("Undefined")'],
      [['Add', 'Undefined', 1], '"Undefined" + 1'],
      [['Multiply', 'Undefined', 2], '2 * "Undefined"'],
      [['Sin', ['List', 1, 'Undefined', 3]], '[sin(1),sin("Undefined"),sin(3)]'],
      [['Add', ['Tuple', 1, 'Undefined'], ['Tuple', 1, 1]], '(2, "Undefined" + 1)'],
      [['Mean', ['List', 1, 'Undefined', 3]], 'Mean([1,"Undefined",3])'],
    ] as const) {
      expect(ce.box(expr as any).evaluate().toString()).toBe(expected);
    }
  });

  it('a list cell that is Undefined is not typed missing', () => {
    expect(ce.box(['List', 1, 'Undefined']).type.toString()).toBe('vector<2>');
    expect(ce.box(['Tuple', 1, 'Undefined']).type.toString()).toBe(
      'tuple<integer, number>'
    );
  });

  it('the readers of absence do not see it as absent', () => {
    expect(ce.box(['IsMissing', 'Undefined']).evaluate().symbol).toBe('False');
    expect(ce.box(['Coalesce', 'Undefined', 2]).evaluate().toString()).toBe(
      'Coalesce("Undefined", 2)'
    );
    expect(ce.box(['At', ['List', 1, 2], 'Undefined']).evaluate().toString()).toBe(
      'At([1,2], "Undefined")'
    );
  });

  it('a bare Undefined evaluates to itself', () => {
    expect(ce.box('Undefined').evaluate().symbol).toBe('Undefined');
  });

  // `Undefined` is an unknown symbol like any other: its type is `unknown`
  // until a use narrows it. Boxing `Undefined + 1` narrows it to `number` on
  // that engine, as it narrows `Foo` in `Foo + 1`.
  it('its type is `unknown` until a use narrows it', () => {
    const fresh = new ComputeEngine();
    expect(fresh.box('Undefined').type.toString()).toBe('unknown');
    fresh.box(['Add', 'Undefined', 1]);
    expect(fresh.box('Undefined').type.toString()).toBe('number');
  });
});

// The operators declared `missingBehavior: 'handle'` decide for themselves
// what an absent operand or element means.
describe('MISSING for the operators that own their absence semantics', () => {
  const evaluated = (expr: unknown): string =>
    ce
      .box(expr as any)
      .evaluate()
      .toString();

  describe('the statistics reducers answer Missing for an absent datum', () => {
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
      it(`${head} of [1, Missing, 3]`, () => {
        expect(evaluated([head, ['List', 1, 'Missing', 3]])).toBe('"Missing"');
      });
    }

    it('Quantile of [1, Missing, 3]', () => {
      expect(
        evaluated(['Quantile', ['List', 1, 'Missing', 3], 0.5])
      ).toBe('"Missing"');
    });

    it('Covariance against data with an absent datum', () => {
      expect(
        evaluated([
          'Covariance',
          ['List', 1, 2, 3],
          ['List', 1, 'Missing', 3],
        ])
      ).toBe('"Missing"');
    });
  });

  describe('the absence-discharge operators', () => {
    it('IsMissing(Missing) is True', () => {
      expect(evaluated(['IsMissing', 'Missing'])).toBe('"True"');
    });

    it('Coalesce(Missing, 2) is 2', () => {
      expect(evaluated(['Coalesce', 'Missing', 2])).toBe('2');
    });

    it('Coalesce of absences alone stays absent', () => {
      expect(ce.box(['Coalesce', 'Missing', 'Missing']).evaluate().symbol).toBe(
        'Missing'
      );
    });
  });

  describe('chained At absorbs an absent base or index', () => {
    it('an absent INDEX absorbs into the numeric domain of the elements', () => {
      expect(evaluated(['At', ['List', 1, 2], 'Missing'])).toBe('NaN');
    });

    it('an absent BASE propagates the position-preserving marker', () => {
      expect(evaluated(['At', 'Missing', 1])).toBe('"Missing"');
    });
  });

  describe('Count and Tally read an absent cell as a cell', () => {
    it('Count counts it', () => {
      expect(evaluated(['Count', ['List', 1, 'Missing', 3]])).toBe('3');
    });

    it('Tally keeps it as its own value, with a count of one', () => {
      expect(evaluated(['Tally', ['List', 1, 'Missing', 3]])).toBe(
        '([1,"Missing",3], [1,1,1])'
      );
    });
  });

  describe('an absent operand beside a POINT makes the point absent', () => {
    // The tuple is atomic, so there is no cell for the absence to land in.
    it('Missing + (1, 1, 1) is Missing', () => {
      expect(evaluated(['Add', 'Missing', ['Tuple', 1, 1, 1]])).toBe(
        '"Missing"'
      );
    });

    it('Missing · (1, 1, 1) is Missing', () => {
      expect(evaluated(['Multiply', 'Missing', ['Tuple', 1, 1, 1]])).toBe(
        '"Missing"'
      );
    });
  });

  describe('compiled JavaScript lane', () => {
    // The interpreter gives `Missing` for these reducers; compiled code
    // gives `NaN`, as the caveats of compiled code allow. `Count` and the
    // read of an absent index have the same value on both routes.
    const compiled = (expr: unknown): unknown =>
      compile(ce.expr(expr as any))!.run!({});

    it('Mean, Variance, Max and Min of [1, Missing, 3] compile to NaN', () => {
      for (const head of ['Mean', 'Variance', 'Max', 'Min'])
        expect(compiled([head, ['List', 1, 'Missing', 3]])).toBeNaN();
    });

    it('Count of [1, Missing, 3] compiles to 3', () => {
      expect(compiled(['Count', ['List', 1, 'Missing', 3]])).toBe(3);
    });

    it('At([1, 2], Missing) compiles to NaN', () => {
      expect(compiled(['At', ['List', 1, 2], 'Missing'])).toBeNaN();
    });
  });
});
