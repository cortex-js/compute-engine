import { performance } from 'node:perf_hooks';

import type { BoxedExpression, ComputeEngine } from '../compute-engine.js';
import type { Type } from '../common/type/types.js';
import {
  budgetCauseOf,
  isTimeoutCancellation,
  type CancellationCause,
} from '../common/interruptible.js';
import { compile } from '../compute-engine/compilation/compile-expression.js';
import type { CompilationResult } from '../compute-engine/compilation/types.js';
import type { ParsingDiagnostic } from '../epsil/diagnostics.js';
import { resolveLibraryNames } from '../epsil/resolve-library-names.js';
import { staticDiagnostics } from '../epsil/static-diagnostics.js';

import { parseSource } from './check.js';
import type { EvaluationResult, InputFormat } from './types.js';

/**
 * Compile a program to JavaScript and run the generated code — the
 * `--compile` mode of the CLI. The result has the shape `session.evaluate()`
 * answers, so the output and diagnostics pipeline of the CLI is shared.
 *
 * The compiled route differs from the interpreter by construction, and this
 * mode exists to show those differences rather than hide them:
 *
 * - Arithmetic is machine arithmetic. Every number is a float: `1/3` is
 *   `0.333…`, `sqrt(2)` is `1.414…`, and a pole is `Infinity` or `NaN` where
 *   the interpreter answers `~oo` or an exact value.
 * - The program must be closed. The generated code reads a symbol with no
 *   value from an inputs object, and this mode supplies none, so a program
 *   whose value would stay symbolic in the interpreter (`x + 1`) is an
 *   error value naming the symbol.
 * - A construct the JavaScript target declines is an error value with the
 *   target's reason, never an interpreter fallback: the point of the mode is
 *   to see what the compiled program does.
 *
 * Parse diagnostics and the canonicalization-time type errors are reported as
 * the interpreter reports them (`executeEpsil`), so `--compile` changes the
 * evaluation, not the checks that precede it.
 */
