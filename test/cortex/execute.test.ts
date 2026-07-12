import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';
import { executeCortex } from '../../src/cortex/execute-cortex';

//
// Cortex execution (Phase 4, Stage 2). `executeCortex` parses a program and
// evaluates each top-level statement sequentially in the engine's current
// scope (a notebook cell-chain), symbolic-by-default (the exactness contract),
// with runtime problems flowing as `["Error", …]` *values* and parse problems
// as diagnostics. See `roadmap/cortex/phase-4-semantics.md`.
//

/** Run a Cortex program against a fresh engine, injecting the engine's own
 * LaTeX parser for `$…$` islands. */
function run(
  source: string,
  options?: { allowHostPragmas?: boolean }
): ReturnType<typeof executeCortex> {
  const ce = new ComputeEngine();
  const parseLatex = (latex: string): MathJsonExpression => ce.parse(latex).json;
  return executeCortex(ce, source, { parseLatex, ...options });
}

describe('CORTEX EXECUTE — programs', () => {
  test('a declaration, a reassignment, and the last-statement value', () => {
    // Declarations persist across statements (one shared scope, no push/pop
    // around the program), so the reassignment sees `x` and the final bare
    // `x` reads its updated value.
    const { value, diagnostics } = run('let x = 5\nx = x + 3\nx');
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(8);
  });

  test('a const declaration is usable as a value', () => {
    const { value, diagnostics } = run('const c = 6.28\nc');
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(6.28);
  });

  test('a typed function definition then a call', () => {
    const { value, diagnostics } = run('f(x: real) = x + 1\nf(10)');
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(11);
  });

  test('an if expression', () => {
    const { value, diagnostics } = run('if 3 > 0 { 1 } else { 2 }');
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(1);
  });

  test('the `..` range operator drives a Sum', () => {
    const { value, diagnostics } = run('Sum(k, k in 1..5)');
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(15);
  });

  test('the `..` range operator drives a for loop', () => {
    const { value, diagnostics } = run(
      'let t = 0\nfor k in 1..3 { t = t + k }\nt'
    );
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(6);
  });

  test('`true`/`false` evaluate as booleans', () => {
    expect(run('false && (1 > 0)').value.symbol).toBe('False');
    expect(run('!true').value.symbol).toBe('False');
    expect(run('let b = true\nb').value.symbol).toBe('True');
  });

  test('a for loop executes (evaluated for effect → Nothing)', () => {
    // `for x in xs` DOES execute today via the engine `Loop`, but `Loop` is
    // evaluated *for effect*: its value is `Nothing` (the collecting/scoping
    // quirk is what the pending Loop/Map de-conflation addresses —
    // docs/plans/2026-07-07-loop-map-deconflation.md).
    const { value, diagnostics } = run('for x in [1, 2, 3] { x }');
    expect(diagnostics).toEqual([]);
    expect(value.symbol).toBe('Nothing');
  });

  test('a $…$ island is spliced via the injected parseLatex', () => {
    const { value, diagnostics } = run('let a = $2 + 3$\na');
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(5);
  });

  test('an empty program yields Nothing', () => {
    const { value, diagnostics } = run('   ');
    expect(diagnostics).toEqual([]);
    expect(value.symbol).toBe('Nothing');
  });
});

describe('CORTEX EXECUTE — exactness contract', () => {
  test('a transcendental of an exact argument stays symbolic', () => {
    const { value } = run('Ln(2)');
    expect(value.operator).toBe('Ln');
    expect(value.toString()).toBe('ln(2)');
  });

  test('N(…) numericizes explicitly', () => {
    const { value } = run('N(Ln(2))');
    expect(value.re).toBeCloseTo(Math.log(2), 12);
  });
});

describe('CORTEX EXECUTE — errors are values', () => {
  test('a runtime problem surfaces as an Error value, not a throw', () => {
    // A type error becomes an embedded `["Error", …]` value; nothing throws.
    const { value } = run('x + True');
    expect(value.has('Error')).toBe(true);
  });

  test('reassigning a const yields an Error value (no throw)', () => {
    const { value, diagnostics } = run('const c = 1\nc = 2');
    // The engine throws on a const reassignment; executeCortex catches it and
    // captures an `["Error", …]` value instead of propagating.
    expect(value.operator).toBe('Error');
    expect(diagnostics).toEqual([]);
  });
});

