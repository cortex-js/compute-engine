import { ComputeEngine } from '../../src/compute-engine';
import { parseType } from '../../src/common/type/parse';
import { isSubtype } from '../../src/common/type/subtype';

/**
 * Element-wise `Which`/`If` over list-valued conditions.
 *
 * Spec: `docs/BROADCAST-MODEL.md` (R1–R4 + R4′,
 * ratified 2026-07-27). Witness: Tycho item 102 — the Game-of-Life step
 * `S → {n=3: 1, n=2: S, 0}` over a 900-cell board.
 */

function engine(): ComputeEngine {
  return new ComputeEngine();
}

/** The result cells as strings, so `NaN` / error cells stay visible. */
function cells(expr: any): string[] {
  return Array.from(expr.each()).map((x: any) => x.toString());
}

//
// GoL witness (R1 end-to-end)
//

describe('elementwise Which — Game-of-Life witness', () => {
  test('hand-checked 4-cell table', () => {
    const ce = engine();
    ce.assign('S', ce.box(['List', 1, 0, 1, 1]));
    ce.assign('n', ce.box(['List', 3, 2, 1, 3]));
    // n=3 → 1 ; n=2 → the old cell S ; otherwise 0
    const r = ce
      .box(['Which', ['Equal', 'n', 3], 1, ['Equal', 'n', 2], 'S', 'True', 0])
      .evaluate();
    // j=0: n=3 → 1. j=1: n=2 → S[1]=0. j=2: no match → default 0. j=3: n=3 → 1.
    expect(cells(r)).toEqual(['1', '0', '0', '1']);
  });

  test('900-cell board matches an independent JS computation', () => {
    const ce = engine();
    const N = 900;
    const S: number[] = [];
    const n: number[] = [];
    for (let i = 0; i < N; i++) {
      S.push(i % 2);
      n.push(i % 5);
    }
    ce.assign('S', ce.box(['List', ...S]));
    ce.assign('n', ce.box(['List', ...n]));
    const r = ce
      .box(['Which', ['Equal', 'n', 3], 1, ['Equal', 'n', 2], 'S', 'True', 0])
      .evaluate();
    expect(r.count).toBe(N);
    // Independent reference (Tycho's `broadcastPiecewise` semantics).
    const expected = n.map((c, j) => (c === 3 ? 1 : c === 2 ? S[j] : 0));
    expect(Array.from(r.each()).map((x: any) => x.re)).toEqual(expected);
  });
});

//
// Route parity — `Which` is a `lazy` head: operands arrive held
//

describe('elementwise Which — route parity', () => {
  const expected = ['1', '0', '0', '1'];

  test('box route (raw MathJSON)', () => {
    const ce = engine();
    ce.assign('S', ce.box(['List', 1, 0, 1, 1]));
    ce.assign('n', ce.box(['List', 3, 2, 1, 3]));
    const r = ce
      .box(['Which', ['Equal', 'n', 3], 1, ['Equal', 'n', 2], 'S', 'True', 0])
      .evaluate();
    expect(cells(r)).toEqual(expected);
  });

  test('function route (pre-boxed canonical args)', () => {
    const ce = engine();
    ce.assign('S', ce.box(['List', 1, 0, 1, 1]));
    ce.assign('n', ce.box(['List', 3, 2, 1, 3]));
    const r = ce
      .function('Which', [
        ce.box(['Equal', 'n', 3]),
        ce.number(1),
        ce.box(['Equal', 'n', 2]),
        ce.symbol('S'),
        ce.True,
        ce.number(0),
      ])
      .evaluate();
    expect(cells(r)).toEqual(expected);
  });

  test('LaTeX parse route (cases environment)', () => {
    const ce = engine();
    ce.assign('S', ce.box(['List', 1, 0, 1, 1]));
    ce.assign('n', ce.box(['List', 3, 2, 1, 3]));
    const r = ce
      .parse(
        '\\begin{cases} 1 & n = 3 \\\\ S & n = 2 \\\\ 0 & \\text{otherwise} \\end{cases}'
      )
      .evaluate();
    expect(cells(r)).toEqual(expected);
  });

  test('If: box, function and parse routes agree', () => {
    const ce = engine();
    ce.assign('n', ce.box(['List', 3, 2, 1, 3]));
    const boxed = ce.box(['If', ['Equal', 'n', 3], 1, 0]).evaluate();
    const fn = ce
      .function('If', [ce.box(['Equal', 'n', 3]), ce.number(1), ce.number(0)])
      .evaluate();
    const parsed = ce.parse('\\mathrm{If}(n = 3, 1, 0)').evaluate();
    expect(cells(boxed)).toEqual(['1', '0', '0', '1']);
    expect(cells(fn)).toEqual(cells(boxed));
    expect(cells(parsed)).toEqual(cells(boxed));
  });
});

//
// R1 — first-match per element, scalars lift
//

describe('R1 — selection semantics', () => {
  test('a scalar arm lifts to every selected position', () => {
    const ce = engine();
    const r = ce
      .box(['Which', ['List', 'True', 'False', 'True'], 7, 'True', 0])
      .evaluate();
    expect(cells(r)).toEqual(['7', '0', '7']);
  });

  test('a list-valued arm is indexed position-wise', () => {
    const ce = engine();
    const r = ce
      .box([
        'Which',
        ['List', 'True', 'False', 'True'],
        ['List', 10, 20, 30],
        'True',
        ['List', 1, 2, 3],
      ])
      .evaluate();
    expect(cells(r)).toEqual(['10', '2', '30']);
  });

  test('a scalar True condition lifts to every remaining position', () => {
    const ce = engine();
    const r = ce
      .box(['Which', ['List', 'True', 'False', 'False'], 1, 'True', 5])
      .evaluate();
    expect(cells(r)).toEqual(['1', '5', '5']);
  });

  test('a scalar False condition never selects (it lifts to no position)', () => {
    const ce = engine();
    const r = ce
      .box(['Which', 'False', 99, ['List', 'True', 'False'], 1, 'True', 0])
      .evaluate();
    expect(cells(r)).toEqual(['1', '0']);
  });

  test('first match wins: an earlier clause shadows a later one', () => {
    const ce = engine();
    const r = ce
      .box([
        'Which',
        ['List', 'True', 'False'],
        11,
        ['List', 'True', 'True'],
        22,
      ])
      .evaluate();
    expect(cells(r)).toEqual(['11', '22']);
  });

  test('clause order is respected across three list conditions', () => {
    const ce = engine();
    const r = ce
      .box([
        'Which',
        ['List', 'False', 'True', 'False', 'False'],
        1,
        ['List', 'True', 'True', 'True', 'False'],
        2,
        ['List', 'True', 'True', 'True', 'True'],
        3,
      ])
      .evaluate();
    expect(cells(r)).toEqual(['2', '1', '2', '3']);
  });
});

//
// R2 — arms evaluated at most once, whole, only if selected
//

describe('R2 — arm evaluation', () => {
  test('a selected arm is evaluated exactly once, however many cells select it', () => {
    const ce = engine();
    ce.assign('count', ce.number(0));
    ce.assign('n', ce.box(['List', 3, 2, 1, 3]));
    const arm = ['Block', ['Assign', 'count', ['Add', 'count', 1]], 42];
    const r = ce.box(['Which', ['Equal', 'n', 3], arm, 'True', 0]).evaluate();
    expect(cells(r)).toEqual(['42', '0', '0', '42']);
    // Two positions selected the arm, but it ran once (whole-arm contract).
    expect(ce.box('count').evaluate().re).toBe(1);
  });

  test('an unselected arm is never evaluated (an arm that errors whole stays silent)', () => {
    const ce = engine();
    // Evaluated on its own this is an `incompatible-dimensions` error.
    const bad = ['Add', ['List', 1, 2, 3, 4], ['List', 1, 2, 3]];
    expect(ce.box(bad).evaluate().operator).toBe('Error');
    const r = ce
      .box([
        'Which',
        ['List', 'False', 'False', 'False', 'False'],
        bad,
        'True',
        7,
      ])
      .evaluate();
    expect(cells(r)).toEqual(['7', '7', '7', '7']);
  });

  test('an unselected arm with a side effect does not run it', () => {
    const ce = engine();
    ce.assign('count', ce.number(0));
    const arm = ['Block', ['Assign', 'count', ['Add', 'count', 1]], 42];
    const r = ce
      .box(['Which', ['List', 'False', 'False'], arm, 'True', 0])
      .evaluate();
    expect(cells(r)).toEqual(['0', '0']);
    expect(ce.box('count').evaluate().re).toBe(0);
  });

  test('an unreachable clause after a lifted True has its condition skipped', () => {
    const ce = engine();
    ce.assign('count', ce.number(0));
    const cond = ['Block', ['Assign', 'count', ['Add', 'count', 1]], 'True'];
    const r = ce
      .box(['Which', ['List', 'False', 'True'], 1, 'True', 0, cond, 9])
      .evaluate();
    expect(cells(r)).toEqual(['0', '1']);
    expect(ce.box('count').evaluate().re).toBe(0);
  });
});

