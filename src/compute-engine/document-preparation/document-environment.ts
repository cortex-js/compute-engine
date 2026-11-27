import { preparedContractDeclaration } from '../boxed-expression/boxed-value-definition.js';
import { sealPreparedNamespace } from '../boxed-expression/prepared-import-binding.js';
import { isThenable } from '../../common/interruptible.js';
import { retainDocumentRegistryReader } from '../document-registry-lifetime.js';
import type { IComputeEngine, InspectableScope } from '../global-types.js';
import {
  prepareDocument,
  type DocumentSourceRow,
  type DocumentSyntax,
  type PreparedDocumentRevision,
} from './prepare-document.js';
import {
  prepareWithTypePolicy,
  type DocumentTypePolicy,
} from './type-policy.js';

export type DeclareDocumentInput = (name: string, contract: string) => void;

export interface DocumentEnvironment {
  /** Initialize an import namespace synchronously, then seal its definitions. */
  createImports(
    initialize: (declareInput: DeclareDocumentInput) => void
  ): DocumentImports;
  /** Close this factory. Existing imports retain the profile until disposed. */
  dispose(): void;
}

export interface DocumentImports {
  /** Prepare an independent revision using these imports. If supplied, the
   * type policy proposes additional row contracts from this preparation's
   * evidence. The revision reports the accepted proposals in
   * `promotedContracts`. */
  prepare(
    rows: readonly DocumentSourceRow[],
    syntax: DocumentSyntax,
    writableNames?: ReadonlySet<string>,
    options?: { readonly typePolicy?: DocumentTypePolicy }
  ): PreparedDocumentRevision;
  /** Close this factory. Existing revisions retain their imports until disposed. */
  dispose(): void;
}

function scopeLifetime(
  scope: InspectableScope,
  label: string,
  releaseParent?: () => void
) {
  let disposed = false;
  let children = 0;
  function releaseScope(): void {
    if (!disposed || children !== 0) return;
    try {
      scope.dispose();
    } finally {
      releaseParent?.();
    }
  }

  return {
    retain(): () => void {
      if (disposed) throw new Error(label + ' is disposed');
      children++;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        children--;
        releaseScope();
      };
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      releaseScope();
    },
  };
}

function requireSynchronous(result: unknown): void {
  if (!isThenable(result)) return;
  // The callback has already run. Observe a later rejection without retaining
  // the temporary scope or allowing the initializer capability to escape.
  void Promise.resolve(result).catch(() => {});
  throw new TypeError('Document initialization must be synchronous');
}

/**
 * Construct a profile over the engine library scope. The callback runs
 * synchronously. Install host types, protocols, conformances and arithmetic
 * value kinds before opening the environment. CE keeps these engine-wide
 * registrations read-only until the environment and all of its imports and
 * revisions are disposed. Treat installed arithmetic hooks as immutable
 * for that lifetime.
 */
export function createDocumentEnvironment(
  ce: IComputeEngine,
  configureProfile: () => void
): DocumentEnvironment {
  const profile = ce.createScope({}, ce.contextStack[0].lexicalScope);
  const lifetime = scopeLifetime(
    profile,
    'Document environment',
    retainDocumentRegistryReader(ce)
  );
  try {
    requireSynchronous(ce._inScope(profile, configureProfile));
    sealPreparedNamespace(profile);
  } catch (error) {
    lifetime.dispose();
    throw error;
  }

  return {
    createImports(initialize) {
      const releaseProfile = lifetime.retain();
      let parent: InspectableScope;
      try {
        parent = ce.createScope({}, profile);
      } catch (error) {
        releaseProfile();
        throw error;
      }
      const imports = scopeLifetime(
        parent,
        'Document import factory',
        releaseProfile
      );
      let inputs: Map<string, object> | undefined = new Map();
      const declareInput: DeclareDocumentInput = (name, contract) => {
        if (inputs === undefined)
          throw new Error('Document imports are already prepared');
        if (parent.bindings.has(name))
          throw new Error('Document import "' + name + '" is already declared');
        const type = ce.type(contract);
        if (
          !type.matches('scalar | string | list<number> | list<list<number>>')
        )
          throw new Error(
            'Expected a data type for Document input "' + name + '"'
          );
        const definition = {
          type,
          inferred: false,
          [preparedContractDeclaration]: true as const,
        };
        inputs.set(name, ce._declareSymbolValue(name, definition, parent));
      };
      try {
        requireSynchronous(ce._inScope(parent, () => initialize(declareInput)));
        sealPreparedNamespace(
          parent,
          (name, binding) => inputs?.get(name) === binding
        );
      } catch (error) {
        imports.dispose();
        throw error;
      } finally {
        inputs = undefined;
      }
      return {
        prepare(rows, syntax, writableNames, options) {
          const releaseImports = imports.retain();
          try {
            const policy = options?.typePolicy;
            const revision =
              policy === undefined
                ? prepareDocument(ce, parent, rows, syntax, writableNames)
                : prepareWithTypePolicy(
                    ce,
                    parent,
                    rows,
                    syntax,
                    writableNames,
                    policy
                  );
            return {
              ...revision,
              dispose() {
                try {
                  revision.dispose();
                } finally {
                  releaseImports();
                }
              },
            };
          } catch (error) {
            releaseImports();
            throw error;
          }
        },
        dispose: imports.dispose,
      };
    },
    dispose: lifetime.dispose,
  };
}
