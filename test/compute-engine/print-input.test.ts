import { ComputeEngine } from '../../src/compute-engine';

//
// `Print` and `Input` — host console I/O (with the Epsil-facing lowercase
// aliases `print`/`input`, which canonicalize to the capitalized operators).
//
// `Input` is exercised through the browser `prompt()` path only: its Node
// path does a BLOCKING synchronous read of stdin, which in a jest worker
// (stdin is an open pipe that never delivers data) would deadlock the
// worker. Each `Input` test removes `process.getBuiltinModule` for its
// duration so `hostReadLine` falls through to the `prompt()` branch.
//

const ce = new ComputeEngine();

describe('Print', () => {
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

  test('prints operands space-separated, strings without quotes', () => {
    const result = ce
      .box(['Print', { str: 'x is' }, ['Add', 40, 2]])
      .evaluate();
    expect(logged).toEqual(['x is 42']);
    expect(result.symbol).toBe('Nothing');
  });

  test('no operands prints an empty line', () => {
    ce.box(['Print']).evaluate();
    expect(logged).toEqual(['']);
  });

  test('operands are evaluated before printing', () => {
    ce.box(['Print', ['Multiply', 6, 7]]).evaluate();
    expect(logged).toEqual(['42']);
  });

  test('is impure and carries the console effect label', () => {
    const expr = ce.box(['Print', { str: 'hi' }]);
    expect(expr.isPure).toBe(false);
    expect(expr.effects).toContain('console');
  });

  test('lowercase alias canonicalizes to Print', () => {
    const expr = ce.box(['print', { str: 'hi' }]);
    expect(expr.operator).toBe('Print');
    expr.evaluate();
    expect(logged).toEqual(['hi']);
  });
});

describe('Input', () => {
  // Disable the Node stdin path (see the module comment) and install a
  // mock `prompt()`; restore both afterwards.
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

  test('reads a line via prompt(), passing the prompt string', () => {
    const seen: string[] = [];
    (globalThis as Record<string, unknown>).prompt = (p: string) => {
      seen.push(p);
      return 'Arno';
    };
    const result = ce.box(['Input', { str: 'Who? ' }]).evaluate();
    expect(result.string).toBe('Arno');
    expect(seen).toEqual(['Who? ']);
  });

  test('canceled dialog (null) evaluates to Nothing', () => {
    (globalThis as Record<string, unknown>).prompt = () => null;
    const result = ce.box(['Input']).evaluate();
    expect(result.symbol).toBe('Nothing');
  });

  test('no interactive input available: stays unevaluated', () => {
    const result = ce.box(['Input', { str: 'Who? ' }]).evaluate();
    expect(result.operator).toBe('Input');
  });

  test('is impure and carries the console effect label', () => {
    const expr = ce.box(['Input']);
    expect(expr.isPure).toBe(false);
    expect(expr.effects).toContain('console');
  });

  test('lowercase alias canonicalizes to Input', () => {
    expect(ce.box(['input', { str: '? ' }]).operator).toBe('Input');
  });
});