//
// R3 — strict lengths, through the shared `broadcastLengthMismatch`
//

describe('R3 — length policy (strict, lifted regime)', () => {
  test('condition vs condition mismatch is incompatible-dimensions', () => {
    const ce = engine();
    const r = ce
      .box([
        'Which',
        ['List', 'True', 'False'],
        1,
        ['List', 'False', 'True', 'True'],
        2,
      ])
      .evaluate();
    expect(r.operator).toBe('Error');
    expect(r.toString()).toMatch(/incompatible-dimensions/);
  });

  test('condition vs selected list-valued arm mismatch is incompatible-dimensions', () => {
    const ce = engine();
    const r = ce
      .box(['Which', ['List', 'True', 'False'], ['List', 1, 2, 3]])
      .evaluate();
    expect(r.operator).toBe('Error');
    expect(r.toString()).toMatch(/incompatible-dimensions/);
  });

  test('an unbounded condition is refused: it is not a flat list', () => {
    // Selection rule of 2026-11-02: a condition is a boolean or a flat list
    // of booleans. A `Cycle` is an unbounded indexed collection, so the
    // `Which` is a static error (it was a length mismatch at evaluation).
    const ce = engine();
    const r = ce
      .box([
        'Which',
        ['List', 'False', 'False'],
        1,
        ['Cycle', ['List', 'True', 'False']],
        2,
      ])
      .evaluate();
    expect(r.isValid).toBe(false);
    expect(r.toString()).toMatch(/incompatible-type/);
  });

  test('the same diagnostic Add produces', () => {
    const ce = engine();
    const add = ce.box(['Add', ['List', 1, 2], ['List', 1, 2, 3]]).evaluate();
    const which = ce
      .box(['Which', ['List', 'True', 'False'], ['List', 1, 2, 3]])
      .evaluate();
    expect(which.toString()).toBe(add.toString());
  });

  test('an unknown-length condition is not compared — the expression stays inert', () => {
    const ce = engine();
    ce.declare('m', 'integer');
    const unknown = [
      'Map',
      ['Function', ['Greater', '_', 2], '_'],
      ['Range', 1, 'm'],
    ];
    const r = ce
      .box(['Which', ['List', 'False', 'False'], 1, unknown, 2, 'True', 0])
      .evaluate();
    expect(r.operator).toBe('Which');
  });

  test('an unknown-length selected arm leaves the expression inert', () => {
    const ce = engine();
    ce.declare('m', 'integer');
    // The arm is a list of numbers: an arm of booleans is refused under a
    // list condition (selection rule of 2026-11-02).
    const unknown = [
      'Map',
      ['Function', ['Multiply', 2, '_'], '_'],
      ['Range', 1, 'm'],
    ];
    const r = ce.box(['Which', ['List', 'True', 'False'], unknown]).evaluate();
    expect(r.operator).toBe('Which');
  });

  test('a lone empty condition broadcasts to an empty result', () => {
    const ce = engine();
    const r = ce.box(['Which', ['List'], 1]).evaluate();
    expect(r.operator).toBe('List');
    expect(r.count).toBe(0);
  });

  test('an empty condition against a non-empty one mismatches', () => {
    const ce = engine();
    const r = ce
      .box(['Which', ['List'], 1, ['List', 'True', 'False'], 2])
      .evaluate();
    expect(r.operator).toBe('Error');
    expect(r.toString()).toMatch(/incompatible-dimensions/);
  });
});

//
// R4 / R4′ — the no-match cell and the absent-condition cell
//

describe('R4 — the no-match cell follows the type of its position', () => {
  test('no default clause: unmatched positions are NaN', () => {
    const ce = engine();
    const r = ce
      .box(['Which', ['List', 'True', 'False', 'True'], 5])
      .evaluate();
    expect(cells(r)).toEqual(['5', 'NaN', '5']);
  });

  test('all-False conditions with no default: every cell is NaN', () => {
    const ce = engine();
    const r = ce
      .box(['Which', ['List', 'False', 'False', 'False'], 5])
      .evaluate();
    expect(cells(r)).toEqual(['NaN', 'NaN', 'NaN']);
  });

  // Selection rule of 2026-11-02: a position that no clause selects is `NaN`
  // for a number cell and a point of `NaN` coordinates for a point cell. A
  // string cell has no such value, so a string arm under a list condition is
  // a static error. This reverses the decision of 2026-10-17, which gave
  // `Missing` for a point or a string cell.
  test('a string arm under a list condition is a static error', () => {
    const ce = engine();
    const e = ce.box(['Which', ['List', 'True', 'False'], { str: 'hot' }]);
    expect(e.isValid).toBe(false);
    expect(e.evaluate().toString()).toMatch(/incompatible-type/);
  });

  test('a point arm masks to a NaN point; the scalar forms give Missing', () => {
    const ce = engine();
    const cond = ['Less', ['List', 1, 5], 3];
    const which = ce.box(['Which', cond, ['Tuple', 1, 2]]).evaluate();
    const when = ce.box(['If', cond, ['Tuple', 1, 2]]).evaluate();
    expect(cells(which)).toEqual(['(1, 2)', '(NaN, NaN)']);
    expect(cells(when)).toEqual(['(1, 2)', '(NaN, NaN)']);
    expect(
      ce
        .box(['Which', ['Less', 5, 3], ['Tuple', 1, 2]])
        .evaluate()
        .toString()
    ).toBe('"Missing"');
    // A false restriction of a point is the point of `NaN` coordinates
    // (user decision 2026-11-03); a `Which` with no match stays `Missing`.
    expect(
      ce
        .box(['If', ['Less', 5, 3], ['Tuple', 1, 2]])
        .evaluate()
        .toString()
    ).toBe('(NaN, NaN)');
    // The else-less `If` is the same selection.
    const ifForm = ce.box(['If', cond, ['Tuple', 1, 2]]).evaluate();
    expect(cells(ifForm)).toEqual(['(1, 2)', '(NaN, NaN)']);
  });

  test('a number arm masks to NaN in both operators', () => {
    const ce = engine();
    const cond = ['Less', ['List', 1, 5], 3];
    expect(cells(ce.box(['Which', cond, 7]).evaluate())).toEqual(['7', 'NaN']);
    expect(cells(ce.box(['If', cond, 7]).evaluate())).toEqual(['7', 'NaN']);
  });

  test('a number arm beside a point arm is a static error', () => {
    // All the arms of a selection under a list condition have one element
    // kind (selection rule of 2026-11-02).
    const ce = engine();
    const e = ce.box([
      'Which',
      ['Less', ['List', 1, 5, 9], 3],
      7,
      ['Greater', ['List', 1, 5, 9], 8],
      ['Tuple', 1, 2],
    ]);
    expect(e.isValid).toBe(false);
    expect(e.type.toString()).toBe('error');
  });

  test('If without an else branch yields NaN, not Nothing (positions preserved)', () => {
    const ce = engine();
    ce.assign('n', ce.box(['List', 3, 2, 1, 3]));
    const r = ce.box(['If', ['Equal', 'n', 3], 1]).evaluate();
    expect(cells(r)).toEqual(['1', 'NaN', 'NaN', '1']);
  });
});

