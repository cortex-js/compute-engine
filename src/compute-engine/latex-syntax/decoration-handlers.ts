/**
 * The parse handlers of the default decoration commands: the style switches,
 * the size switches, `\color`, the invisible boxes (`\phantom` and its
 * variants) and the struts. They change only the appearance of the math.
 *
 * The parser skips such a command before an infix operator only when the
 * active dictionary entry of the command is one of these handlers, so a
 * custom dictionary that gives the command another meaning is respected.
 *
 * This set and `CONTENT_PARSE_HANDLERS` are in their own module because both
 * the dictionary (`dictionary/definitions-other.ts`, which adds the handlers)
 * and the parser (`parse.ts`, which reads them) import them, and the parser
 * cannot import the dictionary module without a circular import.
 */
export const DECORATION_PARSE_HANDLERS = new Set<unknown>();

/** Record `handler` as a decoration handler and return it. */
export function decoration<T>(handler: T): T {
  DECORATION_PARSE_HANDLERS.add(handler);
  return handler;
}

/**
 * The parse handlers of the default commands that return the math of their
 * argument unchanged in value: `\smash{…}`, `\placeholder{…}`, and the
 * style, size and color switches, which return their body. An
 * authored `\mathrm{Nothing}` in such an argument is still an operand. Any
 * other dictionary entry that reads an authored `Nothing` and returns
 * `Nothing` is taken to discard it, as `\phantom{…}` does.
 */
export const CONTENT_PARSE_HANDLERS = new Set<unknown>();

/** Record `handler` as a handler that returns its argument, and return it. */
export function contentCommand<T>(handler: T): T {
  CONTENT_PARSE_HANDLERS.add(handler);
  return handler;
}
