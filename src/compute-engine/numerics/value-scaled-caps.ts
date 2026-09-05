/**
 * Result-count caps shared by the interpreter and the compiled lane for
 * operators whose work scales with an operand VALUE — one materialized
 * element, or one matrix product, per unit of the operand. The interpreter
 * stays symbolic past a cap. The JavaScript target fails closed at compile
 * time on a literal past a cap, and answers NaN — the compiled spelling for
 * "no value" — for a run-time operand past it, so both lanes are bounded by
 * the same numbers. The constants live here, outside `library/` and
 * `compilation/`, so that both can import them — the same arrangement as
 * `MAX_RANDOM_ELEMENT_COUNT` in `random.ts`.
 */

/** The most groups `Chunk(xs, k)` materializes: one list per group, empty
 * groups included, so the work scales with the value of `k`. */
export const MAX_CHUNK_COUNT = 10_000;

/** The most colors `Colormap(palette, n)` samples into a list: one sample
 * per color, so the work scales with the value of `n`. */
export const MAX_COLORMAP_SAMPLES = 10_000;

/** The largest |exponent| `MatrixPower` computes. The multiplication count
 * is logarithmic (exponentiation by squaring), but exact entries grow
 * linearly in the exponent (`[[2]]^n` has n·log₁₀2 digits), so a
 * value-sized exponent is still unbounded work. */
export const MAX_MATRIX_POWER_EXPONENT = 1_000_000;