describe('R4′ — a Missing condition', () => {
  test('a written Missing cell in a list condition is a static error', () => {
    // Selection rule of 2026-11-02: a condition is a boolean or a flat list
    // of booleans, so a list condition whose type admits a `Missing` cell is
    // refused. Before, the cell was an error cell at its position.
    const ce = engine();
    for (const json of [
      ['Which', ['List', 'True', 'Missing', 'False'], 1, 'True', 0],
      ['If', ['List', 'Missing', 'True'], 1, 2],
      ['Which', ['List', 'Missing'], 1, 'True', 99],
    ]) {
      const e = ce.box(json as any);
      expect(e.isValid).toBe(false);
      expect(e.evaluate().toString()).toMatch(/incompatible-type/);
    }
  });

  test('a lifted SCALAR Missing condition is False at every position', () => {
    const ce = engine();
    // A scalar condition lifts to every position (R1). An absent condition
    // is `False` (user decision of 2026-11-02, two-valued comparisons), so
    // its clause selects no position, and a position that no clause selects
    // is `NaN` for a number. Before, the position was an absent-condition
    // error cell.
    const r = ce
      .box(['Which', ['List', 'True', 'False'], 1, 'Missing', 2])
      .evaluate();
    const c = cells(r);
    expect(c).toHaveLength(2);
    expect(c[0]).toBe('1');
    expect(c[1]).toBe('NaN');
  });

  test('a later clause selects the positions that a scalar Missing row leaves', () => {
    const ce = engine();
    const r = ce
      .box([
        'Which',
        ['List', 'True', 'False', 'False'],
        1,
        'Missing',
        2,
        'True',
        3,
      ])
      .evaluate();
    const c = cells(r);
    expect(c).toEqual(['1', '3', '3']);
  });

  test('the all-scalar form: no clause is selected', () => {
    // A scalar `Which` with no selected clause is `Missing`.
    const ce = engine();
    const r = ce.box(['Which', 'Missing', 1]).evaluate();
    expect(r.symbol).toBe('Missing');
  });
});

//
// The activation gate (§3)
//

describe('activation gate', () => {
  test('a symbolic condition keeps the whole expression inert', () => {
    const ce = engine();
    ce.declare('x', 'number');
    const r = ce.box(['Which', ['Equal', 'x', 4], 1, 'True', 0]).evaluate();
    expect(r.operator).toBe('Which');
  });

  test('a symbolic condition in a LATER clause keeps it inert too', () => {
    const ce = engine();
    ce.declare('x', 'number');
    const r = ce
      .box([
        'Which',
        ['List', 'False', 'False'],
        1,
        ['Equal', 'x', 4],
        2,
        'True',
        0,
      ])
      .evaluate();
    expect(r.operator).toBe('Which');
  });

  test('a collection with a symbolic boolean cell stays inert', () => {
    const ce = engine();
    ce.declare('x', 'number');
    const r = ce
      .box(['Which', ['List', 'True', ['Equal', 'x', 4]], 1, 'True', 0])
      .evaluate();
    expect(r.operator).toBe('Which');
  });

  test('a LATER collection-condition with a symbolic cell stays inert — same length', () => {
    const ce = engine();
    ce.declare('x', 'number');
    const r = ce
      .box([
        'Which',
        ['List', 'True', 'False'],
        1,
        ['List', 'True', ['Equal', 'x', 4]],
        2,
        'True',
        0,
      ])
      .evaluate();
    expect(r.operator).toBe('Which');
  });

  test('a LATER collection-condition with a symbolic cell stays inert — DIFFERENT length', () => {
    const ce = engine();
    ce.declare('x', 'number');
    // Selection rule of 2026-11-02: the two list conditions have lengths
    // that their types give (2 and 3), so the selection is the static
    // `incompatible-dimensions` error. Before, the cell `x = 4` kept the
    // whole expression inert.
    const r = ce
      .box([
        'Which',
        ['List', 'True', 'False'],
        1,
        ['List', 'True', ['Equal', 'x', 4], 'True'],
        2,
        'True',
        0,
      ])
      .evaluate();
    expect(r.toString()).toMatch(/incompatible-dimensions/);
  });

  test('a PROVABLY INFINITE later condition is refused: it is not a flat list', () => {
    const ce = engine();
    // Selection rule of 2026-11-02: a `Cycle` is not a flat list of
    // booleans, so the `Which` is a static error (it was a length mismatch).
    const r = ce
      .box([
        'Which',
        ['List', 'False', 'False'],
        1,
        ['Cycle', ['List', 'True', 'False', 'True']],
        2,
        'True',
        0,
      ])
      .evaluate();
    expect(r.isValid).toBe(false);
    expect(r.toString()).toMatch(/incompatible-type/);
  });

  test('a collection of non-booleans is refused at boxing (never selected)', () => {
    // The cells are numbers, so the element-wise gate can never open, and
    // the type says so at boxing: the condition is an `incompatible-type`
    // error operand (provably non-boolean condition ruling), propagated as
    // the condition's error — never a host exception, never a selection.
    const ce = engine();
    const boxed = ce.box(['Which', ['List', 1, 2], 1, 'True', 0]);
    expect(boxed.errors).toHaveLength(1);
    expect(boxed.errors[0].toString()).toContain('incompatible-type');
    expect(boxed.evaluate().operator).toBe('Error');
  });

  test('a Set of booleans (not indexed) does not activate', () => {
    const ce = engine();
    const r = ce
      .box(['Which', ['Set', 'True', 'False'], 1, 'True', 0])
      .evaluate();
    expect(r.operator).not.toBe('List');
  });

  test('a Solve-shaped symbolic Which round-trips unreduced', () => {
    const ce = engine();
    ce.declare('x', 'number');
    const w = ce.box([
      'Which',
      ['Greater', 'x', 0],
      1,
      ['Less', 'x', 0],
      -1,
      'True',
      0,
    ]);
    const r = w.evaluate();
    expect(r.operator).toBe('Which');
    expect(r.toString()).toBe(w.toString());
  });
});

describe('scalar behavior is unchanged', () => {
  test('scalar first-match', () => {
    const ce = engine();
    expect(ce.box(['Which', 'False', 1, 'True', 2]).evaluate().re).toBe(2);
  });

  test('scalar no-match is the Undefined symbol, not NaN', () => {
    const ce = engine();
    const r = ce.box(['Which', 'False', 1]).evaluate();
    expect(r.symbol).toBe('Missing');
  });

  test('scalar If without an else branch is the absent value of its arm', () => {
    // An else-less `If` with a false condition answers the absent value of
    // the domain of its arm: `NaN` for a number, the point of `NaN`
    // coordinates for a point, `Missing` otherwise (decisions of 2026-11-02,
    // `docs/plans/2026-11-02-restriction-binding.md`, and 2026-11-03).
    const ce = engine();
    expect(ce.box(['If', 'False', 1]).evaluate().isNaN).toBe(true);
    expect(
      ce.box(['If', 'False', ['Tuple', 1, 2]]).evaluate().toString()
    ).toBe('(NaN, NaN)');
    expect(ce.box(['If', 'False', 'a']).evaluate().symbol).toBe('Missing');
  });

  test('a scalar Missing condition is False', () => {
    // User decision of 2026-11-02, two-valued comparisons. Before, it was
    // the catchable absent-condition error.
    const ce = engine();
    expect(ce.box(['If', 'Missing', 1, 2]).evaluate().toString()).toBe('2');
    expect(ce.box(['Which', 'Missing', 1, 'True', 2]).evaluate().toString()).toBe(
      '2'
    );
  });

  test('the scalar typo path is an error operand, not a throw', () => {
    // `3` can never be a condition, and its type says so at boxing: the
    // condition is an `incompatible-type` error operand (ruling 2026-09-02),
    // never a host exception. An undecidable condition of unknown type keeps
    // its inertness (ruling 2026-08-31).
    const ce = engine();
    const boxed = ce.box(['If', 3, 1, 2]);
    expect(boxed.errors).toHaveLength(1);
    expect(boxed.evaluate().operator).toBe('Error');
    expect(ce.box(['If', 'stillUnknown', 1, 2]).evaluate().operator).toBe('If');
  });
});

//
// `If` variants of the core cases
//

describe('elementwise If', () => {
  test('list condition, scalar branches', () => {
    const ce = engine();
    const r = ce
      .box(['If', ['List', 'True', 'False', 'True'], 1, 0])
      .evaluate();
    expect(cells(r)).toEqual(['1', '0', '1']);
  });

  test('list condition, list branches are indexed position-wise', () => {
    const ce = engine();
    const r = ce
      .box([
        'If',
        ['List', 'True', 'False'],
        ['List', 10, 20],
        ['List', 30, 40],
      ])
      .evaluate();
    expect(cells(r)).toEqual(['10', '40']);
  });

  test('branch length mismatch is incompatible-dimensions', () => {
    const ce = engine();
    const r = ce
      .box(['If', ['List', 'True', 'False'], ['List', 1, 2, 3], 0])
      .evaluate();
    expect(r.operator).toBe('Error');
    expect(r.toString()).toMatch(/incompatible-dimensions/);
  });

  test('the else branch is not evaluated when no position selects it', () => {
    const ce = engine();
    ce.assign('count', ce.number(0));
    const arm = ['Block', ['Assign', 'count', ['Add', 'count', 1]], 42];
    const r = ce.box(['If', ['List', 'True', 'True'], 0, arm]).evaluate();
    expect(cells(r)).toEqual(['0', '0']);
    expect(ce.box('count').evaluate().re).toBe(0);
  });

  test('a Missing condition cell is a static error', () => {
    // Selection rule of 2026-11-02 (it was an error cell at its position).
    const ce = engine();
    const r = ce.box(['If', ['List', 'True', 'Missing'], 1, 0]).evaluate();
    expect(r.operator).toBe('Error');
    expect(r.toString()).toMatch(/incompatible-type/);
  });
});

