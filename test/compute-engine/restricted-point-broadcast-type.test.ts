import { ComputeEngine } from '../../src/compute-engine';

/**
 * The static type of an application over a RESTRICTED point or list.
 *
 * A restriction `P{c}` was `When(P, c)` before the operator was removed, typed `missing | T`: the value is `P`
 * when `c` holds and `Missing` otherwise. A broadcast over it must keep both
 * the shape of `P` and the absence arm. Before the fix, the `missing` arm hid
 * the point from the broadcast type lift, and the numeric absence absorption
 * then turned the arm into `number`: `Sin(P{c})` was typed `number`, and
 * because the absence marker is read off the application's own type, it
 * evaluated to `NaN` where `Sin` of an absent point is the absent point
 * `Missing`. The same held for a default-less `Which` with point arms.
 *
 * Since 2026-11-02 the parser reads a restriction `P{c}` as the single-branch
 * `If(c, P)`, whose static type is the type of `P`, with no `missing` arm
 * (`docs/plans/2026-11-02-restriction-binding.md`); the type of a value that
 * holds an absent cell then has a `missing` arm that the static type does
 * not show. The restriction also applies to its whole group, so
 * `2{c}·P` is `If(c, 2·P)`.
 *
 * The rule for the absence marker is in `docs/ERROR-MODEL.md` (an absent
 * operand answers the marker of the application's codomain: `NaN` for a
 * numeric type, `Missing` otherwise; an absent factor beside a point makes
 * the whole point absent). Since 2026-11-03 a false restriction of a point is
 * the point of `NaN` coordinates, not `Missing` (`docs/ERROR-MODEL.md`,
 * "`Missing` is a result only", rule 2), so a broadcast over it gives a
 * point of `NaN` coordinates.
 */

const P = String.raw`\operatorname{PointList}(0,1)`;
const PC = String.raw`\operatorname{PointList}(0,1)\left\{0<t\right\}`;
const QC = String.raw`\operatorname{PointList}(2,3)\left\{0<t\right\}`;
const Q = String.raw`\operatorname{PointList}(2,3)`;
const LC = String.raw`[1,2,3]\left\{0<t\right\}`;
const WHICH = String.raw`\begin{cases}(1,2) & t>0\\ (3,4) & t<-5\end{cases}`;

/** The static type, and the value when `t` is 1 (present) and -1 (absent). */
function probe(latex: string): {
  type: string;
  present: string;
  absent: string;
} {
  const ce = new ComputeEngine();
  const type = ce.parse(latex).type.toString();
  ce.assign('t', 1);
  const present = ce.parse(latex).evaluate().toString();
  const ce2 = new ComputeEngine();
  ce2.assign('t', -1);
  const absent = ce2.parse(latex).evaluate().toString();
  return { type, present, absent };
}

describe('a broadcast over a restricted point keeps the point and the absence', () => {
  test.each([
    // [label, latex, type, present value]
    [
      'Sin',
      String.raw`\sin(${PC})`,
      'tuple<number, number>',
      '(0, sin(1))',
    ],
    ['Power', `(${PC})^2`, 'tuple<number, number>', '(0, 1)'],
    ['Negate', `-${PC}`, 'tuple<integer, integer>', '(0, -1)'],
    // `t` has no declared type, so the type is read before `t` has a value,
    // and `t` can be any number: the components are `number`.
    [
      'a scalar factor',
      String.raw`t\cdot${PC}`,
      'tuple<number, number>',
      '(0, 1)',
    ],
    [
      'a scalar divisor',
      String.raw`\frac{${PC}}{t}`,
      'tuple<number, number>',
      '(0, 1)',
    ],
    [
      'a point addend',
      `${PC}+${Q}`,
      'tuple<integer, integer>',
      '(2, 4)',
    ],
  ])('%s', (_label, latex, type, present) => {
    const r = probe(latex);
    expect(r.type).toBe(type);
    expect(r.present).toBe(present);
    // The value when the restriction does not hold is the point of `NaN`
    // coordinates, the absent value of a point. It was `NaN` for `Sin`,
    // `Power` and the scalar factor, then `Missing`.
    expect(r.absent).toBe('(NaN, NaN)');
  });

  test('the unrestricted point is unchanged', () => {
    const ce = new ComputeEngine();
    expect(ce.parse(String.raw`\sin(${P})`).type.toString()).toBe(
      'tuple<number, number>'
    );
    expect(ce.parse(`(${P})^2`).type.toString()).toBe('tuple<number, number>');
    expect(ce.parse(`-${P}`).type.toString()).toBe('tuple<integer, integer>');
  });

  test('a restricted scalar factor beside a point restricts the whole point', () => {
    // The restriction applies to its whole group, here the whole product
    // `If(0<t, 2·P)`, so the absent value is the point of `NaN`
    // coordinates.
    const r = probe(String.raw`2\left\{0<t\right\}\cdot${P}`);
    expect(r.type).toBe('tuple<integer, integer>');
    expect(r.present).toBe('(0, 2)');
    expect(r.absent).toBe('(NaN, NaN)');
  });
});

