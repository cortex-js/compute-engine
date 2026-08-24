/**
 * Behavior and contract pins for operator `type` handlers that take
 * operand DESCRIPTORS (`typeHandlerKind: 'types'`) and for the engine
 * invariant behind that shape: deriving an application's type never
 * modifies engine state. Everything in this file is durable regression
 * coverage. What each block guards:
 *
 * - `Coalesce`/`Hold`/`ReleaseHold` derive these exact types, byte for
 *   byte. `Hold`/`ReleaseHold` are lazy with no `canonical` handler, so
 *   through `ce.box` their operands arrive RAW and unbound — these rows
 *   pin that raw-operand typing route.
 * - A `Coalesce` result never promises presence its last operand does not
 *   (§3.D of the missing-value typing design): the last operand's
 *   `missing` arm survives into the result type. Guards against a
 *   once-shipped bug where the type-derivation call site pre-stripped it.
 * - `GammaRegularized`/`BetaRegularized` claim `finite_real` only on
 *   their proven domain and `number` otherwise (the non-finite typing
 *   convention: claim wide whenever NaN is possible).
 * - Deriving a type is state-pure: repeated and forced re-derivations
 *   move no cache axis, a `'types'`-shape handler receives descriptors
 *   (never expressions), and the runtime guard — always on under test —
 *   throws on a handler that writes state, including one declared through
 *   the public `ce.declare` route.
 *
 * Provenance: the descriptor handler shape and these pins were introduced
 * by the staged handler-signature change recorded in
 * `docs/plans/2026-08-22-type-handlers-on-types.md`; the operator type
 * pins were first captured from the pre-descriptor handlers at commit
 * bca1105e and are unchanged since. The migration's own disposable
 * apparatus — the differential shadow — lives separately in
 * `type-handler-shadow-parity.test.ts` and its fixture.
 */

import { ComputeEngine } from '../../src/compute-engine';
import type {
  IComputeEngine,
  OperandDescriptor,
} from '../../src/compute-engine/global-types';

describe('Coalesce, Hold and ReleaseHold type derivation (raw-operand route)', () => {
  let ce: ComputeEngine;
  beforeEach(() => {
    ce = new ComputeEngine();
    ce.declare('x', 'integer');
  });

  const CORPUS: [name: string, json: unknown, expected: string][] = [
    ['Coalesce of two literals', ['Coalesce', 1, 2.5], 'finite_real'],
    ['Coalesce symbol/literal', ['Coalesce', 'x', 2.5], 'real'],
    ['Coalesce single operand', ['Coalesce', 'x'], 'integer'],
    [
      'Coalesce with exact rational',
      ['Coalesce', ['Rational', 1, 3], 2.5],
      'finite_real',
    ],
    ['Hold of a symbol', ['Hold', 'q'], 'symbol'],
    ['Hold of a string', ['Hold', { str: 'abc' }], 'string'],
    ['Hold of a number', ['Hold', 3.14], 'finite_real'],
    ['Hold of a raw application', ['Hold', ['Add', 'x', 1]], 'unknown'],
    ['Hold of a raw list', ['Hold', ['List', 1, 2]], 'unknown'],
    [
      'Hold of a function literal',
      ['Hold', ['Function', ['Add', 'n', 1], 'n']],
      'unknown',
    ],
    [
      'ReleaseHold of a held literal',
      ['ReleaseHold', ['Hold', 2]],
      'finite_integer',
    ],
    ['ReleaseHold of a symbol', ['ReleaseHold', 'q'], 'unknown'],
    [
      'ReleaseHold of a held application',
      ['ReleaseHold', ['Hold', ['Add', 1, 2]]],
      'unknown',
    ],
  ];

  for (const [name, json, expected] of CORPUS)
    test(name, () => {
      expect(ce.box(json as any).type.toString()).toBe(expected);
    });

  test("Coalesce's LAST operand keeps its full type, `missing` arm included", () => {
    // Every arm but the last contributes its stripped type, the last its
    // FULL type — a Coalesce result never promises presence its last
    // operand does not (§3.D of the missing-value typing design). The
    // type-derivation call site folds the missing-strip override into
    // descriptors only for `propagate` operators for exactly this reason:
    // a `handle` operator's handler owns the absence semantics.
    ce.declare('m', 'integer | missing');
    expect(ce.box(['Coalesce', 1, 'm'] as any).type.toString()).toBe(
      'integer | missing'
    );
    // At a NON-last position the arm is stripped by the handler itself.
    expect(ce.box(['Coalesce', 'm', 1] as any).type.toString()).toBe('integer');
  });

  test('the regularized gamma/beta claim finite_real only on their proven domain', () => {
    // `GammaRegularized(-1, 2)` evaluates to NaN, so an unconditional
    // `finite_real` claim would be unsound (and once was shipped): these
    // handlers narrow the claim only when positivity/range is proven, and
    // an unproven fact answers the wide `number` — the non-finite typing
    // convention.
    ce.declare('s', 'real');
    expect(ce.box(['GammaRegularized', 2, 3] as any).type.toString()).toBe(
      'finite_real'
    );
    expect(ce.box(['GammaRegularized', -1, 2] as any).type.toString()).toBe(
      'number'
    );
    expect(ce.box(['GammaRegularized', 's', 3] as any).type.toString()).toBe(
      'number'
    );
    expect(ce.box(['BetaRegularized', 0.5, 2, 3] as any).type.toString()).toBe(
      'finite_real'
    );
    expect(ce.box(['BetaRegularized', 2, 2, 3] as any).type.toString()).toBe(
      'number'
    );
  });

  test('ReleaseHold and Coalesce evaluate their operands correctly', () => {
    expect(
      ce
        .box(['ReleaseHold', ['Hold', ['Add', 1, 2]]] as any)
        .evaluate()
        .toString()
    ).toBe('3');
    expect(
      ce
        .box(['Coalesce', 5, 7] as any)
        .evaluate()
        .toString()
    ).toBe('5');
  });
});