//
// Type handler
//

describe('type handler', () => {
  test('a literal boolean-list condition types list<T^n>', () => {
    const ce = engine();
    const t = ce.box(['Which', ['List', 'True', 'False'], 1, 'True', 0]).type;
    expect(t.matches(parseType('list<integer^2>'))).toBe(true);
  });

  test('a declared indexed_collection<boolean> condition types list<T>', () => {
    // An ordered collection of booleans is a flat list of booleans: a host
    // types a comparison over a list of points this way (Tycho item 335).
    const ce = engine();
    ce.declare('b', 'indexed_collection<boolean>');
    const e = ce.box(['Which', 'b', 1, 'True', 0]);
    expect(e.isValid).toBe(true);
    expect(e.type.toString()).toBe('list<integer>');
  });

  test('a derived condition (a broadcast comparison) types list<T^n>', () => {
    const ce = engine();
    ce.assign('n', ce.box(['List', 3, 2, 1, 3]));
    const e = ce.box(['Which', ['Equal', 'n', 3], 1, 'True', 0]);
    expect(e.type.matches(parseType('list<integer^4>'))).toBe(true);
    expect(e.evaluate().type.matches(parseType('list<number>'))).toBe(true);
  });

  test('a tuple-typed condition does NOT flip the static shape (tuple-atomic)', () => {
    // `tuple` is a subtype of `indexed_collection`, but runtime lifts tuples
    // whole and never activates the elementwise path — so a tuple can never
    // be a condition, and it is refused at boxing as an `incompatible-type`
    // error operand (provably non-boolean condition ruling). The static
    // shape does not flip to a list either way.
    const ce = engine();
    const e = ce.box(['Which', ['Tuple', 'True', 'False'], 1, 'True', 0]);
    expect(e.errors).toHaveLength(1);
    expect(e.type.matches(parseType('list<integer>'))).toBe(false);
    expect(e.evaluate().operator).toBe('Error');
  });

  test('a list-valued arm contributes its ELEMENT type, not its list type', () => {
    const ce = engine();
    const t = ce.box([
      'Which',
      ['List', 'True', 'False'],
      ['List', 1, 2],
      'True',
      0,
    ]).type;
    expect(t.matches(parseType('list<integer^2>'))).toBe(true);
  });

  test('If with a list condition types a list of the branch types', () => {
    const ce = engine();
    const t = ce.box(['If', ['List', 'True', 'False'], 1, 0]).type;
    expect(t.matches(parseType('list<integer^2>'))).toBe(true);
  });

  test('NO default clause: the element type joins in the NaN marker', () => {
    const ce = engine();
    // `finite_*` types EXCLUDE NaN (non-finite typing convention), and
    // without a default clause an unmatched position IS NaN — so the declared
    // type must admit it, or a consumer dispatching on `.type.matches()` is
    // promised a finite integer and handed a NaN.
    const e = ce.box(['Which', ['List', 'True', 'False'], 5]);
    expect(e.type.matches(parseType('list<integer^2>'))).toBe(false);
    expect(e.type.matches(parseType('list<number^2>'))).toBe(true);
    // The runtime value is assignable to the declared type.
    const v = e.evaluate();
    expect(cells(v)).toEqual(['5', 'NaN']);
    expect(v.type.matches(e.type)).toBe(true);
  });

  test('WITH a default clause: no-match is unreachable, the exact join stays', () => {
    const ce = engine();
    const e = ce.box(['Which', ['List', 'True', 'False'], 5, 'True', 0]);
    // Not widened: an over-wide union would break `matches()` dispatch — the
    // exact `integer` join survives.
    expect(e.type.matches(parseType('list<integer^2>'))).toBe(true);
    const v = e.evaluate();
    expect(v.type.matches(e.type)).toBe(true);
  });

  test('string arms under a list condition are a static error', () => {
    // Selection rule of 2026-11-02: a string cell has no `NaN`, so a string
    // arm under a list condition is refused, with or without a default
    // clause. Before, the types were `list<missing | string>` and
    // `list<string^2>`.
    const ce = engine();
    for (const json of [
      ['Which', ['List', 'True', 'False'], { str: 'hot' }],
      [
        'Which',
        ['List', 'True', 'False'],
        { str: 'hot' },
        'True',
        { str: 'cold' },
      ],
    ]) {
      const e = ce.box(json as any);
      expect(e.type.toString()).toBe('error');
      expect(e.isValid).toBe(false);
    }
  });

  test('If without an else branch widens; with one it does not', () => {
    const ce = engine();
    const noElse = ce.box(['If', ['List', 'True', 'False'], 1]);
    expect(noElse.type.matches(parseType('list<integer^2>'))).toBe(false);
    expect(noElse.type.matches(parseType('list<number^2>'))).toBe(true);
    expect(noElse.evaluate().type.matches(noElse.type)).toBe(true);

    const withElse = ce.box(['If', ['List', 'True', 'False'], 1, 0]);
    expect(withElse.type.matches(parseType('list<integer^2>'))).toBe(true);
  });

  test('the walk stops at the first literal True: later conditions are unreachable', () => {
    const ce = engine();
    // `Which(True, 1, …)` evaluates to the scalar `1` — the second condition
    // is never even evaluated, so it must not type the result element-wise.
    const e = ce.box(['Which', 'True', 1, ['List', 'True', 'False'], 2]);
    expect(e.evaluate().re).toBe(1);
    expect(e.type.toString()).toBe('integer');
  });

  test('a condition with Missing cells is a static error', () => {
    // Selection rule of 2026-11-02: `["True", "Missing"]` types
    // `list<boolean | missing>`, which is not a flat list of booleans.
    const ce = engine();
    const e = ce.box(['Which', ['List', 'True', 'Missing'], 1, 'True', 0]);
    expect(e.evaluate().operator).toBe('Error');
    expect(e.type.toString()).toBe('error');
  });

  test('a condition typing plain unknown adds the type of a mask of unknown rank', () => {
    const ce = engine();
    ce.declare('u', 'unknown');
    // At run time `u` can hold a mask of any rank: with `u := [True,
    // False]`, the value is `[1, 0]`, which `integer` does not hold.
    const e = ce.box(['Which', 'u', 1, 'True', 0]);
    expect(e.type.toString()).toBe('integer | list<integer | list<any>>');
    ce.assign('u', ce.box(['List', 'True', 'False']));
    const v = e.evaluate();
    expect(v.toString()).toBe('[1,0]');
    expect(v.type.matches(e.type)).toBe(true);
  });

  test('a TUPLE-valued arm is lifted whole, and types whole', () => {
    const ce = engine();
    // Runtime lifts a non-broadcastable value WHOLE (the tuple-atomic
    // convention), so the arm type must NOT be unwrapped to its element type.
    const e = ce.box([
      'Which',
      ['List', 'True', 'False'],
      ['Tuple', 1, 2],
      'True',
      ['Tuple', 0, 0],
    ]);
    const v = e.evaluate();
    expect(cells(v)).toEqual(['(1, 2)', '(0, 0)']);
    expect(e.type.matches(parseType('list<tuple<integer, integer>^2>'))).toBe(
      true
    );
    expect(v.type.matches(e.type)).toBe(true);
  });

  test('a scalar condition keeps the existing scalar typing', () => {
    const ce = engine();
    ce.declare('x', 'number');
    expect(
      ce.box(['Which', ['Equal', 'x', 4], 1, 'True', 0]).type.toString()
    ).toBe('integer');
    expect(ce.box(['If', ['Equal', 'x', 4], 1, 0]).type.toString()).toBe(
      'integer'
    );
  });

  test('a branch of type unknown makes the result unknown', () => {
    // `widen` drops `unknown` from a join, so the conditional claimed the
    // type of the other branch: `If(n = 0, s, [1, 2])` was typed
    // `vector<integer^2>` while `f(0, 5)` with
    // `f(n, s) = s if n == 0 else f(n - 1, [1, 2])` is `5`.
    const ce = engine();
    expect(
      ce.box(['If', ['Equal', 'n', 0], 's', ['List', 1, 2]]).type.toString()
    ).toBe('unknown');
    expect(
      ce.box(['If', ['Equal', 'n', 0], ['List', 1, 2], 's']).type.toString()
    ).toBe('unknown');
    // An else-less `If` has the type of its arm, with no `missing` arm.
    expect(ce.box(['If', ['Equal', 'n', 0], 's']).type.toString()).toBe(
      'unknown'
    );
    ce.assign(
      'f',
      ce.parse('(n, s) \\mapsto \\operatorname{If}(n = 0, s, f(n - 1, [1, 2]))')
    );
    expect(ce.parse('f(0, 5)').evaluate().json).toBe(5);
    expect(ce.parse('f(0, [0.5])').evaluate().json).toEqual(['List', 0.5]);
    expect(ce.parse('f(2, 5)').evaluate().json).toEqual(['List', 1, 2]);
    // `Which` follows the same rule.
    expect(
      ce
        .box(['Which', ['Equal', 'n', 0], 's', 'True', ['List', 1, 2]])
        .type.toString()
    ).toBe('unknown');
  });

  test('a recursive call or a Return branch keeps the join of the other branches', () => {
    // A recursive call reads the signature of its function while that
    // signature is derived, where the result is the placeholder `unknown`;
    // the other branch is the seed of the fixpoint. A `Return` yields no
    // value in place.
    const ce = engine();
    ce.assign(
      'f',
      ce.parse('(n) \\mapsto \\operatorname{If}(n = 0, 1, f(n - 1))')
    );
    expect(ce.box('f').type.toString()).toBe('(n: unknown) -> integer');
    expect(
      ce.box(['If', ['Greater', 'y', 0], ['Return', 1], 2]).type.toString()
    ).toBe('integer');
  });
});

