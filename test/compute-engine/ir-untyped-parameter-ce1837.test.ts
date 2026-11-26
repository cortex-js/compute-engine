import { ComputeEngine, compile } from '../../src/compute-engine';
import type { CompileDiagnostic } from '../../src/compute-engine/compilation/types';

// CE-1837: a positional parameter of a root function literal of no declared
// type whose uses give it a type that admits a list (`value`, a union of a
// number and a tensor) declines with `untyped-input`, as an input of no type
// does: a list passed there was read as a number (`v ↦ Norm(v)` gave NaN for
// `[3, 4]`). One of a number type, or whose uses give it no type
// (`unknown`), is a real, as before.

type Result = {
  success: boolean;
  diagnostic?: CompileDiagnostic;
  unsupported?: string[];
  run?: (...a: unknown[]) => unknown;
};

const ce = new ComputeEngine();

const strict = (json: unknown) => {
  try {
    return compile(ce.box(json as never), {
      to: 'javascript',
      fallback: false,
    }) as unknown as Result;
  } catch (e) {
    return {
      success: false,
      diagnostic: (e as { diagnostic?: CompileDiagnostic }).diagnostic,
    } as Result;
  }
};

const withFallback = (json: unknown) =>
  compile(ce.box(json as never), { to: 'javascript' }) as unknown as Result;

const M = [
  [1, 2],
  [3, 4],
];

describe('CE-1837: a root function literal of an untyped parameter', () => {
  test.each([
    ['A ↦ Transpose(A)', ['Function', ['Transpose', 'A'], 'A'], 'A'],
    ['v ↦ Norm(v)', ['Function', ['Norm', 'v'], 'v'], 'v'],
  ])('%s declines, naming the parameter', (_, json, name) => {
    const r = strict(json);
    expect(r.success).toBe(false);
    expect(r.diagnostic?.code).toBe('untyped-input');
    expect(r.diagnostic?.kind).toBe('correctness');
    expect(r.diagnostic?.value).toBe(name);
    expect(r.diagnostic?.message).toContain(
      `the parameter ${name} of no declared type`
    );
    expect(r.diagnostic?.message).toContain(`(${name}: matrix<real>) ↦ …`);
  });

  // The interpreter applies a function of an untyped parameter to each
  // element of a list argument (`Apply(v ↦ Norm(v), [3, 4])` is `[3, 4]`);
  // the compiled code gave NaN there.
  test('with the fallback, the witnesses give the interpreter values', () => {
    const t = withFallback(['Function', ['Transpose', 'A'], 'A']);
    expect(t.success).toBe(false);
    expect(t.unsupported).toEqual(['A']);
    expect(t.run!(M)).toEqual(M);
    const n = withFallback(['Function', ['Norm', 'v'], 'v']);
    expect(n.success).toBe(false);
    expect(n.unsupported).toEqual(['v']);
    expect(n.run!([3, 4])).toEqual([3, 4]);
    // The interpreter's value of the call.
    expect(
      ce
        .box(['Apply', ['Function', ['Norm', 'v'], 'v'], ['List', 3, 4]])
        .evaluate()
        .toString()
    ).toBe('[3,4]');
  });

  test('a declared parameter takes the list whole', () => {
    const r = strict([
      'Function',
      ['Norm', 'v'],
      ['Typed', 'v', "'list<real>'"],
    ]);
    expect(r.success).toBe(true);
    expect(r.run!([3, 4])).toBe(5);
  });

  test('a parameter whose uses give it a number type is a real', () => {
    const s = strict(['Function', ['Sin', 'x'], 'x']);
    expect(s.success).toBe(true);
    expect(s.run!(1)).toBeCloseTo(Math.sin(1), 15);
    const a = strict(['Function', ['Add', 'x', 'y'], 'x', 'y']);
    expect(a.success).toBe(true);
    expect(a.run!(1, 2)).toBe(3);
  });

  // `docs/COMPILATION-MODEL.md`: a list there is outside the type that the
  // body implies (`x ↦ f(x)` with `f` a user function of an untyped
  // parameter, the literal of a compiled `Map`).
  test('a parameter whose uses give it no type is a real', () => {
    const r = strict(['Function', 'x', 'x']);
    expect(r.success).toBe(true);
    expect(r.run!(3)).toBe(3);
  });

  test('a parameter that the body does not read compiles', () => {
    const r = strict(['Function', 2, 'x']);
    expect(r.success).toBe(true);
    expect(r.run!(5)).toBe(2);
  });

  test('a declared parameter compiles', () => {
    const r = strict([
      'Function',
      ['Transpose', 'A'],
      ['Typed', 'A', "'matrix<real>'"],
    ]);
    expect(r.success).toBe(true);
    expect(r.run!(M)).toEqual([
      [1, 3],
      [2, 4],
    ]);
  });

  // The type is the parameter's own: an inner binder of the same name whose
  // type admits a list does not decline the outer parameter, a number.
  test('an inner binder of the same name does not decline the parameter', () => {
    const r = strict([
      'Function',
      [
        'Add',
        ['Sin', 'x'],
        ['Sum', ['Map', ['List', 1, 2], ['Function', ['Norm', 'x'], 'x']]],
      ],
      'x',
    ]);
    expect(r.diagnostic?.code).not.toBe('untyped-input');
  });
});
