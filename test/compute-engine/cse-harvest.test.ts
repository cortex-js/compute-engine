import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';
import {
  CSE_MAX_BINDINGS_PER_REGION,
  CSE_MAX_VERIFY_NODES_PER_BUCKET,
  CSE_MIN_SCORE,
  CSE_MIN_SIZE,
  LAZY_OPERANDS,
  candidateAt,
  childRegionAt,
  harvestCse,
  lazyOperandRegions,
} from '../../src/compute-engine/compilation/cse';
import type {
  CseCandidate,
  CseHarvest,
  CseRegion,
} from '../../src/compute-engine/compilation/cse';

const ce = new ComputeEngine();

/** `sin(6u)` — the baseline size-4 subtree of the design doc's probe. */
const SIN6U = ['Sin', ['Multiply', 6, 'u']] as any;

function box(json: any): Expression {
  return ce.box(json);
}

function reps(region: CseRegion): string[] {
  return region.candidates.map((c) => c.representative.toString());
}

function counts(region: CseRegion): number[] {
  return region.candidates.map((c) => c.occurrences.length);
}

function allReps(harvest: CseHarvest): string[] {
  return harvest.candidates.map((c) => c.representative.toString());
}

function regionsOfKind(harvest: CseHarvest, kind: string): CseRegion[] {
  return harvest.regions.filter((r) => r.kind === kind);
}

describe('CSE HARVEST — constants', () => {
  it('exports the tuned thresholds by name', () => {
    expect(CSE_MIN_SIZE).toBe(4);
    expect(CSE_MIN_SCORE).toBe(8);
    expect(CSE_MAX_BINDINGS_PER_REGION).toBe(32);
    expect(CSE_MAX_VERIFY_NODES_PER_BUCKET).toBe(10_000);
  });
});

describe('CSE HARVEST — the lazy-operand inventory', () => {
  it('covers the §5.1(b) constructs', () => {
    expect(Object.keys(LAZY_OPERANDS).sort()).toEqual([
      'And',
      'Coalesce',
      'If',
      'Match',
      'Or',
      'When',
      'Which',
    ]);
  });

  it('Which: value arms and conditions after the first', () => {
    const expr = box(['Which', ['Less', 0, 'x'], 1, 'True', 2]);
    expect(lazyOperandRegions(expr).map((s) => s.index)).toEqual([1, 2, 3]);
    expect(lazyOperandRegions(expr).every((s) => !s.inert)).toBe(true);
  });

  it('If: both arms, not the condition', () => {
    expect(
      lazyOperandRegions(box(['If', ['Less', 0, 'x'], 1, 2])).map(
        (s) => s.index
      )
    ).toEqual([1, 2]);
  });

  it('When: the value arm, not the condition', () => {
    expect(
      lazyOperandRegions(box(['When', 'x', ['Less', 0, 'x']])).map(
        (s) => s.index
      )
    ).toEqual([0]);
  });

  it('And/Or/Coalesce: operands after the first', () => {
    expect(
      lazyOperandRegions(box(['And', 'A', 'B', 'C'])).map((s) => s.index)
    ).toEqual([1, 2]);
    expect(
      lazyOperandRegions(box(['Or', 'A', 'B', 'C'])).map((s) => s.index)
    ).toEqual([1, 2]);
    expect(
      lazyOperandRegions(box(['Coalesce', 'x', 'y', 1])).map((s) => s.index)
    ).toEqual([1, 2]);
  });

  it('Match: every operand, inert', () => {
    const sites = lazyOperandRegions(box(['Match', 'x', ['Tuple', 1, 2]]));
    expect(sites.map((s) => s.index)).toEqual([0, 1]);
    expect(sites.every((s) => s.inert)).toBe(true);
  });

  it('chained relation: comparisons after the first (no And node in the tree)', () => {
    const chained = ce.parse('a < m < b');
    expect(chained.operator).toBe('Less');
    expect(chained.nops).toBe(3);
    expect(lazyOperandRegions(chained).map((s) => s.index)).toEqual([2]);
    // A plain two-operand comparison is fully eager.
    expect(lazyOperandRegions(ce.parse('a < b'))).toEqual([]);
  });

  it('is empty for eager operators and non-applications', () => {
    expect(lazyOperandRegions(box(['Add', 'x', 'y']))).toEqual([]);
    expect(lazyOperandRegions(ce.symbol('x'))).toEqual([]);
    expect(lazyOperandRegions(undefined)).toEqual([]);
  });
});