//
// Perf smoke — the witness must stay in the eager-zip regime
//

describe('perf smoke', () => {
  test('the 3-clause × 900-element witness evaluates promptly', () => {
    const ce = engine();
    const N = 900;
    const S: number[] = [];
    const n: number[] = [];
    for (let i = 0; i < N; i++) {
      S.push(i % 2);
      n.push(i % 5);
    }
    ce.assign('S', ce.box(['List', ...S]));
    ce.assign('n', ce.box(['List', ...n]));

    // Box-microloop canary: the reference cost of an engine operation on this
    // machine, so a slow CI host is visible in the reported numbers.
    let t = performance.now();
    for (let i = 0; i < 500; i++) ce.box(['Add', 'x', 1]);
    const canary = (performance.now() - t) / 500;

    const witness = ce.box([
      'Which',
      ['Equal', 'n', 3],
      1,
      ['Equal', 'n', 2],
      'S',
      'True',
      0,
    ]);
    let elapsed = Infinity;
    for (let r = 0; r < 4; r++) {
      t = performance.now();
      const v = witness.evaluate();
      elapsed = Math.min(elapsed, performance.now() - t);
      expect(v.count).toBe(N);
    }
    // Express the cost in units of the canary rather than in milliseconds.
    // Both numbers are measured in the same process moments apart, so a host
    // that is slow — or merely busy running the rest of the suite in parallel
    // — inflates them together and the ratio stays put, whereas an absolute
    // millisecond bound turns machine load into a test failure. Measured
    // ~1150 canary units (22 ms against a 0.019 ms/iter canary); the
    // per-position lazy regime this guards against is an order of magnitude
    // worse, so the bound below sits comfortably between the two.
    const canaryUnits = elapsed / canary;
    // The measurement is printed on request only (`BENCH_VERBOSE=1`), so the
    // suite output carries results, not readings.
    if (process.env.BENCH_VERBOSE)
      // eslint-disable-next-line no-console
      console.log(
        `[elementwise-which] witness 3×900: ${elapsed.toFixed(2)} ms = ` +
          `${canaryUnits.toFixed(0)} canary units (box canary ` +
          `${canary.toFixed(4)} ms/iter)`
      );
    // The ratio still moves when the machine is heavily loaded (6,139 units
    // were measured with several test runs on 8 cores), because the short
    // canary and the longer witness do not see the same load. So the bound is
    // asserted only in a `CE_PERF=1` run, as for the other timing checks.
    if (process.env.CE_PERF === '1') expect(canaryUnits).toBeLessThan(5000);
  });
});

describe('the selection rule of 2026-11-02: what is a static error', () => {
  // A condition is a boolean or a flat list of booleans; every arm is a
  // scalar or a flat list of the length of the condition, and all arms have
  // one element kind (numbers or points). Anything else is a static error:
  // the expression is invalid, its type is `error`, its value is the error,
  // and a compilation declines. These forms selected at every level of a
  // nested mask, or put a row of an arm at a position, before
  // (`docs/BROADCAST-MODEL.md`, the entries of 2026-07-27 and 2026-10-22).
  const C = ['List', 'True', 'False', 'True'];
  const ROWS = ['List', ['List', 1], ['List', 2], ['List', 3]];
  const M = ['List', ['List', 1, 2], ['List', 3, 4]];
  const cases: Array<[string, unknown]> = [
    ['a nested list condition', ['If', ['List', ['List', 'True']], 1, 0]],
    [
      'an uneven list condition',
      ['If', ['List', ['List', 'True'], ['List', 'False', 'True']], 7, 0],
    ],
    ['a matrix condition', ['If', ['Less', M, 3], 1, 0]],
    ['a matrix condition in Which', ['Which', ['Less', M, 2], 10, 'True', 0]],
    ['an arm whose elements are lists', ['If', C, ROWS, 0]],
    ['an arm whose elements are lists in Which', ['Which', C, ROWS]],
    ['a list of strings', ['If', C, ['List', "'a'", "'b'", "'c'"], "'d'"]],
    ['a number arm beside a point arm', ['If', C, ['Tuple', 1, 2], 0]],
  ];
  test.each(cases)('%s', (_label, json) => {
    const ce = engine();
    const e = ce.box(json as any);
    expect(e.isValid).toBe(false);
    expect(e.type.toString()).toBe('error');
    expect(e.evaluate().operator).toBe('Error');
  });

  test('a boolean arm is accepted, as a relation is', () => {
    // A relation under a list condition is a region of a plot
    // (`1 > 0 where (x+2)^2 + y^2 <= (0..0.2..1.6)^2`); a position that is
    // not selected is `False`: the region is not drawn there (user decision
    // of 2026-11-02, two-valued comparisons; before, it was `Missing`).
    const ce = engine();
    expect(ce.box(['If', C, 'True', 'False']).evaluate().toString()).toBe(
      '["True","False","True"]'
    );
    const e = ce.box(['If', C, ['Greater', 1, 0]]);
    expect(e.isValid).toBe(true);
    expect(e.evaluate().toString()).toBe('["True","False","True"]');
  });

  // `list<boolean | missing>` was in this list; a declared type cannot name
  // `missing` since 2026-11-02 (`docs/ERROR-MODEL.md`, "`Missing` is a
  // result only").
  test('a declared condition whose type cannot be a flat list', () => {
    for (const type of [
      'list',
      'list<any>',
      'indexed_collection<any>',
      'tensor<boolean^(2x2x2)>',
      'collection<boolean>',
      'matrix<boolean>',
    ]) {
      const ce = engine();
      ce.declare('T', type);
      expect(ce.box(['If', 'T', 1, 0]).isValid).toBe(false);
    }
  });

  test('a condition whose type does not settle its shape is checked on its value', () => {
    // `C < 2` over `C: indexed_collection` types `list<boolean | list<any>>`,
    // and `T` declared `tensor<boolean>` has no number of dimensions: each
    // can be a flat list, so neither is refused by its type. A value that is
    // a nested list is refused when the selection is evaluated.
    const ce = engine();
    ce.declare('C', 'indexed_collection');
    const e = ce.box(['Which', ['Less', 'C', 2], 1, 'True', 0]);
    expect(e.isValid).toBe(true);
    ce.assign('C', ce.box(['List', 1, 3]));
    expect(e.evaluate().toString()).toBe('[1,0]');
    ce.declare('T', 'tensor<boolean>');
    expect(ce.box(['If', 'T', 1, 0]).isValid).toBe(true);
    ce.assign('T', ce.box(['List', ['List', 'True'], ['List', 'False']]));
    expect(ce.box(['If', 'T', 1, 0]).evaluate().operator).toBe('Error');
  });

  test('a list arm of another length is an error', () => {
    const ce = engine();
    const e = ce.box(['If', ['List', 'True', 'False'], ['List', 1, 2, 3], 0]);
    expect(e.type.toString()).toBe('error');
    expect(e.evaluate().toString()).toBe(
      'Error("incompatible-dimensions", "2 vs 3")'
    );
  });

  test('a scalar condition still takes any arm whole', () => {
    const ce = engine();
    expect(ce.box(['If', 'True', ROWS, 0]).evaluate().toString()).toBe(
      '[[1],[2],[3]]'
    );
    expect(
      ce
        .box(['If', 'False', 1, ['List', "'a'", "'b'"]])
        .evaluate()
        .toString()
    ).toBe('["a","b"]');
  });
});

