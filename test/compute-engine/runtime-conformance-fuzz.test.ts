/**
 * Runtime-conformance fuzz (§4.4 of
 * `docs/plans/2026-08-22-type-handlers-on-types.md`).
 *
 * For every operator definition with a declared signature, apply each
 * wrong-kind probe value — routed through an `any`-typed symbol so the
 * static gate admits it and the evaluate handler actually runs — and require
 * the outcome to be an error value or an inert application. A handler that
 * instead RETURNS A VALUE from a wrong-kind operand trusted the strict
 * boxing gate to never hand it one (the `toBigint` rounding family:
 * `FactorInteger(2.5)` → `[(3, 1)]`), and that trust is what the R1 overlap
 * admission removes. The generic runtime conformance check at non-lazy
 * dispatch is what makes these rows error; `EXPECTED_FAILURES` pins the rows
 * that still leak, and §4.4 is done when it is empty.
 *
 * Scope — the fuzz probes exactly what the generic check polices:
 * - Definitions with a CUSTOM `canonical` handler are exempt: boxing never
 *   runs the declared-signature validation for them — the handler plus the
 *   lenient `checkNumericArgs` re-validation are the admission authority,
 *   and their declared signatures are deliberately looser than what the
 *   handlers accept (`Apply(3, 5)` is a constant nullary despite the
 *   `symbol` parameter; `Degrees(i)` flows through the linear conversion
 *   despite `(real)`). See the re-validation comment in `box.ts`.
 * - Function-typed parameters are exempt (Design E: admission is by
 *   compatibility, and the application itself checks).
 * - Collection-kind parameters (list, set, collection, indexed_collection,
 *   dictionary, tuple, record — NOT range) are exempt: their runtime
 *   conformance is the operator's own evaluate-time gate (D6.2 handler
 *   precedence — `expected-square-matrix` and friends), and several
 *   handlers deliberately accept lenient spellings (a `List` where a
 *   `tuple` shape is declared, a scalar as a 1×1 matrix).
 * - Open generic parameters are exempt: a free type variable cannot be
 *   judged without instantiation (the ground-type invariant — `admissionOf`
 *   asserts on an open type).
 * - A `list` probe is not applied to a broadcastable operator (that is a
 *   legitimate broadcast, not a wrong-kind operand).
 * - A probe whose CANONICAL form no longer has the operator under test is
 *   skipped: canonicalization rewrote the call into a different operator
 *   (`Rational(3, x)` → `Divide(3, x)`, `NotDivides(a, b)` →
 *   `Not(Divides(a, b))`, unary variadic folds like `Subtract(x)` → `x`),
 *   so the probed signature no longer governs the evaluated form — the
 *   rewritten operators' own signatures do, and their dispatch gets its own
 *   check. What such a rewrite drops (the pre-rewrite operator's stricter
 *   parameter contract) is a CANONICALIZATION property, out of reach of any
 *   dispatch-time mechanism.
 *
 * Lazy operators evaluate their own operands, so the generic check cannot
 * cover them (their guards are their own — §4.4, P4). For them the fuzz
 * asserts only that evaluation never THROWS on a wrong-kind operand: a
 * native-fault crash (the `CONDITIONS[name]` lookup TypeError this sweep
 * found) is a bug where an error value belongs, and a DELIBERATE diagnostic
 * throw reached by a wrong-kind operand is worth a pinned row here either
 * way. `EXPECTED_LAZY_THROWS` pins the offenders found.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { admissionOf } from '../../src/compute-engine/boxed-expression/value-membership';
import { overloadArms } from '../../src/compute-engine/boxed-expression/overload';
import { runtimeCheckExemptParam } from '../../src/compute-engine/boxed-expression/validate';
import { freeTypeVariables } from '../../src/common/type/instantiate';
import type { Type, FunctionSignature } from '../../src/common/type/types';
import type { Expression } from '../../src/compute-engine/global-types';

// ——— Expected failures (the §4.4 seed) ————————————————————————————
// Non-lazy probes whose outcome is a VALUE (or a throw) instead of an error
// or an inert application. Regenerate by running this file and copying the
// reported diff. The goal state is an empty list.
const EXPECTED_FAILURES: string[] = [];

// Lazy operators that THROW on a wrong-kind operand (should produce an error
// value instead). Goal state: empty.
const EXPECTED_LAZY_THROWS: string[] = [];

// ——— Probe values ———————————————————————————————————————————————————
// The five §4.4 probes plus `2.5`: the plain non-integer float is the probe
// that exposes the `toBigint` rounding family most directly (ROADMAP:
// "Integer-domain operators ROUND a non-integer operand").
// `nothing` (the ground `Nothing` unit value) is a seventh probe: it has no
// `concreteValueOf`, so it exercised the check's "still symbolic" gate — a
// wrong-kind `Nothing` used to slip through to lenient handlers
// (`IsTriangular(Nothing)` answered `False`). Probed at REQUIRED positions
// only: an evaluated `Nothing` at an optional or variadic slot is DROPPED
// as the omitted-argument marker (the engine-wide convention `flatten`
// applies at canonicalization), so `Xor(Nothing)` is `Xor()` — the shorter
// call's own semantics, not a wrong-kind operand.
const PROBE_NAMES = [
  'str',
  'list',
  'complex',
  'nan',
  '+oo',
  '2.5',
  'nothing',
] as const;

// Skipped operators:
// - `Input`/`input` perform real I/O (the Node path synchronously blocks a
//   jest worker waiting on stdin).
// - The state mutators change the shared engine mid-fuzz: an `Assign` probe
//   rebinds the harness's own probe symbols, so every later probe would
//   measure the contamination, not the operator.
const SKIP = new Set([
  'Input',
  'input',
  'Assign',
  'Declare',
  'DeclareType',
  'Assume',
  'Forget',
]);

// `nan-propagated` is the Contract B propagate policy answering
// (`docs/ERROR-MODEL.md` §4): a `NaN` probe into a precise numeric carrier
// with a numeric result evaluates to `NaN`. That is CONFORMANT behavior —
// the declared (or derived) per-slot NaN policy, not a handler trusting the
// static gate — so it is counted separately from `value`.
type Outcome = 'error' | 'inert' | 'value' | 'nan-propagated' | 'throw';
type Row = { key: string; lazy: boolean; outcome: Outcome; detail: string };

function runFuzz(): Row[] {
  const ce = new ComputeEngine();

  const mkProbe: Record<(typeof PROBE_NAMES)[number], () => Expression> = {
    str: () => ce.string('fuzz'),
    list: () => ce.box(['List', 7, 11]),
    complex: () => ce.box(['Complex', 1, 2]),
    nan: () => ce.NaN,
    '+oo': () => ce.PositiveInfinity,
    '2.5': () => ce.box(2.5),
    nothing: () => ce.Nothing,
  };

  // — Param-kind classifier: the CHECK's own exemption list, so the fuzz
  // probes exactly the positions the generic check polices. —
  const isOutOfScopeParam = runtimeCheckExemptParam;

  // — Enumerate operator definitions —
  type OpRow = {
    name: string;
    lazy: boolean;
    broadcastable: boolean;
    sig: Type;
  };
  const ops: OpRow[] = [];
  {
    let scope = (ce as any).context?.lexicalScope;
    const seen = new Set<string>();
    while (scope) {
      for (const [name, def] of scope.bindings) {
        if (seen.has(name)) continue;
        seen.add(name);
        if (!('operator' in def) || !def.operator) continue;
        const op = def.operator;
        if (!op.signature) continue;
        // Canonical-handler definitions are out of scope (see the header).
        if (op.canonical !== undefined) continue;
        ops.push({
          name,
          lazy: op.lazy === true,
          broadcastable: op.broadcastable === true,
          sig: op.signature.type,
        });
      }
      scope = scope.parent;
    }
    ops.sort((a, b) => a.name.localeCompare(b.name));
  }

  const armsOf = (sig: Type): FunctionSignature[] => {
    if (typeof sig !== 'string' && sig.kind === 'signature') return [sig];
    return (overloadArms(sig) ?? []) as FunctionSignature[];
  };

  // — Fillers for non-probe positions —
  let fillerSymCount = 0;
  const fillerFor = (param: Type): Expression => {
    // An open generic parameter cannot be tested with `admissionOf`
    // (ground-type invariant) — fall straight to the unknown-symbol filler.
    if (freeTypeVariables(param).size > 0)
      return ce.symbol(`__fzu${++fillerSymCount}`);
    const pool = [
      ce.box(3),
      ce.box(2),
      ce.string('x'),
      ce.True,
      ce.box(['List', 1, 2]),
      ce.box(['Function', 'x', 'x']),
    ];
    for (const cand of pool) if (admissionOf(cand, param) === 'admit') return cand;
    // Fallback: a fresh undeclared symbol (unknown type — admitted anywhere).
    return ce.symbol(`__fzu${++fillerSymCount}`);
  };

  let probeSymCount = 0;
  const anySymbolHolding = (value: Expression): Expression => {
    const name = `__fz${++probeSymCount}`;
    ce.declare(name, 'any');
    ce.assign(name, value);
    return ce.symbol(name);
  };

  const rows: Row[] = [];

  for (const op of ops) {
    if (SKIP.has(op.name)) continue;
    const arms = armsOf(op.sig);
    if (arms.length === 0) continue;
    // Probe against the FIRST arm's parameter list; a value is wrong-kind
    // only when EVERY arm refutes it at that position (an overload set
    // admits through any arm).
    const arm = arms[0];
    const reqParams = arm.args?.map((a) => a.type) ?? [];
    const optParam = arm.optArgs?.[0]?.type;
    const varParam = arm.variadicArg?.type;

    for (const probeName of PROBE_NAMES) {
      const probe = mkProbe[probeName]();
      const refutedEverywhere = (
        paramAt: (armX: FunctionSignature, i: number) => Type | undefined,
        i: number
      ) =>
        arms.every((a) => {
          const p = paramAt(a, i);
          if (p === undefined || freeTypeVariables(p).size > 0) return false;
          return admissionOf(probe, p) === 'refute';
        });

      // Positions where this probe is wrong-kind.
      const positions: number[] = [];
      for (let i = 0; i < reqParams.length; i++) {
        const p = reqParams[i];
        if (isOutOfScopeParam(p)) continue;
        if (probeName === 'list' && op.broadcastable) continue;
        if (refutedEverywhere((a, k) => a.args?.[k]?.type, i)) positions.push(i);
      }
      const variadicProbe =
        varParam !== undefined &&
        !isOutOfScopeParam(varParam) &&
        !(probeName === 'list' && op.broadcastable) &&
        // A `Nothing` at a variadic slot is the omitted argument (see the
        // probe-list note) — the call it makes is the shorter one.
        probeName !== 'nothing' &&
        arms.every(
          (a) =>
            a.variadicArg !== undefined &&
            freeTypeVariables(a.variadicArg.type).size === 0 &&
            admissionOf(probe, a.variadicArg.type) === 'refute'
        );
      const optionalProbe =
        optParam !== undefined &&
        !isOutOfScopeParam(optParam) &&
        !(probeName === 'list' && op.broadcastable) &&
        // Same omitted-argument convention as the variadic slot.
        probeName !== 'nothing' &&
        arms.every(
          (a) =>
            a.optArgs?.[0] !== undefined &&
            freeTypeVariables(a.optArgs[0].type).size === 0 &&
            admissionOf(probe, a.optArgs[0].type) === 'refute'
        );

      if (positions.length === 0 && !variadicProbe && !optionalProbe) continue;

      // Build ONE call: the wrong value (through an any-typed symbol) at
      // every wrong-kind position, a neutral filler at the rest.
      const args: Expression[] = [];
      for (let i = 0; i < reqParams.length; i++)
        args.push(
          positions.includes(i)
            ? anySymbolHolding(probe)
            : fillerFor(reqParams[i])
        );
      if (optionalProbe) args.push(anySymbolHolding(probe));
      if (variadicProbe && !optionalProbe) args.push(anySymbolHolding(probe));

      const key = `${op.name} × ${probeName}`;
      try {
        const call = ce.function(op.name, args);
        const canonicalOp = call.operator;
        // Canonicalization rewrote the call into a different operator: the
        // probed signature no longer governs the evaluated form (see the
        // scope note in the header).
        if (canonicalOp !== op.name) continue;
        const result = call.evaluate();
        let outcome: Outcome;
        if (!result.isValid) outcome = 'error';
        else if (result.operator === canonicalOp || result.isSame(call))
          outcome = 'inert';
        else if (probeName === 'nan' && result.isNaN === true)
          outcome = 'nan-propagated';
        else outcome = 'value';
        rows.push({
          key,
          lazy: op.lazy,
          outcome,
          detail: result.toString().slice(0, 60),
        });
      } catch (e: any) {
        rows.push({
          key,
          lazy: op.lazy,
          outcome: 'throw',
          detail: String(e?.message ?? e).slice(0, 60),
        });
      }
    }
  }
  return rows;
}

// The sweep produces deliberate diagnostic noise (handlers canonicalizing
// garbage print through console) — run it silenced.
let rows: Row[] = [];
beforeAll(() => {
  const saved = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    info: console.info,
    assert: console.assert,
  };
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
  console.info = () => {};
  console.assert = () => {};
  try {
    rows = runFuzz();
  } finally {
    Object.assign(console, saved);
  }
});

describe('runtime conformance fuzz (§4.4)', () => {
  test('non-lazy operators error or stay inert on wrong-kind operands (expected failures pinned)', () => {
    const failing = rows
      .filter((r) => !r.lazy && (r.outcome === 'value' || r.outcome === 'throw'))
      .map((r) => r.key)
      .sort();
    expect(failing).toEqual(EXPECTED_FAILURES);
  });

  test('lazy operators never throw on wrong-kind operands (expected throws pinned)', () => {
    const throwing = rows
      .filter((r) => r.lazy && r.outcome === 'throw')
      .map((r) => r.key)
      .sort();
    expect(throwing).toEqual(EXPECTED_LAZY_THROWS);
  });
});