describe("purity: deriving an application's type moves no cache axis", () => {
  test('repeated reads and forced re-derivations both drift zero', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'integer');
    const exprs = [
      ce.box(['Coalesce', 'x', 2.5] as any),
      ce.box(['Hold', ['Add', 'x', 1]] as any),
      ce.box(['ReleaseHold', ['Hold', 2]] as any),
    ];
    for (const e of exprs) expect(e.type).toBeDefined(); // Warm: the first read may bind.

    let drift = 0;
    for (let i = 0; i < 5; i++) {
      // An unrelated declaration retires the type memo, so each round
      // re-derives through the handler rather than answering from cache.
      ce.declare(`z${i}`, 'number');
      const before = ce._anyVersion;
      for (const e of exprs) expect(e.type).toBeDefined();
      drift += ce._anyVersion - before;
    }
    expect(drift).toBe(0);
  });
});

describe("user-declared 'types'-shape handlers", () => {
  test('ce.declare accepts the flag and the handler sees descriptors', () => {
    const ce = new ComputeEngine();
    const seen: OperandDescriptor[][] = [];
    ce.declare('EchoT', {
      signature: '(any) -> unknown',
      typeHandlerKind: 'types',
      type: (operands) => {
        seen.push([...operands]);
        return operands[0]?.type;
      },
    });
    const t = ce.box(['EchoT', 3] as any).type.toString();
    // The handler saw the literal's value-carrying type; the stored result
    // is widened back to its tier — the same widening every handler result
    // gets.
    expect(t).toBe('finite_integer');
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0][0].facts.finite).toBe(true);
    expect(seen[0][0].facts.sgn).toBe('positive');
  });

  test('a handler that writes engine state trips the purity guard', () => {
    const ce = new ComputeEngine();
    let counter = 0;
    ce.declare('LeakyT', {
      signature: '(any) -> unknown',
      typeHandlerKind: 'types',
      type: (_operands, { engine }) => {
        // Deliberate violation: the compile-time PureEngineView hides the
        // mutating surface, so the leak needs a cast — exactly the misuse
        // the runtime guard exists to catch.
        (engine as unknown as IComputeEngine).declare(
          `leak${counter++}`,
          'number'
        );
        return 'unknown';
      },
    });
    expect(() => ce.box(['LeakyT', 1] as any).type).toThrow(
      /LeakyT.*modified engine state/s
    );
  });
});