describe('the result type of a selection over a broadcastable arm', () => {
  // `broadcastable<T>` is defined for a `T` that cannot hold a list, so a
  // `broadcastable` arm contributes its cells: the result is never a
  // `broadcastable<broadcastable<…>>`. An element of a `broadcastable` arm
  // can be a list, so the mask can have a lower rank than the arm, and the
  // result also admits a list of cells or lists of any depth.
  const cases: Array<[unknown, string, string]> = [
    [
      ['If', ['Less', 'B', 0], ['Negate', 'B'], 'B'],
      '\\mathrm{If}(B < 0, -B, B)',
      'broadcastable<number> | list<list<any> | number>',
    ],
    [
      ['If', ['Less', 'B', 0], 0, 'B'],
      '\\mathrm{If}(B < 0, 0, B)',
      'broadcastable<number> | list<list<any> | number>',
    ],
    [
      ['Which', ['Less', 'B', 0], 0, 'True', 'B'],
      '\\begin{cases} 0 & B < 0 \\\\ B & \\text{otherwise} \\end{cases}',
      'broadcastable<number> | list<list<any> | number>',
    ],
    [
      ['If', ['Less', 'B', 0], 0, 1],
      '\\mathrm{If}(B < 0, 0, 1)',
      'broadcastable<integer>',
    ],
  ];
  test.each(cases)('%j', (expr, latex, type) => {
    const ce = engine();
    ce.declare('B', 'broadcastable<number>');
    expect(ce.box(expr as any).type.toString()).toBe(type);
    expect(ce.parse(latex).type.toString()).toBe(type);
  });

  test('the type holds the value for a matrix, a vector and a scalar', () => {
    const values: Array<[unknown, unknown, string]> = [
      // A matrix value of `B` makes `B < 0` a matrix condition, which the
      // selection rule of 2026-11-02 refuses (it gave `[[1,2],[3,4]]` and
      // `[[1,0],[0,4]]`).
      // A vector value of `B: broadcastable<number>` types `B < 0` as
      // `tensor<boolean>`, which does not settle a flat list: refused too
      // (it gave `[1,0]`).
      [['If', ['Less', 'B', 0], ['Negate', 'B'], 'B'], -3, '3'],
    ];
    for (const [expr, value, expected] of values) {
      const ce = engine();
      ce.declare('B', 'broadcastable<number>');
      // The type is read while `B` has no value, as a document is typed
      // before its rows are computed.
      const type = ce.box(expr as any).type;
      ce.assign('B', ce.box(value as any));
      const v = ce.box(expr as any).evaluate();
      expect(v.toString()).toBe(expected);
      expect(isSubtype(v.type.type, type.type)).toBe(true);
    }
  });

  test('a mask of lower rank than the arm is a static error', () => {
    // With `C := [-1, 1]` and `B := [[1, 2], [3, 4]]`, the arm `B` is a list
    // whose elements are lists, which the selection rule of 2026-11-02
    // refuses under a list condition. Before, the value was `[[1, 2], 0]`.
    const ce = engine();
    ce.declare('B', 'broadcastable<number>');
    ce.declare('C', 'broadcastable<number>');
    const expr = ['If', ['Less', 'C', 0], 'B', 0];
    const type = ce.box(expr as any).type;
    expect(type.toString()).toBe(
      'broadcastable<number> | list<list<any> | number>'
    );
    ce.assign('C', ce.box(['List', -1, 1]));
    ce.assign('B', ce.box(['List', ['List', 1, 2], ['List', 3, 4]]));
    const v = ce.box(expr as any).evaluate();
    expect(v.operator).toBe('Error');
  });
});

describe('the result type when the shape of a condition is not known', () => {
  // The type is read while the symbols have no value, as a document is
  // typed before its rows are computed, and must hold the value computed
  // after the assignments.
  function typedThenEvaluated(
    declarations: Record<string, string>,
    expr: unknown,
    values: Record<string, unknown>
  ): { type: string; value: string; holds: boolean } {
    const ce = engine();
    for (const [name, type] of Object.entries(declarations))
      ce.declare(name, type as any);
    const type = ce.box(expr as any).type;
    for (const [name, value] of Object.entries(values))
      ce.assign(name, ce.box(value as any));
    const v = ce.box(expr as any).evaluate();
    return {
      type: type.toString(),
      value: v.toString(),
      holds: isSubtype(v.type.type, type.type),
    };
  }
  const MASK = ['List', ['List', 'True', 'False'], ['List', 'False', 'True']];

  test('a condition of unknown type after a mask makes the rank unknown', () => {
    expect(
      typedThenEvaluated(
        { u: 'unknown' },
        ['Which', ['List', 'False', 'False'], 5, 'u', 1, 'True', 0],
        { u: MASK }
      )
    ).toEqual({
      type: 'list<integer | list<any>>',
      // Selection rule of 2026-11-02: once `u` holds a matrix, the type of
      // `u` is a matrix, and the condition is a static error.
      value: expect.stringContaining('incompatible-type'),
      holds: false,
    });
    expect(
      typedThenEvaluated(
        { u: 'any', M: 'matrix<integer^(2x2)>' },
        ['Which', ['Less', 'M', 0], 5, 'u', 1, 'True', 0],
        { M: ['List', ['List', 1, 2], ['List', 3, 4]], u: MASK }
      )
    ).toEqual({
      // `M < 0` over a matrix is not a flat list (selection rule of
      // 2026-11-02).
      type: 'error',
      value: expect.stringContaining('incompatible-type'),
      holds: true,
    });
  });

  test('a clause before the first mask can select its arm whole', () => {
    // A scalar `True` before the mask gives the arm itself.
    expect(
      typedThenEvaluated(
        { x: 'real' },
        [
          'Which',
          ['Greater', 'x', 0],
          5,
          ['List', 'True', 'False'],
          1,
          'True',
          0,
        ],
        { x: 1 }
      )
    ).toEqual({ type: 'integer | vector<integer^2>', value: '5', holds: true });
    // A condition of unknown type before the mask: the arm whole, or a
    // selection of unknown rank.
    expect(
      typedThenEvaluated(
        { u: 'unknown' },
        ['Which', 'u', 5, ['List', 'True', 'False'], 1, 'True', 0],
        { u: 'True' }
      )
    ).toEqual({
      type: 'integer | list<integer | list<any>>',
      value: '5',
      holds: true,
    });
  });

  test('the no-match cell reads the arms of the clauses before the first mask', () => {
    // Selection rule of 2026-11-02: a string arm of a selection with a list
    // condition is a static error, also in a clause before the first mask.
    // Before, the no-match cell was `Missing` (`[1, "Missing"]`).
    expect(
      typedThenEvaluated(
        { x: 'real' },
        [
          'Which',
          ['Greater', 'x', 0],
          { str: 's' },
          ['List', 'True', 'False'],
          1,
        ],
        { x: -1 }
      )
    ).toEqual({
      type: 'error',
      value: expect.stringContaining('incompatible-type'),
      holds: true,
    });
  });

  test('a condition that is a scalar or a mask is typed for both outcomes', () => {
    // The result type is the union of the scalar result and of the
    // element-wise result. Before, it was the scalar result only, `integer`,
    // which does not hold `[1, 0]`.
    const declarations = { c: 'boolean | list<boolean>' };
    const LIST = ['List', 'True', 'False'];
    expect(
      typedThenEvaluated(declarations, ['If', 'c', 1, 0], { c: LIST })
    ).toEqual({ type: 'integer | list<integer>', value: '[1,0]', holds: true });
    expect(
      typedThenEvaluated(declarations, ['If', 'c', 1, 0], { c: 'True' })
    ).toEqual({ type: 'integer | list<integer>', value: '1', holds: true });
    expect(
      typedThenEvaluated(declarations, ['Which', 'c', 1], { c: LIST })
    ).toEqual({
      type: 'integer | list<number> | missing',
      value: '[1,NaN]',
      holds: true,
    });
    // With two list arms, every outcome is a list: no scalar cell is added
    // to the type, as a `broadcastable` result type would add.
    const lists = ['If', 'c', ['List', 1, 2], ['List', 3, 4]];
    expect(typedThenEvaluated(declarations, lists, { c: LIST })).toEqual({
      type: 'list<integer>',
      value: '[1,4]',
      holds: true,
    });
    expect(typedThenEvaluated(declarations, lists, { c: 'False' })).toEqual({
      type: 'list<integer>',
      value: '[3,4]',
      holds: true,
    });
  });

  test('a union of masks of different ranks is a mask of unknown rank', () => {
    const declarations = { P: 'matrix<boolean^(2x2)> | list<boolean^3>' };
    // Selection rule of 2026-11-02: the type admits a flat list of booleans,
    // so it is not refused; a value that is a nested list (the matrix arm)
    // is refused when the selection is evaluated.
    expect(
      typedThenEvaluated(declarations, ['If', 'P', 1, 0], { P: MASK })
    ).toEqual(
      expect.objectContaining({
        type: 'list<integer | list<any>>',
        value: expect.stringContaining('incompatible-type'),
      })
    );
    expect(
      typedThenEvaluated(declarations, ['If', 'P', 1, 0], {
        P: ['List', 'True', 'False', 'True'],
      })
    ).toEqual({
      type: 'list<integer | list<any>>',
      value: '[1,0,1]',
      holds: true,
    });
  });

  test('a union of masks of one rank keeps that rank', () => {
    expect(
      typedThenEvaluated(
        { P: 'list<boolean^2> | list<boolean^3>' },
        ['If', 'P', 1, 0],
        { P: ['List', 'True', 'False'] }
      )
    ).toEqual({ type: 'list<integer>', value: '[1,0]', holds: true });
  });
});

