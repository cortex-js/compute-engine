import { ComputeEngine } from '../../src/compute-engine';

//
// AN EXPRESSION BOXED BEFORE A NARROWING READS THE NARROWED TYPE
//
// A use of a symbol can narrow its inferred type (`Mod(x, 2)` makes `x`
// `real`). The narrowing cannot advance the type caches where it happens (it
// happens while a type is being computed), so it advances them when that
// computation ends. Before, an expression boxed earlier kept the type it had
// computed with the wider type of the symbol.
//

describe('a narrowing reaches the types of expressions boxed before it', () => {
  test('the example of the ROADMAP entry', () => {
    const ce = new ComputeEngine();
    const l = ce.box(['List', 'x']);
    const s = ce.box(['Add', 'x', 1]);
    expect(l.type.toString()).toBe('vector<1>');
    expect(s.type.toString()).toBe('number');

    ce.box(['Mod', 'x', 2]).evaluate();
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
    ce.box(['Mod', 'y', 2]).evaluate();
    expect(ce.symbol('y').type.toString()).toBe('real');
    const fresh = ce.box(['Abs', ['Add', 'y', 1]]);
    expect(q.type.toString()).toBe(fresh.type.toString());
    expect(q.sgn).toBe(fresh.sgn);
    expect(typeBefore).not.toBe(q.type.toString());
  });

  test('a rolled-back narrowing restores the old types', () => {
    const ce = new ComputeEngine();
    const l = ce.box(['List', 'z']);
    expect(l.type.toString()).toBe('vector<1>');
    ce._withBoxingPassWindow(() =>
      ce._withRolledBackInference(() => {
        ce.box(['Mod', 'z', 2]);
        expect(ce.symbol('z').type.toString()).toBe('real');
        // Cached with the narrowed type, inside the frame.
        expect(l.type.toString()).toBe('vector<real^1>');
      })
    );
    expect(ce.symbol('z').type.toString()).toBe('unknown');
    expect(l.type.toString()).toBe(ce.box(['List', 'z']).type.toString());
  });
});
