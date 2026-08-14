import { ComputeEngine } from '../../src/compute-engine';
import {
  overloadArms,
  resolveOverload,
} from '../../src/compute-engine/boxed-expression/overload';

//
// Phase 2c acceptance — TRIAL-BASED overload resolution
// (`docs/plans/2026-08-13-inference-tx-design.md`, "No new import cycle" /
// "Repairs are not trialed" / phasing §2c).
//
// An overload arm is admitted by running full validation on it in TRIAL mode
// under a repair-forbidding rollback frame, replacing the hand-mirrored
// write-free gate filter. These tests port the overload design's
// write-freedom guarantees to the trial mechanism: rejected arms leave no
// trace, §4.3's join inference is computed over the arms whose trials
// succeeded, blame stays per-arm, and the repair-precondition no-fallback
// semantics is byte-compatible with the filter era.
//

describe('OVERLOAD TRIALS — write-freedom via rollback', () => {
  test('a REJECTED arm’s trial narrowing does not leak onto the operand', () => {
    const ce = new ComputeEngine();
    // Arm 2's trial narrows y toward list<integer> before failing on the
    // second operand; the rollback must undo that narrowing, and the final
    // inference is the §4.3 join over the SURVIVING arms only (arm 1).
    ce.declare(
      'f',
      '((integer, string) -> integer) & ((list<integer>, integer) -> integer)'
    );
    ce.box('y');
    const call = ce.box(['f', 'y', { str: 'a' }]);
    expect(call.isValid).toBe(true);
    expect(ce.box('y').type.toString()).toBe('integer');
  });

  test('§4.3 — inference into an operand is the JOIN of the surviving arms', () => {
    const ce = new ComputeEngine();
    ce.declare(
      'g',
      '((set<real>, integer) -> real) & ((collection, integer) -> any)'
    );
    const call = ce.box(['g', 'S', 'n']);
    expect(call.isValid).toBe(true);
    // Both arms survive: S gets widen(set<real>, collection) = collection,
    // never the selected (more specific) arm's set<real>.
    expect(ce.box('S').type.toString()).toBe('collection');
    expect(ce.box('n').type.toString()).toBe('integer');
  });

  test('a no-match call leaves ALL trial writes rolled back', () => {
    const ce = new ComputeEngine();
    ce.declare(
      'h',
      '((integer, integer) -> integer) & ((string, string) -> string)'
    );
    ce.declare('b', 'boolean');
    ce.box('z');
    // No arm admits (b: boolean refutes both), but each arm's trial ran and
    // narrowed z before failing on b. z must be untouched.
    const call = ce.box(['h', 'z', 'b']);
    expect(call.isValid).toBe(false);
    expect(ce.box('z').type.toString()).toBe('unknown');
  });
});

describe('OVERLOAD TRIALS — per-arm blame', () => {
  test('cross-satisfying arms still blame (never reported valid)', () => {
    const ce = new ComputeEngine();
    // Each arm rejects a different position; every position is admitted by
    // SOME arm. Per-column blame would mark nothing.
    ce.declare(
      'f',
      '((string, integer) -> integer) & ((integer, string) -> integer)'
    );
    const call = ce.box(['f', 'True', 'False']);
    expect(call.isValid).toBe(false);
  });

  test('single-culprit blame stays precise: only the failing operand is marked', () => {
    const ce = new ComputeEngine();
    ce.declare(
      'f',
      '((list<integer>, integer) -> integer) & ((set<real>, integer) -> real)'
    );
    const call = ce.box(['f', ['List', 1, 2, 3], { str: 'x' }]);
    expect(call.isValid).toBe(false);
    // The list satisfies the near-miss arm's first position — only the
    // second operand carries the error.
    expect(call.ops[0].isValid).toBe(true);
    expect(call.ops[1].isValid).toBe(false);
  });
});

