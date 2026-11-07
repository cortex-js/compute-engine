import type { ComputeEngine } from '../compute-engine.js';
import { isTimeoutCancellation } from '../common/interruptible.js';
import { FatalParsingError, type ParsingDiagnostic } from './diagnostics.js';
import type { ExecuteEpsilOptions } from './execute-epsil.js';
import { nextEpsilBatchId, sumVariantNames } from './execute-epsil.js';
import { parseEpsil } from './parse-epsil.js';
import { resolveLibraryNames } from './resolve-library-names.js';
import { staticDiagnostics } from './static-diagnostics.js';

export interface CheckEpsilResult {
  /** The parse diagnostics, and the `static-type-error` and
   * `variable-redeclaration` diagnostics of the static pass. These are the
   * diagnostics that `executeEpsil` reports before it runs a statement. A
   * problem found only when a statement runs (a `runtime-error`) is not in
   * this list. */
  diagnostics: ParsingDiagnostic[];
}

/**
 * Check an Epsil program against a compute engine without running it.
 *
 * The program is parsed as `executeEpsil` parses it: the engine's declared
 * type names, protocol names and sum variants are known to the parser, so an
 * annotation that names a type the host declared is not an error. The static
 * pass then canonicalizes each statement in a scope of its own and rolls back
 * the types and protocols that the program declares. So the check assigns no
 * value, defines no function and declares no type on `ce`, and a host can run
 * it on a shared engine, for example after each edit of a program.
 *
 * The static pass is skipped when the parse gives an error, because the tree
 * of a program that does not parse is a guess.
 *
 * An expired time limit of `ce` (`ce.withTimeLimit()`) is thrown to the
 * caller as a `CancellationError`.
 */
export function checkEpsil(
  ce: ComputeEngine,
  source: string,
  options?: ExecuteEpsilOptions
): CheckEpsilResult {
  const diagnostics: ParsingDiagnostic[] = [];
  let ast;
  try {
    const [parsed, parseDiagnostics] = parseEpsil(source, options?.url, {
      parseLatex: options?.parseLatex,
      allowHostPragmas: options?.allowHostPragmas ?? false,
      typeNames: ce._typeResolver.names,
      protocolNames: Object.keys(ce._protocolRegistry),
      sumVariants: sumVariantNames(ce),
      deadline: ce._deadlineFrame,
      isLibraryFunction: (name) => ce._isLibraryFunction(name),
    });
    ast = resolveLibraryNames(parsed, source, ce);
    diagnostics.push(...parseDiagnostics);
  } catch (e) {
    // A `#error` directive throws while it parses; `executeEpsil` reports it
    // as this diagnostic too.
    if (e instanceof FatalParsingError && !isTimeoutCancellation(e)) {
      diagnostics.push({
        severity: 'error',
        message: ['error-directive', e.message],
        range: [0, source.length],
      });
      return { diagnostics };
    }
    throw e;
  }
  if (!diagnostics.some((x) => x.severity === 'error')) {
    // The pass runs under a batch id of its own, as in `executeEpsil`: the
    // protocol registry stamps an implementation with the id, so that a second
    // implementation block for one type and protocol in the same program is
    // an error.
    const enclosingBatch = ce._epsilBatchId;
    ce._epsilBatchId = nextEpsilBatchId();
    try {
      staticDiagnostics(ce, ast, source, diagnostics);
    } finally {
      ce._epsilBatchId = enclosingBatch;
    }
  }
  return { diagnostics };
}
