import { ComputeEngine } from '../../../src/compute-engine';

import '../../utils'; // For snapshot serializers

// P4 of FUNGRIM-PLAN-3-ASSUMPTIONS.md: the Fungrim guard acceptance suite
// (design §11, "Secondary validation").
//
// Every guard below is the verbatim `assumptions` MathJSON of a real
// `guardLevel: complex-domain` entry from `data/fungrim/corpus/*.json`
// (entry ids in the table). For each entry the suite asserts:
//
//   (i)  every top-level And-conjunct is assumable —
//        `ce.assume()` returns `'ok'` or `'tautology'`;
//   (ii) the full guard discharges — `ce.verify()` returns `true` under
//        the assumptions;
//   (iii) negative control — without the assumptions, `ce.verify()` is
//        `undefined` (indeterminate), never `false`.
//
// Entries whose guards do NOT discharge are kept (marked
// `dischargeable: false`) and pinned to their current behavior, with the
// precise reason documented — the design §7.4 honesty list, plus one
// sets.ts typing gap discovered in P4 (see `log/0ba9b2`).
//
// Notes on the corpus encoding:
// - `HH` (upper half-plane) is NOT desugared by the translator: entries
//   carry `["Element", "tau", "HH"]` verbatim, with `HH` declared as a
//   shell of type `set<complex>` in `data/fungrim/declarations.json`.
//   Discharge therefore goes through the stored-membership-fact path
//   (design §5.1c, exact `isSame` match), not through `Im(tau) > 0`.
// - Conjuncts containing a part extractor (`Real`, `Imaginary`, `Abs`,
//   `Argument`) are boxed with `{ canonical: false }`: canonical boxing
//   would auto-declare the symbol and can collapse the part term (e.g.
//   `Real(s)` → `s` for an inferred-real `s`), destroying the §2 subject
//   shape. This mirrors `assume-extended.test.ts`/`query-hooks.test.ts`.

const PART_HEADS = ['Real', 'Imaginary', 'Abs', 'Argument'];
function hasPartHead(x: unknown): boolean {
  return (
    Array.isArray(x) &&
    (PART_HEADS.includes(x[0] as string) || x.some(hasPartHead))
  );
}

/** Shells used by the guards below (subset of data/fungrim/declarations.json,
 * with `collection<complex>` setified to `set<complex>` as in
 * scripts/fungrim/load.ts). */
function makeEngine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('HH', 'set<complex>');
  ce.declare('EisensteinE', '(integer, complex) -> complex');
  return ce;
}

function conjunctsOf(guard: unknown): unknown[] {
  if (Array.isArray(guard) && guard[0] === 'And') return guard.slice(1);
  return [guard];
}

function assumeGuard(ce: ComputeEngine, guard: unknown): string[] {
  return conjunctsOf(guard).map((c) =>
    ce.assume(ce.box(c as any, { canonical: !hasPartHead(c) }))
  );
}

type GuardCase = {
  /** `topic/entry-id` in data/fungrim/corpus/ */
  entry: string;
  guard: unknown;
  /** Expected per-conjunct assume() results */
  assume: string[];
  /** Whether verify(guard) === true under the assumptions */
  dischargeable: boolean;
  /** For non-dischargeable entries: why (design §7.4 / known gaps) */
  reason?: string;
};

