/**
 * Stage C3 of the checkpoint work — the **differential harness** over
 * randomized cell sequences ("Remaining work" in `docs/CHECKPOINT-MODEL.md`).
 *
 * The oracle is the correctness specification itself:
 *
 *     restore(cp[k-1]); run(P'k … P'm)
 *       ≡  fresh engine at baseline B; run(P1 … Pk-1, P'k … P'm)
 *
 * Each seed builds a random notebook session on a SUBJECT engine — cells
 * drawn from a vocabulary covering every journaled and snapshotted family,
 * a checkpoint after every cell — then performs one to three random EDITS
 * (restore to a random checkpoint, replace the suffix), with occasional
 * discards interleaved so the window-fold path is exercised. The ORACLE is a
 * fresh engine running the final linear program the edits produced. The two
 * are compared through observation closures the generator registered as it
 * built the program: evaluation results, types, `About()` output,
 * assumption-dependent predicates, sequence terms, object fields, and the
 * numeric configuration.
 *
 * Failures print the seed, the full cell history and the edit log, so a
 * counterexample replays by pasting the seed into `FOCUS_SEED` below.
 *
 * Deliberately deterministic vocabulary: no `Random()`, no I/O — replay
 * re-executes effects by design ("Effects and exclusions" in the model doc),
 * so a nondeterministic cell would make the oracle itself unsound.
 *
 * Two structural invariants are asserted DURING the subject run, because the
 * oracle cannot see them:
 *
 * - restoring to a checkpoint returns the session scope's binding count and
 *   the engine's configuration-listener count to their values when that
 *   checkpoint was taken (a growing count across cycles is the definition of
 *   the leak the disposal pass exists to prevent);
 * - with `CE_CHECKPOINT_CANARY=1` in the environment, every live window's
 *   canary tally shows no journal bypass at each restore point. The canary is
 *   a module-load flag, so this arm is inert in a plain run; `scripts/test.sh`
 *   (the funnel behind `npm test`, which is what CI invokes) re-runs this one
 *   file in a second jest process with the flag set.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import {
  CHECKPOINT_CANARY,
  checkpointCanaryBypasses,
  type CheckpointCanaryTally,
} from '../../src/compute-engine/checkpoint-journal';

/** Set to a seed number to run only that seed while chasing a failure. */
const FOCUS_SEED: number | undefined = undefined;

const SEEDS = FOCUS_SEED !== undefined ? [FOCUS_SEED] : range(1, 20);

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

/** mulberry32 — a tiny deterministic PRNG. Seeded per test so every failure
 * is reproducible from its seed alone; `Math.random` would make a red run
 * unrepeatable, which for a differential harness is the same as useless. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One notebook cell: Epsil source, or a host-API action. Both the subject
 * and the oracle execute cells through the same `runCell`, so an API cell is
 * as replayable as a source cell. */
type Cell = { label: string; src?: string; api?: (ce: ComputeEngine) => void };

/** A named probe run identically on both engines after the session settles.
 * Returns a STRING so the comparison is a plain equality with a readable
 * diff; errors are part of the observation, not an escape from it. */
type Observation = { desc: string; probe: (ce: ComputeEngine) => string };

/** The generator's working state. Pools are never pruned on an edit — a
 * later cell may reference a name whose declaration the edit discarded,
 * which is exactly the shape that catches a restore leaving a binding
 * behind: the oracle never saw the name, so the subject must not either. */
type GenState = {
  r: () => number;
  fresh: number;
  scalars: string[];
  funcs: string[];
  objects: string[];
  sequences: string[];
  observations: Observation[];
};

function pick<T>(state: GenState, pool: T[]): T {
  return pool[Math.floor(state.r() * pool.length)];
}

function int(state: GenState, max: number): number {
  return 1 + Math.floor(state.r() * max);
}

/** Run one Epsil probe, folding the printed value, its TYPE, its LaTeX
 * serialization and EVERY diagnostic (all severities — a stale warning left
 * behind by a restore is as much a divergence as a stale value) into one
 * comparable string. Shared by subject and oracle so the two runs are
 * byte-identical in how they execute and how they report. */
