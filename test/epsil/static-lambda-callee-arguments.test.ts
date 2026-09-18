import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import { staticDiagnostics } from '../../src/epsil/static-diagnostics';

// The Epsil static pre-pass reports a call whose argument cannot satisfy the
// parameter annotation of a FUNCTION LITERAL bound to the callee's name:
// `let k = (n: integer) => n + 1` followed by `k(1.5)`. The run time leaves
// that refusal to the literal itself, when applied (the definition stays
// INFERRED, and an inferred signature never refuses a value at boxing), so
// the pass registers the literal's signature (`registerPinnedSignature`,
// src/epsil/static-diagnostics.ts) and asks boxing to validate the later calls
// against it (`staticallyPinnedCallee`, boxed-expression/box.ts) — the same
// validation, and the same diagnostic, both annotated spellings of the callee
// always got.

function run(source: string): ReturnType<typeof executeEpsil> {
  const ce = new ComputeEngine();
  const parseLatex = (latex: string): MathJsonExpression =>
    ce.parse(latex).json;
  return executeEpsil(ce, source, { parseLatex });
}

/** `[description, code, range]` of each static diagnostic of `source`. */
function check(
  source: string,
  ce = new ComputeEngine()
): [string, string, [number, number, number]][] {
  const [ast] = parseEpsil(source);
  return staticDiagnostics(ce, ast!, source).map((d) => [
    String(d.message[1]),
    String(d.message[3]),
    d.range,
  ]);
}

