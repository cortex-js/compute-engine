import { ComputeEngine } from '../../src/compute-engine';
import { parseSource } from '../../src/cli/check';
import { staticDiagnostics } from '../../src/epsil/static-diagnostics';

//
// AN EXPRESSION BOXED BEFORE A NARROWING READS THE NARROWED TYPE
//
// `ce.infer()` over a use of a symbol declares its inferred type
// (`Mod(x, 2)` makes `x` `real`). An expression boxed before reads that
// definition: its cached type is computed again, and it does not keep the
// type it computed with the wider type of the symbol.
//

describe('a narrowing reaches the types of expressions boxed before it', () => {
  test('the example of the ROADMAP entry', () => {
    const ce = new ComputeEngine();
    const l = ce.box(['List', 'x']);
    const s = ce.box(['Add', 'x', 1]);
    expect(l.type.toString()).toBe('vector<1>');
    expect(s.type.toString()).toBe('number');

    ce.infer([ce.box(['Mod', 'x', 2])]);
    expect(ce.symbol('x').type.toString()).toBe('real');

    expect(l.type.toString()).toBe(ce.box(['List', 'x']).type.toString());
    expect(l.type.toString()).toBe('vector<real^1>');
    expect(s.type.toString()).toBe('real');
  });

  test('the sign of an expression boxed before a narrowing', () => {
    const ce = new ComputeEngine();
    const q = ce.box(['Abs', ['Add', 'y', 1]]);
    // Read (and cache) the type and the sign with the wide type of `y`.
    const typeBefore = q.type.toString();
    void q.sgn;
    ce.infer([ce.box(['Mod', 'y', 2])]);
    expect(ce.symbol('y').type.toString()).toBe('real');
    const fresh = ce.box(['Abs', ['Add', 'y', 1]]);
    expect(q.type.toString()).toBe(fresh.type.toString());
    expect(q.sgn).toBe(fresh.sgn);
    expect(typeBefore).not.toBe(q.type.toString());
  });

  test('a static check that assigns an outer symbol restores the old types', () => {
    const ce = new ComputeEngine();
    ce.declare('z', 'unknown');
    const l = ce.box(['List', 'z']);
    expect(l.type.toString()).toBe('vector<1>');
    // The check gives `z` the type of the assigned value while it runs.
    const source = 'z = 2.5\nz';
    const { ast } = parseSource(source, undefined, ce);
    staticDiagnostics(ce, ast!, source);
    expect(ce.symbol('z').type.toString()).toBe('unknown');
    expect(l.type.toString()).toBe(ce.box(['List', 'z']).type.toString());
  });
});
