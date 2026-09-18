/**
 * The host console, as the engine sees it: the implementation behind the
 * `console` effect label. The `Print` operator calls `log`; the `Input`
 * operator calls `readLine`.
 *
 * @category Host Capabilities
 */
export interface ConsoleHandler {
  /** Write one line of text. The line has no trailing newline; the handler
   * adds the line break its output medium needs. */
  log(line: string): void;

  /**
   * Read one line of text, synchronously. `prompt`, when given, is displayed
   * before the read.
   *
   * The three results are distinct:
   * - a string: the line, without its trailing newline;
   * - `null`: end of input, or the user canceled the read — `Input`
   *   evaluates to `Nothing`;
   * - `undefined`: this host has no interactive input — `Input` stays
   *   unevaluated.
   */
  readLine(prompt?: string): string | null | undefined;
}

/**
 * The host capabilities of an engine: one handler for each capability the
 * library operators can reach. This is the value of `ce.effects`.
 *
 * A handler is either an implementation or **`null`**. `null` is a denial:
 * an operator that needs the capability evaluates to an
 * `Error("capability-denied", …)` value instead of reaching the host.
 *
 * The object is immutable. To change a handler, install a new registry:
 * assign `ce.effects`, or call `ce.withEffects()` for a change that lasts for
 * one callback.
 *
 * Only `console` has a handler today, because `Print` and `Input` are the only
 * library operators that reach a host capability. The other capability labels
 * of the effect system (`network`, `fs_read`, `fs_write`, `time`,
 * `environment`) get a handler when the first operator that needs one is
 * added: a handler that no operator reads would accept an override and
 * silently do nothing.
 *
 * @category Host Capabilities
 */
export interface EffectHandlers {
  readonly console: ConsoleHandler | null;
}

/**
 * A partial change to the host capabilities, for `ce.withEffects()` and the
 * `ce.effects` setter. For each capability:
 * - an implementation replaces the current handler;
 * - `null` denies the capability, even when the default handler exists;
 * - an absent key, or `undefined`, keeps the current handler.
 *
 * @category Host Capabilities
 */
export type EffectHandlerOverrides = {
  readonly [K in keyof EffectHandlers]?: EffectHandlers[K] | undefined;
};