describe('a condition whose type cannot be read (CE-22)', () => {
  test('If with a condition of unknown type may give a list', () => {
    const ce = engine();
    const e = ce.box(['If', 'c', 1, 0]);
    expect(e.type.toString()).toBe('integer | list<integer | list<any>>');
    ce.assign('c', ce.box(['List', 'True', 'False']));
    const v = e.evaluate();
    expect(v.toString()).toBe('[1,0]');
    expect(v.type.matches(e.type)).toBe(true);
  });

  test('Which with two conditions that are scalars or masks may give a list', () => {
    const ce = engine();
    ce.declare('B1', 'boolean | list<boolean>');
    ce.declare('B2', 'boolean | list<boolean>');
    const e = ce.box(['Which', 'B1', 1, 'B2', 2]);
    expect(e.type.toString()).toBe(
      'integer | list<list<any> | number> | missing'
    );
  });

  test('a whole-collection comparison with an absent cell is False', () => {
    // User decision of 2026-11-02, two-valued comparisons. Before, the
    // comparison was undecided, the selection was `Missing`, and its type
    // had a `missing` arm.
    const ce = engine();
    ce.assign('L', ce.box(['List', 1, 2]));
    const cond = ['Equal', 'L', ['List', 1, 'Missing']];
    for (const [json, expected] of [
      [['If', cond, 5, 0], '0'],
      [['Which', cond, 5, 'True', 0], '0'],
      [['Which', cond, 5, ['List', 'True', 'False'], 1, 'True', 0], '[1,0]'],
    ] as const) {
      const e = ce.box(json as any);
      const v = e.evaluate();
      expect(v.toString()).toBe(expected);
      expect(v.type.matches(e.type)).toBe(true);
    }
  });

  test('a comparison with one collection operand adds no missing arm', () => {
    // `At(s, 2)` can be absent, so `At(s, 2) = 0` is typed with a `missing`
    // arm. That comparison is not a whole-collection comparison: when it is
    // `Missing`, the `If` is the absent-condition error, not `Missing`.
    const ce = engine();
    ce.declare('s', 'list<list<integer> | integer>');
    // The element `At(s, 2)` can be a list, which makes the comparison a
    // mask, so the result can be a list.
    const e = ce.box(['If', ['Equal', ['At', 's', 2], 0], 5, 0]);
    expect(e.type.toString()).toBe('integer | list<integer>');
    ce.assign('s', ce.box(['List', ['List', 1], 0]));
    const v = e.evaluate();
    expect(v.toString()).toBe('5');
    expect(v.type.matches(e.type)).toBe(true);
  });
});

