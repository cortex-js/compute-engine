import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

//
// A statement that assigns a new function literal to a name that an earlier
// statement defined (`function g(k) scope { … }` then `g = (k) => …`) is
// checked by the interpreter on its own: a literal that states no effects
// and writes a variable outside the function is refused, also when the
// earlier definition stated the `scope` effect. The compiled program must
// not run such a definition either (`refuseEffectContractViolations()`,
// `src/compute-engine/compilation/base-compiler.ts`).
//

const compileProgram = (source: string, to = 'javascript') =>
  compile(new ComputeEngine().box(parseEpsil(source)[0] as never), {
    to,
    fallback: false,
  } as never)!;

function run(source: string): { value: unknown; diagnostics: string[] } {
  const { value, diagnostics } = executeEpsil(new ComputeEngine(), source);
  return {
    value: value.json,
    diagnostics: diagnostics.map((d) => d.message.map(String).join(' ')),
  };
}

describe('A FUNCTION REDEFINED WITH A BODY THAT WRITES OUTSIDE', () => {
  const source =
    'let t = 0\nfunction g(k) scope { t = k + 1; t }\n' +
    'g = (k) => do { t = k + 2; t }\n[g(1), t]';

  test('the run refuses the redefinition', () => {
    const { diagnostics } = run(source);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toContain(
      'writes outside a function require a declared `scope` effect'
    );
  });

  test('the compilation is refused', () => {
    expect(() => compileProgram(source)).toThrow(
      /Could not compile `Assign`: .*writes outside the function/
    );
    const interval = compileProgram(source, 'interval-js');
    expect(interval.success).toBe(false);
  });

  // A redefined function is a function value stored in a local, which
  // compiled code does not compile (`docs/COMPILATION-MODEL.md`, "Function
  // values"); the interpreter runs it.
  test('a redefinition with no write outside declines', () => {
    const plain = 'function g(k) { k + 1 }\ng = (k) => k + 5\n[g(1)]';
    expect(run(plain)).toEqual({ value: ['List', 6], diagnostics: [] });
    expect(() => compileProgram(plain)).toThrow(/assigned more than once/);
  });
});

describe('A FUNCTION DEFINED UNDER A DECLARATION THAT STATES ITS EFFECTS', () => {
  // `let g: (integer) pure -> real` is the contract of `g`. A definition
  // whose body draws a random number does not meet it: the interpreter
  // refuses the definition (`incompatible-type`, pure effects against
  // random effects), and the compiled program must not run it either. The
  // name was skipped by the compiled check (found by the Codex reviewer,
  // 2026-10-19), so the program compiled and drew the number.
  const source =
    'let g: (integer) pure -> real\nfunction g(k) { Random() }\ng(1)';

  test('the run refuses the definition', () => {
    const { diagnostics } = run(source);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.join(' ')).toMatch(/pure/);
  });

  test('the compilation is refused', () => {
    // The compiled program is one block, where the declaration and the
    // function statement are two declarations of `g`.
    expect(() => compileProgram(source)).toThrow(/variable-redeclaration/);
  });

  test('a definition that meets the declared effects still compiles', () => {
    const plain = 'let g: (integer) random -> real = (k) => Random()\ng(1)';
    const value = compileProgram(plain).run!({} as never);
    expect(typeof value).toBe('number');
    const pure = 'let h: (integer) pure -> integer = (k) => k + 1\nh(1)';
    expect(compileProgram(pure).run!({} as never)).toBe(2);
  });
});
