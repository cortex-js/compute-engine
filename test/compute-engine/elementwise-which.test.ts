import { ComputeEngine } from '../../src/compute-engine';
import { parseType } from '../../src/common/type/parse';

/**
 * Element-wise `Which`/`If` over list-valued conditions.
 *
 * Spec: `docs/plans/2026-07-27-elementwise-which-design.md` (R1–R4 + R4′,
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
      .box([
        'Which',
        'False',
        99,
        ['List', 'True', 'False'],
        1,
        'True',
        0,
      ])
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
    const r = ce
      .box(['Which', ['Equal', 'n', 3], arm, 'True', 0])
      .evaluate();
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
    const unknown = ['Map', ['Function', ['Greater', '_', 2], '_'], ['Range', 1, 'm']];
    const r = ce
      .box(['Which', ['List', 'False', 'False'], 1, unknown, 2, 'True', 0])
      .evaluate();
    expect(r.operator).toBe('Which');
  });

  test('an unknown-length selected arm leaves the expression inert', () => {
    const ce = engine();
    ce.declare('m', 'integer');
    const unknown = ['Map', ['Function', ['Greater', '_', 2], '_'], ['Range', 1, 'm']];
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

describe('R4 — the no-match cell is NaN, uniformly', () => {
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

  test('the marker is uniform, never type-directed (string arms too)', () => {
    const ce = engine();
    const r = ce
      .box(['Which', ['List', 'True', 'False'], { str: 'hot' }])
      .evaluate();
    expect(cells(r)).toEqual(['"hot"', 'NaN']);
  });

  test('If without an else branch yields NaN, not Nothing (positions preserved)', () => {
    const ce = engine();
    ce.assign('n', ce.box(['List', 3, 2, 1, 3]));
    const r = ce.box(['If', ['Equal', 'n', 3], 1]).evaluate();
    expect(cells(r)).toEqual(['1', 'NaN', 'NaN', '1']);
  });
});

describe("R4′ — a Missing condition cell is an error cell at that position", () => {
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
    const r = ce
      .box(['Which', ['List', 'Missing'], 1, 'True', 99])
      .evaluate();
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

  test('a collection of non-booleans is not reinterpreted (typo path unchanged)', () => {
    const ce = engine();
    expect(() =>
      ce.box(['Which', ['List', 1, 2], 1, 'True', 0]).evaluate()
    ).toThrow(/must evaluate to/);
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
    expect(r.symbol).toBe('Undefined');
  });

  test('scalar If without an else branch is Nothing', () => {
    const ce = engine();
    const r = ce.box(['If', 'False', 1]).evaluate();
    expect(r.symbol).toBe('Nothing');
  });

  test('scalar Missing condition is the catchable error', () => {
    const ce = engine();
    expect(ce.box(['If', 'Missing', 1, 2]).evaluate().operator).toBe('Error');
    expect(
      ce.box(['Which', 'Missing', 1, 'True', 2]).evaluate().operator
    ).toBe('Error');
  });

  test('the scalar typo path still throws', () => {
    const ce = engine();
    expect(() => ce.box(['If', 3, 1, 2]).evaluate()).toThrow(
      /must evaluate to/
    );
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
    expect(t.matches(parseType('list<finite_integer^2>'))).toBe(true);
  });

  test('a declared indexed_collection<boolean> condition types list<T>', () => {
    const ce = engine();
    ce.declare('b', 'indexed_collection<boolean>');
    const t = ce.box(['Which', 'b', 1, 'True', 0]).type;
    expect(t.matches(parseType('list<finite_integer>'))).toBe(true);
  });

  test('a derived condition (a broadcast comparison) types list<T^n>', () => {
    const ce = engine();
    ce.assign('n', ce.box(['List', 3, 2, 1, 3]));
    const e = ce.box(['Which', ['Equal', 'n', 3], 1, 'True', 0]);
    expect(e.type.matches(parseType('list<finite_integer^4>'))).toBe(true);
    expect(e.evaluate().type.matches(parseType('list<number>'))).toBe(true);
  });

  test('a tuple-typed condition does NOT flip the static shape (tuple-atomic)', () => {
    // `tuple` is a subtype of `indexed_collection`, but runtime lifts tuples
    // whole and never activates the elementwise path — the type must agree.
    const ce = engine();
    const e = ce.box(['Which', ['Tuple', 'True', 'False'], 1, 'True', 0]);
    expect(e.type.matches(parseType('finite_integer'))).toBe(true);
    expect(e.type.matches(parseType('list<finite_integer>'))).toBe(false);
    expect(e.evaluate().operator).toBe('Which'); // inert at runtime
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
    expect(t.matches(parseType('list<finite_integer^2>'))).toBe(true);
  });

  test('If with a list condition types a list of the branch types', () => {
    const ce = engine();
    const t = ce.box(['If', ['List', 'True', 'False'], 1, 0]).type;
    expect(t.matches(parseType('list<finite_integer^2>'))).toBe(true);
  });

  test('NO default clause: the element type joins in the NaN marker', () => {
    const ce = engine();
    // `finite_*` types EXCLUDE NaN (non-finite typing convention), and
    // without a default clause an unmatched position IS NaN — so the declared
    // type must admit it, or a consumer dispatching on `.type.matches()` is
    // promised a finite integer and handed a NaN.
    const e = ce.box(['Which', ['List', 'True', 'False'], 5]);
    expect(e.type.matches(parseType('list<finite_integer^2>'))).toBe(false);
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
    // exact `finite_integer` join survives.
    expect(e.type.matches(parseType('list<finite_integer^2>'))).toBe(true);
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
    const e = ce.box(['Which', ['List', 'True', 'False'], { str: 'hot' }]);
    expect(e.type.toString()).toBe('list<number | string>');
    expect(e.type.matches(parseType('list<number | string^2>'))).toBe(false);

    const v = e.evaluate();
    expect(cells(v)).toEqual(['"hot"', 'NaN']);
    expect(v.type.toString()).toBe('list<number | string>');
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
    expect(noElse.type.matches(parseType('list<finite_integer^2>'))).toBe(
      false
    );
    expect(noElse.type.matches(parseType('list<number^2>'))).toBe(true);
    expect(noElse.evaluate().type.matches(noElse.type)).toBe(true);

    const withElse = ce.box(['If', ['List', 'True', 'False'], 1, 0]);
    expect(withElse.type.matches(parseType('list<finite_integer^2>'))).toBe(
      true
    );
  });

  test('the walk stops at the first literal True: later conditions are unreachable', () => {
    const ce = engine();
    // `Which(True, 1, …)` evaluates to the scalar `1` — the second condition
    // is never even evaluated, so it must not type the result element-wise.
    const e = ce.box(['Which', 'True', 1, ['List', 'True', 'False'], 2]);
    expect(e.evaluate().re).toBe(1);
    expect(e.type.toString()).toBe('finite_integer');
  });

  test('a condition with Missing cells types element-wise, as it evaluates', () => {
    const ce = engine();
    // Runtime admits `True`/`False`/`Missing` cells (R4′), so the static gate
    // must too: `["True", "Missing"]` types `list<boolean | missing>`.
    const e = ce.box(['Which', ['List', 'True', 'Missing'], 1, 'True', 0]);
    expect(e.evaluate().operator).toBe('List');
    expect(e.type.matches(parseType('list<finite_integer>'))).toBe(true);
  });

  test('a condition typing plain unknown does NOT flip the result type', () => {
    const ce = engine();
    ce.declare('u', 'unknown');
    expect(ce.box(['Which', 'u', 1, 'True', 0]).type.toString()).toBe(
      'finite_integer'
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
    expect(
      e.type.matches(parseType('list<tuple<finite_integer, finite_integer>^2>'))
    ).toBe(true);
    expect(v.type.matches(e.type)).toBe(true);
  });

  test('a scalar condition keeps the existing scalar typing', () => {
    const ce = engine();
    ce.declare('x', 'number');
    expect(
      ce.box(['Which', ['Equal', 'x', 4], 1, 'True', 0]).type.toString()
    ).toBe('finite_integer');
    expect(ce.box(['If', ['Equal', 'x', 4], 1, 0]).type.toString()).toBe(
      'finite_integer'
    );
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
    // eslint-disable-next-line no-console
    console.log(
      `[elementwise-which] witness 3×900: ${elapsed.toFixed(
        2
      )} ms = ${canaryUnits.toFixed(0)} canary units (box canary ${canary.toFixed(
        4
      )} ms/iter)`
    );
    expect(canaryUnits).toBeLessThan(5000);
  });
});
