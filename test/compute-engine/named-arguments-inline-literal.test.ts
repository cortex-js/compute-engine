import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

/**
 * Named arguments on an INLINE function-literal callee:
 * `((x: number) => x + 1)(x: 5)`.
 *
 * The call canonicalizes through `Apply`, which the named-argument seam
 * excludes (sub-ruling R4: `Apply`'s own first parameter IS the callee, so a
 * written name is meant for that callee, not for `Apply`). The inline-literal
 * carve-out (2026-08-13) reads the parameter names SYNTACTICALLY from the
 * literal expression itself (`inlineLiteralSignature`,
 * `boxed-expression/named-arguments.ts`) and permutes the argument list
 * against them, the same way the qualified-protocol carve-out permutes
 * against a requirement signature.
 *
 * Reading the names from the syntax rather than from the literal's TYPE is
 * what makes UNANNOTATED inline literals work too: an inferred signature
 * drops parameter names (`effects-inference.ts`), which is why a literal
 * bound to a NAME is still not name-addressable (ROADMAP "Named-argument
 * calls — v1 residuals") — but an inline literal's names sit in the very
 * expression being applied.
 */

/** A `NamedArgument` carrier in raw MathJSON. */
const N = (name: string, value: unknown): unknown => [
  'NamedArgument',
  { str: name },
  value,
];

/** An annotated parameter in raw MathJSON. */
const T = (name: string, type: string): unknown => ['Typed', name, { str: type }];

/** Every error code embedded anywhere in `expr`, outermost first — the same
 * walker `named-arguments.test.ts` uses (an `Error`'s cause is an `ErrorCode`
 * application whose first operand is the code string). */
function errorCodes(expr: any): string[] {
  const out: string[] = [];
  const visit = (e: any): void => {
    if (!e) return;
    if (e.operator === 'Error') {
      const cause = e.ops?.[0];
      if (cause?.operator === 'ErrorCode')
        out.push(cause.ops?.[0]?.string ?? '');
      else if (cause?.string) out.push(cause.string);
    }
    for (const op of e.ops ?? []) visit(op);
  };
  visit(expr);
  return out;
}

function epsil(src: string): { value: string; codes: string[] } {
  const r = executeEpsil(new ComputeEngine(), src);
  return {
    value: String(r.value),
    // The code sits at index 3 of both diagnostic shapes the Epsil pass
    // emits: ['static-type-error', description, snippet, code] and
    // ['runtime-error', description, frames, errorCode].
    codes: (r.diagnostics ?? []).map(
      (d: { message: unknown[] }) => String(d.message?.[3] ?? '').split(':')[0]
    ),
  };
}

describe('inline-literal named arguments — Epsil route', () => {
  test('annotated literal, named call', () => {
    const r = epsil('((x: number) => x + 1)(x: 5)');
    expect(r.codes).toEqual([]);
    expect(r.value).toBe('6');
  });

  test('named arguments are permuted into declaration order', () => {
    const r = epsil('((x: number, y: number) => x - y)(y: 2, x: 10)');
    expect(r.codes).toEqual([]);
    expect(r.value).toBe('8');
  });

  test('UNANNOTATED literal: names read from the syntax, not the type', () => {
    const r = epsil('((x, y) => x - y)(y: 2, x: 10)');
    expect(r.codes).toEqual([]);
    expect(r.value).toBe('8');
  });

  test('mixed positional-then-named call', () => {
    const r = epsil('((x: number, y: number) => x - y)(10, y: 2)');
    expect(r.codes).toEqual([]);
    expect(r.value).toBe('8');
  });

  test('positional call is untouched by the carve-out', () => {
    const r = epsil('((x: number) => x + 1)(5)');
    expect(r.codes).toEqual([]);
    expect(r.value).toBe('6');
  });

  test('an unknown name reports argument-name-unknown with the declared names', () => {
    const r = epsil('((x: number) => x + 1)(y: 5)');
    expect(r.value).toContain('argument-name-unknown');
    expect(r.value).toContain('`x`');
  });

  test('a zero-parameter literal names no parameters', () => {
    const r = epsil('(() => 42)(x: 1)');
    expect(r.value).toContain('argument-name-unknown');
    expect(r.value).toContain('declares no parameter names');
  });

  test('a positional argument may not follow a named one', () => {
    const r = epsil('((x: number, y: number) => x - y)(x: 1, 2)');
    expect(r.value).toContain('argument-order-invalid');
  });

  test('writing the same name twice is a duplicate', () => {
    const r = epsil('((x: number) => x + 1)(x: 1, x: 2)');
    expect(r.value).toContain('argument-name-duplicate');
  });
});

describe('inline-literal named arguments — box route parity', () => {
  const literal: unknown = ['Function', ['Subtract', 'x', 'y'], 'x', 'y'];
  const annotated: unknown = [
    'Function',
    ['Subtract', 'x', 'y'],
    T('x', 'number'),
    T('y', 'number'),
  ];

  test('explicit Apply spelling', () => {
    const ce = new ComputeEngine();
    const e = ce.box(['Apply', literal, N('y', 2), N('x', 10)] as any);
    expect(errorCodes(e as any)).toEqual([]);
    expect(e.evaluate().toString()).toBe('8');
  });

  test('implicit-apply spelling: a function-literal head', () => {
    const ce = new ComputeEngine();
    const e = ce.box([annotated, N('y', 2), N('x', 10)] as any);
    expect(errorCodes(e as any)).toEqual([]);
    expect(e.evaluate().toString()).toBe('8');
  });

  test('ce.function route with pre-boxed callee and raw carriers', () => {
    const ce = new ComputeEngine();
    const e = ce.function('Apply', [
      ce.box(literal as any),
      ce.box(N('y', 2) as any, { form: 'raw' }),
      ce.box(N('x', 10) as any, { form: 'raw' }),
    ]);
    expect(errorCodes(e as any)).toEqual([]);
    expect(e.evaluate().toString()).toBe('8');
  });

  test('named calls never curry: a missing required argument is `missing`', () => {
    const ce = new ComputeEngine();
    const e = ce.box(['Apply', literal, N('x', 10)] as any);
    expect(errorCodes(e as any)).toEqual(['missing']);
  });

  test('a non-literal callee still declines (R4 exclusion intact)', () => {
    // `Apply(f, x: 1)` with a symbol callee: the seam has no syntactic
    // parameter list to read, so the carrier declines exactly as before the
    // carve-out.
    const ce = new ComputeEngine();
    ce.assign('f_nl', ce.box(annotated as any));
    const e = ce.box(['Apply', 'f_nl', N('x', 1), N('y', 2)] as any);
    // One decline per carrier: each reports when it canonicalizes.
    expect(errorCodes(e as any)).toEqual([
      'argument-names-unavailable',
      'argument-names-unavailable',
    ]);
  });

  test('a rest-parameter-shaped literal declines rather than guess', () => {
    // A parameter that is neither a bare symbol nor a `Typed` annotation is
    // one `inlineLiteralSignature` cannot name — and might not be
    // one-slot-per-parameter — so the carve-out bails and the carrier
    // declines, instead of silently binding arguments to the wrong slots.
    const ce = new ComputeEngine();
    const weird: unknown = ['Function', ['Add', 'x', 1], ['Spread', 'x']];
    const e = ce.box(['Apply', weird, N('x', 2)] as any);
    expect(errorCodes(e as any)).toContain('argument-names-unavailable');
  });
});
