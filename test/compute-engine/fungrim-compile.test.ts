// Unit tests for the offline Fungrim rule compiler
// (FUNGRIM-PLAN-5-LOADER.md §2.2–§2.5, milestone M1).
//
// Fixture-corpus tests: guard-shape mappings, fail-closed guard exclusion,
// the three orientation cases (cheaper-RHS, cheaper-LHS-with-var-subset,
// tie → 'expand' toward the special-function-headed side), undirected dedup,
// wildcard-loss rejection and no-fire rejection — plus a sanity check of the
// checked-in artifact.

import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  compileGuards,
  compileEntries,
  wildcardize,
  isSliceEntry,
} from '../../scripts/fungrim/compile-rules';
import type {
  GuardSpec,
  CompileResult,
  CurationOverrides,
} from '../../scripts/fungrim/compile-rules';
import type { Entry, Declarations } from '../../scripts/fungrim/load';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const EMPTY_DECLS: Declarations = {
  generator: 'fixture',
  declarations: {},
  existing: {},
};

/** Shells used by fixtures (uninterpreted special-function heads). */
const FIXTURE_DECLS: Declarations = {
  generator: 'fixture',
  declarations: {
    FooF: { signature: '(complex) -> complex' },
    BarG: { signature: '(complex) -> complex' },
  },
  existing: {},
};

function entry(
  id: string,
  formula: unknown,
  variables: string[] = [],
  assumptions: unknown = null,
  cls: 'identity' | 'specific-value' = 'identity'
): Entry {
  return {
    id,
    formula,
    variables,
    assumptions,
    class: cls,
    subclass: null,
    heads: [],
    guardLevel: assumptions === null ? 'none' : 'real-simple',
    flavor: null,
    references: null,
    topics: ['fixture'],
    topic: 'fixture',
  } as Entry;
}

function guards(assumptions: unknown, variables: string[]): GuardSpec[] {
  const r = compileGuards(assumptions, variables);
  if ('error' in r) throw new Error(`unexpected guard error: ${r.error}`);
  return r.guards;
}

function guardError(assumptions: unknown, variables: string[]): string {
  const r = compileGuards(assumptions, variables);
  if (!('error' in r)) throw new Error('expected a guard-compilation error');
  return r.error;
}

// ---------------------------------------------------------------------------
// wildcardization
// ---------------------------------------------------------------------------

describe('wildcardize', () => {
  it('renames entry variables to wildcards in both symbol and nested positions', () => {
    expect(
      wildcardize(['Gamma', ['Add', 'z', 1]], ['z'])
    ).toEqual(['Gamma', ['Add', '_z', 1]]);
  });

  it('leaves non-variable symbols, numbers and other variables intact', () => {
    expect(
      wildcardize(['Multiply', 'Pi', 'z', 'w', 2], ['z'])
    ).toEqual(['Multiply', 'Pi', '_z', 'w', 2]);
  });
});

// ---------------------------------------------------------------------------
// Guard-shape mappings (§2.2 table)
// ---------------------------------------------------------------------------