const GUARDS: GuardCase[] = [
  //
  // ── Dischargeable: the complex-domain bread and butter ──────────────────
  //
  {
    // Theta-function guard: z ∈ ℂ ∧ tau ∈ HH (verbatim inert-set membership)
    entry: 'jacobi_theta/0096a8',
    guard: [
      'And',
      ['Element', 'z', 'ComplexNumbers'],
      ['Element', 'tau', 'HH'],
    ],
    assume: ['ok', 'ok'],
    dischargeable: true,
  },
  {
    // Beta-integral-style guard: Re(a) > 0 ∧ Re(b) > 0 ∧ x ∈ [0, 1] (§11.8)
    entry: 'jacobi_theta/026e44',
    guard: [
      'And',
      ['Element', 'a', 'ComplexNumbers'],
      ['Greater', ['Real', 'a'], 0],
      ['Element', 'b', 'ComplexNumbers'],
      ['Greater', ['Real', 'b'], 0],
      ['Element', 'x', ['Interval', 0, 1]],
    ],
    assume: ['ok', 'ok', 'ok', 'ok', 'ok'],
    dischargeable: true,
  },
  {
    entry: 'dedekind_eta/02d14f',
    guard: ['Element', 'tau', 'HH'],
    assume: ['ok'],
    dischargeable: true,
  },
  {
    entry: 'modular_j/42a909',
    guard: ['Element', 'tau', 'HH'],
    assume: ['ok'],
    dischargeable: true,
  },
  {
    entry: 'gamma/06260c',
    guard: ['Element', 'z', 'ComplexNumbers'],
    assume: ['ok'],
    dischargeable: true,
  },
  {
    entry: 'atan/072166',
    guard: ['Element', 'z', 'ComplexNumbers'],
    assume: ['ok'],
    dischargeable: true,
  },
  {
    // Log guard: ℂ ∖ {0} (§11.7 family, encoded as SetMinus)
    entry: 'log/099b19',
    guard: ['Element', 'z', ['SetMinus', 'ComplexNumbers', ['Set', 0]]],
    assume: ['ok'],
    dischargeable: true,
  },
  {
    // Sin(Arctan(z)) identity guard: ℂ ∖ {±i} (§11.5, entry d4b0b6 family)
    entry: 'atan/0b829e',
    guard: [
      'Element',
      'z',
      [
        'SetMinus',
        'ComplexNumbers',
        ['Set', ['Negate', 'ImaginaryUnit'], 'ImaginaryUnit'],
      ],
    ],
    assume: ['ok'],
    dischargeable: true,
  },
  {
    // Zeta Dirichlet-series guard: Re(s) > 1 (§11.3)
    entry: 'hurwitz_zeta/0bd6aa',
    guard: [
      'And',
      ['Element', 's', 'ComplexNumbers'],
      ['Greater', ['Real', 's'], 1],
      ['Element', 'N_var', 'PositiveIntegers'],
    ],
    assume: ['ok', 'ok', 'ok'],
    dischargeable: true,
  },
  {
    // Gamma recurrence-style guard: ℂ ∖ Range(-∞, 1) — an infinite,
    // non-finite exclusion stored as a NotElement fact (§11.6 family)
    entry: 'gamma/14af98',
    guard: [
      'Element',
      'z',
      ['SetMinus', 'ComplexNumbers', ['Range', 'NegativeInfinity', 1]],
    ],
    assume: ['ok'],
    dischargeable: true,
  },
  {
    // Non-integer part bound: Re(a) > 1/2, plus s ≠ 1
    entry: 'hurwitz_zeta/1699a9',
    guard: [
      'And',
      ['Element', 's', 'ComplexNumbers'],
      ['NotEqual', 's', 1],
      ['Element', 'a', 'ComplexNumbers'],
      ['Greater', ['Real', 'a'], ['Divide', 1, 2]],
    ],
    assume: ['ok', 'ok', 'ok', 'ok'],
    dischargeable: true,
  },
  {
    // Nome/q-series convergence guard: |q| < 1 (§11.4)
    entry: 'dedekind_eta/2e7fdb',
    guard: [
      'And',
      ['Element', 'q', 'ComplexNumbers'],
      ['Less', ['Abs', 'q'], 1],
    ],
    assume: ['ok', 'ok'],
    dischargeable: true,
  },
  {
    // Multi-symbol guard with a disequality: x, y, z ∈ ℂ ∧ z ≠ 0
    entry: 'carlson_elliptic/31a3ba',
    guard: [
      'And',
      ['Element', 'x', 'ComplexNumbers'],
      ['Element', 'y', 'ComplexNumbers'],
      ['Element', 'z', 'ComplexNumbers'],
      ['NotEqual', 'z', 0],
    ],
    assume: ['ok', 'ok', 'ok', 'ok'],
    dischargeable: true,
  },
  {
    // Branch-cut exclusion as a direct NotElement conjunct — discharges
    // by exact stored-fact match (contrast with log/0ba9b2 below where the
    // same interval is wrapped in a SetMinus)
    entry: 'gamma/37a95a',
    guard: [
      'And',
      ['Element', 'z', 'ComplexNumbers'],
      [
        'NotElement',
        'z',
        ['Interval', ['Open', 'NegativeInfinity'], 0],
      ],
      ['Element', 'n', 'PositiveIntegers'],
    ],
    assume: ['ok', 'ok', 'ok'],
    dischargeable: true,
  },
  {
    entry: 'hurwitz_zeta/3ba544',
    guard: [
      'And',
      ['Element', 's', 'ComplexNumbers'],
      ['NotEqual', 's', 1],
      ['Element', 'a', 'ComplexNumbers'],
      ['Greater', ['Real', 'a'], 0],
    ],
    assume: ['ok', 'ok', 'ok', 'ok'],
    dischargeable: true,
  },
  {
    // Gamma reflection-style guard: Re(z) > 0
    entry: 'gamma/4e4e0f',
    guard: [
      'And',
      ['Element', 'z', 'ComplexNumbers'],
      ['Greater', ['Real', 'z'], 0],
    ],
    assume: ['ok', 'ok'],
    dischargeable: true,
  },

  //
  // ── Not dischargeable: the §7.4 residue, pinned with reasons ────────────
  //
  {
    // ℂ ∖ Interval(Open(-∞), 0): the conjunct IS assumable (a NotElement
    // fact is stored, see gamma/37a95a), but the *query-side* SetMinus
    // decomposition cannot process the exclusion: an `Interval` with an
    // infinite endpoint has type `unknown` and `isCollection === false`,
    // so membershipKleene's SetMinus branch falls back to treating it as
    // a scalar (notEqualKleene → undefined). sets.ts typing gap found in
    // P4, distinct from the §7.4 list.
    entry: 'log/0ba9b2',
    guard: [
      'Element',
      'z',
      [
        'SetMinus',
        'ComplexNumbers',
        ['Interval', ['Open', 'NegativeInfinity'], 0],
      ],
    ],
    assume: ['ok'],
    dischargeable: false,
    reason:
      'Interval with infinite endpoint is not typed as a collection; ' +
      'SetMinus query decomposition cannot match the stored NotElement fact',
  },
  {
    // NotElement with a *compound* lhs (z·i): stored opaque; the
    // membership fact index is keyed by bare symbol only (§7.4: parts of
    // compound expressions are stored but never decide).
    entry: 'atan/12765e',
    guard: [
      'And',
      ['Element', 'z', 'ComplexNumbers'],
      [
        'NotElement',
        ['Multiply', 'z', 'ImaginaryUnit'],
        ['Interval', 1, ['Open', 'PositiveInfinity']],
      ],
    ],
    assume: ['ok', 'ok'],
    dischargeable: false,
    reason:
      'NotElement(z*i, ...) has a compound subject; membership facts are ' +
      'keyed by bare symbols (§7.4)',
  },
  {
    // NotEqual with a compound lhs (a function application): stored
    // verbatim, but eq() cannot discharge it (§7.4).
    entry: 'modular_j/348b26',
    guard: [
      'And',
      ['Element', 'tau', 'HH'],
      ['NotEqual', ['EisensteinE', 4, 'tau'], 0],
    ],
    assume: ['ok', 'ok'],
    dischargeable: false,
    reason:
      'NotEqual(EisensteinE(4, tau), 0) has a compound subject; stored ' +
      'opaque, never decides (§7.4)',
  },
  {
    // NotEqual between a sum of two symbols and a constant: same compound-
    // subject limitation (`Re(s) > Re(t)`-class, §7.4).
    entry: 'hurwitz_zeta/40c3e2',
    guard: [
      'And',
      ['Element', 's', 'ComplexNumbers'],
      ['NotEqual', 's', 1],
      ['NotEqual', ['Add', 's', 'r'], 1],
      ['Element', 'a', 'ComplexNumbers'],
      ['Greater', ['Real', 'a'], 0],
      ['Element', 'r', 'NonNegativeIntegers'],
    ],
    assume: ['ok', 'ok', 'ok', 'ok', 'ok', 'ok'],
    dischargeable: false,
    reason: 'NotEqual(s + r, 1) has a compound subject (§7.4)',
  },
  {
    // Membership of a part extractor in an interval: Element(Im(z), ...)
    // is not Element(symbol, ...) — assumeElement case 2 finds no
    // undeclared variable (z is declared by the first conjunct) and the
    // closed evaluation is indeterminate → 'not-a-predicate' (§7.4:
    // Argument/part-range constraints store fine only as inequalities,
    // not as memberships).
    entry: 'log/4c1e1e',
    guard: [
      'And',
      ['Element', 'z', 'ComplexNumbers'],
      [
        'Element',
        ['Imaginary', 'z'],
        ['Interval', ['Open', ['Negate', 'Pi']], 'Pi'],
      ],
    ],
    assume: ['ok', 'not-a-predicate'],
    dischargeable: false,
    reason:
      'Element(Imaginary(z), Interval(...)) — membership of a part term is ' +
      'not assumable (only part *inequalities* are, §4.2)',
  },
  {
    // |z| < 2π: the bound is symbolic (2π), not a numeric literal. The
    // part-bound path stores the fact opaquely (no numeric bound in the
    // index), so the query side cannot decide it (§7 non-goal 3: no
    // numeric/interval-arithmetic discharge).
    entry: 'bernoulli_numbers/522b04',
    guard: [
      'And',
      ['Element', 'z', 'ComplexNumbers'],
      ['Less', ['Abs', 'z'], ['Multiply', 2, 'Pi']],
      ['NotEqual', 'z', 0],
    ],
    assume: ['ok', 'ok', 'ok'],
    dischargeable: false,
    reason:
      'Abs(z) < 2π has a symbolic (non-literal) bound; the fact index ' +
      'only carries numeric bounds (§7 non-goal 3)',
  },
];

