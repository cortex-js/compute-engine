/**
 * The serialization style options (`rootStyle`, `fractionStyle`, etc...) can be
 * specified either as a function of the expression and of its level, or as a
 * constant string, e.g. `rootStyle: 'solidus'`.
 *
 * This module has no dependencies so that the option-ingestion boundary
 * (`ComputeEngine.latexOptions`) can validate the constant form without
 * statically pulling in the LaTeX serializer.
 */

/** The values accepted by each style option when specified as a constant. */
const STYLE_OPTIONS: Record<string, readonly string[]> = {
  applyFunctionStyle: ['normal', 'scaled', 'big', 'none'],
  groupStyle: ['normal', 'scaled', 'big', 'none'],
  rootStyle: ['radical', 'quotient', 'solidus'],
  fractionStyle: [
    'quotient',
    'block-quotient',
    'inline-quotient',
    'inline-solidus',
    'nice-solidus',
    'reciprocal',
    'factor',
  ],
  logicStyle: ['word', 'boolean', 'uppercase-word', 'punctuation'],
  powerStyle: ['root', 'solidus', 'quotient'],
  numericSetStyle: ['compact', 'regular', 'interval', 'set-builder'],
  indexStyle: ['subscript', 'bracket'],
};

/**
 * Throw if a style option is specified as a string which is not one of the
 * values accepted for that option. Silently ignoring it would result in an
 * empty serialization.
 */
export function validateStyleOptions(options: object): void {
  const opts = options as Record<string, unknown>;
  for (const key of Object.keys(STYLE_OPTIONS)) {
    const value = opts[key];
    if (typeof value !== 'string') continue;
    if (!STYLE_OPTIONS[key].includes(value))
      throw new Error(
        `Invalid value "${value}" for the LaTeX serialization option "${key}". Expected a function, or one of: ${STYLE_OPTIONS[
          key
        ]
          .map((x) => `"${x}"`)
          .join(', ')}`
      );
  }
}

/**
 * Replace the constant form of the style options with the equivalent function
 * so the serializer only has to deal with functions. Throws if a constant is
 * not a valid value for that option.
 *
 * Returns `options` unchanged (same reference) when there is nothing to
 * normalize.
 */
export function normalizeStyleOptions<T extends object>(options: T): T {
  validateStyleOptions(options);
  let result: T | undefined = undefined;
  for (const key of Object.keys(STYLE_OPTIONS)) {
    const value = (options as Record<string, unknown>)[key];
    if (typeof value !== 'string') continue;
    result ??= { ...options };
    (result as Record<string, unknown>)[key] = () => value;
  }
  return result ?? options;
}