export function evaluateCompiled(
  engine: ComputeEngine,
  source: string,
  options: { url?: string; inputFormat: InputFormat; timeLimit: number }
): EvaluationResult {
  const start = performance.now();
  const diagnostics: ParsingDiagnostic[] = [];

  const run = (): BoxedExpression => {
    let expr: BoxedExpression;
    if (options.inputFormat === 'latex') {
      expr = engine.parse(source);
      // A LaTeX parse error is an error in the value, as on the interpreted
      // route (`session.evaluateLatex`): the error expressions carry no
      // source offsets, so there is no diagnostic to report.
      if (expr.errors.length > 0) return expr;
    } else {
      const parsed = parseSource(source, options.url, engine);
      diagnostics.push(...parsed.diagnostics);
      if (
        parsed.ast === null ||
        parsed.diagnostics.some((x) => x.severity === 'error')
      )
        return engine.Nothing;
      // The library spellings (`sqrt`, `pi`) become library names (`Sqrt`,
      // `Pi`) before the tree is boxed, as `executeEpsil` does.
      resolveLibraryNames(parsed.ast, source, engine);
      staticDiagnostics(engine, parsed.ast, source, diagnostics);
      expr = engine.box(parsed.ast);
      // An empty program (or one of comments only) is `Nothing`, which the
      // interpreter answers as is and the CLI prints as nothing; there is no
      // code to generate for it.
      if (expr.isSame(engine.Nothing)) return expr;
    }

    // `fallback: false`: a decline throws with the target's reason, instead
    // of answering an interpreter fallback (and warning on the console that
    // it did so). The mode reports the decline as an error value; a
    // cancellation (a deadline, an iteration limit) is not a decline and is
    // thrown on to the handler below. The class is checked by name, since an
    // `instanceof` fails across bundle boundaries.
    let result: CompilationResult<'javascript'>;
    try {
      result = compile<'javascript'>(expr, {
        to: 'javascript',
        fallback: false,
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'CancellationError')
        throw error;
      return errorValue(
        engine,
        'compile-declined',
        error instanceof Error ? error.message : String(error)
      );
    }

    const free = result.freeSymbols ?? [];
    if (free.length > 0)
      return errorValue(
        engine,
        'unbound-symbol',
        `${free.map((x) => `\`${x}\``).join(', ')} ${
          free.length === 1 ? 'has' : 'have'
        } no value; a compiled program cannot keep a symbol symbolic`
      );

    // A `lambda` runner IS the program's value (the program is a function
    // literal), and a function is not a value this mode can print.
    if (result.calling === 'lambda') return unprintable(engine, 'a function');

    // The generated code can throw: a stack overflow from a recursion, a
    // `RangeError` from a huge array, a runtime helper refusing a value. On
    // the interpreted route a throw becomes an error value (`executeEpsil`),
    // and it does here too; a cancellation keeps its cause as the second
    // operand, as `executeEpsil` writes it.
    try {
      return boxCompiledValue(engine, result.run({}), expr.type.type);
    } catch (error) {
      return thrownValue(engine, error);
    }
  };

  let value: BoxedExpression;
  try {
    value =
      options.timeLimit > 0
        ? engine.withTimeLimit(
            { ms: options.timeLimit, label: 'epsil:cli' },
            run
          )
        : run();
  } catch (error) {
    // A cancellation while parsing or compiling (the deadline, a limit) is
    // the program's value, as on the interpreted route; anything else is a
    // defect of the CLI and is reported by the top-level handler.
    if (cancellationCause(error) === undefined) throw error;
    value = thrownValue(engine, error);
  }

  return {
    source,
    value,
    diagnostics,
    elapsedMs: performance.now() - start,
  };
}

/** The color head of each color space a compiled color can carry — the
 * constructor the interpreter's `ColorFromColorspace` builds for that space
 * (`colorHeadFromSpace`, `library/colors.ts`). */
const COLOR_HEADS: Readonly<Record<string, string>> = {
  rgb: 'Rgb',
  hsl: 'Hsl',
  hsv: 'Hsv',
  oklab: 'Oklab',
  oklch: 'Oklch',
};

/**
 * The boxed form of a value the compiled JavaScript answered. The compiled
 * ABI is narrower than the engine's values (`CompiledValue`,
 * `compilation/types.ts`), and the mapping follows it:
 *
 * - a number is a float, because compiled arithmetic is machine arithmetic:
 *   the compiled `2 + 1` is the float `3.0`, not the exact `3`;
 * - `{re, im}` is a complex float;
 * - an array is a `Tuple` where the program's static type says so (the ABI
 *   returns a tuple and a list both as an array), else a `List`; the static
 *   type is followed into the elements;
 * - a color is the constructor of its color space, with the alpha channel
 *   only when it is not the opaque default, as the interpreter emits it;
 * - `undefined` is the absence marker `Missing` (the compiled spelling of an
 *   absent value, decided 2026-09-27);
 * - a function cannot be printed and becomes an error value.
 */
function boxCompiledValue(
  engine: ComputeEngine,
  value: unknown,
  type: Type | undefined
): BoxedExpression {
  if (typeof value === 'number')
    return engine.number(engine._inexactNumericValue(value));
  if (typeof value === 'boolean') return engine.box(value);
  if (typeof value === 'string') return engine.string(value);
  if (value === undefined || value === null) return engine.Missing;
  if (typeof value === 'function') return unprintable(engine, 'a function');

  if (Array.isArray(value)) {
    // A `Type` is a primitive name (a string) or a structured type object.
    const shape = typeof type === 'object' ? type : undefined;
    const tuple = shape?.kind === 'tuple' ? shape : undefined;
    const elementType = (i: number): Type | undefined => {
      if (tuple !== undefined) return tuple.elements[i]?.type;
      if (shape?.kind === 'list') return shape.elements;
      return undefined;
    };
    return engine.function(
      tuple !== undefined ? 'Tuple' : 'List',
      value.map((x, i) => boxCompiledValue(engine, x, elementType(i)))
    );
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.re === 'number' && typeof record.im === 'number')
      return engine.number(
        engine._inexactNumericValue(
          record.im === 0 ? record.re : { re: record.re, im: record.im }
        )
      );
    const head =
      typeof record.space === 'string' ? COLOR_HEADS[record.space] : undefined;
    if (
      head !== undefined &&
      typeof record.c0 === 'number' &&
      typeof record.c1 === 'number' &&
      typeof record.c2 === 'number'
    ) {
      const args = [record.c0, record.c1, record.c2].map((x) =>
        engine.number(x)
      );
      const alpha = record.alpha;
      if (typeof alpha === 'number' && Number.isFinite(alpha) && alpha !== 1)
        args.push(engine.number(alpha));
      return engine.function(head, args);
    }
  }

  return unprintable(engine, `a value of type ${typeof value}`);
}

function unprintable(engine: ComputeEngine, what: string): BoxedExpression {
  return errorValue(
    engine,
    'unprintable-value',
    `the compiled program evaluates to ${what}`
  );
}

/** The error value of a throw: `["Error", message, cause]` for a
 * cancellation (the shape `executeEpsil` builds, whose cause operand the
 * description does not render as a site), `["Error", message]` otherwise. */
function thrownValue(engine: ComputeEngine, error: unknown): BoxedExpression {
  const message = error instanceof Error ? error.message : String(error);
  const cause = cancellationCause(error);
  return engine.box(
    cause === undefined
      ? ['Error', { str: message }]
      : ['Error', { str: message }, { str: cause }]
  );
}

/** The cause of a cancellation error, or `undefined` for any other throw.
 * The class is checked by name, since an `instanceof` fails across bundle
 * boundaries; a timeout of an enclosing span reads as `budgetCauseOf` reads
 * it. */
function cancellationCause(error: unknown): CancellationCause | undefined {
  if (!(error instanceof Error) || error.name !== 'CancellationError')
    return undefined;
  if (isTimeoutCancellation(error)) return budgetCauseOf(error);
  const cause = (error as { cause?: unknown }).cause;
  return cause === 'iteration-limit-exceeded' ||
    cause === 'recursion-depth-exceeded'
    ? cause
    : undefined;
}

/** An error value that renders as `<code, as words>: <message>` (the default
 * arm of `describeError`, `epsil/static-diagnostics.ts`). */
function errorValue(
  engine: ComputeEngine,
  code: string,
  message: string
): BoxedExpression {
  return engine.box(['Error', ['ErrorCode', { str: code }, { str: message }]]);
}