describe('CSE HARVEST — basic candidates', () => {
  it('finds the repeated subtree of the design doc probe at the root', () => {
    const harvest = harvestCse(
      ce.parse('\\sin(6u)^2 + \\frac{\\sin(6u)}{\\sin(6u)+2}')
    );
    expect(harvest.regions).toHaveLength(1);
    expect(harvest.root.kind).toBe('root');
    expect(reps(harvest.root)).toEqual(['sin(6u)']);
    expect(counts(harvest.root)).toEqual([3]);
    const candidate = harvest.root.candidates[0];
    expect(candidate.size).toBe(4);
    expect(candidate.score).toBe(8);
  });

  it('resolves an occurrence through the per-region node map', () => {
    const harvest = harvestCse(box(['Add', SIN6U, SIN6U, SIN6U]));
    const candidate = harvest.root.candidates[0];
    const occurrenceNode = candidate.occurrences[0].node;
    expect(candidateAt(harvest.root, occurrenceNode)).toBe(candidate);
    // A node that is not an occurrence of a candidate of this region.
    expect(candidateAt(harvest.root, ce.symbol('u'))).toBeUndefined();
  });

  it('never proposes an atom as a candidate', () => {
    // `x` occurs three times; number literals repeat too.
    const harvest = harvestCse(
      box(['Add', ['Sin', 'x'], ['Cos', 'x'], ['Tan', 'x']])
    );
    expect(allReps(harvest)).toEqual([]);
    // And, in general, every surviving candidate is a compound node.
    const probe = harvestCse(box(['Add', SIN6U, SIN6U, SIN6U]));
    for (const c of probe.candidates) expect(c.representative.ops).not.toBe(null);
  });

  it('collects every symbol name into usedNames', () => {
    const harvest = harvestCse(ce.parse('\\sin(6u) + v_1 + \\pi'));
    expect(harvest.usedNames.has('u')).toBe(true);
    expect(harvest.usedNames.has('v_1')).toBe(true);
    expect(harvest.usedNames.has('Pi')).toBe(true);
    // Mutable by design: the caller merges `_cse`/`_tv` tokens found in
    // caller-supplied source strings.
    harvest.usedNames.add('_cse1');
    expect(harvest.usedNames.has('_cse1')).toBe(true);
  });
});

describe('CSE HARVEST — G4 thresholds', () => {
  it('rejects a size-4 subtree occurring only twice (score 4 < CSE_MIN_SCORE)', () => {
    const harvest = harvestCse(box(['Add', SIN6U, SIN6U]));
    expect(allReps(harvest)).toEqual([]);
    expect(harvest.diagnostics.droppedByThreshold).toBe(1);
  });

  it('rejects a below-CSE_MIN_SIZE subtree however often it repeats', () => {
    // `Negate(u)` is size 2 — the trivia the size gate exists to skip.
    const harvest = harvestCse(
      box([
        'Add',
        ['Sin', ['Negate', 'u']],
        ['Cos', ['Negate', 'u']],
        ['Tan', ['Negate', 'u']],
        ['Sinh', ['Negate', 'u']],
      ])
    );
    expect(
      harvest.candidates.some((c) => c.representative.operator === 'Negate')
    ).toBe(false);
  });

  it('scores on the PER-REGION count: 5 occurrences one per region yield nothing', () => {
    const harvest = harvestCse(
      box([
        'Which',
        ['Less', 0, 'x'],
        SIN6U,
        ['Less', 1, 'x'],
        SIN6U,
        ['Less', 2, 'x'],
        SIN6U,
        ['Less', 3, 'x'],
        SIN6U,
        'True',
        SIN6U,
      ])
    );
    // Every arm is its own region, so no region sees two occurrences.
    expect(allReps(harvest)).toEqual([]);
    expect(harvest.regions.length).toBeGreaterThan(5);
  });

  it('applies the per-region binding cap, highest score first', () => {
    const terms: any[] = [];
    for (let k = 0; k < 6; k++) {
      const t = ['Sin', ['Multiply', k + 2, 'u']];
      terms.push(t, t, t);
    }
    const harvest = harvestCse(box(['Add', ...terms]), {
      maxBindingsPerRegion: 2,
    });
    expect(harvest.root.candidates).toHaveLength(2);
    expect(harvest.diagnostics.droppedByRegionCap).toBe(4);
    // Deterministic tie-break: equal scores, so first occurrence wins.
    const enters = harvest.root.candidates.map((c) => c.occurrences[0].enter);
    expect(enters[0]).toBeLessThan(enters[1]);
  });
});