describe('EPSIL STATIC — arguments of a call to a function literal', () => {
  test('a literal argument the parameter annotation refuses is reported', () => {
    const src = 'let k = (n: integer) => n + 1\nk(1.5)';
    expect(check(src)).toEqual([
      [
        'expected `integer`, got `1.5` at `1.5`',
        'incompatible-type',
        [src.indexOf('1.5)'), src.indexOf('1.5)') + 3, src.indexOf('1.5)')],
      ],
    ]);
    // The run time still refuses at the application, with an error value —
    // the linter is stricter than the engine, the engine is unchanged.
    const { value } = run(src);
    expect(value.operator).toBe('Error');
  });

  test('the diagnostic matches the annotated spellings of the same callee', () => {
    const literal = check('let k = (n: integer) => n + 1\nk(1.5)');
    const annotated = check(
      'let k: (n: integer) -> integer = (n) => n + 1\nk(1.5)'
    );
    const clause = check('k(n: integer) = n + 1\nk(1.5)');
    const strip = (d: (typeof literal)[number]) => [d[0], d[1]];
    expect(literal.map(strip)).toEqual(annotated.map(strip));
    expect(literal.map(strip)).toEqual(clause.map(strip));
  });

  test('`const` and `:=` bindings of a literal are checked the same way', () => {
    for (const src of [
      'const k = (n: integer) => n + 1\nk(1.5)',
      'k := (n: integer) => n + 1\nk(1.5)',
    ])
      expect(check(src).map((d) => d[1])).toEqual(['incompatible-type']);
  });

  test('a conforming call is clean', () => {
    expect(check('let k = (n: integer) => n + 1\nk(2)')).toEqual([]);
    expect(run('let k = (n: integer) => n + 1\nk(2)').value.re).toBe(3);
  });

  test('a wrong string argument, and a wrong second argument', () => {
    expect(
      check('let k = (n: integer) => n + 1\nk("a")').map((d) => d[1])
    ).toEqual(['incompatible-type']);
    const src = 'let k = (n: integer, m: string) => n\nk(1, 2)';
    expect(check(src)).toEqual([
      [
        'expected `string`, got `2` for argument 2',
        'incompatible-type',
        [src.lastIndexOf('2'), src.lastIndexOf('2') + 1, src.lastIndexOf('2')],
      ],
    ]);
  });

  test('a symbol argument is checked against its assignment evidence', () => {
    // `let x = 1.5` records `x`'s evidence for the pass, and a `1.5` can
    // never be an `integer` — the same line the annotated callee draws.
    expect(
      check('let k = (n: integer) => n + 1\nlet x = 1.5\nk(x)').map((d) => d[1])
    ).toEqual(['incompatible-type']);
    // Evidence that merely OVERLAPS the parameter (`g()` is `unknown`) stays
    // silent: a provisional type is not a refutation.
    expect(check('let k = (n: integer) => n + 1\nlet x = g()\nk(x)')).toEqual(
      []
    );
  });

  test('a collection argument at a scalar parameter is threadable, not refused', () => {
    // The lambda-broadcast machinery maps the body over a list at run time.
    expect(check('let k = (n: integer) => n + 1\nk([1, 2])')).toEqual([]);
    expect(
      run('let k = (n: integer) => n + 1\nk([1, 2])').value.toString()
    ).toBe('[2,3]');
  });

  test('a parameter that shadows the callee name is not checked against it', () => {
    expect(
      check('let k = (n: integer) => n + 1\nlet f = (k) => k(1.5)')
    ).toEqual([]);
  });

  test('a named call to a `let`-bound literal resolves its parameter names', () => {
    // Before the literal's signature was pinned, `k(n: 2)` drew a false
    // `argument-names-unavailable` for a program that runs fine.
    expect(check('let k = (n: integer) => n + 1\nk(n: 2)')).toEqual([]);
    expect(run('let k = (n: integer) => n + 1\nk(n: 2)').value.re).toBe(3);
    expect(
      check('let k = (n: integer) => n + 1\nk(n: 1.5)').map((d) => d[1])
    ).toEqual(['incompatible-type']);
    expect(
      check('let k = (n: integer) => n + 1\nk(m: 2)').map((d) => d[1])
    ).toEqual(['argument-name-unknown']);
  });

  test('an unsaturated call is a partial application, not a missing argument', () => {
    // Applying the literal to fewer arguments than it has parameters yields
    // the residual literal at run time, so only the supplied prefix is
    // checked — as the literal's own application checks it.
    const decl = 'let k = (x: integer, y: integer) => x + y\n';
    expect(check(decl + 'k(1)')).toEqual([]);
    expect(run(decl + 'k(1)').value.operator).toBe('Function');
    expect(check(decl + 'k(1.5)').map((d) => d[1])).toEqual([
      'incompatible-type',
    ]);
    expect(check(decl + 'k(1, 2, 3)').map((d) => d[1])).toEqual([
      'unexpected-argument',
    ]);
    // A DECLARED signature keeps the whole check: its application reports
    // the missing argument.
    expect(
      check(
        'let k: (x: integer, y: integer) -> integer = (x, y) => x + y\nk(1)'
      ).map((d) => d[1])
    ).toEqual(['missing']);
  });

  test('a bare parameter admits any argument, the absence marker included', () => {
    const decl = 'let k = (x, n: integer) => n\n';
    expect(check(decl + 'k("a", 1)')).toEqual([]);
    expect(check(decl + 'k([1], 1)')).toEqual([]);
    expect(check(decl + 'let x = Nothing\nk(x, 1)')).toEqual([]);
    expect(check(decl + 'k(1, "a")').map((d) => d[1])).toEqual([
      'incompatible-type',
    ]);
  });

  describe('reassignment mirrors the run time', () => {
    test('after one replacement the binding keeps the replacement signature', () => {
      // Assigning a literal to a `let` binding that holds one converts it
      // into an operator definition with the new literal's signature; a
      // further incompatible reassignment is then refused at run time and
      // the second literal stays in force.
      const src =
        'let k = (n: integer) => n\nk = (s: string) => s\nk = (n: integer) => n\n';
      expect(check(src + 'k("a")')).toEqual([]);
      const { value, diagnostics } = run(src + 'k("a")');
      expect(diagnostics.map((d) => d.message[0])).toEqual(['runtime-error']);
      expect(value.toString()).toBe('"a"');
      expect(check(src + 'k(1)').map((d) => d[1])).toEqual([
        'incompatible-type',
      ]);
    });

    test('an unannotated replacement literal is a replacement too', () => {
      expect(check('let k = (n: integer) => n\nk = (s) => s\nk("a")')).toEqual(
        []
      );
    });

    test('a `let` binding reassigned to another literal is checked against the NEW one', () => {
      // The run time replaces a `let` binding on assignment.
      const base = 'let k = (n: integer) => n + 1\nk = (s: string) => s\n';
      expect(check(base + 'k("a")')).toEqual([]);
      expect(run(base + 'k("a")').value.toString()).toBe('"a"');
      expect(check(base + 'k(1)').map((d) => d[1])).toEqual([
        'incompatible-type',
      ]);
      expect(run(base + 'k(1)').value.operator).toBe('Error');
    });

    test('a `const` binding keeps its FIRST signature', () => {
      // The run time refuses the reassignment of a constant and keeps the
      // original binding (`Cannot assign a value to the constant`), so the
      // static line against the first signature is a true prediction.
      const src =
        'const k = (n: integer) => n + 1\nk = (s: string) => s\nk("a")';
      expect(check(src).map((d) => d[1])).toEqual(['incompatible-type']);
      // A whole run reports both: the static line, then the refused
      // reassignment.
      const { value, diagnostics } = run(src);
      expect(diagnostics.map((d) => d.message[0])).toEqual([
        'static-type-error',
        'runtime-error',
      ]);
      expect(value.operator).toBe('Error');
    });

    test('a `:=` binding keeps its FIRST signature', () => {
      // The run time refuses the incompatible reassignment and keeps the
      // original binding, so the static line against the first signature is
      // a true prediction.
      const src = 'k := (n: integer) => n + 1\nk := (s: string) => s\nk("a")';
      expect(check(src).map((d) => d[1])).toEqual(['incompatible-type']);
      expect(run(src).value.operator).toBe('Error');
    });

    test('a `let` binding reassigned to a non-literal is no longer checked', () => {
      // `k = 5` replaces the binding at run time; the pass drops the pin and
      // the assignment's own type effect takes over.
      expect(check('let k = (n: integer) => n + 1\nk = 5\nk("a")')).toEqual([]);
    });
  });

  describe('across cells', () => {
    test("a previous cell's `let` binding is checked in the next cell", () => {
      const ce = new ComputeEngine();
      executeEpsil(ce, 'let k = (n: integer) => n + 1');
      expect(check('k(1.5)', ce).map((d) => d[1])).toEqual([
        'incompatible-type',
      ]);
      expect(check('k(2)', ce)).toEqual([]);
    });

    test("reassigning a previous cell's binding checks against the NEW literal", () => {
      const ce = new ComputeEngine();
      executeEpsil(ce, 'let k = (n: integer) => n + 1');
      expect(check('k = (s: string) => s\nk("a")', ce)).toEqual([]);
      expect(check('k = (s: string) => s\nk(1)', ce).map((d) => d[1])).toEqual([
        'incompatible-type',
      ]);
    });

    test('an unannotated replacement in the next cell drops the old signature', () => {
      const ce = new ComputeEngine();
      executeEpsil(ce, 'let k = (n: integer) => n');
      expect(check('k = (s) => s\nk("a")', ce)).toEqual([]);
      expect(check('k = (s) => s\nk(1)', ce)).toEqual([]);
    });

    test('a second reassignment in the next cell is checked against the first replacement', () => {
      const ce = new ComputeEngine();
      executeEpsil(ce, 'let k = (n: integer) => n');
      const src = 'k = (s: string) => s\nk = (n: integer) => n\n';
      expect(check(src + 'k("a")', ce)).toEqual([]);
      expect(check(src + 'k(1)', ce).map((d) => d[1])).toEqual([
        'incompatible-type',
      ]);
    });

    test('the pass leaves the engine as it found it', () => {
      const ce = new ComputeEngine();
      executeEpsil(ce, 'let k = (n: integer) => n + 1');
      check('k = (s: string) => s\nk(1)', ce);
      check('k(1.5)', ce);
      expect(ce._staticPinnedCallees).toBeUndefined();
      expect(ce.box('k').type.toString()).toBe('(n: integer) -> integer');
      // Outside the pass, boxing still admits the call: the literal refuses
      // it at the application, as before.
      expect(ce.box(['k', 1.5]).isValid).toBe(true);
      expect(ce.box(['k', 1.5]).evaluate().operator).toBe('Error');
    });
  });
});
