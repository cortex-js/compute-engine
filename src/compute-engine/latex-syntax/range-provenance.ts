/**
 * Provenance set of `Range` nodes produced by the range *infix* operators
 * (`..`, `...`, `\ldots`, `\dots` — see `parseRange`). Membership distinguishes
 * a range written with the ellipsis/`..` idiom (which, as a trailing element of
 * a bracketed sample list, denotes a continuation: `[0, 15...210]`,
 * `[1, 3..10]`) from a range written explicitly as a `\operatorname{Range}(…)`
 * function call (which is a literal list element: `[3, Range(1, 5)]` stays a
 * `List`). Rewrites of raw MathJSON must carry membership to replacement
 * nodes until continuation-range normalization is complete.
 */
export const continuationRanges = new WeakSet<object>();