describe('CSE HARVEST — G1 purity', () => {
  it('rejects a subtree containing a random draw', () => {
    const draw = ['Sin', ['Multiply', 6, ['Random']]] as any;
    const harvest = harvestCse(box(['Add', draw, draw, draw]));
    expect(allReps(harvest)).toEqual([]);
  });

  it('rejects a RandomChoice-containing subtree while its pure operand survives', () => {
    const draw = [
      'Sin',
      ['Multiply', 6, ['RandomChoice', ['List', 1, 2, 3], 1]],
    ] as any;
    const harvest = harvestCse(box(['Add', draw, draw, draw]));
    expect(
      harvest.candidates.some((c) =>
        c.representative.toString().includes('RandomChoice')
      )
    ).toBe(false);
    // The pure `[1,2,3]` collection inside is still shareable — the gate is
    // structural, not "anything near a draw".
    expect(allReps(harvest)).toEqual(['[1,2,3]']);
  });
});

describe('CSE HARVEST — G1b emission purity', () => {
  it('rejects a subtree resolving through a caller-supplied operator mapping', () => {
    const harvest = harvestCse(box(['Add', SIN6U, SIN6U, SIN6U]), {
      isOverriddenOperator: (name) => name === 'Sin',
    });
    expect(allReps(harvest)).toEqual([]);
    expect(harvest.diagnostics.eligibleOccurrences).toBe(0);
  });

  it('rejects occurrences BELOW a caller-mapped operator', () => {
    // The mapping is on the enclosing `Cos`; the repeated `sin(6u)` beneath it
    // does not count, because the custom emitter controls how often — or
    // whether — everything beneath it evaluates.
    const inner = ['Add', SIN6U, SIN6U, SIN6U] as any;
    const harvest = harvestCse(box(['Cos', inner]), {
      isOverriddenOperator: (name) => name === 'Cos',
    });
    expect(allReps(harvest)).toEqual([]);
    expect(harvest.diagnostics.eligibleOccurrences).toBe(0);
  });

  it('rejects a subtree containing a string-valued `vars` symbol', () => {
    const harvest = harvestCse(box(['Add', SIN6U, SIN6U, SIN6U]), {
      isStringVar: (name) => name === 'u',
    });
    expect(allReps(harvest)).toEqual([]);
  });

  it('rejects a user-defined function application', () => {
    const engine = new ComputeEngine();
    engine.assign('f', engine.parse('x \\mapsto x+1'));
    const harvest = harvestCse(engine.parse('f(2)+f(2)+f(2)'));
    expect(allReps(harvest)).toEqual([]);
  });

  it('rejects an application whose operator is not a fixed built-in', () => {
    const engine = new ComputeEngine();
    engine.declare('g', '(number) -> number');
    const app = ['g', ['Multiply', 6, 'u']] as any;
    const harvest = harvestCse(engine.box(['Add', app, app, app]));
    expect(allReps(harvest)).toEqual([]);
  });

  it('rejects a named callback but accepts an inline Function literal', () => {
    const engine = new ComputeEngine();
    engine.assign('f', engine.parse('x \\mapsto x+1'));

    const named = ['Map', 'f', 'xs'] as any;
    const namedHarvest = harvestCse(engine.box(['Add', named, named, named]));
    expect(namedHarvest.candidates.map((c) => c.representative.toString())).toEqual(
      []
    );

    const inline = ['Map', ['Function', ['Add', 'x', 1], 'x'], 'xs'] as any;
    const inlineHarvest = harvestCse(
      engine.box(['Add', inline, inline, inline])
    );
    expect(inlineHarvest.root.candidates).toHaveLength(1);
    expect(
      inlineHarvest.root.candidates[0].representative.operator
    ).toBe('Map');
    expect(inlineHarvest.root.candidates[0].occurrences).toHaveLength(3);
  });
});