describe('OVERLOAD TRIALS — select once, no fallback', () => {
  test('resolveOverload runs each surviving arm’s trial exactly once and never re-selects', () => {
    // The no-fallback contract is structural: resolution trials every
    // prefilter-surviving arm ONCE (the §4.3 join needs the complete viable
    // set), selects the most specific, and the winner's real validation has
    // no second chance — there is no retry loop to fall back into. Pinned
    // mechanically with a counting stub trial.
    const ce = new ComputeEngine();
    const arms = overloadArms(
      ce.type(
        '((integer) -> integer) & ((number) -> number) & ((string) -> string)'
      ).type
    )!;
    const ops = [ce.box(7)];
    const trialed: number[] = [];
    const resolution = resolveOverload(
      ce,
      ops,
      arms,
      undefined,
      undefined,
      (declared) => {
        trialed.push(arms.indexOf(declared));
        // Reject the most specific arm (integer): selection must fall to
        // the next survivor rather than ever re-running a trial.
        return declared === arms[0] ? [0] : null;
      }
    );
    // One trial per prefilter-surviving arm (the string arm is provably
    // disjoint from an integer literal and is never trialed), in
    // declaration order, none repeated.
    expect(trialed).toEqual([0, 1]);
    expect(resolution.selected).toBe(arms[1]);
    expect(resolution.viable).toHaveLength(1);
  });

  test('a repair-precondition admission agrees between trial and real validation', () => {
    const ce = new ComputeEngine();
    // A·v (A fresh, v declared vector) reaches arm 1 (`matrix`) through the
    // same provisional admissions in the arm's TRIAL and in the winner's
    // REAL validation — the two must agree (the trial IS validateArguments),
    // so the call resolves to the matrix arm without leaking any trial
    // state onto A.
    ce.declare('v', 'vector');
    ce.declare('q', '((matrix) -> integer) & ((collection) -> string)');
    const call = ce.box(['q', ['Multiply', 'A', 'v']]);
    expect(call.isValid).toBe(true);
    expect(call.type.toString()).toBe('integer'); // the matrix arm's result
    expect(ce.box('A').type.toString()).toBe('number'); // no phantom matrix
  });
});

describe('OVERLOAD TRIALS — result typing reads the validated resolution', () => {
  test('.type reports the arm full validation selected, not the prefilter’s pick', () => {
    const ce = new ComputeEngine();
    // A DECLARED (non-inferred) `number` operand: the integer arm's trial
    // fails (no narrowing of a declared type), so validation selects the
    // number arm. The trial-less prefilter would keep the integer arm (the
    // types overlap) and rank it more specific — the cached resolution is
    // what keeps `.type` consistent with the validation.
    ce.declare('u', 'number');
    ce.declare('p', '((integer) -> integer) & ((number) -> number)');
    const call = ce.box(['p', 'u']);
    expect(call.isValid).toBe(true);
    expect(call.type.toString()).toBe('number');
  });

  test('an idempotent rewrite keeps the inner call’s validated resolution', () => {
    const ce = new ComputeEngine();
    ce.declare('u', 'number');
    ce.declare('f', {
      signature: '((integer) -> integer) & ((number) -> number)',
      idempotent: true,
    });
    // f(f(u)) rewrites to the retained inner f(u); the inner call's cached
    // resolution must ride along, or `.type` falls to the prefilter-only
    // cold path and reports the integer arm.
    const call = ce.box(['f', ['f', 'u']]);
    expect(call.toString()).toBe('f(u)');
    expect(call.type.toString()).toBe('number');
  });

  test('an inferred operand narrows to the selected arm and types accordingly', () => {
    const ce = new ComputeEngine();
    ce.declare('p', '((integer) -> integer) & ((string) -> string)');
    expect(ce.box(['p', 7]).type.toString()).toBe('integer');
    expect(ce.box(['p', { str: 'a' }]).type.toString()).toBe('string');
  });
});

describe('OVERLOAD TRIALS — trials nest inside enclosing rollback frames', () => {
  test('an overload call canonicalized inside a rollback frame resolves normally and rolls back cleanly', () => {
    const ce = new ComputeEngine();
    ce.declare(
      'g',
      '((set<real>, integer) -> real) & ((collection, integer) -> any)'
    );
    ce._withBoxingPassWindow(() =>
      ce._withRolledBackInference(() => {
        const call = ce.box(['g', 'S2', 'n2']);
        expect(call.isValid).toBe(true);
        expect(ce.box('S2').type.toString()).toBe('collection');
      })
    );
    // The enclosing frame (the static checking pass's shape) undoes the
    // call's OWN inference too — including the trial-era join writes.
    expect(ce.lookupDefinition('S2')).toBeUndefined();
    expect(ce.lookupDefinition('n2')).toBeUndefined();
  });
});
