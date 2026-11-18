/**
 * Compiled code for function values and parameter defaults (item 3.4.5 of
 * the CE language release, `docs/COMPILATION-MODEL.md`, "Function values").
 *
 * A symbol default that names a constant that the host or the program
 * declares: the interpreter reads the default where the function is
 * declared. Compiled code fills the value of the constant, read from the
 * same definition, and not the name, which a local or a `vars` entry can
 * hide where the default is filled (`compiledDefaultOperand()`). A
 * constant with no value that compiled code can write declines.
 *
 * Each other case below declines, so that the host gets the interpreter's
 * value:
 *
 * - a full application of a function literal whose value is a function;
 * - a call that leaves out a defaulted argument and returns a function;
 * - an `Assign` whose value is a block-local function assigned more than
 *   once.
 */
import { ComputeEngine } from '../../src/compute-engine';

type Json = any;

describe('A declaration in a scope other than the current scope', () => {
  test('reads a symbol default in the scope that receives it', () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    const outer = ce.context.lexicalScope;
    ce.declare('W', { isConstant: true, value: 5 } as never);
    ce.pushScope();
    ce.declare('W', { isConstant: true, value: 7 } as never);
    ce.declare(
      'f',
      {
        signature: '(k: real = W) -> real',
        evaluate: ([k]: Json[]) => k,
      } as never,
      outer
    );
    ce.popScope();
    expect(ce.box(['f']).evaluate().toString()).toBe('5');
  });
});