describe('a broadcast over a restricted list keeps the list and the absence', () => {
  test.each([
    ['Sin', String.raw`\sin(${LC})`, '[sin(1),sin(2),sin(3)]'],
    ['Power', `(${LC})^2`, '[1,4,9]'],
  ])('%s', (_label, latex, present) => {
    const r = probe(latex);
    // It was `number | vector<3>`: the absence arm became a scalar.
    expect(r.type).toBe('vector<3>');
    expect(r.present).toBe(present);
    // A scalar condition selects the list whole, also under an operator
    // that maps over its operand: the absent value is the absent list
    // `Missing` (selection rule of 2026-11-02). It was `[NaN,NaN,NaN]`,
    // the held restriction mapped cell by cell.
    expect(r.absent).toBe('"Missing"');
  });

  test('a restricted scalar beside a list restricts the whole list', () => {
    // The restriction applies to the whole sum `If(0<t, [1,2,3]+2)`, so the
    // absent value is the absent list `Missing`. When the restriction was on
    // the scalar alone, it landed in each cell, `[NaN,NaN,NaN]`.
    const r = probe(String.raw`[1,2,3]+2\left\{0<t\right\}`);
    expect(r.type).toBe('vector<integer^3>');
    expect(r.absent).toBe('"Missing"');
  });

  test('a restricted scalar with a scalar result absorbs to NaN', () => {
    const r = probe(String.raw`\sin(2\left\{0<t\right\})`);
    expect(r.type).toBe('real');
    expect(r.absent).toBe('NaN');
  });
});

describe('a broadcast over a default-less Which with point arms', () => {
  test('Sin keeps the point and the absence', () => {
    const r = probe(String.raw`\sin(${WHICH})`);
    expect(r.type).toBe('missing | tuple<number, number>');
    expect(r.present).toBe('(sin(1), sin(2))');
    expect(r.absent).toBe('"Missing"');
  });

  test('Power keeps the point and the absence', () => {
    const r = probe(`(${WHICH})^2`);
    expect(r.type).toBe('missing | tuple<number, number>');
    expect(r.present).toBe('(1, 4)');
    expect(r.absent).toBe('"Missing"');
  });

  test('with a default arm, the point is never absent', () => {
    const r = probe(
      String.raw`\sin(\begin{cases}(1,2) & t>0\\ (3,4) & \text{otherwise}\end{cases})`
    );
    expect(r.type).toBe('tuple<number, number>');
  });
});

describe('shapes that are an error for a restricted point', () => {
  // `t / P` and `P · Q` are errors for an unrestricted point
  // (`no-division-by-point`, `no-product-between-points`). Over restricted
  // points they are the same errors when the expression is created, whatever
  // the value of the condition, because when present the operand is a point.
  // Desmos rejects them the same way (user decision 2026-09-25). Before, they
  // were valid, typed `number`, and evaluated to the error when the point was
  // present and to `NaN` when it was absent.
  test('a number divided by a restricted point', () => {
    const r = probe(String.raw`\frac{t}{${PC}}`);
    expect(r.type).toBe('error');
    expect(r.present).toContain('no-division-by-point');
    expect(r.absent).toContain('no-division-by-point');
  });

  test('the product of two restricted points', () => {
    // The two restrictions apply to the whole product: it is
    // `If(And(0<t, 0<t), P·Q)`, and the error is its arm. The expression is
    // invalid; its value is the error when the condition holds, and, since
    // an `If` evaluates only the arm it selects, the absent value `Missing`
    // when it does not.
    const r = probe(String.raw`${PC}\cdot${QC}`);
    expect(r.type).toBe('error');
    expect(r.present).toContain('no-product-between-points');
    expect(r.absent).toBe('"Missing"');
  });
});