function runEpsil(ce: ComputeEngine, src: string): string {
  const r = executeEpsil(ce, src);
  const diags = r.diagnostics.map(
    (d) => `${d.severity}:${JSON.stringify(d.message)}`
  );
  const v = r.value;
  return [
    v?.toString() ?? '<no value>',
    `type ${v?.type.toString() ?? '-'}`,
    `latex ${v?.latex ?? '-'}`,
    ...(diags.length > 0 ? ['diags ' + diags.join(',')] : []),
  ].join(' | ');
}

function observeEpsil(state: GenState, src: string): void {
  state.observations.push({ desc: src, probe: (ce) => runEpsil(ce, src) });
}

/** The cell vocabulary. Each maker returns a cell and registers the
 * observations that make its state family visible in the final comparison.
 * Weights are implicit in the table: kinds that stress the journal (value
 * writes, redefinitions, object stores) appear more than once. */
const CELL_MAKERS: ((state: GenState) => Cell)[] = [
  // Scalar assignment — new name or reassignment of an existing one.
  (s) => {
    const name =
      s.scalars.length > 0 && s.r() < 0.5
        ? pick(s, s.scalars)
        : `v${s.fresh++}`;
    if (!s.scalars.includes(name)) s.scalars.push(name);
    observeEpsil(s, name);
    observeEpsil(s, `About("${name}")`);
    return { label: 'assign', src: `${name} = ${int(s, 40)}` };
  },
  // Host-API assignment to an existing symbol — the one route where the
  // value-setter journal hook is the SOLE cover: Epsil reassignment goes
  // through the declare path, whose scope-map entry restores the previous
  // binding object whole and would mask a dead funnel-1 hook.
  (s) => {
    if (s.scalars.length === 0) {
      const name = `v${s.fresh++}`;
      s.scalars.push(name);
      observeEpsil(s, name);
      return { label: 'assign', src: `${name} = ${int(s, 40)}` };
    }
    const name = pick(s, s.scalars);
    const n = int(s, 99);
    observeEpsil(s, name);
    return { label: 'api-assign', api: (ce) => ce.assign(name, ce.number(n)) };
  },
  // Dependent expression over the pool.
  (s) => {
    // The dependency is drawn BEFORE the fresh name joins the pool — drawing
    // after it made 1/|pool| of these cells the self-reference
    // `vN = vN^2 + k`, a guaranteed error instead of a dependency.
    const dep = s.scalars.length > 0 ? pick(s, s.scalars) : '2';
    const name = `v${s.fresh++}`;
    s.scalars.push(name);
    observeEpsil(s, name);
    return { label: 'expr', src: `${name} = ${dep}^2 + ${int(s, 9)}` };
  },
  // Function definition or in-place redefinition — the operator-update and
  // half-swap funnels, and the constant-key regression surface.
  (s) => {
    const name =
      s.funcs.length > 0 && s.r() < 0.5 ? pick(s, s.funcs) : `f${s.fresh++}`;
    if (!s.funcs.includes(name)) s.funcs.push(name);
    const body =
      s.r() < 0.25 ? `"s${int(s, 9)}"` : `x * ${int(s, 6)} + ${int(s, 9)}`;
    observeEpsil(s, `${name}(2)`);
    observeEpsil(s, `About("${name}")`);
    return { label: 'fn', src: `${name}(x) = ${body}` };
  },
  // Lambda held in a value binding — the value-half → operator-half shape.
  (s) => {
    const name =
      s.funcs.length > 0 && s.r() < 0.3 ? pick(s, s.funcs) : `g${s.fresh++}`;
    if (!s.funcs.includes(name)) s.funcs.push(name);
    observeEpsil(s, `${name}(3)`);
    return { label: 'lambda', src: `${name} = x => x + ${int(s, 12)}` };
  },
  // List + map over it — collection state and callbacks.
  (s) => {
    const name = `xs${s.fresh++}`;
    const k = int(s, 5);
    observeEpsil(s, `map(x => x + ${k}, ${name})`);
    observeEpsil(s, `sum(${name})`);
    return { label: 'list', src: `${name} = [1, ${int(s, 7)}, ${int(s, 9)}]` };
  },
  // Typed let / frozen constant — the bare-field funnel (`_isConstant`).
  (s) => {
    const name = `c${s.fresh++}`;
    const frozen = s.r() < 0.5;
    observeEpsil(s, name);
    observeEpsil(s, `About("${name}")`);
    return {
      label: frozen ? 'const' : 'typed-let',
      src: frozen
        ? `let ${name} = ${int(s, 20)} { constant: True }`
        : `let ${name}: integer = ${int(s, 20)}`,
    };
  },
  // Type declaration — registry snapshot family. Fresh names only: the
  // strict-posture rules for redeclaration are their own workstream.
  (s) => {
    const name = `T${s.fresh++}`;
    observeEpsil(s, `let t${s.fresh}: ${name} = ${int(s, 9)}\nt${s.fresh}`);
    return { label: 'type', src: `type ${name} = integer` };
  },
  // Object type, construction and slot mutation — the object-slot funnel.
  // Mutation targets a PRE-EXISTING object when one is in the pool, which is
  // the case the design singles out: an object created before the edit point,
  // mutated by a discarded cell.
  (s) => {
    if (s.objects.length > 0 && s.r() < 0.75) {
      const name = pick(s, s.objects);
      observeEpsil(s, `${name}.x`);
      return { label: 'store', src: `${name}.x = ${int(s, 50)}` };
    }
    const t = `O${s.fresh++}`;
    const name = `o${s.fresh++}`;
    s.objects.push(name);
    observeEpsil(s, `${name}.x`);
    return {
      label: 'object',
      src: `type ${t} = object{x: number}\n${name} = ${t}(x: ${int(s, 9)})`,
    };
  },
  // Protocol + conformance + dispatcher call — protocol registry snapshot
  // and dispatcher re-sync. Fresh names; the implementation body reads the
  // object's slot so the dispatch result is also an object-state probe.
  (s) => {
    const p = `P${s.fresh++}`;
    const t = `B${s.fresh++}`;
    const name = `b${s.fresh++}`;
    observeEpsil(s, `m${p}(${name})`);
    return {
      label: 'protocol',
      src:
        `protocol ${p} { function m${p}(self: Self) -> integer }\n` +
        `type ${t} = object{n: integer}\n` +
        `type ${t} is ${p} { function m${p}(self: Self) -> integer { self.n } }\n` +
        `${name} = ${t}(n: ${int(s, 9)})`,
    };
  },
  // Sequence — the module-level registry snapshot family, declared through
  // the host API. The Epsil subscript route (`s_0 = 1` …) builds a PENDING
  // sequence first and is exercised by the targeted pending-sequence probe
  // below, where its two-statement shape can straddle a checkpoint.
  (s) => {
    const name = `Q${s.fresh++}`;
    // The step is the spine scalar `z` when it is in the pool, not a
    // literal — the recurrence string is parsed as LATEX, where a pool name
    // like `v3` is the product v·3, so `z` is the only pool symbol the
    // recurrence can resolve. A dependency-bearing memo is the point: a memo
    // entry computed while the scalar held a window-only value then differs
    // from recomputation after the restore, so a memo the restore failed to
    // clear IN THE HANDLER'S OWN MAP shows up in the value oracle. (The
    // registry-side memo field is not evidence — a broken restore can swap
    // in a fresh map there while the handler keeps its old one.) The oracle
    // stays sound because subject-replay and oracle run the same final
    // program, so their memo HISTORIES agree whenever the restore is
    // correct.
    const step = s.scalars.includes('z') ? 'z' : String(int(s, 5));
    s.sequences.push(name);
    s.observations.push({
      desc: `${name}_{6}`,
      probe: (ce) => ce.parse(`${name}_{6}`).evaluate().toString(),
    });
    return {
      label: 'sequence',
      api: (ce) =>
        ce.declareSequence(name, {
          variable: 'n',
          base: { 0: 1 },
          recurrence: `${name}_{n-1} + ${step}`,
        }),
    };
  },
  // Evaluate a term of an existing sequence mid-session, populating its memo
  // BEFORE an edit — without this, no memo exists at restore time and the
  // memo-clearing path is never exercised. The memoized values themselves are
  // recomputation-identical (self-contained recurrences), so the memo state
  // is asserted structurally at each restore rather than through the oracle.
  (s) => {
    if (s.sequences.length === 0) {
      const name = `v${s.fresh++}`;
      s.scalars.push(name);
      observeEpsil(s, name);
      return { label: 'assign', src: `${name} = ${int(s, 40)}` };
    }
    const name = pick(s, s.sequences);
    return {
      label: 'seq-eval',
      api: (ce) => void ce.parse(`${name}_{8}`).evaluate(),
    };
  },
  // Assumption — per-frame assumption map and its provenance. Through the
  // host API: the lowercase Epsil `assume(...)` spelling stays symbolic and
  // asserts nothing. Observed through `verify`, which consults the
  // assumption store; plain evaluation of the predicate does not.
  (s) => {
    const name = `w${s.fresh++}`;
    s.observations.push({
      desc: `verify ${name} > 0`,
      probe: (ce) => String(ce.verify(ce.parse(`${name} > 0`))),
    });
    return {
      label: 'assume',
      api: (ce) => void ce.assume(ce.parse(`${name} > 0`)),
    };
  },
  // Host configuration beyond precision — each pass flips one of the other
  // user-reachable scalar config fields the snapshot covers, with a paired
  // observation, so a restore regression confined to one field cannot hide
  // behind the others.
  (s) => {
    const kind = int(s, 4);
    if (kind === 1) {
      s.observations.push({
        desc: 'angularUnit + sin(30)',
        probe: (ce) =>
          `${ce.angularUnit} ${runEpsil(ce, 'sin(30)')}`,
      });
      return { label: 'angular', api: (ce) => void (ce.angularUnit = 'deg') };
    }
    if (kind === 2) {
      s.observations.push({
        desc: 'iterationLimit',
        probe: (ce) => String(ce.iterationLimit),
      });
      const n = 200 + int(s, 800);
      return { label: 'iter-limit', api: (ce) => void (ce.iterationLimit = n) };
    }
    if (kind === 3) {
      s.observations.push({
        desc: 'maxCollectionSize',
        probe: (ce) => String(ce.maxCollectionSize),
      });
      const n = 1000 + int(s, 5000);
      return {
        label: 'coll-limit',
        api: (ce) => void (ce.maxCollectionSize = n),
      };
    }
    s.observations.push({ desc: 'jit', probe: (ce) => String(ce.jit) });
    return { label: 'jit', api: (ce) => void (ce.jit = 'off') };
  },
  // Numeric configuration — the ordered config snapshot (precision resets
  // tolerance, so this cell is the snapshot-ordering probe: restoring
  // tolerance before precision would silently install the precision-derived
  // default).
  (s) => {
    const p = 15 + int(s, 40);
    s.observations.push({
      desc: 'precision/tolerance',
      probe: (ce) => `${ce.precision}/${ce.tolerance}`,
    });
    return { label: 'precision', api: (ce) => void (ce.precision = p) };
  },
];

