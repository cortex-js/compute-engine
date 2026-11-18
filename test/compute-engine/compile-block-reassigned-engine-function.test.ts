/**
 * A block that assigns a function to a name the engine also assigns a
 * function to. The interpreter writes the engine's binding, and a call of the
 * name inside the block applies the block's function: with the engine
 * `gg = t ↦ t + 1`, `Block(gg := t ↦ t + 10, gg(1))` gives 11. Compiled code
 * writes only the locals that it declares, so the compilation declines on
 * every target. (Before, the constant folder applied the engine's function
 * and the code returned 2.)
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { compileDiagnosticOf } from '../../src/compute-engine/compilation/diagnostics';

function setup(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.assign('gg', ce.box(['Function', ['Add', 't', 1], 't'] as any));
  return ce;
}

const ADD10 = ['Assign', 'gg', ['Function', ['Add', 't', 10], 't']];
const SRC = ['Block', ADD10, ['gg', 1]];
const DECLINE = /"gg" is not a local of the compiled expression/;

describe('a call of a function that the enclosing block assigns', () => {
  // A write to a symbol declared in the engine declines.
  test('JavaScript declines', () => {
    const ce = setup();
    expect(() => compile(ce.box(SRC as any), { fallback: false })).toThrow(
      DECLINE
    );
    expect(setup().box(SRC as any).evaluate().toString()).toBe('11');
  });

  test('interval-js declines', () => {
    const ce = setup();
    let diagnostic;
    try {
      compile(ce.box(SRC as any), { to: 'interval-js', fallback: false });
    } catch (e) {
      diagnostic = compileDiagnosticOf(e);
    }
    // The interval mode writes only its locals.
    expect(diagnostic?.code).toBe('outside-profile');
    expect(diagnostic?.operator).toBe('Assign');
  });
});
