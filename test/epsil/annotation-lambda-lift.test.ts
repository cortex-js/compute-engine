import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

//
// Annotation-bound parameters (the "lambda lift") — see
// `docs/LANGUAGE-MODEL.md`.
//
// A parameter name binds wherever it appears: a literal named function-type
// annotation on a declaration turns a non-lambda initializer into the body of
// a lambda whose parameters come from the annotation. When the initializer is
// itself a lambda, the two parameter lists must agree positionally
// (`parameter-name-mismatch` otherwise). Aliases, zero-parameter, generic,
// effectful, optional/variadic, and partially named signatures are opaque:
// they never lift.
//

/** Run an Epsil program against a fresh engine. */
function run(source: string): ReturnType<typeof executeEpsil> {
  return executeEpsil(new ComputeEngine(), source);
}

describe('EPSIL ANNOTATION LAMBDA LIFT — lifting', () => {
  test('a named annotation binds the initializer expression', () => {
    const { value, diagnostics } = run(
      'const f : (x: number) -> number = x^2 + 2x + 1\nf(3)'
    );
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(16);
  });

  test('multiple named parameters bind positionally', () => {
    const { value, diagnostics } = run(
      'const g : (a: number, b: number) -> number = a + 2b\ng(1, 2)'
    );
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(5);
  });

  test('a lifted parameter shadows an enclosing binding of the same name', () => {
    // The wrap happens at parse time, before the initializer is ever
    // evaluated in the enclosing scope: `x` is the parameter, not 100.
    const { value, diagnostics } = run(
      'let x = 100\nconst f : (x: number) -> number = x^2 + 2x + 1\nf(3)'
    );
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(16);
  });

  test('a bare annotation (no let/const keyword) lifts too', () => {
    const { value, diagnostics } = run(
      'f : (x: number) -> number = x^2 + 2x + 1\nf(4)'
    );
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(25);
  });

  test('nested arrows lift the outermost level only', () => {
    // The lambda's name matches the INNER level, so it is the outer lift's
    // body: `x` binds around it.
    const { value, diagnostics } = run(
      'const f : (x: number) -> (y: number) -> number = (y) => x + y\nf(2)(3)'
    );
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(5);
  });

  test('a fully explicit nested lambda is the function value', () => {
    const { value, diagnostics } = run(
      'const f : (x: number) -> (y: number) -> number = (x) => ((y) => x + y)\nf(2)(3)'
    );
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(5);
  });
});

describe('EPSIL ANNOTATION LAMBDA LIFT — both sides named', () => {
  test('matching names on both sides are legal', () => {
    const { value, diagnostics } = run(
      'const f : (x: number) -> number = (x) => x^2 + 2x + 1\nf(3)'
    );
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(16);
  });

  test('a bare-symbol lambda participates in the name check', () => {
    const { value, diagnostics } = run(
      'const f : (x: number) -> number = x => x + 1\nf(3)'
    );
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(4);
  });

  test('a name mismatch is a diagnostic with a rename-the-annotation fixit', () => {
    const src = 'const f : (y: number) -> number = (x) => x + 1';
    const { diagnostics } = run(src);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toEqual([
      'parameter-name-mismatch',
      'x',
      'y',
    ]);
    // The fixit renames the ANNOTATION to the lambda's names (the lambda's
    // names are the binders the body actually uses).
    const [start, end, replacement] = diagnostics[0].fixits![0];
    expect(src.slice(0, start) + replacement + src.slice(end)).toBe(
      'const f : (x: number) -> number = (x) => x + 1'
    );
  });

  test('an arity disagreement is the type check’s job, not a name mismatch', () => {
    const { value, diagnostics } = run(
      'const f : (x: number) -> number = (a, b) => a + b'
    );
    expect(
      diagnostics.some((d) => d.message[0] === 'parameter-name-mismatch')
    ).toBe(false);
    // The declared-type check reports the real problem.
    expect(value.toString()).toContain('takes 2 parameter(s)');
  });
});

describe('EPSIL ANNOTATION LAMBDA LIFT — deliberately inert', () => {
  test('an unnamed annotation with a lambda initializer is unchanged', () => {
    const { value, diagnostics } = run(
      'const f : (number) -> number = (x) => x + 1\nf(3)'
    );
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(4);
  });

  test('an unnamed annotation never lifts a bare expression', () => {
    // The error explains the near-miss — readers mentally auto-insert the
    // missing name, so the message must spell out that nothing binds — and
    // names the exact rewrite, pairing the initializer's unknown with the
    // unnamed parameter.
    const { value } = run('const f : (number) -> number = x^2 + 1');
    const message = value.toString();
    expect(message).toContain('incompatible-type');
    expect(message).toContain('parameters bind only when they are named');
    expect(message).toContain('an expression in the unknown \\"x\\"');
    expect(message).toContain('(x: number) -> number');
    expect(message).toContain('(x) => x^2 + 1');
  });

  test('the host `ce.declare` route throws the same explanation', () => {
    const ce = new ComputeEngine();
    expect(() =>
      ce.declare('f', {
        type: '(number) -> number',
        value: ce.parse('x^2+1'),
      })
    ).toThrow(/bind only when they are named[\s\S]*\(x: number\) -> number/);
  });

  test('a function-valued initializer under an unnamed annotation is untouched', () => {
    const { value, diagnostics } = run(
      'const k = (x) => x + 1\nconst m : (number) -> number = k\nm(3)'
    );
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(4);
  });

  test('an alias annotation is opaque: its names never bind', () => {
    const { value } = run(
      'type alias F = (x: number) -> number\nconst f : F = x + 1'
    );
    expect(value.toString()).toContain('incompatible-type');
  });

  test('a zero-parameter signature never lifts (the RHS may be a thunk value)', () => {
    const { value } = run('const f : () -> number = 42');
    expect(value.toString()).toContain('incompatible-type');
  });
});
