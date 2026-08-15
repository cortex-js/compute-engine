import { ComputeEngine } from '../../src/compute-engine';

/**
 * The canonicalization walk must honor an enclosing `withTimeLimit` span
 * DURING the walk, not only at the boundaries between walks.
 *
 * The walk is a plain recursion, not a generator, so `run()`/`runAsync()` —
 * which enforce a deadline between yields — do not cover it. Until
 * 2026-08-15 there was no in-walk check at all, so a single long
 * canonicalization ran to completion no matter how small the budget: the
 * overrun was proportional to the INPUT SIZE, not bounded by the limit (a
 * 12 000-term sum under a 1 ms budget ran 2 799 ms). A deadline is a
 * correctness boundary, so that is a defect regardless of how large today's
 * workloads are. Fixed by a strided `checkDeadline` in `boxFunctionInternal`
 * (`boxed-expression/box.ts`).
 *
 * **These assertions are deliberately on OUTCOMES, never on elapsed
 * milliseconds** (the project's wall-clock test doctrine: under parallel load
 * a timing assertion measures machine state, not the engine). The
 * discriminator is that an unbounded walk COMPLETES and a bounded one
 * CANCELS — which is exactly the behavior change, and does not need a
 * stopwatch to detect.
 */
describe('canonicalization honors a deadline DURING the walk', () => {
  /**
   * A sum with `n` distinct non-trivial terms. Each term canonicalizes to
   * several nodes, so this is one long canonicalization STRETCH rather than
   * many short ones — the shape the granularity bug needs.
   */
  function bigSum(n: number): string {
    const terms: string[] = [];
    for (let i = 1; i <= n; i++)
      terms.push(`\\frac{x^{${i}}+${i}}{\\sqrt{${i}x+1}}`);
    return terms.join('+');
  }

  // Large enough that canonicalization costs hundreds of milliseconds on the
  // machines this suite runs on, so the 1 ms budget below has ~2 orders of
  // magnitude of headroom and the outcome does not depend on machine speed.
  const LATEX = bigSum(2000);

  it('cancels a long canonicalization instead of running it to completion', () => {
    const ce = new ComputeEngine();
    const raw = ce.parse(LATEX, { canonical: false });

    let cancelled = false;
    let completed = false;
    try {
      ce.withTimeLimit({ ms: 1, label: 'granularity-probe' }, () => {
        raw.canonical;
        completed = true;
      });
    } catch (e) {
      // Identified by NAME, never `instanceof`: plugin bundles re-bundle
      // engine code, so a `CancellationError` crossing a bundle boundary is
      // not an instance of the host's class.
      cancelled =
        e instanceof Error &&
        e.name === 'CancellationError' &&
        (e as { cause?: unknown }).cause === 'timeout';
    }

    // The OUTCOME assertion: before the fix this walk always reached
    // `completed = true`. There is no timing assertion here by design.
    expect(completed).toBe(false);
    expect(cancelled).toBe(true);
  });

  it('attributes the cancellation to the span that owns the budget', () => {
    const ce = new ComputeEngine();
    const raw = ce.parse(LATEX, { canonical: false });

    let attribution: unknown = 'never threw';
    try {
      ce.withTimeLimit({ ms: 1, label: 'granularity-probe' }, () => {
        raw.canonical;
      });
    } catch (e) {
      attribution = (e as { attribution?: unknown }).attribution;
    }

    // Without the owner the console line reads a bare "Timeout exceeded",
    // indistinguishable from an engine-imposed deadline — and no such
    // deadline exists, since a frame is armed only by a `withTimeLimit` span.
    expect(attribution).toBe('granularity-probe');
  });

  it('still canonicalizes the same expression when the budget is generous', () => {
    const ce = new ComputeEngine();
    const raw = ce.parse(LATEX, { canonical: false });

    // Non-vacuity for the test above: the cancellation must come from the
    // BUDGET, not from the expression being uncanonicalizable. A generous
    // limit takes the identical path and must produce a canonical result.
    const result = ce.withTimeLimit({ ms: 120_000 }, () => raw.canonical);
    expect(result.isCanonical).toBe(true);
    expect(result.operator).toBe('Add');
  });

  it('does not let a canonical handler swallow the cancellation', () => {
    // `applyOperatorDefinition` wraps every `canonical` handler in a
    // try/catch that logs and falls back to a NON-canonical expression. That
    // is right for a handler that failed on its operands and wrong for a
    // cancellation: the strided check above fires from inside any node the
    // handler CONSTRUCTS, so without an exception for it the span returned
    // NORMALLY holding a silently degraded expression — worse than the
    // unbounded overrun this whole entry exists to fix, because it looks like
    // success. The wide-sum fixture above cannot catch this: its operands are
    // canonicalized before the handler runs, so its trip point is the
    // operand-boxing loop, which sits OUTSIDE the try.
    const ce = new ComputeEngine();
    ce.declare('BuildLots', {
      signature: '(number) -> number',
      // Builds many fresh nodes, so the deadline trips inside the handler.
      canonical: (ops, { engine }) => {
        let acc = ops[0] ?? engine.One;
        for (let i = 0; i < 20_000; i++)
          acc = engine.function('Add', [acc, engine.number(i)]);
        return acc;
      },
    });
    const raw = ce.box(['BuildLots', 'x'], { form: 'raw' });

    let cancelled = false;
    let returned: unknown = 'never returned';
    try {
      returned = ce.withTimeLimit(
        { ms: 1, label: 'swallow-probe' },
        () => raw.canonical.isCanonical
      );
    } catch (e) {
      cancelled =
        e instanceof Error &&
        e.name === 'CancellationError' &&
        (e as { cause?: unknown }).cause === 'timeout';
    }

    expect(cancelled).toBe(true);
    // Before the fix this read `false` — the degraded, non-canonical result.
    expect(returned).toBe('never returned');
  });

  it('leaves canonicalization unbounded when no span is armed', () => {
    // A deadline frame is armed ONLY by an enclosing `withTimeLimit`, so the
    // strided check must be inert outside a span — otherwise every caller
    // would inherit a budget nobody asked for.
    const ce = new ComputeEngine();
    const result = ce.parse(LATEX);
    expect(result.isCanonical).toBe(true);
    expect(result.operator).toBe('Add');
  });
});