function makeCell(state: GenState): Cell {
  return CELL_MAKERS[Math.floor(state.r() * CELL_MAKERS.length)](state);
}

function runCell(ce: ComputeEngine, cell: Cell): void {
  if (cell.src !== undefined) executeEpsil(ce, cell.src);
  else cell.api!(ce);
}

/** Subject-side record of one checkpoint: the handle plus the structural
 * invariants recorded when it was taken. */
type CpRecord = {
  cp: ReturnType<ComputeEngine['checkpoint']>;
  bindings: number;
  listeners: number;
  dead: boolean;
};

function listenerCount(ce: ComputeEngine): number {
  // Test-only reach into the tracker: there is no public count, and the leak
  // this asserts on (a constant's subscription surviving its disposal) is
  // invisible through any public surface.
  return (
    ce as unknown as {
      _configurationLifecycle: { _tracker: { _listeners: unknown[] } };
    }
  )._configurationLifecycle._tracker._listeners.length;
}

function bindingCount(ce: ComputeEngine): number {
  return ce.context.lexicalScope.bindings.size;
}

function assertNoCanaryBypass(records: CpRecord[], history: string[]): void {
  if (!CHECKPOINT_CANARY) return;
  for (const rec of records) {
    if (rec.dead) continue;
    const tally = (
      rec.cp as unknown as { window?: { canary?: CheckpointCanaryTally } }
    ).window?.canary;
    const bypasses = checkpointCanaryBypasses(tally);
    if (bypasses.length > 0)
      throw new Error(
        `journal bypass (${bypasses.join(', ')}) detected by the canary\n` +
          history.join('\n')
      );
  }
}