describe('a list that holds a restricted point or masked points', () => {
  // A cell that holds a false restriction of a point is the point of `NaN`
  // coordinates (user decision 2026-11-03), on every route; a written
  // `Missing` cell stays `Missing`. Before that decision, a cell whose
  // present value is a point and which is absent was `Missing`, on every
  // route, and the static type said so:
  // `list<missing | tuple<…>>`. Before the fix, the type of such a
  // broadcast dropped the `missing` arm (`Sin([P{c}, (2, 3)])` was typed
  // `list<number>`), and an absent point cell answered `NaN` where the rule
  // gives `Missing` (`2·[P{c}, (2, 3)]` was `[NaN, (4, 6)]`), or both
  // markers in one list (`P{c} + [(1, 2), (3, 4)]{[1, 2] > 1}` was
  // `[NaN, Missing]`). A cell whose present value is a number is still
  // `NaN` (`docs/ERROR-MODEL.md`, the section on `Missing` in a numeric
  // slot).
  const PJ = ['If', ['Less', 0, 't'], ['PointList', 0, 1]];
  const PTS = ['If', ['Greater', ['List', 1, 2], 1], ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]]];
  const NUMS = ['If', ['Greater', ['List', 1, 2, 3], 2], ['List', 10, 20, 30]];
  // A list of points masked by a list of conditions: a position that is not
  // selected is a point whose coordinates are `NaN` (selection rule of
  // 2026-11-02; it was `Missing`), so the cells are points of numbers.
  const MASKED_POINTS = 'list<tuple<number, number>>';
  // The type of a list literal of two such points: the literal states its
  // length.
  const POINT_PAIR = 'list<(missing | tuple<number, number>)^2>';
  // A sum, a difference, a negation or a product by an integer of points
  // with integer coordinates: a coordinate is an integer, or `NaN` when an
  // operand is absent.
  const INTEGER_POINTS = 'list<missing | tuple<integer | nan, integer | nan>>';
  // An operator over `Missing` gives `Missing`, so no coordinate is `NaN`.
  const INTEGER_POINT_PAIR = 'list<(missing | tuple<integer, integer>)^2>';
  const MATRIX_OF_INTEGER_POINTS =
    'matrix<(missing | tuple<integer, integer>)^(2x2)>';
  // The type of a 2×2 matrix of such points. A literal of rank 2 whose cells
  // are `missing | tuple<…>` was typed as a list of rank 1,
  // `list<missing | tuple<…>>`, which claimed that its elements are the
  // points, where they are the rows.
  const MATRIX_OF_POINTS = 'matrix<(missing | tuple<number, number>)^(2x2)>';

  /** The value when `t` is `t`, by `evaluate()` or by `N()`. A present value
   * (`t > 0`) must match the static type. The static type of a restriction has
   * no `missing` arm, so an absent value is not checked against it. */
  function at(json: any, t: number, numeric = false): string {
    const ce = new ComputeEngine();
    ce.assign('t', t);
    const e = ce.box(json);
    const v = numeric ? e.N() : e.evaluate();
    if (t > 0) expect(v.type.matches(e.type)).toBe(true);
    return v.toString();
  }

  const missingCount = (s: string) => (s.match(/"Missing"/g) ?? []).length;

  test.each([
    [
      'a restricted point plus masked points',
      ['Add', PJ, PTS],
      '[(NaN, NaN),(3, 5)]',
      '[(NaN, NaN),(NaN, NaN)]',
      MASKED_POINTS,
    ],
    [
      'a restricted point times masked numbers',
      ['Multiply', PJ, NUMS],
      '[(NaN, NaN),(NaN, NaN),(0, 30)]',
      '[(NaN, NaN),(NaN, NaN),(NaN, NaN)]',
      'list<tuple<number, number>>',
    ],
    [
      'Sin of a list holding a restricted point',
      ['Sin', ['List', PJ, ['Tuple', 2, 3]]],
      '[(0, sin(1)),(sin(2), sin(3))]',
      '[(NaN, NaN),(sin(2), sin(3))]',
      'list<tuple<number, number>^2>',
    ],
    [
      'a scalar times a list holding a restricted point',
      ['Multiply', 2, ['List', PJ, ['Tuple', 2, 3]]],
      '[(0, 2),(4, 6)]',
      '[(NaN, NaN),(4, 6)]',
      'list<tuple<integer, integer>^2>',
    ],
    [
      'a list holding a restricted point plus a point',
      ['Add', ['List', PJ, ['Tuple', 2, 3]], ['Tuple', 1, 1]],
      '[(1, 2),(3, 4)]',
      '[(NaN, NaN),(3, 4)]',
      'list<tuple<integer, integer>>',
    ],
    [
      'Sin of masked points',
      ['Sin', PTS],
      '[(NaN, NaN),(sin(3), sin(4))]',
      '[(NaN, NaN),(sin(3), sin(4))]',
      MASKED_POINTS,
    ],
    [
      'a scalar times masked points',
      ['Multiply', 2, PTS],
      '[(NaN, NaN),(6, 8)]',
      '[(NaN, NaN),(6, 8)]',
      MASKED_POINTS,
    ],
  ])('%s', (_label, json, present, absent, type) => {
    expect(new ComputeEngine().box(json).type.toString()).toBe(type);
    expect(at(json, 1)).toBe(present);
    expect(at(json, -1)).toBe(absent);
    // `N()` marks the same cells.
    expect(missingCount(at(json, -1, true))).toBe(missingCount(absent));
  });

  test('a MATRIX of points: an absent point cell is Missing at any depth', () => {
    // The cells of a list of lists of points are in the inner lists. The
    // correction of an absent point cell from `NaN` to `Missing` looked at
    // the cells of the outer list only, so a restricted point added to a
    // matrix of points left `NaN` in an inner cell:
    // `[[Missing, (3, 4)], [(5, 6), (7, 8)]] + (1, 1){0 < t}` with `t = -1`
    // was `[[NaN, Missing], [Missing, Missing]]`.
    const M = [
      'List',
      ['List', 'Missing', ['Tuple', 3, 4]],
      ['List', ['Tuple', 5, 6], ['Tuple', 7, 8]],
    ];
    const json = ['Add', M, ['If', ['Less', 0, 't'], ['Tuple', 1, 1]]];
    expect(new ComputeEngine().box(json).type.toString()).toBe(
      MATRIX_OF_INTEGER_POINTS
    );
    // The written `Missing` cell stays `Missing`; the other cells are
    // points of `NaN` coordinates.
    expect(at(json, -1)).toBe(
      '[["Missing",(NaN, NaN)],[(NaN, NaN),(NaN, NaN)]]'
    );
    expect(at(json, -1, true)).toBe(
      '[["Missing",(NaN, NaN)],[(NaN, NaN),(NaN, NaN)]]'
    );
    // A present point beside the matrix leaves the absent cell `Missing`
    // and computes the others.
    expect(at(json, 1)).toBe('[["Missing",(4, 5)],[(6, 7),(8, 9)]]');
  });

  test('a MATRIX of restricted points, parse route', () => {
    const ce = new ComputeEngine();
    ce.declare('t', 'real');
    ce.assign('t', 1);
    const src = String.raw`[[(1,2)\{0<t\}, (3,4)], [(5,6), (7,8)\{t<0\}]]`;
    for (const expr of [src, String.raw`2${src}`, String.raw`${src}+(1,1)`]) {
      const e = ce.parse(expr);
      const v = e.evaluate();
      // The static type of a restriction `If(c, e)` is the type of `e`, with
      // no `nan` arm, so the point of `NaN` coordinates that a false
      // restriction gives does not match it, as `NaN` sits outside `real`.
      // Only the present cells are checked against the cell type of the
      // expression.
      const cellType = (e.type.type as any).elements;
      for (const row of v.ops!)
        for (const cell of row.ops!)
          if (!cell.toString().includes('NaN'))
            expect(cell.type.matches(cellType)).toBe(true);
      expect(v.ops![1].ops![1].toString()).toBe('(NaN, NaN)');
    }
    // A restriction applies to its whole group, here the whole statement: the
    // value is a list of lists of points, which is absent as a whole when the
    // condition is false.
    expect(ce.parse(String.raw`${src}+(1,1)\{t<0\}`).evaluate().symbol).toBe(
      'Missing'
    );
  });

  test('numeric cells still answer NaN', () => {
    const json = ['Multiply', ['If', ['Less', 0, 't'], 2], NUMS];
    expect(new ComputeEngine().box(json).type.toString()).toBe('list<number>');
    expect(at(json, 1)).toBe('[NaN,NaN,60]');
    expect(at(json, -1)).toBe('[NaN,NaN,NaN]');
    expect(at(['Multiply', 2, NUMS], -1)).toBe('[NaN,NaN,60]');
  });

  test('the parse route agrees with the box route', () => {
    const ce = new ComputeEngine();
    ce.assign('t', -1);
    const L = String.raw`[${PC}, (2,3)]`;
    // The parsed restriction `If(c, P)` has no `missing` arm, so the cells
    // of the static type do not show the absent point.
    const sin = ce.parse(String.raw`\sin(${L})`);
    expect(sin.type.toString()).toBe('list<tuple<number, number>^2>');
    expect(sin.evaluate().toString()).toBe('[(NaN, NaN),(sin(2), sin(3))]');
    const scaled = ce.parse(String.raw`2\cdot${L}`);
    expect(scaled.type.toString()).toBe('list<tuple<integer, integer>^2>');
    expect(scaled.evaluate().toString()).toBe('[(NaN, NaN),(4, 6)]');
  });

  test('only the cell of an absent restricted point becomes a NaN point', () => {
    // The marker of each cell is decided from the operand cell at the same
    // position. A restricted point whose condition is false gives the point
    // of `NaN` coordinates; a `NaN` computed from a present cell stays
    // `NaN`, also in a list that holds a restricted point.
    const L = String.raw`[(1,2)\left\{0<t\right\}, (3,4)]`;
    const ce = new ComputeEngine();
    ce.assign('t', -1);
    expect(
      ce.parse(String.raw`2\cdot[${PC}, (2,3)]`).evaluate().toString()
    ).toBe('[(NaN, NaN),(4, 6)]');
    const json = ['Divide', ce.parse(L).json, ['List', 1, 'x']];
    ce.assign('x', NaN);
    expect(ce.box(json).evaluate().toString()).toBe('[(NaN, NaN),NaN]');
    const ce2 = new ComputeEngine();
    ce2.assign('t', 1);
    ce2.assign('x', NaN);
    expect(ce2.box(json).evaluate().toString()).toBe('[(1, 2),NaN]');
  });

  test('the condition of a restricted point is evaluated once', async () => {
    // The absent cells are read from the operands that the evaluation has
    // already evaluated, so the condition is not evaluated a second time to
    // decide the marker of a cell. A condition with an effect runs once.
    const ce = new ComputeEngine();
    let calls = 0;
    ce.declare('TraceCondition', {
      signature: '() -> integer',
      pure: false,
      evaluate: () => {
        calls++;
        return ce.number(-1);
      },
    });
    const cell = ['If', ['Less', 0, ['TraceCondition']], ['Tuple', 1, 2]];
    const json = ['Multiply', 2, ['List', cell, ['Tuple', 2, 3]]];
    expect(ce.box(json).evaluate().toString()).toBe('[(NaN, NaN),(4, 6)]');
    expect(calls).toBe(1);
    calls = 0;
    expect((await ce.box(json).evaluateAsync()).toString()).toBe(
      '[(NaN, NaN),(4, 6)]'
    );
    expect(calls).toBe(1);
    // A restricted row of points, beside a list of numbers.
    calls = 0;
    const row = [
      'If',
      ['Less', 0, ['TraceCondition']],
      ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]],
    ];
    // A scalar condition selects the row whole: the quotient is the absent
    // list (selection rule of 2026-11-02; it was `["Missing","Missing"]`).
    expect(
      ce.box(['Divide', row, ['List', 1, 2]]).evaluate().toString()
    ).toBe('"Missing"');
    expect(calls).toBe(1);
  });

  test('the asynchronous route agrees', async () => {
    const ce = new ComputeEngine();
    ce.assign('t', -1);
    const e = ce.box(['Multiply', PJ, NUMS]);
    expect((await e.evaluateAsync()).toString()).toBe(
      '[(NaN, NaN),(NaN, NaN),(NaN, NaN)]'
    );
  });

  describe('the generic broadcast of a function marks an absent point cell', () => {
    // `Sin`, `Negate` and `Sqrt` broadcast over a list with the generic
    // element-wise broadcast, not with a handler of their own. The absent
    // cell reaches the cell application as the bare `Missing` symbol, and
    // the numeric operator answers `NaN` for it, while the type of the
    // broadcast says the cell is `missing | tuple<…>`: `Sin([Missing,
    // (3, 4)])` was `[NaN, (sin(3), sin(4))]`. Two routes reach the generic
    // broadcast with the absent cell: a literal `Missing` cell (the broadcast
    // before evaluation of the operands), and a symbol whose VALUE holds the
    // absent cell (the broadcast after evaluation of the operands). A false
    // restriction of a point is not absent: it is the point of `NaN`
    // coordinates (`restricted()`), and the parse routes below read it so.
    const ROW = ['List', 'Missing', ['Tuple', 3, 4]];
    const restricted = (s: string) => s.replace('"Missing"', '(NaN, NaN)');
    const MATRIX = ['List', ROW, ['List', ['Tuple', 1, 4], ['Tuple', 9, 16]]];
    const cases: [string, string, string][] = [
      ['Sin', '["Missing",(sin(3), sin(4))]', '\\sin'],
      ['Negate', '["Missing",(-3, -4)]', '-'],
      ['Sqrt', '["Missing",(sqrt(3), 2)]', '\\sqrt'],
    ];
    const MATRIX_ROW2: Record<string, string> = {
      Sin: '[(sin(1), sin(4)),(sin(9), sin(16))]',
      Negate: '[(-1, -4),(-9, -16)]',
      Sqrt: '[(1, 2),(3, 4)]',
    };
    // The types of a symbol whose value holds a point of `NaN` coordinates
    // in place of the restricted point.
    const RESTRICTED_TYPES: Record<string, [string, string]> = {
      Sin: [
        'list<tuple<number, number>^2>',
        'matrix<tuple<number, number>^(2x2)>',
      ],
      Negate: [
        'list<(tuple<integer, integer> | tuple<nan, nan>)^2>',
        'matrix<(tuple<integer, integer> | tuple<nan, nan>)^(2x2)>',
      ],
      Sqrt: [
        'list<tuple<number, number>^2>',
        'matrix<tuple<number, number>^(2x2)>',
      ],
    };
    // `Negate` keeps integer coordinates; `Sin` and `Sqrt` give numbers.
    const TYPES: Record<string, [string, string]> = {
      Sin: [POINT_PAIR, MATRIX_OF_POINTS],
      Negate: [INTEGER_POINT_PAIR, MATRIX_OF_INTEGER_POINTS],
      Sqrt: [POINT_PAIR, MATRIX_OF_POINTS],
    };

    test.each(cases)('%s, box route, rank 1', async (op, expected) => {
      const ce = new ComputeEngine();
      const e = ce.box([op, ROW]);
      expect(e.type.toString()).toBe(TYPES[op][0]);
      const v = e.evaluate();
      expect(v.type.matches(e.type)).toBe(true);
      expect(v.toString()).toBe(expected);
      const n = e.N();
      expect(n.type.matches(e.type)).toBe(true);
      expect(n.ops![0].symbol).toBe('Missing');
      expect((await e.evaluateAsync()).toString()).toBe(expected);
    });

    test.each(cases)('%s, box route, rank 2', async (op, expected) => {
      const ce = new ComputeEngine();
      const e = ce.box([op, MATRIX]);
      expect(e.type.toString()).toBe(TYPES[op][1]);
      const want = `[${expected},${MATRIX_ROW2[op]}]`;
      const v = e.evaluate();
      expect(v.type.matches(e.type)).toBe(true);
      expect(v.toString()).toBe(want);
      const n = e.N();
      expect(n.type.matches(e.type)).toBe(true);
      expect(n.toString()).not.toContain('NaN');
      expect(n.ops![0].ops![0].symbol).toBe('Missing');
      expect((await e.evaluateAsync()).toString()).toBe(want);
    });

    test.each(cases)(
      '%s, parse route, a symbol that holds the list',
      async (op, expected, cmd) => {
        const ce = new ComputeEngine();
        ce.assign('t', -1);
        ce.assign('L', ce.parse(String.raw`[(1,2)\{0<t\}, (3,4)]`).evaluate());
        ce.assign(
          'M',
          ce
            .parse(String.raw`[[(1,2)\{0<t\}, (3,4)], [(1,4), (9,16)]]`)
            .evaluate()
        );
        const call = (x: string) =>
          cmd === '\\sqrt' ? `\\sqrt{${x}}` : `${cmd}(${x})`;
        for (const [src, want, type] of [
          [call('L'), restricted(expected), RESTRICTED_TYPES[op][0]],
          [
            call('M'),
            `[${restricted(expected)},${MATRIX_ROW2[op]}]`,
            RESTRICTED_TYPES[op][1],
          ],
        ]) {
          const e = ce.parse(src);
          expect(e.operator).toBe(op);
          expect(e.type.toString()).toBe(type);
          const v = e.evaluate();
          expect(v.type.matches(e.type)).toBe(true);
          expect(v.toString()).toBe(want);
          const n = e.N();
          expect(n.type.matches(e.type)).toBe(true);
          expect((await e.evaluateAsync()).toString()).toBe(want);
        }
      }
    );

    test('the parse route with a restricted point in a literal list', () => {
      const ce = new ComputeEngine();
      ce.assign('t', -1);
      // The parsed restriction `If(c, P)` has no `missing` arm, so the
      // static type of a literal list that holds one has none either.
      const pair = 'list<tuple<number, number>^2>';
      for (const [src, want, type] of [
        [
          String.raw`\sin([(1,2)\{0<t\}, (3,4)])`,
          restricted(cases[0][1]),
          pair,
        ],
        [
          String.raw`-[(1,2)\{0<t\}, (3,4)]`,
          restricted(cases[1][1]),
          'list<tuple<integer, integer>^2>',
        ],
        [
          String.raw`\sqrt{[(1,2)\{0<t\}, (3,4)]}`,
          restricted(cases[2][1]),
          pair,
        ],
        [
          String.raw`\sin([[(1,2)\{0<t\}, (3,4)], [(1,4), (9,16)]])`,
          `[${restricted(cases[0][1])},${MATRIX_ROW2.Sin}]`,
          'matrix<tuple<number, number>^(2x2)>',
        ],
      ]) {
        const e = ce.parse(src);
        expect(e.type.toString()).toBe(type);
        expect(e.evaluate().toString()).toBe(want);
        expect(e.N().toString()).toContain('(NaN, NaN)');
      }
    });

    test('a numeric list keeps Missing in the absent cell', () => {
      // `Sin(Missing)` is `Missing`.
      const ce = new ComputeEngine();
      const e = ce.box(['Sin', ['List', 'Missing', 1]]);
      expect(e.type.toString()).toBe('list<missing | number^2>');
      expect(e.evaluate().toString()).toBe('["Missing",sin(1)]');
      expect(e.N().ops![0].symbol).toBe('Missing');
    });
  });
});
