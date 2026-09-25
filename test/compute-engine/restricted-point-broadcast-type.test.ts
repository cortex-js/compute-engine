import { ComputeEngine } from '../../src/compute-engine';

/**
 * The static type of an application over a RESTRICTED point or list.
 *
 * A restriction `P{c}` is `When(P, c)`, typed `missing | T`: the value is `P`
 * when `c` holds and `Missing` otherwise. A broadcast over it must keep both
 * the shape of `P` and the absence arm. Before the fix, the `missing` arm hid
 * the point from the broadcast type lift, and the numeric absence absorption
 * then turned the arm into `number`: `Sin(P{c})` was typed `number`, and
 * because the absence marker is read off the application's own type, it
 * evaluated to `NaN` where `Sin` of an absent point is the absent point
 * `Missing`. The same held for a default-less `Which` with point arms.
 *
 * The rule for the absence marker is in `docs/ERROR-MODEL.md` (an absent
 * operand answers the marker of the application's codomain: `NaN` for a
 * numeric type, `Missing` otherwise; an absent factor beside a point makes
 * the whole point absent).
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
      'missing | tuple<number, number>',
      '(0, sin(1))',
    ],
    ['Power', `(${PC})^2`, 'missing | tuple<number, number>', '(0, 1)'],
    ['Negate', `-${PC}`, 'missing | tuple<integer, integer>', '(0, -1)'],
    [
      'a scalar factor',
      String.raw`t\cdot${PC}`,
      'missing | tuple<integer, integer>',
      '(0, 1)',
    ],
    [
      'a scalar divisor',
      String.raw`\frac{${PC}}{t}`,
      'missing | tuple<number, number>',
      '(0, 1)',
    ],
    [
      'a point addend',
      `${PC}+${Q}`,
      'missing | tuple<integer, integer>',
      '(2, 4)',
    ],
  ])('%s', (_label, latex, type, present) => {
    const r = probe(latex);
    expect(r.type).toBe(type);
    expect(r.present).toBe(present);
    // The value when the restriction does not hold is the absent point, the
    // marker of a point codomain. It was `NaN` for `Sin`, `Power` and the
    // scalar factor.
    expect(r.absent).toBe('"Missing"');
  });

  test('the unrestricted point is unchanged', () => {
    const ce = new ComputeEngine();
    expect(ce.parse(String.raw`\sin(${P})`).type.toString()).toBe(
      'tuple<number, number>'
    );
    expect(ce.parse(`(${P})^2`).type.toString()).toBe('tuple<number, number>');
    expect(ce.parse(`-${P}`).type.toString()).toBe('tuple<integer, integer>');
  });

  test('a restricted scalar factor beside a point makes the point absent', () => {
    const r = probe(String.raw`2\left\{0<t\right\}\cdot${P}`);
    expect(r.type).toBe('missing | tuple<integer, integer>');
    expect(r.present).toBe('(0, 2)');
    expect(r.absent).toBe('"Missing"');
  });
});

describe('a broadcast over a restricted list keeps the list and the absence', () => {
  test.each([
    ['Sin', String.raw`\sin(${LC})`, '[sin(1),sin(2),sin(3)]'],
    ['Power', `(${LC})^2`, '[1,4,9]'],
  ])('%s', (_label, latex, present) => {
    const r = probe(latex);
    // It was `number | vector<3>`: the absence arm became a scalar.
    expect(r.type).toBe('missing | vector<3>');
    expect(r.present).toBe(present);
    expect(r.absent).toBe('"Missing"');
  });

  test('a restricted scalar beside a list still lands in each cell', () => {
    const r = probe(String.raw`[1,2,3]+2\left\{0<t\right\}`);
    expect(r.type).toBe('vector<3>');
    expect(r.absent).toBe('[NaN,NaN,NaN]');
  });

  test('a restricted scalar with a scalar result absorbs to NaN', () => {
    const r = probe(String.raw`\sin(2\left\{0<t\right\})`);
    expect(r.type).toBe('number');
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
    const r = probe(String.raw`${PC}\cdot${QC}`);
    expect(r.type).toBe('error');
    expect(r.present).toContain('no-product-between-points');
    expect(r.absent).toContain('no-product-between-points');
  });
});

describe('a list that holds a restricted point or masked points', () => {
  // A cell whose present value is a point and which is absent is `Missing`,
  // on every route, and the static type says so:
  // `list<missing | tuple<…>>`. Before the fix, the type of such a
  // broadcast dropped the `missing` arm (`Sin([P{c}, (2, 3)])` was typed
  // `list<number>`), and an absent point cell answered `NaN` where the rule
  // gives `Missing` (`2·[P{c}, (2, 3)]` was `[NaN, (4, 6)]`), or both
  // markers in one list (`P{c} + [(1, 2), (3, 4)]{[1, 2] > 1}` was
  // `[NaN, Missing]`). A cell whose present value is a number is still
  // `NaN` (`docs/ERROR-MODEL.md`, the section on `Missing` in a numeric
  // slot).
  const PJ = ['When', ['PointList', 0, 1], ['Less', 0, 't']];
  const PTS = [
    'When',
    ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]],
    ['Greater', ['List', 1, 2], 1],
  ];
  const NUMS = [
    'When',
    ['List', 10, 20, 30],
    ['Greater', ['List', 1, 2, 3], 2],
  ];
  const POINTS = 'list<missing | tuple<number, number>>';

  /** The value when `t` is `t`, by `evaluate()` or by `N()`. The value must
   * match the static type. */
  function at(json: any, t: number, numeric = false): string {
    const ce = new ComputeEngine();
    ce.assign('t', t);
    const e = ce.box(json);
    const v = numeric ? e.N() : e.evaluate();
    expect(v.type.matches(e.type)).toBe(true);
    return v.toString();
  }

  const missingCount = (s: string) => (s.match(/"Missing"/g) ?? []).length;

  test.each([
    [
      'a restricted point plus masked points',
      ['Add', PJ, PTS],
      '["Missing",(3, 5)]',
      '["Missing","Missing"]',
    ],
    [
      'a restricted point times masked numbers',
      ['Multiply', PJ, NUMS],
      '["Missing","Missing",(0, 30)]',
      '["Missing","Missing","Missing"]',
    ],
    [
      'Sin of a list holding a restricted point',
      ['Sin', ['List', PJ, ['Tuple', 2, 3]]],
      '[(0, sin(1)),(sin(2), sin(3))]',
      '["Missing",(sin(2), sin(3))]',
    ],
    [
      'a scalar times a list holding a restricted point',
      ['Multiply', 2, ['List', PJ, ['Tuple', 2, 3]]],
      '[(0, 2),(4, 6)]',
      '["Missing",(4, 6)]',
    ],
    [
      'a list holding a restricted point plus a point',
      ['Add', ['List', PJ, ['Tuple', 2, 3]], ['Tuple', 1, 1]],
      '[(1, 2),(3, 4)]',
      '["Missing",(3, 4)]',
    ],
    [
      'Sin of masked points',
      ['Sin', PTS],
      '["Missing",(sin(3), sin(4))]',
      '["Missing",(sin(3), sin(4))]',
    ],
    [
      'a scalar times masked points',
      ['Multiply', 2, PTS],
      '["Missing",(6, 8)]',
      '["Missing",(6, 8)]',
    ],
  ])('%s', (_label, json, present, absent) => {
    expect(new ComputeEngine().box(json).type.toString()).toBe(POINTS);
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
    const json = ['Add', M, ['When', ['Tuple', 1, 1], ['Less', 0, 't']]];
    expect(new ComputeEngine().box(json).type.toString()).toBe(POINTS);
    expect(at(json, -1)).toBe('[["Missing","Missing"],["Missing","Missing"]]');
    expect(at(json, -1, true)).toBe(
      '[["Missing","Missing"],["Missing","Missing"]]'
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
    for (const expr of [
      src,
      String.raw`2${src}`,
      String.raw`${src}+(1,1)`,
      // The added point is absent, so every cell is.
      String.raw`${src}+(1,1)\{t<0\}`,
    ]) {
      const e = ce.parse(expr);
      const v = e.evaluate();
      expect(v.type.matches(e.type)).toBe(true);
      expect(v.toString()).not.toContain('NaN');
      expect(v.ops![1].ops![1].symbol).toBe('Missing');
    }
  });

  test('numeric cells still answer NaN', () => {
    const json = ['Multiply', ['When', 2, ['Less', 0, 't']], NUMS];
    expect(new ComputeEngine().box(json).type.toString()).toBe('list<number>');
    expect(at(json, 1)).toBe('[NaN,NaN,60]');
    expect(at(json, -1)).toBe('[NaN,NaN,NaN]');
    expect(at(['Multiply', 2, NUMS], -1)).toBe('[NaN,NaN,60]');
  });

  test('the parse route agrees with the box route', () => {
    const ce = new ComputeEngine();
    ce.assign('t', -1);
    const L = String.raw`[${PC}, (2,3)]`;
    const sin = ce.parse(String.raw`\sin(${L})`);
    expect(sin.type.toString()).toBe(POINTS);
    expect(sin.evaluate().toString()).toBe('["Missing",(sin(2), sin(3))]');
    const scaled = ce.parse(String.raw`2\cdot${L}`);
    expect(scaled.type.toString()).toBe(POINTS);
    expect(scaled.evaluate().toString()).toBe('["Missing",(4, 6)]');
  });

  test('the asynchronous route agrees', async () => {
    const ce = new ComputeEngine();
    ce.assign('t', -1);
    const e = ce.box(['Multiply', PJ, NUMS]);
    expect((await e.evaluateAsync()).toString()).toBe(
      '["Missing","Missing","Missing"]'
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
    // absent cell (the broadcast after evaluation of the operands).
    const ROW = ['List', 'Missing', ['Tuple', 3, 4]];
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

    test.each(cases)('%s, box route, rank 1', async (op, expected) => {
      const ce = new ComputeEngine();
      const e = ce.box([op, ROW]);
      expect(e.type.toString()).toBe(POINTS);
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
      expect(e.type.toString()).toBe(POINTS);
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
        for (const [src, want] of [
          [call('L'), expected],
          [call('M'), `[${expected},${MATRIX_ROW2[op]}]`],
        ]) {
          const e = ce.parse(src);
          expect(e.operator).toBe(op);
          expect(e.type.toString()).toBe(POINTS);
          const v = e.evaluate();
          expect(v.type.matches(e.type)).toBe(true);
          expect(v.toString()).toBe(want);
          const n = e.N();
          expect(n.type.matches(e.type)).toBe(true);
          expect(n.toString()).not.toContain('NaN');
          expect((await e.evaluateAsync()).toString()).toBe(want);
        }
      }
    );

    test('the parse route with a restricted point in a literal list', () => {
      const ce = new ComputeEngine();
      ce.assign('t', -1);
      for (const [src, want] of [
        [String.raw`\sin([(1,2)\{0<t\}, (3,4)])`, cases[0][1]],
        [String.raw`-[(1,2)\{0<t\}, (3,4)]`, cases[1][1]],
        [String.raw`\sqrt{[(1,2)\{0<t\}, (3,4)]}`, cases[2][1]],
        [
          String.raw`\sin([[(1,2)\{0<t\}, (3,4)], [(1,4), (9,16)]])`,
          `[${cases[0][1]},${MATRIX_ROW2.Sin}]`,
        ],
      ]) {
        const e = ce.parse(src);
        expect(e.type.toString()).toBe(POINTS);
        expect(e.evaluate().toString()).toBe(want);
        expect(e.N().toString()).not.toContain('NaN');
      }
    });

    test('a numeric list keeps NaN in the absent cell', () => {
      const ce = new ComputeEngine();
      const e = ce.box(['Sin', ['List', 'Missing', 1]]);
      expect(e.type.toString()).toBe('list<number>');
      expect(e.evaluate().toString()).toBe('[NaN,sin(1)]');
      expect(e.N().ops![0].isNaN).toBe(true);
    });
  });

  test('an absent coordinate does not make the point absent', () => {
    // `missing` inside a tuple component is an absent coordinate, not an
    // absent cell, so the cell type gets no `missing` arm.
    const ce = new ComputeEngine();
    ce.declare('L', 'list<tuple<number | missing, number>>');
    expect(ce.box(['Multiply', 2, 'L']).type.toString()).not.toContain(
      'missing'
    );
  });
});