function runSession(seed: number, inScope: boolean): void {
  const state: GenState = {
    r: prng(seed),
    fresh: 1,
    scalars: [],
    funcs: [],
    objects: [],
    sequences: [],
    observations: [],
  };
  const history: string[] = [`seed ${seed}`];

  const subject = new ComputeEngine();
  // In-scope mode runs the WHOLE session inside a host-pushed scope — the
  // consumer's shape: its cells always evaluate inside one. The scope push is
  // part of the program, so the oracle pushes the same scope before running
  // the final linear cells.
  if (inScope) subject.pushScope(undefined, 'pass');
  const cells: Cell[] = [];
  // records[i] is the checkpoint taken after i cells; records[0] is cp[0] on
  // the fresh engine. The index alignment is what lets an edit at cell k
  // restore records[k] and truncate both arrays consistently.
  const records: CpRecord[] = [];

  const takeCp = (): void => {
    records.push({
      cp: subject.checkpoint(),
      bindings: bindingCount(subject),
      listeners: listenerCount(subject),
      dead: false,
    });
  };

  const runOne = (cell: Cell): void => {
    history.push(`  cell[${cells.length}] ${cell.label}: ${cell.src ?? '<api>'}`);
    cells.push(cell);
    runCell(subject, cell);
    takeCp();
  };

  takeCp();
  // The spine: one cell per state family, before any randomness. Without it
  // a seed only exercises a family if the generator happens to (a) create
  // its state, (b) mutate it later, and (c) place an edit point between the
  // two — measured at 20 seeds, that conjunction simply failed to occur for
  // object stores. The spine pins (a); the biased random suffix supplies
  // (b) and (c).
  state.scalars.push('z');
  state.objects.push('o0');
  observeEpsil(state, 'z');
  observeEpsil(state, 'o0.x');
  observeEpsil(state, 'fz(2)');
  state.observations.push({
    desc: 'verify w0 > 0',
    probe: (ce) => String(ce.verify(ce.parse('w0 > 0'))),
  });
  for (const spine of [
    { label: 'spine-scalar', src: 'z = 3' },
    { label: 'spine-object', src: 'type OS = object{x: number}\no0 = OS(x: 1)' },
    { label: 'spine-fn', src: 'fz(x) = x * z' },
    {
      label: 'spine-assume',
      api: (ce) => void ce.assume(ce.parse('w0 > 0')),
    },
  ] as Cell[])
    runOne(spine);
  runOne(CELL_MAKERS[10](state)); // sequence — recurrence picks up `z`
  runOne(CELL_MAKERS[11](state)); // seq-eval — populates the memo early

  const initial = 3 + Math.floor(state.r() * 4);
  for (let i = 0; i < initial; i++) runOne(makeCell(state));

  const edits = 1 + Math.floor(state.r() * 3);
  for (let e = 0; e < edits; e++) {
    // Occasionally discard a live checkpoint first — interior discards fold
    // their window into the next-older live one; discarding the base frees
    // it. Never the newest, so an edit target always remains.
    if (state.r() < 0.35 && records.length > 2) {
      const j = Math.floor(state.r() * (records.length - 1));
      if (!records[j].dead) {
        history.push(`  discard cp[${j}]`);
        subject.discard(records[j].cp);
        records[j].dead = true;
      }
    }

    // Restore to a random LIVE checkpoint and replace the suffix.
    // The newest checkpoint is excluded when any other is live: restoring
    // it discards nothing, so it edits nothing.
    let liveIdx = records
      .map((rec, i) => (rec.dead ? -1 : i))
      .filter((i) => i >= 0);
    if (liveIdx.length > 1) liveIdx = liveIdx.slice(0, -1);
    const k = liveIdx[Math.floor(state.r() * liveIdx.length)];
    history.push(`  edit: restore cp[${k}], replay from cell ${k}`);

    assertNoCanaryBypass(records, history);
    subject.restore(records[k].cp);

    // Structural invariants the oracle cannot see: the restore returned the
    // session scope and the listener set to their checkpoint-time sizes.
    expect(`bindings=${bindingCount(subject)}`).toBe(
      `bindings=${records[k].bindings}`
    );
    expect(`listeners=${listenerCount(subject)}`).toBe(
      `listeners=${records[k].listeners}`
    );
    // Sequence value memos are cleared wholesale on restore. This registry
    // read only pins the cleared-at-all half: the handler closes over the
    // MAP OBJECT, so a broken restore that swapped in a fresh registry map
    // would pass this probe while the handler kept serving window-era
    // terms — that half is what the scalar-referencing recurrences above
    // make visible to the value oracle.
    for (const name of state.sequences) {
      const size = subject.getSequenceCache(name)?.size ?? 0;
      expect(`${name} memo after restore: ${size}`).toBe(
        `${name} memo after restore: 0`
      );
    }

    cells.length = k;
    records.length = k + 1;
    const suffix = 1 + Math.floor(state.r() * 4);
    for (let i = 0; i < suffix; i++) runOne(makeCell(state));
  }

  // The oracle: a fresh engine running the final linear program.
  const oracle = new ComputeEngine();
  if (inScope) oracle.pushScope(undefined, 'pass');
  for (const cell of cells) runCell(oracle, cell);

  const context = history.join('\n');
  for (const ob of state.observations) {
    const got = ob.probe(subject);
    const want = ob.probe(oracle);
    // One string per observation so a mismatch names its probe and carries
    // the whole session in the diff.
    expect(`${ob.desc} = ${got}\n${context}`).toBe(
      `${ob.desc} = ${want}\n${context}`
    );
  }
}