describe('CSE HARVEST — G3 mutation', () => {
  it('drops a candidate whose symbol is assigned anywhere in its region subtree', () => {
    const harvest = harvestCse(
      box(['Add', ['Block', ['Assign', 'u', 2], 1], SIN6U, SIN6U, SIN6U])
    );
    expect(allReps(harvest)).toEqual([]);
    expect(harvest.diagnostics.droppedByMutation).toBe(1);
    expect(harvest.root.assignedNames.has('u')).toBe(true);
  });

  it('leaves a candidate alone when nothing it mentions is assigned', () => {
    const harvest = harvestCse(
      box(['Add', ['Block', ['Assign', 'w', 2], 1], SIN6U, SIN6U, SIN6U])
    );
    expect(allReps(harvest)).toEqual(['sin(6u)']);
    expect(harvest.diagnostics.droppedByMutation).toBe(0);
  });

  it('records every leaf of a DESTRUCTURING declaration target', () => {
    // `Declare(Tuple(u, w), …)` writes both names; a target tested for
    // symbol-hood would have recorded neither.
    const declare = (pattern: any): any => [
      'Add',
      ['Block', ['Declare', pattern, ['Tuple', 1, 2]], 1],
      SIN6U,
      SIN6U,
      SIN6U,
    ];
    const rebound = harvestCse(box(declare(['Tuple', 'u', 'w'])));
    expect(allReps(rebound)).toEqual([]);
    expect(rebound.diagnostics.droppedByMutation).toBe(1);
    expect(rebound.root.assignedNames.has('u')).toBe(true);
    expect(rebound.root.assignedNames.has('w')).toBe(true);

    const untouched = harvestCse(box(declare(['Tuple', 'q', 'w'])));
    expect(allReps(untouched)).toEqual(['sin(6u)']);
    expect(untouched.diagnostics.droppedByMutation).toBe(0);
  });
});

describe('CSE HARVEST — subsumption', () => {
  it('drops the inner candidate when the outer has the same per-region count', () => {
    const nested = ['Sin', ['Sin', ['Multiply', 6, 'u']]] as any;
    const harvest = harvestCse(box(['Add', nested, nested, nested]));
    expect(allReps(harvest)).toEqual(['sin(sin(6u))']);
    expect(harvest.diagnostics.droppedBySubsumption).toBe(1);
  });

  it('keeps both when the counts differ', () => {
    const nested = ['Sin', ['Sin', ['Multiply', 6, 'u']]] as any;
    // Four occurrences of the inner `sin(6u)`, three of the outer.
    const harvest = harvestCse(box(['Add', nested, nested, nested, SIN6U]));
    expect(allReps(harvest).sort()).toEqual(['sin(6u)', 'sin(sin(6u))']);
  });
});

