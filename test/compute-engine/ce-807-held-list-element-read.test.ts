import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

// ROADMAP CE-807: a symbol declared with the bare type `list` has the static
// element type `any`, so `At(C, i + 1)` is typed `any` and an indexed `Sum`
// over `At(C, i + 1) * x^i` tested the shape of its term at run time
// (`Array.isArray` and `_SYS.bcast`). The compiled code folds the value that
// `C` holds into a preamble constant, so the read sees a list of numbers
// when the held value is a `List` of numeric symbols. The term is then a
// number, and the loop adds numbers with no test.
//
// A bare `list` symbol whose held value is not a list of numbers, a bound
// name that spells the same name, and a symbol with no held value keep the
// run-time test (or decline), as before.

const NAMES = Array.from({ length: 10 }, (_, k) => `c_${k + 1}`);
const SUM = '\\sum_{i=0}^{\\mathrm{Length}(C)-1}C[i+1]x^{i}';

/** An engine where `C` is declared with the bare type `list` and holds
 * `[c_1, ..., c_10]`. The declared type is set back to `list` after the
 * assignment, as a host that declares the type first and assigns later does
 * (the assignment alone narrows it to `list<real>`). */
function engineWithBareList(elements: unknown[] = NAMES): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('C', { type: 'list' });
  ce.assign('C', ce.box(['List', ...elements] as any));
  // The element symbols are declared AFTER the assignment, as in a document
  // where the names are typed when a row is compiled: the held list keeps
  // symbol nodes that report the old type, `unknown`.
  for (const n of NAMES) ce.declare(n, 'real');
  ce.declare('x', 'real');
  (ce.lookupDefinition('C') as any).value.type = ce.type('list');
  return ce;
}

describe('CE-807: element read of a bare-list symbol that holds numbers', () => {
  test('the Sum loop adds numbers with no run-time shape test', () => {
    const ce = engineWithBareList();
    const e = ce.parse(SUM);
    // Precondition: the static type is open, which is what the defect needs.
    expect((e as any).ops[0].ops[0].type.toString()).toBe('any');
    const r = compile(e, { to: 'javascript', mode: 'strict' } as any);
    expect(r.success).toBe(true);
    expect(r.code).not.toMatch(/Array\.isArray/);
    expect(r.code).not.toMatch(/bcast/);
  });

  test('the compiled value equals the interpreter value', () => {
    const ce = engineWithBareList();
    const r = compile(ce.parse(SUM), { to: 'javascript', mode: 'strict' } as any);
    const vars: Record<string, number> = { x: 2 };
    NAMES.forEach((n, k) => (vars[n] = k + 1));
    // 1 + 2*2 + 3*4 + ... + 10*2^9
    let expected = 0;
    for (let k = 0; k < 10; k++) expected += (k + 1) * 2 ** k;
    expect((r as any).run(vars)).toBe(expected);
  });

  test('a held list with a non-numeric element keeps the run-time test', () => {
    const ce = engineWithBareList([...NAMES.slice(0, 9), ['List', 1, 2]]);
    const r = compile(ce.parse(SUM), {
      to: 'javascript',
      mode: 'strict',
    } as any);
    expect(r.code ?? '').not.toBe('');
    expect(r.code).toMatch(/bcast|Array\.isArray/);
  });
});