describe('the selection rule of 2026-11-02: values', () => {
  test('a false scalar condition selects a restricted list whole, for every reader', () => {
    // Rule 4: a scalar condition selects its arm whole, so the value is the
    // absent value of the whole list, `Missing`. `\sin` gave `[NaN, NaN,
    // NaN]`: it mapped the cells of the held restriction.
    const ce = engine();
    ce.declare('t', 'real');
    ce.assign('t', -1);
    for (const latex of [
      '[1,2,3]\\{0<t\\}',
      '2[1,2,3]\\{0<t\\}',
      '\\sin([1,2,3]\\{0<t\\})',
      '[1,2,3]\\{0<t\\}+1',
    ])
      expect(ce.parse(latex).evaluate().toString()).toBe('"Missing"');
    const R = ['If', ['Less', 0, 't'], ['List', 1, 2, 3]];
    for (const json of [['Sin', R], ['Add', R, 1], ['Multiply', 2, R]])
      expect(
        ce
          .box(json as any)
          .evaluate()
          .toString()
      ).toBe('"Missing"');
  });

  test('an undecided scalar condition is lifted over the whole result', () => {
    const ce = engine();
    ce.declare('t', 'real');
    const e = ce.box(['Sin', ['If', ['Less', 0, 't'], ['List', 1, 2]]]);
    const held = e.evaluate();
    expect(held.toString()).toBe('If(0 < t, [sin(1),sin(2)])');
    expect(held.isCollection).toBe(true);
    ce.assign('t', -1);
    expect(held.evaluate().toString()).toBe('"Missing"');
    ce.assign('t', 1);
    expect(held.evaluate().toString()).toBe('[sin(1),sin(2)]');
  });

  test('an unmatched point cell is a point of NaN coordinates', () => {
    const ce = engine();
    ce.declare('v', 'list<real>');
    const e = ce.box(['If', ['Greater', 'v', 0], ['Tuple', 1, 2]]);
    expect(e.type.toString()).toBe('list<tuple<number, number>>');
    ce.assign('v', ce.box(['List', -1, 2, 3]));
    expect(e.evaluate().toString()).toBe('[(NaN, NaN),(1, 2),(1, 2)]');
  });

  test('a selected arm typed as a list with no elements to read stays held', () => {
    const ce = engine();
    ce.assign('L', ce.box(['List', 1, 3, 5]));
    const mask = ['Less', 'L', 2];
    const heldMask = ['List', 'True', 'False', 'False'];
    const fooOfL = ['foo', ['List', 1, 3, 5]];
    expect(
      ce
        .box(['Which', mask, ['foo', 'L'], 'True', 0] as any)
        .evaluate().json
    ).toEqual(['Which', heldMask, fooOfL, 'True', 0]);
    expect(
      ce.box(['If', mask, ['foo', 'L'], 0] as any).evaluate().json
    ).toEqual(['If', heldMask, fooOfL, 0]);
    expect(
      ce
        .box(['Which', mask, ['Add', 1, ['foo', 'L']], 'True', 0] as any)
        .evaluate()
        .json
    ).toEqual(['Which', heldMask, ['Add', 1, fooOfL], 'True', 0]);
    // A valueless list is the same case: its sum has no cells either.
    ce.declare('M', 'list<number>');
    expect(
      ce
        .box(['Which', mask, ['Add', 'M', 'M'], 'True', 0] as any)
        .evaluate().json
    ).toEqual(['Which', heldMask, ['Multiply', 2, 'M'], 'True', 0]);
  });

  test('a held selection gives the same form on the asynchronous route', async () => {
    const ce = engine();
    ce.assign('L', ce.box(['List', 1, 3, 5]));
    const mask = ['Less', 'L', 2];
    const heldMask = ['List', 'True', 'False', 'False'];
    const fooOfL = ['foo', ['List', 1, 3, 5]];
    const which = ce.box(['Which', mask, ['foo', 'L'], 'True', 0] as any);
    expect((await which.evaluateAsync()).json).toEqual([
      'Which',
      heldMask,
      fooOfL,
      'True',
      0,
    ]);
    const ifElse = ce.box(['If', mask, ['foo', 'L'], 0] as any);
    expect((await ifElse.evaluateAsync()).json).toEqual([
      'If',
      heldMask,
      fooOfL,
      0,
    ]);
  });

  test('an arm evaluated before a selection is held does not run again', () => {
    const ce = engine();
    ce.assign('L', ce.box(['List', 1, 3, 5]));
    ce.assign('count', 0);
    const held = ce
      .box([
        'Which',
        ['Less', 'L', 2],
        ['Block', ['Assign', 'count', ['Add', 'count', 1]], 42],
        'True',
        ['foo', 'L'],
      ] as any)
      .evaluate();
    expect(ce.box('count').evaluate().json).toBe(1);
    expect(held.evaluate().json).toEqual(held.json);
    expect(ce.box('count').evaluate().json).toBe(1);
  });

  test('each arm of a held selection keeps its own value', () => {
    const ce = engine();
    ce.assign('L', ce.box(['List', 1, 2, 3]));
    ce.assign('count', 0);
    // One expression object in two clauses: each clause keeps its own draw.
    const next = ce.box(['Block', ['Assign', 'count', ['Add', 'count', 1]], 'count']);
    const held = ce._fn('Which', [
      ce.box(['Less', 'L', 2]),
      next,
      ce.box(['Less', 'L', 3]),
      next,
      ce.True,
      ce.box(['foo', 'L']),
    ]).evaluate();
    expect(held.operator).toBe('Which');
    expect(held.ops?.[1].json).toBe(1);
    expect(held.ops?.[3].json).toBe(2);
  });

  test('an operator that reads the whole list stays around a held selection', () => {
    const ce = engine();
    ce.assign('L', ce.box(['List', 1, 3, 5]));
    ce.declare('M', 'list<number>');
    const mask = ['Less', 'L', 2];
    const heldMask = ['List', 'True', 'False', 'False'];
    const selection = ['Which', mask, ['foo', 'L'], 'True', 0];
    const held = ['Which', heldMask, ['foo', ['List', 1, 3, 5]], 'True', 0];
    expect(ce.box(['Length', selection] as any).evaluate().json).toEqual([
      'Length',
      held,
    ]);
    expect(ce.box(['At', selection, 2] as any).evaluate().json).toEqual([
      'At',
      held,
      2,
    ]);
    expect(ce.box(['Reverse', selection] as any).evaluate().json).toEqual([
      'Reverse',
      held,
    ]);
    expect(
      ce
        .box(['Length', ['Which', mask, 'M', 'True', 0]] as any)
        .evaluate().json
    ).toEqual(['Length', ['Which', heldMask, 'M', 'True', 0]]);
    // A condition with no value yet: `Distance` has no point to reject.
    const distance = ce.box([
      'Distance',
      [
        'Which',
        ['Less', 'M', 2],
        ['Tuple', 1, 2],
        'True',
        ['Tuple', 3, 4],
      ],
      ['Tuple', 0, 0],
    ] as any);
    expect(distance.evaluate().operator).toBe('Distance');
    // A lazy operator reads the list condition of the evaluated operand.
    ce.declare('c', 'any');
    ce.assign('c', ce.box(['List', 'True', 'False', 'False']));
    expect(
      ce
        .box([
          'ArgMax',
          ['Which', 'c', ['foo', 'L'], 'True', ['List', 7, 8, 9]],
        ] as any)
        .evaluate().operator
    ).toBe('ArgMax');
    // The value of the operator is read when the selection can be made.
    ce.assign('M', ce.box(['List', 1, 3, 5]));
    expect(distance.evaluate().toString()).toBe('[sqrt(5),5,5]');
    ce.declare('foo', {
      signature: '(list<number>) -> list<number>',
      evaluate: () => ce.box(['List', 10, 30, 50]),
    });
    expect(ce.box(['Length', selection] as any).evaluate().json).toBe(3);
    expect(ce.box(['At', selection, 2] as any).evaluate().json).toBe(0);
  });

  test('an operator that maps over a list moves into a held selection', () => {
    const ce = engine();
    ce.assign('L', ce.box(['List', 1, 3, 5]));
    expect(
      ce
        .box(['Sin', ['Which', ['Less', 'L', 2], ['foo', 'L'], 'True', 'x']] as any)
        .evaluate().json
    ).toEqual([
      'Which',
      ['List', 'True', 'False', 'False'],
      ['Sin', ['foo', ['List', 1, 3, 5]]],
      'True',
      ['Sin', 'x'],
    ]);
  });

  test('a held selection is a fixed point and selects when the arm has a value', () => {
    const ce = engine();
    ce.assign('L', ce.box(['List', 1, 3, 5]));
    const held = ce
      .box(['Which', ['Less', 'L', 2], ['foo', 'L'], 'True', 0] as any)
      .evaluate();
    expect(held.evaluate().json).toEqual(held.json);
    ce.declare('foo', {
      signature: '(list<number>) -> list<number>',
      evaluate: () => ce.box(['List', 10, 30, 50]),
    });
    expect(held.evaluate().toString()).toBe('[10,0,0]');
  });

  test('a held If keeps the evaluated condition, so an index does not leak', () => {
    const ce = engine();
    ce.assign('L', ce.box(['List', 1, 3, 5]));
    // The bound variable `k` has a value only during the iteration: a held
    // node that kept the condition as written would give a term in `k`.
    const value = ce
      .box([
        'Sum',
        ['If', ['Less', 'L', 'k'], ['foo', 'L'], 0],
        ['Limits', 'k', 2, 2],
      ] as any)
      .evaluate();
    expect(value.unknowns).not.toContain('k');
    expect(JSON.stringify(value.json)).toContain('"True","False","False"');
  });

  test('an arm that is not reached does not hold the selection', () => {
    const ce = engine();
    ce.assign('L', ce.box(['List', 1, 3, 5]));
    expect(
      ce
        .box(['Which', ['Less', 'L', 9], 'L', 'True', ['foo', 'L']] as any)
        .evaluate()
        .toString()
    ).toBe('[1,3,5]');
  });

  test('an arm typed as a scalar is copied to each selected position', () => {
    const ce = engine();
    ce.assign('L', ce.box(['List', 1, 3, 5]));
    const mask = ['Less', 'L', 2];
    expect(
      ce
        .box(['Which', mask, ['foo', 'x'], 'True', 0] as any)
        .evaluate().json
    ).toEqual(['List', ['foo', 'x'], 0, 0]);
    expect(
      ce
        .box(['Which', mask, ['Length', ['foo', 'L']], 'True', 0] as any)
        .evaluate().json
    ).toEqual(['List', ['Length', ['foo', ['List', 1, 3, 5]]], 0, 0]);
    expect(
      ce.box(['Which', mask, 'x', 'True', 0] as any).evaluate().json
    ).toEqual(['List', 'x', 0, 0]);
  });

  test('a piecewise over an unknown function of a list has a value of linear size', () => {
    // Four reads of an inner selection whose arm applies an undeclared
    // function to the whole list, in the condition and in the arm of an outer
    // selection. A copy of the list at each position would give about
    // 4 × 400 × 400 cells.
    const size = (n: number): number => {
      const ce = engine();
      ce.assign(
        'L',
        ce.box(['List', ...Array.from({ length: n }, (_, i) => i - 1)])
      );
      const inner = ['Which', ['Greater', 'L', 0], ['foo', 'L'], 'True', 1];
      const value = ce
        .box([
          'Which',
          ['Greater', ['Abs', ['Divide', 1, inner]], 0],
          ['Add', ['Divide', inner, 2], inner, ['Negate', inner]],
          'True',
          0,
        ] as any)
        .evaluate();
      return JSON.stringify(value.json).length;
    };
    expect(size(400)).toBeLessThan(5 * size(100));
  });

  test('the scalar no-match value of Which is unchanged', () => {
    const ce = engine();
    ce.declare('t', 'real');
    ce.assign('t', -1);
    expect(
      ce
        .box(['Which', ['Less', 't', -5], 1])
        .evaluate()
        .toString()
    ).toBe('"Missing"');
    expect(ce.parse('\\{t>0: 1\\}').evaluate().toString()).toBe('"Missing"');
  });
});
