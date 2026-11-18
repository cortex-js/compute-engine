import { operands } from '../../src/math-json/utils';
/**
 * Compiling a program that DEFINES a function and then CALLS it — the ordinary
 * shape of an Epsil file, and of any `Block` whose local holds a lambda:
 *
 *     const g = (k) => Sum(Take(Map(_ => _^2, 1..oo), k))
 *     g(3)
 *
 * The declaration always lowered to a value binding (`let g = ((k) => …)`),
 * but the CALL had no resolution: head lookup consults the ENGINE's
 * definitions only (`BaseCompiler.userFunctionLiteral`), which a block-local
 * declaration never enters — compiling must not mutate the engine — so `g(3)`
 * failed the whole compilation with ``Unknown operator `g` ``. A `function`
 * definition (`DefineFunction`) had no lowering on any target at all.
 *
 * Both now compile on the JavaScript family: the block records its
 * function-valued locals in `CompileTarget.localFunctions`, and a `function`
 * definition is rewritten to the equivalent `Declare` of the same literal.
 *
 * Every expected value below is the interpreter's own result for the same
 * program (probed empirically, and re-asserted here by the parity checks).
 */
import { ComputeEngine } from '../../src/compute-engine';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { compileDiagnosticOf } from '../../src/compute-engine/compilation/diagnostics';

let ce: ComputeEngine;
beforeEach(() => {
  ce = new ComputeEngine();
  ce.declare('x', 'real | list<real>');
});

/** Box the parsed statements as a local Block, without evaluating it. */
function program(source: string) {
  const [ast] = parseEpsil(source, {
    parseLatex: (latex: string) => ce.parse(latex).json,
  });
  return ce.box(['Block', ...operands(ast)] as never);
}

/** The compiled program's result, and the interpreter's, for comparison. */
/**
 * The value of `compiled` when the compilation declines a call of a
 * block-local function that is assigned more than once. Such a function is a
 * function value known only at run time, and compiled code does not call a
 * function value (`docs/COMPILATION-MODEL.md`, "Function values"). The
 * interpreter keeps the call.
 */
const DECLINED = 'declined: a function value stored in a local';
const REBOUND = /its value is a function value known only at run time/;

/** `compile()`, or `undefined` when it declines a rebound local function
 * (`REBOUND`). Any other decline throws. */
function compileOrRebound(
  expr: ReturnType<ComputeEngine['box']>,
  options: Record<string, unknown>
): ReturnType<typeof compile> | undefined {
  try {
    return compile(expr, options as never)!;
  } catch (e) {
    if (REBOUND.test(String((e as Error).message))) return undefined;
    throw e;
  }
}

function both(
  source: string,
  options?: {
    to?: string;
    vars?: Record<string, unknown>;
    constantFold?: boolean;
  }
): { compiled: unknown; interpreted: string; code: string } {
  const expr = program(source);
  const result = compileOrRebound(expr, {
    to: options?.to ?? 'javascript',
    fallback: false,
    ...(options?.constantFold === false ? { constantFold: false } : {}),
  });
  if (result === undefined)
    return {
      compiled: DECLINED,
      interpreted: program(source).evaluate().toString(),
      code: '',
    };
  return {
    compiled: result.run!((options?.vars ?? {}) as never),
    // A SECOND boxing, so the compilation above never saw an evaluated engine.
    interpreted: program(source).evaluate().toString(),
    code: result.code as string,
  };
}

describe('COMPILE a block-local function definition', () => {

  it('a NON-function local shadows an outer function-valued one', () => {
    // The inner `g` is a number, so `g(2)` is not a call of the outer lambda.
    expect(() =>
      both('const g = (k) => k + 1\n{ const g = 5\n g(2) }')
    ).toThrow();
  });
});

describe('COMPILE a `function` definition', () => {

  it('is a local: a call before the definition reads it before its declaration', () => {
    // A function statement of a block declares a variable, which has its
    // value when the statement runs. A call before it is the static error
    // `read-before-declaration`, and the compilation refuses the block.
    const src = 'let a = g(3)\nfunction g(k) { k + 1 }\na';
    expect(program(src).json).toMatchObject(
      expect.arrayContaining([
        expect.arrayContaining([
          'Error',
          expect.arrayContaining(["'read-before-declaration'"]),
        ]),
      ])
    );
    expect(() => both(src)).toThrow();
  });

  it('a second function statement of a name is a second declaration', () => {
    // Each function statement of a block declares a variable, so two of one
    // name are the error `variable-redeclaration`, as two `let`.
    expect(
      program('function f(n: integer) { 1 }\nfunction f(s: string) { 2 }\nf(3)')
        .evaluate()
        .toString()
    ).toBe('Error(ErrorCode("variable-redeclaration", "f"))');
  });
});

describe('COMPILE a `Declare` followed by an `Assign` of a function literal', () => {
  // `Declare(k, "function")` then `Assign(k, Function(…))` is the shape the
  // LaTeX parser makes for `k(u) \coloneq 2u; k(x)`. The block-local scope
  // read only a `Declare` that carries its value (the `const`/`let` shape),
  // so the call `k(x)` failed with ``Unknown operator `k` `` although the
  // interpreter answers it.
  const F = (body: unknown, ...params: string[]) => [
    'Function',
    body,
    ...params,
  ];
  const twice = F(['Multiply', 2, 'u'], 'u');
  const thrice = F(['Multiply', 3, 'u'], 'u');

  it('the interval target declines a rebound function at its declaration', () => {
    // A local of type function has no lowering on interval-js.
    let diagnostic: { code: string; operator?: string } | undefined;
    try {
      compile(
        ce.box([
          'Block',
          ['Declare', 'k', "'function'", twice],
          ['Declare', 'a', "'unknown'", ['k', 'x']],
          ['Assign', 'k', thrice],
          ['Add', 'a', ['k', 'x']],
        ] as never),
        { to: 'interval-js', fallback: false } as never
      );
    } catch (e) {
      diagnostic = compileDiagnosticOf(e);
    }
    expect(diagnostic?.code).toBe('outside-profile');
    expect(diagnostic?.operator).toBe('Declare');
  });
});
