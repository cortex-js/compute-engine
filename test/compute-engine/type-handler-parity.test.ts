/**
 * Parity and purity pins for the dual `type`-handler shapes
 * (`typeHandlerKind: 'types'` — the staged signature change of
 * `docs/plans/2026-08-22-type-handlers-on-types.md` §5.3 step 2).
 *
 * The first migrated handlers are `Coalesce`, `Hold` and `ReleaseHold`
 * (`library/core.ts`). The corpus below pins their derived types to the
 * values the EXPRESSIONS-shape handlers answered on the unconverted tree
 * (captured at commit bca1105e before the conversion), so any behavior
 * change from the shape flip fails here byte-for-byte.
 *
 * The purity half pins the shape's contract: a `'types'` handler receives
 * descriptors, never expressions, and the runtime guard (always on under
 * test) throws if a handler call moves any invalidation axis. `Hold` and
 * `ReleaseHold` are lazy operators with no `canonical` handler, so through
 * `ce.box` their operands arrive RAW and unbound — the corpus exercises
 * exactly that route.
 */

import { ComputeEngine } from '../../src/compute-engine';
import type {
  IComputeEngine,
  OperandDescriptor,
} from '../../src/compute-engine/global-types';

describe('parity: migrated handlers answer what the expressions shape answered', () => {
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
    ['ReleaseHold of a held literal', ['ReleaseHold', ['Hold', 2]], 'finite_integer'],
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

  test('evaluation through the migrated definitions is untouched', () => {
    expect(
      ce.box(['ReleaseHold', ['Hold', ['Add', 1, 2]]] as any)
        .evaluate()
        .toString()
    ).toBe('3');
    expect(ce.box(['Coalesce', 5, 7] as any).evaluate().toString()).toBe('5');
  });
});

describe('purity: type reads through the migrated handlers move no cache axis', () => {
  test('repeated reads and forced re-derivations both drift zero', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'integer');
    const exprs = [
      ce.box(['Coalesce', 'x', 2.5] as any),
      ce.box(['Hold', ['Add', 'x', 1]] as any),
      ce.box(['ReleaseHold', ['Hold', 2]] as any),
    ];
    for (const e of exprs) e.type; // Warm: the first read may bind.

    let drift = 0;
    for (let i = 0; i < 5; i++) {
      // An unrelated declaration retires the type memo, so each round
      // re-derives through the handler rather than answering from cache.
      ce.declare(`z${i}`, 'number');
      const before = ce._anyVersion;
      for (const e of exprs) e.type;
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
        (engine as unknown as IComputeEngine).declare(`leak${counter++}`, 'number');
        return 'unknown';
      },
    });
    expect(() => ce.box(['LeakyT', 1] as any).type).toThrow(
      /LeakyT.*modified engine state/s
    );
  });
});
