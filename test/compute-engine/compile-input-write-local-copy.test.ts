/**
 * A compiled body that assigns an input declines.
 *
 * When an engine scope binds `u` (`ce.declare('u', 'real')`), the body
 * `u ≔ u + 1` writes a symbol of the engine. The interpreter changes the
 * engine's binding. Compiled code writes only the locals that it declares, so
 * the compilation declines on every target: the host can return the value and
 * assign it, or the body can declare a local with a value and read the local.
 */
import { ComputeEngine, compile } from '../../src/compute-engine';
import { compileDiagnosticOf } from '../../src/compute-engine/compilation/diagnostics';

const range = ['Element', 'i', ['Range', 1, 3]];

/** [name, MathJSON]. Each one assigns `u`. */
const PROGRAMS: [string, any][] = [
  [
    'u ≔ u + 1, then a read',
    ['Block', ['Assign', 'u', ['Add', 'u', 1]], ['Multiply', 'u', 2]],
  ],
  [
    'an accumulation in a loop',
    ['Block', ['Loop', ['Assign', 'u', ['Add', 'u', 'i']], range], 'u'],
  ],
];

const DECLINE = /a write to a name that is not a local/;

describe('JAVASCRIPT: AN INPUT THAT THE BODY ASSIGNS', () => {
  // A write to a symbol declared in the engine declines.
  for (const [name, src] of PROGRAMS)
    test(name, () => {
      const ce = new ComputeEngine();
      ce.declare('u', 'real');
      expect(() => compile(ce.box(src), { fallback: false })).toThrow(DECLINE);
    });

});

describe('INTERVAL-JS: AN INPUT THAT THE BODY ASSIGNS', () => {
  // A write to a symbol declared in the engine declines.
  for (const [name, src] of PROGRAMS)
    test(name, () => {
      const ce = new ComputeEngine();
      ce.declare('u', 'real');
      let diagnostic;
      try {
        compile(ce.box(src), { to: 'interval-js', fallback: false });
      } catch (e) {
        diagnostic = compileDiagnosticOf(e);
      }
      // The interval mode writes only its locals.
      expect(diagnostic?.code).toBe('outside-profile');
      expect(diagnostic?.operator).toBe('Assign');
    });
});