describe('CSE HARVEST — regions', () => {
  it('attributes a conditional-arm candidate to the arm, not the root', () => {
    const arm = ['Add', SIN6U, SIN6U, SIN6U] as any;
    const harvest = harvestCse(
      box(['Which', ['Less', 0, 'x'], arm, 'True', 1])
    );
    expect(reps(harvest.root)).toEqual([]);
    const armRegions = regionsOfKind(harvest, 'lazy-operand');
    const bearing = armRegions.filter((r) => r.candidates.length > 0);
    expect(bearing).toHaveLength(1);
    expect(reps(bearing[0])).toEqual(['sin(6u)']);
    expect(bearing[0].site?.opIndex).toBe(1);
    expect(bearing[0].inert).toBe(false);
  });

  it('exposes the arm region through childRegionAt for emission', () => {
    const arm = ['Add', SIN6U, SIN6U, SIN6U] as any;
    const expr = box(['Which', ['Less', 0, 'x'], arm, 'True', 1]);
    const harvest = harvestCse(expr);
    const armRegion = childRegionAt(harvest.root, expr, 1);
    expect(armRegion).toBeDefined();
    expect(armRegion!.kind).toBe('lazy-operand');
    expect(reps(armRegion!)).toEqual(['sin(6u)']);
    // The eager first condition opens no region.
    expect(childRegionAt(harvest.root, expr, 0)).toBeUndefined();
  });

  it('separates a binder body from the enclosing scope (no cross-merge)', () => {
    const harvest = harvestCse(
      ce.parse(
        '\\sin(6n)+\\sin(6n)+\\sin(6n)+\\sum_{n=1}^{5}(\\sin(6n)+\\sin(6n)+\\sin(6n))'
      )
    );
    const body = regionsOfKind(harvest, 'binder-body');
    expect(body).toHaveLength(1);
    expect(body[0].boundNames).toEqual(['n']);
    // Three occurrences inside, three outside — attributed separately.
    expect(counts(harvest.root)).toEqual([3]);
    expect(counts(body[0])).toEqual([3]);
    // Two distinct candidates, one per region; neither pooled the other's
    // occurrences.
    expect(harvest.candidates).toHaveLength(2);
    const [outer, inner] = harvest.candidates;
    expect(outer.region).toBe(harvest.root);
    expect(inner.region).toBe(body[0]);
    for (const occ of inner.occurrences)
      expect(candidateAt(harvest.root, occ.node)).not.toBe(outer);
  });

  it('marks a binder clause inert', () => {
    const harvest = harvestCse(ce.parse('\\sum_{n=1}^{5} n^2'));
    const clauses = regionsOfKind(harvest, 'binder-clause');
    expect(clauses).toHaveLength(1);
    expect(clauses[0].inert).toBe(true);
    expect(clauses[0].site?.opIndex).toBe(1);
  });

  it('yields no candidate anywhere inside a Match', () => {
    const arm = ['Add', SIN6U, SIN6U, SIN6U] as any;
    const harvest = harvestCse(box(['Match', arm, ['Tuple', 1, 2]]));
    expect(allReps(harvest)).toEqual([]);
    for (const region of harvest.regions)
      if (region !== harvest.root) expect(region.inert).toBe(true);
  });

  it('keeps a Block statement list inert but binds within one statement RHS', () => {
    const rhs = ['Add', SIN6U, SIN6U, SIN6U] as any;
    const harvest = harvestCse(box(['Block', ['Assign', 'y', rhs], 'y']));

    const lists = regionsOfKind(harvest, 'statement-list');
    expect(lists).toHaveLength(1);
    expect(lists[0].inert).toBe(true);
    expect(lists[0].candidates).toEqual([]);

    const values = regionsOfKind(harvest, 'statement-value');
    const bearing = values.filter((r) => r.candidates.length > 0);
    expect(bearing).toHaveLength(1);
    expect(bearing[0].inert).toBe(false);
    expect(reps(bearing[0])).toEqual(['sin(6u)']);
    expect(counts(bearing[0])).toEqual([3]);
  });

  it('does not bind across two statements of one Block', () => {
    // Three occurrences in total — enough for a candidate if the statement
    // list pooled them (score 8), but they split 2 + 1 across statements.
    const harvest = harvestCse(
      box([
        'Block',
        ['Assign', 'y', ['Add', SIN6U, SIN6U]],
        ['Assign', 'z', SIN6U],
        'y',
      ])
    );
    expect(allReps(harvest)).toEqual([]);
    expect(harvest.diagnostics.droppedByThreshold).toBe(1);
  });

  it('gives a Function literal a bindable body and an inert parameter list', () => {
    const literal = [
      'Function',
      ['Add', ['Sin', ['Multiply', 6, 'x']], ['Sin', ['Multiply', 6, 'x']], ['Sin', ['Multiply', 6, 'x']]],
      'x',
    ] as any;
    const harvest = harvestCse(box(literal));
    const bodies = regionsOfKind(harvest, 'lambda-body');
    expect(bodies).toHaveLength(1);
    expect(bodies[0].inert).toBe(false);
    expect(bodies[0].boundNames).toEqual(['x']);
    const params = regionsOfKind(harvest, 'lambda-params');
    expect(params).toHaveLength(1);
    expect(params[0].inert).toBe(true);
    expect(allReps(harvest)).toEqual(['sin(6x)']);
  });

  it('records the region tree with parents and depths', () => {
    const arm = ['Add', SIN6U, SIN6U, SIN6U] as any;
    const harvest = harvestCse(
      box(['Which', ['Less', 0, 'x'], arm, 'True', 1])
    );
    expect(harvest.root.parent).toBeUndefined();
    expect(harvest.root.depth).toBe(0);
    for (const region of harvest.regions) {
      if (region === harvest.root) continue;
      expect(region.parent).toBeDefined();
      expect(region.depth).toBe(region.parent!.depth + 1);
      expect(region.parent!.children).toContain(region);
    }
  });
});