describe('compileGuards: mapping table', () => {
  it('Element(v, Integers) → type integer', () => {
    expect(guards(['Element', 'n', 'Integers'], ['n'])).toEqual([
      { k: 'type', wc: '_n', t: 'integer' },
    ]);
  });

  it('NonNegativeIntegers / PositiveIntegers → type integer + cmp vs 0', () => {
    expect(guards(['Element', 'n', 'NonNegativeIntegers'], ['n'])).toEqual([
      { k: 'type', wc: '_n', t: 'integer' },
      { k: 'cmp', wc: '_n', op: 'ge', bound: 0 },
    ]);
    expect(guards(['Element', 'n', 'PositiveIntegers'], ['n'])).toEqual([
      { k: 'type', wc: '_n', t: 'integer' },
      { k: 'cmp', wc: '_n', op: 'gt', bound: 0 },
    ]);
  });

  it('RealNumbers → type real; RationalNumbers → type rational', () => {
    expect(guards(['Element', 'x', 'RealNumbers'], ['x'])).toEqual([
      { k: 'type', wc: '_x', t: 'real' },
    ]);
    expect(guards(['Element', 'q', 'RationalNumbers'], ['q'])).toEqual([
      { k: 'type', wc: '_q', t: 'rational' },
    ]);
  });

  it('Interval with Open markers → type real + strict cmp; infinite bounds skipped', () => {
    expect(
      guards(
        ['Element', 'x', ['Interval', ['Open', 0], ['Open', 'PositiveInfinity']]],
        ['x']
      )
    ).toEqual([
      { k: 'type', wc: '_x', t: 'real' },
      { k: 'cmp', wc: '_x', op: 'gt', bound: 0 },
    ]);
    expect(
      guards(['Element', 'x', ['Interval', -1, 'Pi']], ['x'])
    ).toEqual([
      { k: 'type', wc: '_x', t: 'real' },
      { k: 'cmp', wc: '_x', op: 'ge', bound: -1 },
      { k: 'cmp', wc: '_x', op: 'le', bound: 'Pi' },
    ]);
  });

  it('Interval bounds referencing other entry variables are wildcardized', () => {
    expect(
      guards(
        [
          'And',
          ['Element', 'x', ['Interval', ['Open', ['Negate', 'y']], ['Open', 'y']]],
          ['Element', 'y', 'RealNumbers'],
        ],
        ['x', 'y']
      )
    ).toEqual([
      { k: 'type', wc: '_x', t: 'real' },
      { k: 'cmp', wc: '_x', op: 'gt', bound: ['Negate', '_y'] },
      { k: 'cmp', wc: '_x', op: 'lt', bound: '_y' },
      { k: 'type', wc: '_y', t: 'real' },
    ]);
  });

  it('Range → type integer + inclusive bounds', () => {
    expect(
      guards(['Element', 'k', ['Range', 1, 'n']], ['k', 'n'])
    ).toEqual([
      { k: 'type', wc: '_k', t: 'integer' },
      { k: 'cmp', wc: '_k', op: 'ge', bound: 1 },
      { k: 'cmp', wc: '_k', op: 'le', bound: '_n' },
    ]);
  });

  it('SetMinus(S, Set(…)) → recurse on S + one ne per excluded element', () => {
    expect(
      guards(['Element', 'y', ['SetMinus', 'RealNumbers', ['Set', 0]]], ['y'])
    ).toEqual([
      { k: 'type', wc: '_y', t: 'real' },
      { k: 'ne', lhs: '_y', rhs: 0 },
    ]);
  });

  it('NotEqual → ne', () => {
    expect(guards(['NotEqual', 'a', 0], ['a'])).toEqual([
      { k: 'ne', lhs: '_a', rhs: 0 },
    ]);
  });

  it('inequalities over a bare variable → cmp (flipped when the variable is on the right)', () => {
    expect(guards(['GreaterEqual', 'y', 0], ['y'])).toEqual([
      { k: 'cmp', wc: '_y', op: 'ge', bound: 0 },
    ]);
    expect(guards(['Less', 0, 'x'], ['x'])).toEqual([
      { k: 'cmp', wc: '_x', op: 'gt', bound: 0 },
    ]);
  });

  it('Equal(…) → eval fallback (pre-boxed predicate, fires only on literal True)', () => {
    expect(guards(['Equal', ['GCD', 'r', 's'], 1], ['r', 's'])).toEqual([
      { k: 'eval', pred: ['Equal', ['GCD', '_r', '_s'], 1] },
    ]);
  });

  it('Element(p, Primes) → type integer + IsPrime eval', () => {
    expect(guards(['Element', 'p', 'Primes'], ['p'])).toEqual([
      { k: 'type', wc: '_p', t: 'integer' },
      { k: 'eval', pred: ['IsPrime', '_p'] },
    ]);
  });

  it('Divides(d, a) → eval Mod(a, d) = 0', () => {
    expect(guards(['Divides', 'd', 'a'], ['a', 'd'])).toEqual([
      { k: 'eval', pred: ['Equal', ['Mod', '_a', '_d'], 0] },
    ]);
  });

  it('flattens nested And conjunctions', () => {
    expect(
      guards(
        ['And', ['Element', 'a', 'Integers'], ['And', ['Element', 'b', 'Integers']]],
        ['a', 'b']
      )
    ).toEqual([
      { k: 'type', wc: '_a', t: 'integer' },
      { k: 'type', wc: '_b', t: 'integer' },
    ]);
  });

  it('null assumptions → no guards', () => {
    expect(guards(null, [])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Fail-closed guard compilation
// ---------------------------------------------------------------------------

describe('compileGuards: fail-closed', () => {
  it('rejects NotElement, Not and Or conjuncts', () => {
    expect(guardError(['NotElement', 'x', 'Integers'], ['x'])).toMatch(
      /NotElement/
    );
    expect(guardError(['Not', ['Equal', 'x', 0]], ['x'])).toMatch(/Not/);
    expect(
      guardError(['Or', ['Element', 'x', 'Integers'], ['Equal', 'x', 0]], ['x'])
    ).toMatch(/Or/);
  });

  it('rejects unsupported domains', () => {
    expect(guardError(['Element', 'z', 'ComplexNumbers'], ['z'])).toMatch(
      /unsupported domain/
    );
  });

  it('excludes the whole entry with reason guard-uncompilable', () => {
    const result = compileEntries(
      [
        entry(
          'aaaa01',
          ['Equal', ['Gamma', 'x'], ['Gamma', 'x']],
          ['x'],
          ['NotElement', 'x', 'Integers']
        ),
      ],
      EMPTY_DECLS
    );
    expect(result.rules).toHaveLength(0);
    expect(result.skips).toEqual([
      {
        id: 'aaaa01',
        reason: 'guard-uncompilable',
        detail: 'unsupported conjunct "NotElement"',
      },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Orientation policy (§2.3), dedup (§2.5), self-test rejections (§2.2)
// ---------------------------------------------------------------------------

describe('compileEntries: orientation, dedup and self-test', () => {
  // One compile pass over all fixtures (a scratch ComputeEngine per call
  // is expensive); per-case assertions below.
  let result: CompileResult;

  const FIXTURES: Entry[] = [
    // (a) cheaper RHS → orient LHS→RHS, purpose 'simplify'
    entry(
      'fix001',
      [
        'Equal',
        ['Add', ['Arctan', 'x'], ['Arctan', ['Divide', 1, 'x']]],
        ['Divide', 'Pi', 2],
      ],
      ['x'],
      ['Element', 'x', ['Interval', ['Open', 0], ['Open', 'PositiveInfinity']]]
    ),
    // (b) cheaper LHS with vars(LHS) ⊆ vars(RHS) → orient RHS→LHS, 'simplify'
    entry(
      'fix002',
      [
        'Equal',
        ['Factorial', 'n'],
        ['Multiply', 'n', ['Factorial', ['Subtract', 'n', 1]]],
      ],
      ['n'],
      ['Element', 'n', 'PositiveIntegers']
    ),
    // (c) cost tie, exactly one special-function-headed side → match on the
    //     special side, purpose 'expand'
    entry(
      'fix003',
      ['Equal', ['FooF', ['Add', 'x', 1]], ['Add', ['FooF', 'x'], 1]],
      ['x']
    ),
    // (c') cost tie, both sides special-headed → corpus orientation, 'expand'
    entry(
      'fix004',
      ['Equal', ['GCD', 'a', 'b'], ['GCD', 'b', 'a']],
      ['a', 'b'],
      ['And', ['Element', 'a', 'Integers'], ['Element', 'b', 'Integers']]
    ),
    // (d) undirected duplicate pair (with renamed variables): one rule only
    entry('fix005', ['Equal', ['FooF', 'x'], ['BarG', ['BarG', 'x']]], ['x']),
    entry('fix006', ['Equal', ['BarG', ['BarG', 'y']], ['FooF', 'y']], ['y']),
    // (e) canonicalizing the match loses the wildcard (x/x → 1)
    entry('fix007', ['Equal', ['Divide', 'x', 'x'], 1], ['x']),
    // (f) no-fire: Ln(1) canonicalizes to 0, so the rule can never rewrite
    //     anything (CE's canonical form already covers it)
    entry('fix008', ['Equal', ['Ln', 1], 0], [], null, 'specific-value'),
    // (g) Q3: symbol-LHS specific value is excluded, no recognition rule
    entry(
      'fix009',
      ['Equal', 'GoldenRatio', ['Divide', ['Add', 1, ['Sqrt', 5]], 2]],
      [],
      null,
      'specific-value'
    ),
  ];

  beforeAll(() => {
    result = compileEntries(FIXTURES, FIXTURE_DECLS);
  });

  const ruleOf = (id: string) => result.rules.find((r) => r.id === `fungrim:${id}`);
  const skipOf = (id: string) => result.skips.find((s) => s.id === id);

  it('orients toward the cheaper RHS as a simplify rule', () => {
    const r = ruleOf('fix001')!;
    expect(r).toBeDefined();
    expect(r.purpose).toBe('simplify');
    // match is the (canonicalized) LHS, replace the RHS
    expect((r.match as unknown[])[0]).toBe('Add');
    expect(JSON.stringify(r.replace)).toContain('Pi');
  });

  it('orients toward a cheaper LHS (reversed) when the wildcard subset allows it', () => {
    const r = ruleOf('fix002')!;
    expect(r).toBeDefined();
    expect(r.purpose).toBe('simplify');
    // reversed: match is the n·(n−1)! side, replace is Factorial(n)
    expect((r.match as unknown[])[0]).toBe('Multiply');
    expect(r.replace).toEqual(['Factorial', '_n']);
  });

  it('exiles cost ties to expand, matching on the special-function-headed side', () => {
    const r = ruleOf('fix003')!;
    expect(r).toBeDefined();
    expect(r.purpose).toBe('expand');
    expect((r.match as unknown[])[0]).toBe('FooF');
    expect((r.replace as unknown[])[0]).toBe('Add');
  });

  it('keeps the corpus orientation for ties where both sides are special-headed', () => {
    const r = ruleOf('fix004')!;
    expect(r).toBeDefined();
    expect(r.purpose).toBe('expand');
    expect(r.match).toEqual(['GCD', '_a', '_b']);
    expect(r.replace).toEqual(['GCD', '_b', '_a']);
  });

  it('the machine policy never emits transform', () => {
    expect(result.rules.every((r) => r.purpose !== 'transform')).toBe(true);
  });

  it('dedups undirected duplicates: one oriented rule, the other ledgered', () => {
    expect(ruleOf('fix005')).toBeDefined();
    expect(ruleOf('fix006')).toBeUndefined();
    expect(skipOf('fix006')).toEqual({
      id: 'fix006',
      reason: 'duplicate-undirected',
      detail: 'same equality as fix005',
    });
  });

  it('rejects matches whose canonicalization loses wildcards', () => {
    expect(ruleOf('fix007')).toBeUndefined();
    expect(skipOf('fix007')?.reason).toBe('wildcard-loss');
  });

  it('rejects rules that do not fire on their seeded instantiation', () => {
    expect(ruleOf('fix008')).toBeUndefined();
    expect(skipOf('fix008')?.reason).toBe('no-fire');
  });

  it('excludes symbol-LHS specific values (Q3: lhs-not-value-form)', () => {
    expect(ruleOf('fix009')).toBeUndefined();
    expect(skipOf('fix009')?.reason).toBe('lhs-not-value-form');
  });

  it('accounts for every entry: emitted + skipped = total', () => {
    expect(result.rules.length + result.skips.length).toBe(FIXTURES.length);
  });
});

// ---------------------------------------------------------------------------
// Curation overrides
// ---------------------------------------------------------------------------

describe('compileEntries: curation overrides', () => {
  it('applies exclude, forced direction, purpose and transform allowlist', () => {
    const fixtures = [
      entry('ovr001', ['Equal', ['FooF', 'x'], ['BarG', ['BarG', 'x']]], ['x']),
      entry('ovr002', ['Equal', ['FooF', ['Add', 'x', 1]], ['Add', ['FooF', 'x'], 1]], ['x']),
      entry('ovr003', ['Equal', ['GCD', 'a', 'b'], ['GCD', 'b', 'a']], ['a', 'b']),
    ];
    const overrides: CurationOverrides = {
      overrides: {
        ovr001: { exclude: true, note: 'triage' },
        ovr002: { direction: 'rhs-lhs' },
      },
      transformAllowlist: ['ovr003'],
    };
    const result = compileEntries(fixtures, FIXTURE_DECLS, overrides);

    expect(result.skips).toContainEqual({
      id: 'ovr001',
      reason: 'curated-exclude',
      detail: 'triage',
    });

    const r2 = result.rules.find((r) => r.id === 'fungrim:ovr002')!;
    expect(r2).toBeDefined();
    expect((r2.match as unknown[])[0]).toBe('Add'); // forced reversal
    expect((r2.replace as unknown[])[0]).toBe('FooF');

    const r3 = result.rules.find((r) => r.id === 'fungrim:ovr003')!;
    expect(r3).toBeDefined();
    expect(r3.purpose).toBe('transform'); // allowlist promotion
  });
});

// ---------------------------------------------------------------------------
// Compat-signature exclusion
// ---------------------------------------------------------------------------

describe('compileEntries: compat-signature', () => {
  it('statically rejects 2-arg LambertW/Digamma (widened COMPAT signatures)', () => {
    const result = compileEntries(
      [
        entry(
          'cmp001',
          ['Equal', ['LambertW', ['Multiply', 'x', ['Exp', 'x']], -1], 'x'],
          ['x'],
          ['Element', 'x', 'RealNumbers']
        ),
      ],
      EMPTY_DECLS
    );
    expect(result.rules).toHaveLength(0);
    expect(result.skips[0]).toMatchObject({
      id: 'cmp001',
      reason: 'compat-signature',
    });
  });
});

// ---------------------------------------------------------------------------
// Checked-in artifact sanity
// ---------------------------------------------------------------------------

describe('fungrim-core-data.json artifact', () => {
  const artifactPath = path.resolve(
    __dirname,
    '../../src/compute-engine/fungrim/fungrim-core-data.json'
  );

  let artifact: {
    manifest: {
      counts: { rules: number };
      ledger: Record<string, number>;
      slice: { entries: number };
    };
    declarations: Record<string, { signature: string }>;
    rules: {
      id: string;
      match: unknown;
      replace: unknown;
      guards: GuardSpec[];
      purpose: string;
      target: string;
      class: string;
      heads: string[];
      topics: string[];
    }[];
  };

  beforeAll(() => {
    artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  });

  it('contains at least 550 rules (M1 acceptance floor)', () => {
    expect(artifact.rules.length).toBeGreaterThanOrEqual(550);
    expect(artifact.manifest.counts.rules).toBe(artifact.rules.length);
  });

  it('accounts for every slice entry: rules + ledgered skips = slice', () => {
    const skipped = Object.values(artifact.manifest.ledger).reduce(
      (a, b) => a + b,
      0
    );
    expect(artifact.rules.length + skipped).toBe(artifact.manifest.slice.entries);
  });

  it('ledgers skips only under the enumerated reasons', () => {
    const reasons = new Set([
      'not-equation',
      'lhs-not-value-form',
      'curated-exclude',
      'compat-signature',
      'guard-uncompilable',
      'unorientable',
      'duplicate-undirected',
      'box-error',
      'wildcard-loss',
      'no-fire',
    ]);
    for (const reason of Object.keys(artifact.manifest.ledger))
      expect(reasons.has(reason)).toBe(true);
  });

  it('rules are well-formed, sorted and deduplicated', () => {
    const ids = artifact.rules.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(ids);
    for (const r of artifact.rules) {
      expect(r.id).toMatch(/^fungrim:[0-9a-f]{6}$/);
      expect(Array.isArray(r.guards)).toBe(true);
      expect(['simplify', 'transform', 'expand']).toContain(r.purpose);
      expect(['simplify', 'solve', 'harmonization']).toContain(r.target);
      expect(['specific-value', 'identity']).toContain(r.class);
    }
  });

  it('no machine-emitted transform rules (override-only)', () => {
    // The shipped transform allowlist is empty, so no rule may carry it.
    expect(artifact.rules.every((r) => r.purpose !== 'transform')).toBe(true);
  });

  it('declarations table is pruned to heads referenced by emitted rules', () => {
    const referenced = new Set<string>();
    const collect = (x: unknown): void => {
      if (typeof x === 'string') referenced.add(x);
      else if (Array.isArray(x)) x.forEach(collect);
    };
    for (const r of artifact.rules) {
      collect(r.match);
      collect(r.replace);
      for (const g of r.guards) collect(g);
    }
    for (const name of Object.keys(artifact.declarations))
      expect(referenced.has(name)).toBe(true);
  });

  it('artifact slice matches the corpus Phase-1 slice definition', () => {
    // isSliceEntry is the single source of truth for slice membership
    expect(
      isSliceEntry(entry('e00001', ['Equal', 1, 1], [], null, 'identity'))
    ).toBe(true);
    const complexEntry = {
      ...entry('e00002', ['Equal', 1, 1]),
      guardLevel: 'complex-domain',
    } as Entry;
    expect(isSliceEntry(complexEntry)).toBe(false);
  });
});
