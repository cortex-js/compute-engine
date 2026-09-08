import { ComputeEngine } from '../../src/compute-engine';

/**
 * A pipe stage written as a raw APPLICATION mentioning the topic placeholder
 * — the LaTeX operator shorthand `[1,2,3] |> \_^2` (the LaTeX parser leaves
 * it as `Power(_, 2)`) and the call form `xs |> Take(_, 2)`.
 *
 * Two defects are pinned here:
 * - the static type of such a pipe was `unknown` while `[1,2,3] |> \_^2`
 *   evaluates to a `vector<integer^3>`;
 * - lifting the shorthand into a function literal substituted `_` with `_1`
 *   through a canonicalizing `subs`, which auto-declared `_1` in the caller's
 *   scope with the type the body inferred. On one engine, a `\_^2` pipe
 *   followed by a `Take(\_, 2)` pipe threw "Function body must be a scoped
 *   Block expression", and `[1,2,3] |> Sum(\_)` answered the list.
 */

const typeOf = (ce: ComputeEngine, s: string) => ce.parse(s).type.toString();
const valueOf = (ce: ComputeEngine, s: string) =>
  ce.parse(s).evaluate().toString();

describe('LaTeX pipe shorthand: static type', () => {
  const ce = new ComputeEngine();

  test('a broadcastable head over a list of scalars types element-wise', () => {
    expect(typeOf(ce, '[1,2,3] |> \\_^2')).toBe('list<integer<0..>^3>');
    expect(valueOf(ce, '[1,2,3] |> \\_^2')).toBe('[1,4,9]');
    expect(typeOf(ce, '[1,2,3] |> \\_ + 1')).toBe('vector<integer^3>');
    expect(valueOf(ce, '[1,2,3] |> \\_ + 1')).toBe('[2,3,4]');
    expect(typeOf(ce, '[1,2,3] |> \\sin(\\_)')).toBe('vector<real^3>');
  });

  test('a non-broadcastable head over the whole topic', () => {
    expect(typeOf(ce, '[1,2,3] |> \\mathrm{Length}(\\_)')).toBe('integer');
    expect(valueOf(ce, '[1,2,3] |> \\mathrm{Length}(\\_)')).toBe('3');
  });

  test('a scalar topic types the applied body', () => {
    expect(typeOf(ce, '5 |> \\_^2')).toBe('integer<25..25>');
    expect(valueOf(ce, '5 |> \\_^2')).toBe('25');
  });

  test('shapes this derivation cannot type stay undecided, never wrong', () => {
    // A tuple topic broadcasts component-wise; a nested list needs a lift the
    // descriptor derivation does not perform; a placeholder inside an inner
    // application of a whole-collection head meets the same gap.
    expect(typeOf(ce, '(1,2) |> \\_^2')).toBe('unknown');
    expect(valueOf(ce, '(1,2) |> \\_^2')).toBe('(1, 4)');
    expect(typeOf(ce, '[[1,2],[3,4]] |> \\_^2')).toBe('unknown');
    expect(typeOf(ce, '[1,2,3] |> \\mathrm{Length}(\\_^2)')).toBe('unknown');
    // A broadcastable head over an inner whole-collection application: the
    // value is the scalar 4, so the element-wise typing must not apply.
    expect(typeOf(ce, '[1,2,3] |> \\mathrm{Length}(\\_) + 1')).toBe('unknown');
    expect(valueOf(ce, '[1,2,3] |> \\mathrm{Length}(\\_) + 1')).toBe('4');
  });
});

describe('LaTeX pipe shorthand: the lifted placeholder does not leak', () => {
  test('a call-form stage after an operator-shorthand stage', () => {
    const ce = new ComputeEngine();
    expect(valueOf(ce, '[1,2,3] |> \\_^2')).toBe('[1,4,9]');
    expect(ce.lookupDefinition('_1')).toBeUndefined();
    expect(valueOf(ce, '[1,2,3] |> \\mathrm{Take}(\\_, 2)')).toBe('[1,2]');
    expect(valueOf(ce, '[1,2,3] |> \\mathrm{Reverse}(\\_)')).toBe('[3,2,1]');
  });

  test('a scalar shorthand pipe before a collection call-form pipe', () => {
    const ce = new ComputeEngine();
    expect(valueOf(ce, '5 |> \\_^2')).toBe('25');
    expect(valueOf(ce, '[1,2,3] |> \\mathrm{Reverse}(\\_)')).toBe('[3,2,1]');
  });

  test('a big op over the piped collection reduces it', () => {
    const ce = new ComputeEngine();
    expect(valueOf(ce, '[1,2,3] |> \\mathrm{Sum}(\\_)')).toBe('6');
    expect(valueOf(ce, '[1,2,3] |> \\mathrm{Product}(\\_)')).toBe('6');
    expect(valueOf(ce, '[1,2,3] |> \\mathrm{Sum}(2\\_)')).toBe('12');
  });

  test('the other shorthand users still lift', () => {
    const ce = new ComputeEngine();
    expect(valueOf(ce, '\\mathrm{Map}(\\_^2, [1,2,3])')).toBe('[1,4,9]');
    expect(valueOf(ce, '\\mathrm{Filter}([1,2,3,4], \\_ > 2)')).toBe('[3,4]');
    expect(
      ce
        .box(['Apply', ['Power', '_', 2], 3])
        .evaluate()
        .toString()
    ).toBe('9');
  });
});
