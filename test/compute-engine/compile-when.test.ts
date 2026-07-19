import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';

const ce = new ComputeEngine();
const glsl = new GLSLTarget();

describe('COMPILE When', () => {
  describe('JavaScript target', () => {
    it('should compile When(x, x > 0) and return x when positive, NaN otherwise', () => {
      const expr = ce.expr(['When', 'x', ['Greater', 'x', 0]]);
      const result = compile(expr)!;
      expect(result.success).toBe(true);
      expect(result.run!({ x: 5 })).toBe(5);
      expect(Number.isNaN(result.run!({ x: -1 }))).toBe(true);
    });

    it('should compile When(5, True) and evaluate to 5', () => {
      const expr = ce.expr(['When', 5, 'True']);
      const result = compile(expr)!;
      expect(result.success).toBe(true);
      expect(result.run!({})).toBe(5);
    });

    it('should compile When(5, False) and evaluate to NaN', () => {
      const expr = ce.expr(['When', 5, 'False']);
      const result = compile(expr)!;
      expect(result.success).toBe(true);
      expect(Number.isNaN(result.run!({}))).toBe(true);
    });

    it('should generate ternary code', () => {
      const expr = ce.expr(['When', 'x', ['Greater', 'x', 0]]);
      const result = compile(expr)!;
      expect(result.code).toContain('?');
      expect(result.code).toContain(':');
      expect(result.code).toContain('NaN');
    });

    it('should compile When nested in an expression', () => {
      // When(x, x > 0) + 1 should be x+1 for x>0, NaN+1=NaN otherwise
      const expr = ce.expr([
        'Add',
        ['When', 'x', ['Greater', 'x', 0]],
        1,
      ]);
      const result = compile(expr)!;
      expect(result.success).toBe(true);
      expect(result.run!({ x: 3 })).toBe(4);
      expect(Number.isNaN(result.run!({ x: -2 }))).toBe(true);
    });
  });

  describe('GLSL target', () => {
    it('should generate ternary code for When', () => {
      const expr = ce.expr(['When', 'x', ['Greater', 'x', 0]]);
      const code = glsl.compile(expr).code;
      expect(code).toContain('?');
      expect(code).toContain(':');
    });

    it('should compile When(x, True) to just x in GLSL', () => {
      const expr = ce.expr(['When', 'x', 'True']);
      const code = glsl.compile(expr).code;
      // Condition is True (1 in boolean context) so x is always returned
      expect(code).toContain('x');
    });
  });

  // CO-P2-24: like Which, a non-boolean When condition fails closed on the JS
  // target (matching the interpreter's throw) rather than silently returning
  // NaN via the else branch.
  describe('non-boolean condition (JS) fails closed', () => {
    it('guards a numeric/NaN condition with _SYS.cond and rethrows', () => {
      const expr = ce.expr(['When', 5, ['Divide', 'x', 'y']]);
      const result = compile(expr, { fallback: false })!;
      expect(result.code).toContain('_SYS.cond(');
      expect(() => result.run!({ x: 0, y: 0 })).toThrow();
    });

    it('leaves a relational condition unguarded', () => {
      const expr = ce.expr(['When', 'x', ['Greater', 'x', 0]]);
      const result = compile(expr, { fallback: false })!;
      expect(result.code).not.toContain('_SYS.cond');
      expect(result.run!({ x: 5 })).toBe(5);
      expect(Number.isNaN(result.run!({ x: -1 }))).toBe(true);
    });
  });

  // The interval comparisons return the tri-state string
  // 'true' | 'false' | 'maybe' — all truthy, so the generic JS ternary can
  // never mask. `When` must compile to the tri-state-aware `_IA.restrict`.
  // (Tycho 0.72.0 restriction-brace probe, issue 1: an input interval
  // entirely outside the condition returned a normal interval result.)
  describe('interval-js target', () => {
    const target = ce.getCompilationTarget('interval-js')!;

    it('compiles When to _IA.restrict, not a bare ternary', () => {
      const expr = ce.parse('\\sin(x)\\{x>0\\}');
      const result = target.compile(expr);
      expect(result.success).toBe(true);
      expect(result.code).toContain('_IA.restrict(');
    });

    it('masks an input interval entirely outside the condition', () => {
      const expr = ce.parse('\\sin(x)\\{x>0\\}');
      const run = target.compile(expr).run!;
      expect(run({ x: { lo: -2, hi: -1 } })).toEqual({ kind: 'empty' });
    });

    it('returns a normal interval entirely inside the condition', () => {
      const expr = ce.parse('\\sin(x)\\{x>0\\}');
      const run = target.compile(expr).run!;
      const r = run({ x: { lo: 1, hi: 2 } }) as any;
      expect(r.kind).toBe('interval');
      expect(r.value.lo).toBeCloseTo(Math.sin(1), 12);
      expect(r.value.hi).toBe(1);
    });

    it('reports a domain-clipped partial when the input straddles the boundary', () => {
      const expr = ce.parse('\\sin(x)\\{x>0\\}');
      const run = target.compile(expr).run!;
      const r = run({ x: { lo: -1, hi: 1 } }) as any;
      expect(r.kind).toBe('partial');
      expect(r.domainClipped).toBe('both');
    });

    it('masks a comma-Or restriction (union of segments)', () => {
      const expr = ce.parse('x\\{x>4, x<0\\}');
      const run = target.compile(expr).run!;
      expect(run({ x: { lo: 1, hi: 2 } })).toEqual({ kind: 'empty' });
      expect((run({ x: { lo: 5, hi: 6 } }) as any).kind).toBe('interval');
    });

    it('masks stacked (And-combined) restrictions', () => {
      const expr = ce.parse('x\\{x\\ge0\\}\\{x\\le1\\}');
      const run = target.compile(expr).run!;
      expect((run({ x: { lo: 0.2, hi: 0.5 } }) as any).kind).toBe('interval');
      expect(run({ x: { lo: 2, hi: 3 } })).toEqual({ kind: 'empty' });
    });
  });
});

// Tycho item 56: n-ary Max/Min over all-scalar arguments typed
// `list | number`, so a comparison over one typed `list<boolean>` and the
// branch-condition assert fail-closed EVERY When mask containing a
// reduction (`y = x {max(a,x) < 2}` masked its whole curve). Max/Min now
// type `number` — they always reduce to a scalar (ElementMax/ElementMin
// are the broadcasting variants).
describe('When condition containing Max/Min compiles (Tycho item 56)', () => {
  it('Max over scalars types number, and the comparison types boolean', () => {
    expect(ce.box(['Max', 'x', ['Add', 'x', -4]]).type.toString()).toBe(
      'number'
    );
    expect(ce.parse('\\max(x,x-4)<2').type.toString()).toBe('boolean');
  });

  it('a When mask with a Max condition compiles and masks correctly', () => {
    const w = ce.box(['When', 'x', ['Less', ['Max', 'x', ['Add', 'x', -4]], 2]]);
    const res = compile(w, { to: 'javascript' });
    expect(res.success).toBe(true);
    const run = (res as any).run;
    expect(run({ x: 1 })).toBe(1); // max(1, −3) = 1 < 2 → visible
    expect(run({ x: 5 })).toBeNaN(); // max(5, 1) = 5 ≥ 2 → masked
  });

  it('Max still reduces collections to a scalar extremum', () => {
    const ce2 = new ComputeEngine();
    ce2.assign('L', ce2.box(['List', 1, 7, 3]).evaluate());
    const m = ce2.box(['Max', 'L']);
    expect(m.type.toString()).toBe('number');
    expect(m.evaluate().re).toBe(7);
  });
});
