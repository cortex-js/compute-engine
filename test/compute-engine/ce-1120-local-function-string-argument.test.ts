/**
 * A block-local function whose parameter is a collection, used with a
 * string, on the JavaScript target.
 *
 * A string is a collection of its characters, so the body of
 * `g := s ↦ Length(s)` infers `s: collection`. A block binds the literal
 * of a local function once, compiled against that type: `Length` of a
 * `collection` reads the operand with `_SYS.elts`, which throws a
 * `RangeError` for a string. `g(t)` with a string `t`, and `Map(g, S)` over
 * `S: list<string>`, threw, while the interpreter gives the number of
 * characters.
 *
 * A use that gives a string now compiles the literal with the parameter
 * typed `string` at that use (`stringTypedLocalLiteral()` in
 * `compile-user-functions.ts`): the call is the application of that
 * literal, and the callback is that literal. A use that gives a list keeps
 * the binding of the block. When the typed literal cannot be written at
 * the use, the compilation declines.
 *
 * The same uses of a function defined on the engine are in
 * `ce-1036-user-function-string-argument.test.ts` (a call) and
 * `ce-1076-user-function-string-callback.test.ts` (a callback).
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/** An engine with `S: list<string>`, `t: string`, `L: list<real>` and
 * `n: real`, all without a value. */
function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('S', 'list<string>');
  ce.declare('t', 'string');
  ce.declare('L', 'list<real>');
  ce.declare('n', 'real');
  return ce;
}

describe('uses that decline', () => {

  test('a declined compilation falls back to the interpreter', () => {
    const fn = ['Function', ['Add', ['Length', 's'], 'k'], 's'];
    const json = [
      'Block',
      ['Declare', 'k', "'unknown'", 2],
      ['Declare', 'g', "'unknown'", fn],
      ['g', 't'],
    ];
    const ce = engine();
    const r = compile(ce.box(json as never), { to: 'javascript' });
    expect(r.success).toBe(false);
    expect(r.run!({ t: 'abc' } as never)).toBe(5);
  });
});
