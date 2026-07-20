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

  test('a typed param rejects a bad-typed call', () => {
    // `2.5` is not an `integer`, so the call boxes to an `incompatible-type`
    // Error value rather than evaluating to `3.5`.
    const { value } = run('f(x: integer) = x + 1\nf(2.5)');
    expect(value.re).not.toBe(3.5);
    expect(value.toString()).toContain('incompatible-type');
  });

  test('a typed param accepts a good-typed call', () => {
    const { value, diagnostics } = run('f(x: integer) = x + 1\nf(3)');
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(4);
  });

  test('a multi-param typed function rejects a bad arg', () => {
    const { value } = run('f(x: integer, y: integer) = x + y\nf(2.5, 1)');
    expect(value.toString()).toContain('incompatible-type');
  });

  test('a multi-param typed function accepts all-good args', () => {
    const { value, diagnostics } = run(
      'f(x: integer, y: integer) = x + y\nf(2, 3)'
    );
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(5);
  });

  test('a partially-annotated function enforces only the typed param', () => {
    // Signature is `(integer, any) -> any`: the first arg is checked, the
    // second is unconstrained.
    const bad = run('f(x: integer, y) = x + y\nf(2.5, 1)');
    expect(bad.value.toString()).toContain('incompatible-type');

    const good = run('f(x: integer, y) = x + y\nf(2, 1.5)');
    expect(good.diagnostics).toEqual([]);
    expect(good.value.re).toBe(3.5);
  });

  test('an unannotated function is unchanged (no enforcement)', () => {
    const { value, diagnostics } = run('g(x) = x + 1\ng(2.5)');
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(3.5);
  });

  test('recursion with a typed param still works', () => {
    const { value, diagnostics } = run(
      'f(n: integer) = if n <= 1 { 1 } else { n * f(n - 1) }\nf(5)'
    );
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(120);
  });

  test('a closure-capturing typed function still captures', () => {
    const { value, diagnostics } = run(
      'let a = 10\nf(x: integer) = x + a\nf(5)'
    );
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(15);
  });

  test('a block-style return type is carried and honored', () => {
    // The return type is native now (no longer dropped): a good call evaluates
    // and the operator signature carries the declared return type.
    const { value, diagnostics } = run(
      'function f(x: integer) -> integer { x + 1 }\nf(3)'
    );
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(4);
  });

  test('a return type shows in the definition signature', () => {
    const { value, diagnostics } = run(
      'function f(x: integer) -> integer { x + 1 }\n"\\(Type(f))"'
    );
    expect(diagnostics).toEqual([]);
    expect(value.string).toBe('(x: integer) -> integer');
  });

  test('a math-style return type is carried and honored', () => {
    const { value, diagnostics } = run('f(x: integer) -> real = x + 1\nf(3)');
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(4);
  });

  test('a typed mapsto rejects a bad-typed call', () => {
    const { value } = run('((x: integer) |-> x + 1)(2.5)');
    expect(value.re).not.toBe(3.5);
    expect(value.toString()).toContain('incompatible-type');
  });

  test('a typed mapsto accepts a good-typed call', () => {
    const { value, diagnostics } = run('((x: integer) |-> x + 1)(3)');
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(4);
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

describe('CORTEX EXECUTE — structured cancellation cause', () => {
  // A cap breach (timeLimit / iterationLimit / recursionLimit) throws a
  // `CancellationError`; executeCortex surfaces its machine-readable `cause`
  // additively — as a second operand on the final-statement Error VALUE, and
  // as `['evaluation-canceled', cause, …]` on a non-final diagnostic — while
  // the legacy message operand (which hosts may still string-match) is
  // unchanged. See Tycho's "structured cancellation cause" request.

  /** Run against an engine with caps applied, no LaTeX island parser needed. */
  function runWith(
    source: string,
    apply: (ce: ComputeEngine) => void
  ): ReturnType<typeof executeCortex> {
    const ce = new ComputeEngine();
    apply(ce);
    return executeCortex(ce, source);
  }

  test('recursion-depth-exceeded on the final-statement Error value', () => {
    const { value, diagnostics } = runWith('f(n) = f(n + 1)\nf(0)', (ce) => {
      ce.recursionLimit = 20;
    });
    expect(diagnostics).toEqual([]);
    expect(value.operator).toBe('Error');
    // Machine-readable cause is the second operand
    expect(value.op2?.string).toBe('recursion-depth-exceeded');
    // Legacy message operand is unchanged (hosts may still string-match it)
    expect(value.op1?.string).toBe('Recursion limit exceeded');
  });

  test('iteration-limit-exceeded on the final-statement Error value', () => {
    const { value } = runWith(
      'let c = 0\nwhile c >= 0 { c = c + 1 }',
      (ce) => {
        ce.iterationLimit = 100;
      }
    );
    expect(value.operator).toBe('Error');
    expect(value.op2?.string).toBe('iteration-limit-exceeded');
    // Legacy default message operand is unchanged
    expect(value.op1?.string).toBe('Operation canceled');
  });

  test('timeout on the final-statement Error value', () => {
    const ce = new ComputeEngine();
    ce.iterationLimit = 100_000_000;
    const { value } = ce.withTimeLimit(
      { ms: 1, label: 'test:cortex-timeout' },
      () => executeCortex(ce, 'let c = 0\nwhile c >= 0 { c = c + 1 }')
    );
    expect(value.operator).toBe('Error');
    expect(value.op2?.string).toBe('timeout');
  });

  test('a non-final cap breach surfaces an evaluation-canceled diagnostic', () => {
    const { diagnostics } = runWith('f(n) = f(n + 1)\nf(0)\n1 + 1', (ce) => {
      ce.recursionLimit = 20;
    });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message[0]).toBe('evaluation-canceled');
    // The cause is carried as the first message argument
    expect(diagnostics[0].message[1]).toBe('recursion-depth-exceeded');
  });

  test('a non-cancellation throw keeps the single-operand Error shape', () => {
    // Back-compat: only cap breaches gain the cause operand.
    const { value } = runWith('const k = 1\nk = 2', () => {});
    expect(value.operator).toBe('Error');
    expect(value.nops).toBe(1);
    expect(value.op2?.symbol).toBe('Nothing');
  });
});

describe('CORTEX EXECUTE — did-you-mean for unknown functions', () => {
  // Calling an unknown function stays *silently* symbolic (an inert
  // `["Quartile", …]` value). When the unknown name is close to a known
  // operator, a `warning`-severity `unknown-function` diagnostic surfaces the
  // suggestion; the returned value is unchanged. A name with no near match is
  // never nagged.

  test('a plural typo suggests the known operator', () => {
    const { value, diagnostics } = run('Quartile([1, 2, 3, 4, 5])');
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe('warning');
    expect(diagnostics[0].message).toEqual([
      'unknown-function',
      'Quartile',
      'Quartiles',
    ]);
    // The value is still the inert symbolic form.
    expect(value.operator).toBe('Quartile');
  });

  test('a transposition typo suggests the known operator', () => {
    const { diagnostics } = run('Argmuent(3)');
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toEqual([
      'unknown-function',
      'Argmuent',
      'Argument',
    ]);
  });

  test('a one-edit typo suggests the known operator', () => {
    const { diagnostics } = run('Facorial(5)');
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toEqual([
      'unknown-function',
      'Facorial',
      'Factorial',
    ]);
  });

  test('an unknown function with no near match is not nagged', () => {
    const { value, diagnostics } = run('foo(3)');
    expect(diagnostics).toEqual([]);
    expect(value.operator).toBe('foo');
  });

  test('a declared function is not flagged', () => {
    const { diagnostics } = run('f(x) = x + 1\nf(3)');
    expect(diagnostics).toEqual([]);
  });

  test('a lambda parameter used as a function is not flagged', () => {
    const { value, diagnostics } = run(
      'apply(g, x) = g(x)\napply(y |-> y * 2, 5)'
    );
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(10);
  });

  test('a name used twice fires a single diagnostic', () => {
    const { diagnostics } = run('Quartile([1, 2, 3])\nQuartile([4, 5, 6])');
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message[1]).toBe('Quartile');
  });

  test('the `Arg` alias is defined, so it evaluates without a diagnostic', () => {
    const { value, diagnostics } = run('Arg(i)');
    expect(diagnostics).toEqual([]);
    // `Arg` canonicalizes to `Argument`; `Argument(i)` is π/2.
    expect(value.isSame(new ComputeEngine().parse('\\frac{\\pi}{2}'))).toBe(
      true
    );
  });
});