describe('CORTEX EXECUTE — while', () => {
  test('a while loop runs to completion (lowered to Loop + Break)', () => {
    // Count `c` down from 3 to 0; the loop value is Nothing (for-effect).
    const { value, diagnostics } = run('let c = 3\nwhile c > 0 { c = c - 1 }\nc');
    expect(diagnostics).toHaveLength(0);
    expect(value.re).toBe(0);
  });

  test('a while whose condition is initially false does not run the body', () => {
    const { value, diagnostics } = run('let c = 0\nwhile c > 0 { c = c - 1 }\nc');
    expect(diagnostics).toHaveLength(0);
    expect(value.re).toBe(0);
  });
});

describe('CORTEX EXECUTE — do-block expressions', () => {
  test('a top-level do-block yields its final statement', () => {
    const { value, diagnostics } = run('do { let t = 3; t + 1 }');
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(4);
  });

  test('a do-block as an assignment RHS', () => {
    const { value, diagnostics } = run('let y = do { let t = 3; t + 1 }\ny');
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(4);
  });

  test('a do-block lambda body', () => {
    const { value, diagnostics } = run(
      'let f = x |-> do { let t = x * x; t + 1 }\nf(3)'
    );
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(10);
  });
});

describe('CORTEX EXECUTE — zero-parameter lambdas', () => {
  test('a zero-parameter lambda applies with no arguments', () => {
    const { value, diagnostics } = run('let f = () |-> 42\nf()');
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(42);
  });
});

describe('CORTEX EXECUTE — pragma security', () => {
  test('#env is gated off by default (diagnostic, no host read)', () => {
    const { value, diagnostics } = run('#env("HOME")');
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toStrictEqual([
      'host-pragma-disabled',
      '#env',
    ]);
    expect(value.symbol).toBe('Nothing');
  });

  test('#navigator is gated off by default (diagnostic, no host read)', () => {
    const { diagnostics } = run('#navigator("userAgent")');
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toStrictEqual([
      'host-pragma-disabled',
      '#navigator',
    ]);
  });

  test('#env reads the host when allowHostPragmas is enabled', () => {
    const { value, diagnostics } = run('#env("HOME")', {
      allowHostPragmas: true,
    });
    expect(diagnostics).toEqual([]);
    expect(value.string).toBe(process.env['HOME']);
  });

  test('#error becomes a diagnostic, never a thrown exception', () => {
    let result: ReturnType<typeof executeCortex> | undefined;
    expect(() => {
      result = run('#error("boom")');
    }).not.toThrow();
    expect(result!.diagnostics).toHaveLength(1);
    expect(result!.diagnostics[0].message).toStrictEqual([
      'error-directive',
      'boom',
    ]);
    expect(result!.value.symbol).toBe('Nothing');
  });
});

describe('CORTEX EXECUTE — string interpolation', () => {
  test('interpolation joins values, without serialization quotes', () => {
    const { value, diagnostics } = run('"the answer is \\(6 * 7)"');
    expect(diagnostics).toEqual([]);
    expect(value.string).toBe('the answer is 42');
  });

  test('the cortex.md headline example', () => {
    const { value, diagnostics } = run(
      'let x = 2^11 - 1\n"\\(x) has type \\(Type(x))"'
    );
    expect(diagnostics).toEqual([]);
    expect(value.string).toBe('2047 has type integer');
  });
});

describe('CORTEX EXECUTE — runtime problems in non-final statements', () => {
  // Only the last statement's value is returned, so an error value produced
  // by an earlier statement would vanish silently. Each non-final statement
  // that evaluates to an error value emits a `runtime-error` diagnostic.

  test('an indexed assignment (unsupported) surfaces as a diagnostic', () => {
    const { value, diagnostics } = run('let xs = [1, 2, 3]\nxs[2] = 9\nxs');
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message[0]).toBe('runtime-error');
    // The diagnostic points at the offending statement
    expect(diagnostics[0].range).toEqual([19, 28]);
    // The list is unchanged
    expect(value.toString()).toBe('[1,2,3]');
  });

  test('a mid-program const reassignment surfaces as a diagnostic', () => {
    const { value, diagnostics } = run('const c = 1\nc = 2\nc + 1');
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message[0]).toBe('runtime-error');
    expect(value.re).toBe(2);
  });

  test('a final-statement error stays in value, with no diagnostic', () => {
    const { value, diagnostics } = run('const c = 1\nc = 2');
    expect(diagnostics).toEqual([]);
    expect(value.operator).toBe('Error');
  });
});