describe('checkpoint differential oracle', () => {
  // `precision` cells write the process-global BigDecimal precision; restore
  // it so this suite cannot poison a sharing worker.
  let savedPrecision: number;
  beforeAll(() => {
    savedPrecision = new ComputeEngine().precision;
  });
  afterAll(() => {
    new ComputeEngine().precision = savedPrecision;
  });

  test.each(SEEDS)('randomized session, seed %i', (seed) => {
    runSession(seed, false);
  });

  test.each(SEEDS)('randomized session inside a host scope, seed %i', (seed) => {
    runSession(seed, true);
  });
});

describe('targeted probes', () => {
  test('a sequence memo populated in a discarded window is not served after restore', () => {
    // The discriminating order the random walk reaches rarely: the memo is
    // populated AFTER a dependency changed, inside the window, so its
    // entries differ from what the restored world computes. A restore that
    // clears the registry-side map but not the map the sequence HANDLER
    // closed over serves the window-era terms — while every registry
    // introspection reports an empty cache.
    const subject = new ComputeEngine();
    executeEpsil(subject, 'z = 3');
    subject.declareSequence('M', {
      variable: 'n',
      base: { 0: 1 },
      recurrence: 'M_{n-1} + z',
    });
    const cp = subject.checkpoint();
    executeEpsil(subject, 'z = 100');
    subject.parse('M_{8}').evaluate(); // memoize 1..8 with z = 100
    subject.restore(cp);

    const oracle = new ComputeEngine();
    executeEpsil(oracle, 'z = 3');
    oracle.declareSequence('M', {
      variable: 'n',
      base: { 0: 1 },
      recurrence: 'M_{n-1} + z',
    });

    expect(subject.parse('M_{6}').evaluate().toString()).toBe(
      oracle.parse('M_{6}').evaluate().toString()
    );
  });

  test('a pending sequence reverts to its checkpoint shape', () => {
    // The Epsil subscript route builds a PENDING sequence — base cases first,
    // recurrence later, finalized only when both halves are present. The two
    // statements can straddle a checkpoint, which is the shape that once
    // exposed a restore bug: a pending entry is created WITHOUT a
    // `recurrence` key and gains one in place, and a merge of the snapshot
    // over the live entry cannot remove a key the snapshot never had.
    const run = (edit: boolean): string => {
      const ce = new ComputeEngine();
      executeEpsil(ce, 'r_0 = 1');
      const cp = ce.checkpoint();
      if (edit) {
        executeEpsil(ce, 'r_n = r_(n-1) + 5');
        ce.restore(cp);
      }
      return JSON.stringify(ce.getSequenceStatus('r'));
    };
    expect(run(true)).toBe(run(false));
  });

  test('a simplification rule pushed in a discarded window stops firing', () => {
    // `ce.simplificationRules.push(...)` is the documented public route into
    // the rule store, and it mutates the ARRAY in place — the exact shape the
    // config snapshot copies structurally instead of holding by reference.
    const probe = (ce: ComputeEngine): string =>
      ce.parse('\\ln(42)').simplify().toString();

    const subject = new ComputeEngine();
    const cp = subject.checkpoint();
    subject.simplificationRules.push({
      match: ['Ln', 42],
      replace: 0,
    });
    expect(probe(subject)).toBe('0'); // the rule fires inside the window
    subject.restore(cp);

    const oracle = new ComputeEngine();
    expect(probe(subject)).toBe(probe(oracle));
  });

  test('an assumption made in a discarded window is forgotten', () => {
    const subject = new ComputeEngine();
    const cp = subject.checkpoint();
    subject.assume(subject.parse('u > 0'));
    expect(subject.verify(subject.parse('u > 0'))).toBe(true);
    subject.restore(cp);

    const oracle = new ComputeEngine();
    expect(String(subject.verify(subject.parse('u > 0')))).toBe(
      String(oracle.verify(oracle.parse('u > 0')))
    );
  });
});