describe('CSE HARVEST — DAG shapes', () => {
  it('counts one shared node object reached three times as three occurrences', () => {
    const shared = box(SIN6U);
    const expr = ce.function('Add', [shared, shared, shared]);
    const harvest = harvestCse(expr);

    expect(harvest.root.candidates).toHaveLength(1);
    const candidate: CseCandidate = harvest.root.candidates[0];
    expect(candidate.occurrences).toHaveLength(3);
    // ...but only ONE distinct node object.
    expect(candidate.nodes.size).toBe(1);
    expect(candidate.nodes.has(shared)).toBe(true);
    // Each occurrence has its own DFS interval.
    const enters = candidate.occurrences.map((o) => o.enter);
    expect(new Set(enters).size).toBe(3);
    expect(candidateAt(harvest.root, shared)).toBe(candidate);
  });

  it('keeps one shared node object in two regions maps, as two candidates', () => {
    const shared = box(SIN6U);
    // The SAME node object three times at the root and three times inside a
    // `Which` arm: two regions, two candidates, one node object.
    const arm = ce.function('Add', [shared, shared, shared]);
    const expr = ce.function('Add', [
      shared,
      shared,
      shared,
      ce.function('Which', [
        ce.parse('0 < x'),
        arm,
        ce.symbol('True'),
        ce.number(1),
      ]),
    ]);
    const harvest = harvestCse(expr);

    const bearing = harvest.regions.filter((r) => r.candidates.length > 0);
    expect(bearing).toHaveLength(2);
    expect(bearing[0]).toBe(harvest.root);
    expect(bearing[1].kind).toBe('lazy-operand');

    const rootCandidate = candidateAt(harvest.root, shared);
    const armCandidate = candidateAt(bearing[1], shared);
    expect(rootCandidate).toBeDefined();
    expect(armCandidate).toBeDefined();
    // One node object, two candidates — resolved by the REGION, per §6.1.
    expect(rootCandidate).not.toBe(armCandidate);
    expect(rootCandidate!.occurrences).toHaveLength(3);
    expect(armCandidate!.occurrences).toHaveLength(3);
    for (const region of harvest.regions)
      for (const candidate of region.candidates)
        expect(candidate.occurrences.every((o) => o.region === region)).toBe(
          true
        );
  });
});

describe('CSE HARVEST — verification budget', () => {
  it('drops a bucket whole when the budget is exhausted', () => {
    // The budget charges only FAILED comparisons (real hash-collision work);
    // legitimate structurally-equal matches never charge — a size-s candidate
    // with k occurrences must not exhaust at (k−1)·s (that accounting
    // silently disabled CSE on the high-value corpus shapes). So exhaustion
    // needs genuinely DISTINCT structures sharing a hash, forced here by
    // shadowing the memoized `hash` getter with an own property.
    const nodes: Expression[] = [];
    for (let k = 0; k < 8; k++) {
      const n = box(['Sin', ['Multiply', k + 2, 'u']]);
      Object.defineProperty(n, 'hash', { value: 0x5eed, configurable: true });
      nodes.push(n, n);
    }
    const harvest = harvestCse(box(['Add', ...nodes]), {
      maxVerifyNodesPerBucket: 1,
    });
    expect(allReps(harvest)).toEqual([]);
    expect(harvest.diagnostics.exhaustedBuckets).toBe(1);
  });

  it('legitimate duplicates never exhaust the budget, whatever their size', () => {
    const harvest = harvestCse(box(['Add', SIN6U, SIN6U, SIN6U]), {
      maxVerifyNodesPerBucket: 1,
    });
    expect(allReps(harvest)).toEqual(['sin(6u)']);
    expect(harvest.diagnostics.exhaustedBuckets).toBe(0);
  });

  it('is deterministic: the same expression harvests identically twice', () => {
    const build = () =>
      harvestCse(ce.parse('\\sin(6u)^2 + \\frac{\\sin(6u)}{\\sin(6u)+2}'));
    const a = build();
    const b = build();
    expect(allReps(a)).toEqual(allReps(b));
    expect(a.regions.map((r) => [r.id, r.kind, r.inert])).toEqual(
      b.regions.map((r) => [r.id, r.kind, r.inert])
    );
    expect(a.diagnostics).toEqual(b.diagnostics);
  });
});
