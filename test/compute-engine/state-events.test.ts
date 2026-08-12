/**
 * Migration step 2b of the state-event invalidation design
 * (`docs/plans/2026-08-09-state-event-invalidation-axes.md` §8): per-row
 * unit tests pinning the parity dispatch table — every (kind, payload)
 * combination maps to EXACTLY the legacy counter mask transcribed from the
 * design's §2/§2b/§2c tables — plus end-to-end advancement probes through
 * the public API.
 *
 * These tests are the "per-row" layer of the parity gate: they catch a
 * misclassified emission that the operation-level (checkpoint) layer could
 * mask behind another event advancing the same counter in the same
 * operation.
 */

import { ComputeEngine } from '../../src/compute-engine';
import {
  axisMaskOf,
  type StateEvent,
  type AxisMask,
} from '../../src/compute-engine/engine-configuration-lifecycle';
import { containsSignatureArm } from '../../src/common/type/utils';
import { parseType } from '../../src/common/type/parse';

function mask(any: boolean, semantic: boolean, world: boolean): AxisMask {
  return { any, semantic, world };
}

describe('axisMaskOf: the parity dispatch table, row by row', () => {
  const ROWS: [string, StateEvent, AxisMask][] = [
    // value-write: G always, +M unless ephemeral (§2: the value setter).
    [
      'value-write (plain)',
      { kind: 'value-write', ephemeral: false, callable: false },
      mask(true, true, false),
    ],
    [
      'value-write (callable)',
      { kind: 'value-write', ephemeral: false, callable: true },
      mask(true, true, false),
    ],
    [
      'value-write (ephemeral)',
      { kind: 'value-write', ephemeral: true, callable: false },
      mask(true, false, false),
    ],
    // declare: G only (§2: declareSymbolValue/Operator).
    [
      'declare (plain)',
      { kind: 'declare', callable: false, shadowsCallable: false },
      mask(true, false, false),
    ],
    [
      'declare (callable)',
      { kind: 'declare', callable: true, shadowsCallable: false },
      mask(true, false, false),
    ],
    [
      'declare (shadowing a callable)',
      { kind: 'declare', callable: false, shadowsCallable: true },
      mask(true, false, false),
    ],
    // binding-repair: G only (§2: updateDef internal, minted-ctor removal).
    ['binding-repair', { kind: 'binding-repair' }, mask(true, false, false)],
    // redefine: M+E — emitted ONLY by the callers that install an operator
    // half (callableAfter true by construction at every emitting site).
    [
      'redefine (operator installed)',
      { kind: 'redefine', callableBefore: true, callableAfter: true },
      mask(false, true, true),
    ],
    [
      'redefine (value was not callable)',
      { kind: 'redefine', callableBefore: false, callableAfter: true },
      mask(false, true, true),
    ],
    // The callableAfter:false shape has a ZERO mask (the operator→scalar
    // swap's legacy G+M arrives via the accompanying value-write) — in the
    // parity regime those sites emit `type-write` instead, but the table
    // row must stay transcription-exact should one arrive.
    [
      'redefine (non-callable result)',
      { kind: 'redefine', callableBefore: true, callableAfter: false },
      mask(false, false, false),
    ],
    // type-write: zero mask today (§2c — bare def retypes).
    // R5-normalized (step 5): type-writes advance `any` so G-keyed
    // _sgn/_type see a def retype.
    [
      'type-write (arm arriving)',
      { kind: 'type-write', callableBefore: false, callableAfter: true },
      mask(true, false, false),
    ],
    [
      'type-write (arm leaving)',
      { kind: 'type-write', callableBefore: true, callableAfter: false },
      mask(true, false, false),
    ],
    // scope-pop: G always for popEvalContext, +M+E when assumptions dirty;
    // the transient (inScope) variant has no G.
    [
      'scope-pop (clean)',
      { kind: 'scope-pop', assumptionsDirty: false },
      mask(true, false, false),
    ],
    [
      'scope-pop (dirty)',
      { kind: 'scope-pop', assumptionsDirty: true },
      mask(true, true, true),
    ],
    [
      'scope-pop (transient, clean)',
      { kind: 'scope-pop', assumptionsDirty: false, transient: true },
      mask(false, false, false),
    ],
    [
      'scope-pop (transient, dirty)', // R5: advances `any` like its twin
      { kind: 'scope-pop', assumptionsDirty: true, transient: true },
      mask(true, true, true),
    ],
    // assumption: G+M+E (assume/forget).
    ['assumption', { kind: 'assumption' }, mask(true, true, true)],
    // inference: default G+M+E; the BoxedSymbol operator branch M+E; the
    // value branch zero-mask (§2b).
    ['inference (default)', { kind: 'inference' }, mask(true, true, true)],
    // R5 (amended): symbolSignature advances `any` (twin-consistent);
    // valueType MUST stay zero-mask — value-branch inference fires DURING
    // type computation, and advancing the axis it reads is self-invalidating
    // (measured: stack overflow + inference drift). Load-bearing row.
    [
      'inference (symbol signature)',
      { kind: 'inference', symbolSignature: true },
      mask(true, true, true),
    ],
    [
      'inference (value type)',
      { kind: 'inference', valueType: true },
      mask(false, false, false),
    ],
    // config: G+M+E (tolerance, jit, reset, type-statement rollback).
    ['config', { kind: 'config' }, mask(true, true, true)],
  ];

  for (const [name, event, expected] of ROWS)
    test(name, () => expect(axisMaskOf(event)).toEqual(expected));
});