describe('resource lifecycle across a session', () => {
  test('discarding every checkpoint empties the stack and detaches the window', () => {
    const ce = new ComputeEngine();
    const cps = [ce.checkpoint()];
    executeEpsil(ce, 'a = 1');
    cps.push(ce.checkpoint());
    executeEpsil(ce, 'b = 2');
    cps.push(ce.checkpoint());

    // Interior first (fold path), then the ends.
    ce.discard(cps[1]);
    ce.discard(cps[2]);
    ce.discard(cps[0]);

    const internals = ce as unknown as {
      _checkpointStack: unknown[];
      _checkpointWindow: unknown;
    };
    expect(internals._checkpointStack.length).toBe(0);
    // With no live checkpoint there is nothing a journaled write could ever
    // be consumed by, so nothing may keep recording.
    expect(internals._checkpointWindow).toBeUndefined();
  });

  test('listener and binding counts are stable across repeated cycles', () => {
    const ce = new ComputeEngine();
    const cp = ce.checkpoint();
    const listeners = listenerCount(ce);
    const bindings = bindingCount(ce);

    for (let i = 0; i < 3; i++) {
      // A constant subscribes a configuration listener at construction; the
      // restore's disposal pass must release it, every cycle.
      executeEpsil(ce, `let k${i} = ${i} { constant: True }`);
      executeEpsil(ce, `h${i}(x) = x + ${i}`);
      ce.restore(cp);
      expect(listenerCount(ce)).toBe(listeners);
      expect(bindingCount(ce)).toBe(bindings);
    }
  });
});
