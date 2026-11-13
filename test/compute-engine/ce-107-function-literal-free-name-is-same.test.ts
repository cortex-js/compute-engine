import { ComputeEngine } from '../../src/compute-engine';

/**
 * Canonicalization wraps the body of a function literal in a `Block`, and a
 * free name of the body is a free name of the scope that the literal is
 * written in: the boxing declares nothing. `isSame()` compares the binding of
 * a symbol as well as its name, and the literal's `f` is the same binding as
 * a global `f`. `docs/SCOPING-MODEL.md`, "Canonical and runtime scopes",
 * states this. These tests hold the statements of that section. Each one uses
 * its own engine, because the result depends on whether `f` is already
 * declared.
 */
const BOXED = ['D', ['Function', ['Block', 'f'], 'x'], 'x'];
const LATEX = '\\frac{\\mathrm{d}f}{\\mathrm{d}x}';

describe('the free name of a function literal', () => {
  // The parse declares no `f`, so the `f` of each literal is a free name
  // with the same home scope and name: the same binding.
  test('a boxed and a later parsed derivative have one `.json` and are isSame', () => {
    const ce = new ComputeEngine();
    const boxed = ce.box(BOXED as any);
    const parsed = ce.parse(LATEX);
    expect(boxed.json).toEqual(BOXED);
    expect(parsed.json).toEqual(BOXED);
    expect(boxed.isSame(parsed)).toBe(true);
    expect(parsed.isSame(boxed)).toBe(true);
  });

  test('a boxed and a later parsed derivative have one value', () => {
    const ce = new ComputeEngine();
    const boxed = ce.box(BOXED as any);
    const parsed = ce.parse(LATEX);
    expect(boxed.evaluate().json).toBe(0);
    expect(parsed.evaluate().json).toBe(0);
    ce.assign('f', 5);
    expect(boxed.evaluate().json).toBe(0);
    expect(parsed.evaluate().json).toBe(0);
  });

  test('they are isSame when the parse runs first', () => {
    const ce = new ComputeEngine();
    const parsed = ce.parse(LATEX);
    expect(ce.box(BOXED as any).isSame(parsed)).toBe(true);
  });

  test('they are isSame when `f` is declared first', () => {
    const declared = new ComputeEngine();
    declared.declare('f', 'real');
    const a = declared.box(BOXED as any);
    expect(a.isSame(declared.parse(LATEX))).toBe(true);

    const used = new ComputeEngine();
    used.box('f');
    const b = used.box(BOXED as any);
    expect(b.isSame(used.parse(LATEX))).toBe(true);
  });

  test('two literals boxed the same way are isSame', () => {
    const ce = new ComputeEngine();
    expect(ce.box(BOXED as any).isSame(ce.box(BOXED as any))).toBe(true);
    expect(ce.parse(LATEX).isSame(ce.parse(LATEX))).toBe(true);
  });

  test('the literal reads the value of a later global `f`', () => {
    const ce = new ComputeEngine();
    const literal = ce.box(['Function', ['Block', 'f'], 'x']);
    const body = literal.op1!.op1!;
    const global = ce.box('f');
    expect(body.json).toBe('f');
    expect(body.isSame(global)).toBe(true);
    ce.assign('f', 5);
    expect(global.evaluate().json).toBe(5);
    expect(ce.box(['Apply', literal, 3]).evaluate().json).toBe(5);
  });
});