describe('containsSignatureArm: the callable write-classifier', () => {
  const CASES: [string, boolean][] = [
    ['integer', false],
    ['string', false],
    ['function', true],
    ['unknown', true], // opaque: conservative
    ['any', true],
    ['(number) -> number', true],
    ['list<integer>', false],
    ['list<(number) -> number>', true], // the R1 shape
    ['tuple<integer, (number) -> boolean>', true],
    ['set<(number) -> number>', true],
    ['dictionary<(number) -> number>', true],
    ['((number) -> number) | nothing', true], // the At-over-callbacks union
    ['integer | string', false],
    ['broadcastable<number>', false],
  ];
  // An applied parameterized nominal keeps its type arguments — an arm in an
  // argument position must classify as containing (reference `args` branch).
  test('applied nominal reference with a callable argument -> true', () => {
    expect(
      containsSignatureArm({
        kind: 'reference',
        name: 'box',
        alias: false,
        def: 'integer',
        args: [parseType('(number) -> number')!],
      })
    ).toBe(true);
  });
  for (const [t, expected] of CASES)
    test(`${t} -> ${expected}`, () =>
      expect(containsSignatureArm(parseType(t))).toBe(expected));
});

describe('choke-point pin: no direct axis writes outside the lifecycle', () => {
  // The step-2b cutover made `noteStateEvent` the sole writer of the
  // invalidation axes. This pin fails when any site writes an axis
  // directly — the "each site hand-picks counters" failure mode the
  // design's §3 closes structurally.
  const fs = require('node:fs') as typeof import('node:fs');
  const path = require('node:path') as typeof import('node:path');

  function* tsFiles(dir: string): Generator<string> {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) yield* tsFiles(p);
      else if (entry.name.endsWith('.ts')) yield p;
    }
  }

  test('src contains no direct writes to the three axes', () => {
    const root = path.join(__dirname, '../../src');
    const offenders: string[] = [];
    const write =
      /_(anyVersion|semanticVersion|worldVersion)\s*(\+=|-=|\+\+|--|=\s*[^=])/;
    for (const file of tsFiles(root)) {
      if (file.endsWith('engine-configuration-lifecycle.ts')) continue;
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*'))
          continue;
        if (write.test(line))
          offenders.push(`${path.relative(root, file)}:${i + 1}: ${line.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('no-op dispatch guard (design §4, step 5)', () => {
  test('an identity re-write dispatches nothing — no axis, no writeVersion', () => {
    const ce = new ComputeEngine();
    ce.assign('nv', 7);
    const def = ce.symbol('nv').valueDefinition!;
    const stored = def.value;
    const a0 = ce._anyVersion;
    const c0 = ce._callableVersion;
    const w0 = def._writeVersion;
    def.value = stored; // the IDENTICAL object: state-identical write
    expect(ce._anyVersion).toBe(a0);
    expect(ce._callableVersion).toBe(c0);
    expect(def._writeVersion).toBe(w0);
  });

  test('a distinct-but-equal value still dispatches (identity only)', () => {
    const ce = new ComputeEngine();
    // Function expressions are always-fresh instances (small-integer
    // literals are INTERNED — `ce.box(7)` twice is the same object, which
    // the guard would legitimately treat as an identity write).
    ce.assign('nv', ce.box(['List', 1, 2]));
    const def = ce.symbol('nv').valueDefinition!;
    const a0 = ce._anyVersion;
    def.value = ce.box(['List', 1, 2]); // structurally equal, fresh object
    expect(ce._anyVersion).toBeGreaterThan(a0);
  });

  test('same-signature/different-body redefinition still dispatches', () => {
    const ce = new ComputeEngine();
    ce.assign('nf', ce.parse('x \\mapsto x + 1'));
    const c0 = ce._callableVersion;
    ce.assign('nf', ce.parse('x \\mapsto x + 2')); // same arrow, new body
    expect(ce._callableVersion).toBeGreaterThan(c0);
  });
});

describe('end-to-end advancement (legacy counters, public API)', () => {
  // These pin today's ADVANCEMENT behavior through real operations — the
  // outer layer of the parity gate, and the baseline the cutover must
  // preserve. Advancement, not magnitude: double-bumps are legal.
  let ce: ComputeEngine;
  beforeEach(() => {
    ce = new ComputeEngine();
  });

  const advanced = (f: () => void): AxisMask => {
    const a0 = ce._anyVersion;
    const s0 = ce._semanticVersion;
    const w0 = ce._worldVersion;
    f();
    return mask(
      ce._anyVersion > a0,
      ce._semanticVersion > s0,
      ce._worldVersion > w0
    );
  };

  test('a scalar assign advances any+semantic, not world', () => {
    ce.assign('xprobe', 1);
    expect(advanced(() => ce.assign('xprobe', 2))).toEqual(
      mask(true, true, false)
    );
  });

  test('an assume advances all three', () => {
    ce.declare('yprobe', 'real');
    expect(advanced(() => ce.assume(ce.parse('yprobe > 0')))).toEqual(
      mask(true, true, true)
    );
  });

  test('a tolerance change advances all three', () => {
    expect(
      advanced(() => {
        ce.tolerance = 1e-8;
      })
    ).toEqual(mask(true, true, true));
  });

  test('a fresh declare advances any (and only any beyond its own writes)', () => {
    const m = advanced(() => ce.declare('zprobe', 'integer'));
    expect(m.any).toBe(true);
    expect(m.world).toBe(false);
  });
});
