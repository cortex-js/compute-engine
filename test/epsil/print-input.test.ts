import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';
import { executeEpsil } from '../../src/epsil/execute-epsil';

//
// The Epsil `print` and `input` commands — lowercase library aliases that
// canonicalize to the `Print`/`Input` operators. Lowercase is the Epsil
// convention for commands; because the aliases are ordinary library
// definitions (not keywords), a user declaration of `print` shadows them by
// scope like any other name.
//
// `input` is tested through the browser `prompt()` path only: its Node path
// does a BLOCKING synchronous stdin read, which would deadlock a jest
// worker. See test/compute-engine/print-input.test.ts for the mechanics.
//

function run(source: string): ReturnType<typeof executeEpsil> {
  const ce = new ComputeEngine();
  const parseLatex = (latex: string): MathJsonExpression =>
    ce.parse(latex).json;
  return executeEpsil(ce, source, { parseLatex });
}

describe('EPSIL print', () => {
  let logged: string[];
  let spy: jest.SpyInstance;
  beforeEach(() => {
    logged = [];
    spy = jest
      .spyOn(console, 'log')
      .mockImplementation((...args: unknown[]) => {
        logged.push(args.join(' '));
      });
  });
  afterEach(() => spy.mockRestore());

  test('prints evaluated operands, strings unquoted', () => {
    const { diagnostics } = run('let x = 6\nprint("x is", x * 7)');
    expect(diagnostics).toEqual([]);
    expect(logged).toEqual(['x is 42']);
  });

  test('the capitalized operator spelling works too', () => {
    const { diagnostics } = run('Print("caps")');
    expect(diagnostics).toEqual([]);
    expect(logged).toEqual(['caps']);
  });

  test('prints from inside a function body at call time', () => {
    const { value, diagnostics } = run(
      'f(x) = do { print("got", x); x + 1 }\nf(9)'
    );
    expect(diagnostics).toEqual([]);
    expect(logged).toEqual(['got 9']);
    expect(value.re).toBe(10);
  });

  test('a user definition of print shadows the command', () => {
    const { value, diagnostics } = run('print(x) = x^2\nprint(3)');
    expect(diagnostics).toEqual([]);
    expect(logged).toEqual([]);
    expect(value.re).toBe(9);
  });
});

describe('EPSIL input', () => {
  const proc = globalThis.process as unknown as Record<string, unknown>;
  let savedGetBuiltin: unknown;
  beforeEach(() => {
    savedGetBuiltin = proc.getBuiltinModule;
    delete proc.getBuiltinModule;
  });
  afterEach(() => {
    if (savedGetBuiltin !== undefined)
      proc.getBuiltinModule = savedGetBuiltin;
    delete (globalThis as Record<string, unknown>).prompt;
  });

  test('reads a line and uses it as a string value', () => {
    (globalThis as Record<string, unknown>).prompt = () => 'Arno';
    const { value, diagnostics } = run('let name = input("Who? ")\nname');
    expect(diagnostics).toEqual([]);
    expect(value.string).toBe('Arno');
  });

  test('canceled input evaluates to Nothing', () => {
    (globalThis as Record<string, unknown>).prompt = () => null;
    const { value, diagnostics } = run('input()');
    expect(diagnostics).toEqual([]);
    expect(value.symbol).toBe('Nothing');
  });
});
