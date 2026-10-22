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

  test('an unbounded condition against a finite one is a mismatch, not a truncation', () => {
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
    expect(r.operator).toBe('Error');
    expect(r.toString()).toMatch(/Infinity/);
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
    const unknown = [
      'Map',
      ['Function', ['Greater', '_', 2], '_'],
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

  // User decision 2026-10-17: a position that no clause selects holds the
  // absence marker of the type of the position, as `When` masks a cell:
  // `NaN` for a number, `Missing` for anything else (a string, a point).
  // Before, the marker was `NaN` whatever the arms were.
  test('a string arm masks to Missing', () => {
    const ce = engine();
    const r = ce
      .box(['Which', ['List', 'True', 'False'], { str: 'hot' }])
      .evaluate();
    expect(cells(r)).toEqual(['"hot"', '"Missing"']);
  });

  test('a point arm masks to Missing, as When and the scalar forms do', () => {
    const ce = engine();
    const cond = ['Less', ['List', 1, 5], 3];
    const which = ce.box(['Which', cond, ['Tuple', 1, 2]]).evaluate();
    const when = ce.box(['When', ['Tuple', 1, 2], cond]).evaluate();
    expect(cells(which)).toEqual(['(1, 2)', '"Missing"']);
    expect(cells(when)).toEqual(['(1, 2)', '"Missing"']);
    expect(
      ce
        .box(['Which', ['Less', 5, 3], ['Tuple', 1, 2]])
        .evaluate()
        .toString()
    ).toBe('"Missing"');
    expect(
      ce
        .box(['When', ['Tuple', 1, 2], ['Less', 5, 3]])
        .evaluate()
        .toString()
    ).toBe('"Missing"');
    // The else-less `If` is the same selection.
    const ifForm = ce.box(['If', cond, ['Tuple', 1, 2]]).evaluate();
    expect(cells(ifForm)).toEqual(['(1, 2)', '"Missing"']);
  });

  test('a number arm masks to NaN in both operators', () => {
    const ce = engine();
    const cond = ['Less', ['List', 1, 5], 3];
    expect(cells(ce.box(['Which', cond, 7]).evaluate())).toEqual(['7', 'NaN']);
    expect(cells(ce.box(['When', 7, cond]).evaluate())).toEqual(['7', 'NaN']);
  });

  test('a number arm beside a point arm masks to Missing', () => {
    const ce = engine();
    const r = ce
      .box([
        'Which',
        ['Less', ['List', 1, 5, 9], 3],
        7,
        ['Greater', ['List', 1, 5, 9], 8],
        ['Tuple', 1, 2],
      ])
      .evaluate();
    expect(cells(r)).toEqual(['7', '"Missing"', '(1, 2)']);
    expect(
      r.type.matches(
        ce.box([
          'Which',
          ['Less', ['List', 1, 5, 9], 3],
          7,
          ['Greater', ['List', 1, 5, 9], 8],
          ['Tuple', 1, 2],
        ]).type
      )
    ).toBe(true);
  });

  test('If without an else branch yields NaN, not Nothing (positions preserved)', () => {
    const ce = engine();
    ce.assign('n', ce.box(['List', 3, 2, 1, 3]));
    const r = ce.box(['If', ['Equal', 'n', 3], 1]).evaluate();
    expect(cells(r)).toEqual(['1', 'NaN', 'NaN', '1']);
  });
});

describe('R4′ — a Missing condition cell is an error cell at that position', () => {
  test('other positions are unaffected', () => {
    const ce = engine();
    const r = ce
      .box(['Which', ['List', 'True', 'Missing', 'False'], 1, 'True', 0])
      .evaluate();
    const c = cells(r);
    expect(c[0]).toBe('1');
    expect(c[1]).toMatch(/absent/);
    expect(c[2]).toBe('0');
  });

  test('the cell is the same catchable error the scalar form produces', () => {
    const ce = engine();
    const scalar = ce.box(['If', 'Missing', 1, 2]).evaluate();
    const r = ce.box(['If', ['List', 'Missing', 'True'], 1, 2]).evaluate();
    const cell = Array.from(r.each())[0] as any;
    expect(cell.operator).toBe('Error');
    expect(cell.toString()).toBe(scalar.toString());
  });

  test('an absent cell does not fall through to a later clause', () => {
    const ce = engine();
    const r = ce.box(['Which', ['List', 'Missing'], 1, 'True', 99]).evaluate();
    expect(cells(r)[0]).toMatch(/absent/);
  });

  test('a lifted SCALAR Missing condition is an all-Missing condition row', () => {
    const ce = engine();
    // A scalar condition lifts to every position (R1) and absence is
    // position-local (R4′): the selection already made at position 0 stands,
    // and only the still-undecided position becomes an error cell — the whole
    // element-wise result is NOT collapsed to one scalar error.
    const r = ce
      .box(['Which', ['List', 'True', 'False'], 1, 'Missing', 2])
      .evaluate();
    const c = cells(r);
    expect(c).toHaveLength(2);
    expect(c[0]).toBe('1');
    expect(c[1]).toMatch(/absent/);
  });

  test('positions absent at a scalar Missing row are not rescued by a later clause', () => {
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
    expect(c[0]).toBe('1');
    expect(c[1]).toMatch(/absent/);
    expect(c[2]).toMatch(/absent/);
  });

  test('the all-scalar form is unchanged: one scalar error', () => {
    const ce = engine();
    const r = ce.box(['Which', 'Missing', 1]).evaluate();
    expect(r.operator).toBe('Error');
    expect(r.toString()).toMatch(/absent/);
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
    // The gate never admitted this condition, so it must not report a
    // dimension error about it: a condition it refuses leaves the WHOLE
    // expression inert, whatever its length (§3).
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
    expect(r.operator).toBe('Which');
  });

  test('a PROVABLY INFINITE later condition is still a length mismatch', () => {
    const ce = engine();
    // Unlike the refused conditions above, a KNOWN infinite length is a
    // genuine R3 mismatch against the finite participants.
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
    expect(r.operator).toBe('Error');
    expect(r.toString()).toMatch(/incompatible-dimensions/);
    expect(r.toString()).toMatch(/Infinity/);
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

  test('scalar If without an else branch is Missing', () => {
    // No-selection ruling 2026-08-27: a selection with no selected branch
    // answers `Missing`, the position-preserving absent datum, on `If` and
    // `Which` alike.
    const ce = engine();
    const r = ce.box(['If', 'False', 1]).evaluate();
    expect(r.symbol).toBe('Missing');
  });

  test('scalar Missing condition is the catchable error', () => {
    const ce = engine();
    expect(ce.box(['If', 'Missing', 1, 2]).evaluate().operator).toBe('Error');
    expect(ce.box(['Which', 'Missing', 1, 'True', 2]).evaluate().operator).toBe(
      'Error'
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

  test('a Missing condition cell yields an error cell', () => {
    const ce = engine();
    const r = ce.box(['If', ['List', 'True', 'Missing'], 1, 0]).evaluate();
    expect(cells(r)[0]).toBe('1');
    expect(cells(r)[1]).toMatch(/absent/);
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
    const ce = engine();
    ce.declare('b', 'indexed_collection<boolean>');
    const t = ce.box(['Which', 'b', 1, 'True', 0]).type;
    expect(t.matches(parseType('list<integer>'))).toBe(true);
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

  test('NO default + non-numeric arm: the union element type drops the shape', () => {
    const ce = engine();
    // Joining in the NaN marker over a `string` arm yields a UNION element
    // type. A dimensioned `list` type IS the tensor claim (`isTensor` is
    // exactly `dimensions !== undefined`) and the union-free clause
    // (tensor-unification design §D3 rule 2) never claims a shape for a
    // heterogeneous cell population — so the declared type must not either,
    // or it promises a shape the evaluated value can never carry.
    // The no-match cell of a string arm is `Missing` (user decision
    // 2026-10-17), so the element type is `missing | string`.
    const e = ce.box(['Which', ['List', 'True', 'False'], { str: 'hot' }]);
    expect(e.type.toString()).toBe('list<missing | string>');
    expect(e.type.matches(parseType('list<missing | string^2>'))).toBe(false);

    const v = e.evaluate();
    expect(cells(v)).toEqual(['"hot"', '"Missing"']);
    expect(v.type.toString()).toBe('list<missing | string>');
    // The invariant this case used to break.
    expect(v.type.matches(e.type)).toBe(true);
  });

  test('WITH a default clause the string arms stay union-free and keep the shape', () => {
    const ce = engine();
    // Contrast with the case above: a default makes the NaN cell
    // unreachable, so the element type is the union-free `string` and the
    // shape claim survives.
    const e = ce.box([
      'Which',
      ['List', 'True', 'False'],
      { str: 'hot' },
      'True',
      { str: 'cold' },
    ]);
    expect(e.type.toString()).toBe('list<string^2>');
    expect(e.evaluate().type.matches(e.type)).toBe(true);
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

  test('a condition with Missing cells types element-wise, as it evaluates', () => {
    const ce = engine();
    // Runtime admits `True`/`False`/`Missing` cells (R4′), so the static gate
    // must too: `["True", "Missing"]` types `list<boolean | missing>`.
    const e = ce.box(['Which', ['List', 'True', 'Missing'], 1, 'True', 0]);
    expect(e.evaluate().operator).toBe('List');
    expect(e.type.matches(parseType('list<integer>'))).toBe(true);
  });

  test('a condition typing plain unknown does NOT flip the result type', () => {
    const ce = engine();
    ce.declare('u', 'unknown');
    expect(ce.box(['Which', 'u', 1, 'True', 0]).type.toString()).toBe(
      'integer'
    );
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
    expect(ce.box(['If', ['Equal', 'n', 0], 's']).type.toString()).toBe(
      'missing | unknown'
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
    expect(ce.box('f').type.toString()).toBe('(unknown) -> integer');
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

describe('an element-wise selection over an arm whose elements are lists', () => {
  // The selection indexes each list arm position by position, so a position
  // holds an element of the arm: a row of a matrix. The arms were read by
  // their cells, so `If(C, [[1], [2], [3]], 0)` was typed `vector<integer^3>`
  // while its value is `[[1], 0, [3]]`.
  const C = ['List', 'True', 'False', 'True'];
  const ROWS = ['List', ['List', 1], ['List', 2], ['List', 3]];
  const cases: Array<[unknown, string, string]> = [
    [['If', C, ROWS, 0], 'list<integer | vector<integer^1>>', '[[1],0,[3]]'],
    [
      ['If', C, ROWS, ['List', ['List', 0], ['List', 0], ['List', 0]]],
      'list<vector<integer^1>>',
      '[[1],[0],[3]]',
    ],
    [
      ['Which', C, ROWS, 'True', 0],
      'list<integer | vector<integer^1>>',
      '[[1],0,[3]]',
    ],
    // With no default, an unselected position holds the absence marker of a
    // list element, `Missing`, not the numeric `NaN`.
    [
      ['Which', C, ROWS],
      'list<missing | vector<integer^1>>',
      '[[1],"Missing",[3]]',
    ],
  ];
  test.each(cases)('%j', (expr, type, value) => {
    const ce = engine();
    const e = ce.box(expr as any);
    expect(e.type.toString()).toBe(type);
    const v = e.evaluate();
    expect(v.toString()).toBe(value);
    expect(v.type.matches(e.type)).toBe(true);
  });

  test('a tensor arm of unknown rank holds a cell or a tensor at a position', () => {
    const ce = engine();
    ce.declare('T', 'tensor<integer>');
    ce.declare('B', 'list<boolean>');
    expect(ce.box(['If', 'B', 'T', 0]).type.toString()).toBe(
      'list<integer | tensor<integer>>'
    );
  });

  test('an arm of a different length is a dimension error at evaluation', () => {
    // A signature's result type describes the successful values
    // (`docs/ERROR-MODEL.md` §4): the length mismatch is reported by the
    // value, as for `[1, 2] + [1, 2, 3]`.
    const ce = engine();
    const e = ce.box(['If', C, ROWS, ['List', 0]]);
    expect(e.evaluate().toString()).toBe(
      'Error("incompatible-dimensions", "3 vs 1")'
    );
  });
});

describe('ELEMENT-WISE WHICH OVER A MASK THAT MAY BE NESTED', () => {
  // A comparison over a bare `indexed_collection` is typed
  // `list<boolean | list<any>>`: an element of the collection may be a list,
  // which the comparison maps at its leaves. Such a mask selects element-wise
  // whether its value is flat or nested, so an element of the result is a
  // cell or a list: `list<integer | list<any>>`.
  test('the selection is typed element-wise, and both values match', () => {
    for (const [value, expected] of [
      [['List', 1, 2, 3], '[1,0,0]'],
      [['List', ['List', 1, 2], ['List', 3]], '[[1,0],[0]]'],
    ]) {
      const ce = engine();
      ce.declare('C', 'indexed_collection');
      const e = ce.box(['Which', ['Less', 'C', 2], 1, 'True', 0]);
      expect(e.type.toString()).toBe('list<integer | list<any>>');
      ce.assign('C', ce.box(value as any));
      const v = ce.box(['Which', ['Less', 'C', 2], 1, 'True', 0]).evaluate();
      expect(v.toString()).toBe(expected);
      expect(v.type.matches(e.type)).toBe(true);
    }
  });

  test('a mask of unknown rank (tensor<boolean>) types its cells or lists', () => {
    const ce = engine();
    ce.declare('T', 'tensor<boolean>');
    const e = ce.box(['If', 'T', 1, 0]);
    expect(e.type.toString()).toBe('list<integer | list<any>>');
    ce.assign(
      'T',
      ce.box(['List', ['List', 'True', 'False'], ['List', 'False', 'True']])
    );
    const v = ce.box(['If', 'T', 1, 0]).evaluate();
    expect(v.toString()).toBe('[[1,0],[0,1]]');
    expect(isSubtype(v.type.type, e.type.type)).toBe(true);
  });
});

describe('a mask of rank 2 or more selects at each level', () => {
  // At a node where some condition is a list, every list participant has
  // the same length and each position is a node one level down; at a node
  // where every condition is a scalar, the selected arm's value at that node
  // is taken whole. The result follows the mask.
  const M = ['List', ['List', 1, 2], ['List', 3, 4]];
  function matrixEngine(): ComputeEngine {
    const ce = engine();
    ce.assign('M', ce.box(M as any));
    return ce;
  }

  const cases: Array<[unknown, string | undefined, string, string]> = [
    [
      ['If', ['Less', 'M', 3], 'M', 0],
      '\\mathrm{If}(M < 3, M, 0)',
      '[[1,2],[0,0]]',
      'matrix<integer^(2x2)>',
    ],
    [
      ['If', ['Less', 'M', 3], 1, 0],
      '\\mathrm{If}(M < 3, 1, 0)',
      '[[1,1],[0,0]]',
      'matrix<integer^(2x2)>',
    ],
    [
      ['Which', ['Less', 'M', 2], 10, ['Less', 'M', 4], 'M', 'True', 0],
      '\\begin{cases} 10 & M < 2 \\\\ M & M < 4 \\\\ 0 & \\text{otherwise} \\end{cases}',
      '[[10,2],[3,0]]',
      'matrix<integer^(2x2)>',
    ],
    // No else branch: an unselected cell of a numeric arm is `NaN`, so the
    // cells are `number`.
    [
      ['If', ['Less', 'M', 3], 'M'],
      '\\mathrm{If}(M < 3, M)',
      '[[1,2],[NaN,NaN]]',
      'matrix<2x2>',
    ],
    // An arm that no position selects is not evaluated, so its length is
    // not checked.
    [
      ['If', ['Less', 'M', 0], ['List', 10, 20, 30], 0],
      undefined,
      '[[0,0],[0,0]]',
      'matrix<integer^(2x2)>',
    ],
    // The rows of a lazy arm are read at the level where they are lists.
    [
      ['If', ['Less', 'M', 3], ['List', ['Range', 1, 2], ['Range', 3, 4]], 0],
      undefined,
      '[[1,2],[0,0]]',
      'matrix<integer^(2x2)>',
    ],
    // A tuple arm is one value at each cell.
    [
      ['If', ['Less', 'M', 3], ['Tuple', 1, 2], ['Tuple', 0, 0]],
      undefined,
      '[[(1, 2),(1, 2)],[(0, 0),(0, 0)]]',
      'list<tuple<integer, integer>^(2x2)>',
    ],
    // A string arm without a default: the unselected cells are `Missing`,
    // and a union cell carries no dimensions.
    [
      ['If', ['Less', 'M', 3], { str: 'a' }],
      undefined,
      '[["a","a"],["Missing","Missing"]]',
      'list<list<missing | string>>',
    ],
    // A mask of rank 3.
    [
      [
        'If',
        [
          'List',
          ['List', ['List', 'True', 'False']],
          ['List', ['List', 'False', 'True']],
        ],
        1,
        0,
      ],
      undefined,
      '[[[1,0]],[[0,1]]]',
      'list<integer^(2x1x2)>',
    ],
  ];

  test.each(cases)('%j', (expr, latex, value, type) => {
    const ce = matrixEngine();
    const e = ce.box(expr as any);
    expect(e.type.toString()).toBe(type);
    const v = e.evaluate();
    expect(v.toString()).toBe(value);
    expect(isSubtype(v.type.type, e.type.type)).toBe(true);
    if (latex !== undefined) {
      const p = ce.parse(latex);
      expect(p.type.toString()).toBe(type);
      expect(p.evaluate().toString()).toBe(value);
    }
  });

  test('the function route agrees with the box route', () => {
    const ce = matrixEngine();
    const v = ce
      .function('If', [ce.box(['Less', 'M', 3]), ce.symbol('M'), ce.number(0)])
      .evaluate();
    expect(v.toString()).toBe('[[1,2],[0,0]]');
  });

  test('the numeric and asynchronous routes agree', async () => {
    const ce = matrixEngine();
    const e = ce.box(['If', ['Less', 'M', 3], ['Sqrt', 2], 0]);
    expect(e.evaluate().toString()).toBe('[[sqrt(2),sqrt(2)],[0,0]]');
    expect(e.N().toString()).toBe(
      '[[1.4142135623730950488,1.4142135623730950488],[0,0]]'
    );
    const w = ce.box([
      'Which',
      ['Less', 'M', 2],
      10,
      ['Less', 'M', 4],
      'M',
      'True',
      0,
    ]);
    expect((await w.evaluateAsync()).toString()).toBe('[[10,2],[3,0]]');
  });

  test('a mask whose rows have different lengths', () => {
    const ce = engine();
    const R = ['List', ['List', 'True'], ['List', 'False', 'True']];
    const e = ce.box(['If', R, 7, 0] as any);
    expect(e.type.toString()).toBe('list<integer | list<any>>');
    const v = e.evaluate();
    expect(v.toString()).toBe('[[7],[0,7]]');
    expect(isSubtype(v.type.type, e.type.type)).toBe(true);
    // The parse route reads the mask from a symbol.
    ce.assign('R', ce.box(R as any));
    const p = ce.parse('\\mathrm{If}(R, 7, 0)');
    expect(p.type.toString()).toBe('list<integer | list<any>>');
    expect(p.evaluate().toString()).toBe('[[7],[0,7]]');
  });

  test('a list participant of a different length is a dimension error', () => {
    const ce = matrixEngine();
    // An arm whose length differs from the mask at the top level.
    expect(
      ce
        .box(['If', ['Less', 'M', 3], ['List', 10, 20, 30], 0])
        .evaluate()
        .toString()
    ).toBe('Error("incompatible-dimensions", "2 vs 3")');
    expect(
      ce.parse('\\mathrm{If}(M < 3, [10, 20, 30], 0)').evaluate().toString()
    ).toBe('Error("incompatible-dimensions", "2 vs 3")');
    // An arm of lower rank than the mask, as `M + [10, 20]` is.
    expect(
      ce
        .box(['If', ['Less', 'M', 3], ['List', 10, 20], 0])
        .evaluate()
        .toString()
    ).toBe('Error("incompatible-dimensions", "2x2 vs 2")');
    expect(
      ce.parse('\\mathrm{If}(M < 3, [10, 20], 0)').evaluate().toString()
    ).toBe('Error("incompatible-dimensions", "2x2 vs 2")');
    // An arm whose rows differ from the rows of the mask.
    expect(
      ce
        .box(['If', ['Less', 'M', 3], ['List', ['List', 1], ['List', 2]], 0])
        .evaluate()
        .toString()
    ).toBe('Error("incompatible-dimensions", "2 vs 1")');
    // Two conditions whose rows differ.
    expect(
      ce
        .box([
          'Which',
          ['List', ['List', 'True', 'False'], ['List', 'True']],
          1,
          ['List', ['List', 'True', 'True'], ['List', 'True', 'True']],
          2,
          'True',
          0,
        ])
        .evaluate()
        .toString()
    ).toBe('Error("incompatible-dimensions", "1 vs 2")');
    // An unbounded arm that a position selects.
    expect(
      ce
        .box(['If', ['Less', 'M', 3], ['Cycle', ['List', 1]], 0])
        .evaluate()
        .toString()
    ).toBe('Error("incompatible-dimensions", "2 vs Infinity")');
  });

  test('a Missing cell at any depth is an error cell at its position', () => {
    const ce = engine();
    const v = ce
      .box([
        'If',
        ['List', ['List', 'True', 'Missing'], ['List', 'False', 'True']],
        1,
        0,
      ])
      .evaluate();
    expect(v.ops![0].ops![0].toString()).toBe('1');
    expect(v.ops![0].ops![1].operator).toBe('Error');
    expect(v.ops![1].toString()).toBe('[0,1]');
  });

  test('a symbolic cell at any depth keeps the expression inert', () => {
    const ce = engine();
    ce.declare('x', 'boolean');
    const r = ce
      .box([
        'If',
        ['List', ['List', 'True', 'x'], ['List', 'False', 'True']],
        1,
        0,
      ])
      .evaluate();
    expect(r.operator).toBe('If');
  });

  test('a condition after a lifted True is not evaluated', () => {
    // `Which(M < 2, 1, True, 2, <a mask of another shape>, 3)`: the third
    // condition is unreachable, so it neither shapes nor errors the result.
    const ce = matrixEngine();
    const v = ce
      .box([
        'Which',
        ['Less', 'M', 2],
        1,
        'True',
        2,
        ['List', 'True', 'False', 'True'],
        3,
      ])
      .evaluate();
    expect(v.toString()).toBe('[[1,2],[2,2]]');
  });

  test('a scalar True condition at a node selects the arm whole there', () => {
    // `V < 3` is `[True, False]`: at position 0 the first condition is the
    // scalar `True`, and the second condition (a row of `M < 2`) makes the
    // node a list node, so the first row of the first arm `M` is read
    // there.
    const ce = matrixEngine();
    ce.assign('V', ce.box(['List', 1, 5]));
    const e = ce.box([
      'Which',
      ['Less', 'V', 3],
      'M',
      ['Less', 'M', 2],
      0,
      'True',
      5,
    ]);
    // The masks have different ranks, so the rank of the result is not
    // known statically.
    expect(e.type.toString()).toBe('list<integer | list<any>>');
    const v = e.evaluate();
    expect(v.toString()).toBe('[[1,2],[5,5]]');
    expect(isSubtype(v.type.type, e.type.type)).toBe(true);
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
      [
        ['If', ['Less', 'B', 0], ['Negate', 'B'], 'B'],
        ['List', ['List', 1, -2], ['List', -3, 4]],
        '[[1,2],[3,4]]',
      ],
      [
        ['If', ['Less', 'B', 0], 0, 'B'],
        ['List', ['List', 1, -2], ['List', -3, 4]],
        '[[1,0],[0,4]]',
      ],
      [['Which', ['Less', 'B', 0], 0, 'True', 'B'], ['List', 1, -2], '[1,0]'],
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

  test('a mask of lower rank than the arm gives a value that is not a tensor', () => {
    // With `C := [-1, 1]` and `B := [[1, 2], [3, 4]]`, the selection takes
    // the first row of `B` whole and lifts `0`: `[[1, 2], 0]`. The type read
    // before the assignment holds this value through its list arm.
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
    expect(v.toString()).toBe('[[1,2],0]');
    expect(isSubtype(v.type.type, type.type)).toBe(true);
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
      value: '[[1,0],[0,1]]',
      holds: true,
    });
    expect(
      typedThenEvaluated(
        { u: 'any', M: 'matrix<integer^(2x2)>' },
        ['Which', ['Less', 'M', 0], 5, 'u', 1, 'True', 0],
        { M: ['List', ['List', 1, 2], ['List', 3, 4]], u: MASK }
      )
    ).toEqual({
      type: 'list<integer | list<any>>',
      value: '[[1,0],[0,1]]',
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
    // The string arm of the scalar clause makes the no-match cell `Missing`,
    // in the value as in the type, although only the numeric arm after it
    // is selected. Before, the evaluation read only the arms from the mask
    // onward and answered `[1, NaN]`, which the type does not hold.
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
      type: 'list<integer | missing | string> | string',
      value: '[1,"Missing"]',
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
    const declarations = { P: 'list<boolean^(2x2)> | list<boolean^3>' };
    expect(
      typedThenEvaluated(declarations, ['If', 'P', 1, 0], { P: MASK })
    ).toEqual({
      type: 'list<integer | list<any>>',
      value: '[[1,0],[0,1]]',
      holds: true,
    });
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