describe('Fungrim complex-domain guard acceptance (design §11)', () => {
  describe.each(GUARDS.filter((g) => g.dischargeable))(
    'dischargeable: $entry',
    ({ guard, assume }) => {
      it('every conjunct is assumable', () => {
        const ce = makeEngine();
        ce.pushScope();
        expect(assumeGuard(ce, guard)).toEqual(assume);
        ce.popScope();
      });

      it('the full guard verifies to true under the assumptions', () => {
        const ce = makeEngine();
        ce.pushScope();
        assumeGuard(ce, guard);
        expect(ce.verify(ce.box(guard as any))).toBe(true);
        ce.popScope();
      });

      it('negative control: undefined (not false) without assumptions', () => {
        const ce = makeEngine();
        expect(ce.verify(ce.box(guard as any))).toBeUndefined();
      });
    }
  );

  describe.each(GUARDS.filter((g) => !g.dischargeable))(
    'NOT dischargeable: $entry ($reason)',
    ({ guard, assume }) => {
      it('assume() results are as documented', () => {
        const ce = makeEngine();
        ce.pushScope();
        expect(assumeGuard(ce, guard)).toEqual(assume);
        ce.popScope();
      });

      it('verify() stays indeterminate (undefined, never false)', () => {
        const ce = makeEngine();
        ce.pushScope();
        assumeGuard(ce, guard);
        // Pinned current behavior: not dischargeable... but sound.
        // If this starts returning `true`, the entry can be promoted to
        // the dischargeable list above.
        expect(ce.verify(ce.box(guard as any))).toBeUndefined();
        ce.popScope();
      });
    }
  );

  it('assumptions made in a pushed scope do not leak (§11.11)', () => {
    const ce = makeEngine();
    const guard = [
      'And',
      ['Element', 's', 'ComplexNumbers'],
      ['Greater', ['Real', 's'], 1],
    ];
    ce.pushScope();
    assumeGuard(ce, guard);
    expect(ce.verify(ce.box(guard as any))).toBe(true);
    ce.popScope();
    expect(ce.verify(ce.box(guard as any))).toBeUndefined();
  });
});

//
// ── ask() subject generalization (P4, design §9 "B2 generalization") ───────
//

describe('ask() inequality-bound queries over subjects', () => {
  it('answers Greater(Real(s), _val) from an assumed part bound', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.box(['Greater', ['Real', 's'], 1], { canonical: false }));
    const r = ce.ask(['Greater', ['Real', 's'], '_val']);
    expect(r.length).toBe(1);
    expect(r[0]!._val.json).toBe(1);
  });

  it('answers Greater(Imaginary(tau), _v) — the HH desugared form', () => {
    const ce = new ComputeEngine();
    ce.assume(
      ce.box(['Greater', ['Imaginary', 'tau'], 0], { canonical: false })
    );
    const r = ce.ask(['Greater', ['Imaginary', 'tau'], '_v']);
    expect(r.length).toBe(1);
    expect(r[0]!._v.json).toBe(0);
  });

  it('answers Less(Abs(q), _v) and stays empty for the opposite direction', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.box(['Less', ['Abs', 'q'], 1], { canonical: false }));
    const r = ce.ask(['Less', ['Abs', 'q'], '_v']);
    expect(r.length).toBe(1);
    expect(r[0]!._v.json).toBe(1);
    // No lower bound is known for Abs(q)
    expect(ce.ask(['Greater', ['Abs', 'q'], '_v'])).toEqual([]);
  });

  it('answers Less(Argument(z), _v) from an Argument bound', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.box(['Less', ['Argument', 'z'], 2], { canonical: false }));
    const r = ce.ask(['Less', ['Argument', 'z'], '_v']);
    expect(r.length).toBe(1);
    expect(r[0]!._v.json).toBe(2);
  });

  it('is conservative about strictness for subjects', () => {
    const ce = new ComputeEngine();
    ce.assume(
      ce.box(['GreaterEqual', ['Real', 's'], 1], { canonical: false })
    );
    // Strict query from a non-strict bound: no answer
    expect(ce.ask(['Greater', ['Real', 's'], '_v'])).toEqual([]);
    // Non-strict query: answered
    const r = ce.ask(['GreaterEqual', ['Real', 's'], '_v']);
    expect(r.length).toBe(1);
    expect(r[0]!._v.json).toBe(1);
  });

  it('does not answer for non-subject compound lhs (Real(z + w))', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.box(['Greater', ['Real', 's'], 1], { canonical: false }));
    expect(ce.ask(['Greater', ['Real', ['Add', 'z', 'w']], '_v'])).toEqual(
      []
    );
  });

  it('bare-symbol queries behave exactly as before', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.parse('x > 0'));
    const r = ce.ask(['Greater', 'x', '_k']);
    expect(r.length).toBe(1);
    expect(r[0]!._k.json).toBe(0);
  });
});
