import { checkDeadline, isThenable } from '../../common/interruptible.js';
import type { IComputeEngine, Scope } from '../global-types.js';
import {
  prepareDocument,
  type DocumentRowTypeContract,
  type DocumentSourceRow,
  type DocumentSyntax,
  type PreparedDocumentRevision,
} from './prepare-document.js';

export type DocumentTypeEvidence = Pick<
  PreparedDocumentRevision,
  'definitions' | 'rawRows' | 'rowErrors' | 'rowReferences'
>;

/** Propose type annotations keyed by row ID from the current draft's
 * `callSiteTypes`, bodies and references. Use a synchronous, deterministic
 * callback. The draft is read-only and its contents may be disposed after
 * the callback returns. Source annotations take precedence.
 *
 * Choose a list type to bind a list whole, or its element type to let the
 * ordinary CE call rules broadcast over the list. A proposal may also open
 * a fixed list width or use a body-derived type instead of a call-site join.
 *
 * CE tries proposals together, then retries smaller groups in source order
 * if a proposal fails or a previously valid definition or formula becomes
 * invalid. Each row's new annotations are tried as a group. After accepting annotations,
 * CE asks for proposals again so types can propagate through callers. Only
 * the first proposal for a slot is tried in each prepare, and accepted
 * annotations stay in effect for the rest of that prepare.
 */
export type DocumentTypePolicy = (
  evidence: DocumentTypeEvidence
) => ReadonlyMap<string, DocumentRowTypeContract>;

type Draft = {
  revision: PreparedDocumentRevision;
  validFormulaRows: ReadonlySet<string>;
};
type Proposal = readonly [string, DocumentRowTypeContract];

function keepsValidRows(
  before: Draft,
  after: Draft,
  proposals: readonly Proposal[]
): boolean {
  for (const id of after.revision.rowErrors.keys())
    if (!before.revision.rowErrors.has(id)) return false;
  for (const id of before.validFormulaRows)
    if (!after.validFormulaRows.has(id)) return false;
  const heads = new Map(after.revision.definitions.map((row) => [row.id, row]));
  for (const [id] of proposals)
    if (after.revision.rowErrors.has(id) || !heads.has(id)) return false;
  return before.revision.definitions.every((row) => {
    const next = heads.get(row.id);
    return (
      before.revision.rowErrors.has(row.id) ||
      (next?.name === row.name &&
        next.role === row.role &&
        next.params.length === row.params.length &&
        next.params.every((param, i) => param === row.params[i]))
    );
  });
}

function mergeFormals(
  first: DocumentRowTypeContract['formalTypes'],
  second: NonNullable<DocumentRowTypeContract['formalTypes']>
): NonNullable<DocumentRowTypeContract['formalTypes']> {
  return Object.assign(Object.create(null), first, second);
}

function mergeContracts(
  first: DocumentRowTypeContract | undefined,
  second: DocumentRowTypeContract
): DocumentRowTypeContract {
  return {
    ...first,
    ...second,
    ...(second.formalTypes === undefined
      ? {}
      : { formalTypes: mergeFormals(first?.formalTypes, second.formalTypes) }),
  };
}

export function prepareWithTypePolicy(
  ce: IComputeEngine,
  parent: Scope,
  rows: readonly DocumentSourceRow[],
  syntax: DocumentSyntax,
  writableNames: ReadonlySet<string> | undefined,
  policy: DocumentTypePolicy
): PreparedDocumentRevision {
  function prepare(
    contracts: ReadonlyMap<string, DocumentRowTypeContract>
  ): Draft {
    const validFormulaRows = new Set<string>();
    const typedRows = rows.map((row) => {
      const contract = contracts.get(row.id);
      if (contract === undefined) return row;
      return {
        ...row,
        ...contract,
        ...(contract.formalTypes === undefined
          ? {}
          : { formalTypes: mergeFormals(row.formalTypes, contract.formalTypes) }),
      };
    });
    return {
      revision: prepareDocument(
        ce, parent, typedRows, syntax, writableNames, validFormulaRows
      ),
      validFormulaRows,
    };
  }

  let accepted = new Map<string, DocumentRowTypeContract>();
  let current = prepare(accepted);
  const attempted = new Map<string, DocumentRowTypeContract>();

  function tryProposals(proposals: readonly Proposal[]): void {
    checkDeadline(ce._deadlineFrame);
    const contracts = new Map(accepted);
    for (const [id, proposed] of proposals)
      contracts.set(id, mergeContracts(accepted.get(id), proposed));
    const trial = prepare(contracts);
    if (keepsValidRows(current, trial, proposals)) {
      const previous = current;
      current = trial;
      accepted = contracts;
      previous.revision.dispose();
      return;
    }
    trial.revision.dispose();
    if (proposals.length === 1) return;
    const middle = Math.floor(proposals.length / 2);
    tryProposals(proposals.slice(0, middle));
    tryProposals(proposals.slice(middle));
  }

  try {
    for (;;) {
      checkDeadline(ce._deadlineFrame);
      const { definitions, rawRows, rowErrors, rowReferences } =
        current.revision;
      const choices = policy({ definitions, rawRows, rowErrors, rowReferences });
      if (isThenable(choices)) {
        void Promise.resolve(choices).catch(() => {});
        throw new TypeError('Document type policy must be synchronous');
      }
      const byId = new Map(definitions.map((row) => [row.id, row]));
      const proposals: Proposal[] = [];
      for (const row of rows) {
        const definition = byId.get(row.id);
        const choice = choices.get(row.id);
        if (definition === undefined || choice === undefined) continue;
        const prior = attempted.get(row.id);
        const proposal: {
          formalTypes?: DocumentSourceRow['formalTypes'];
          resultType?: string;
          valueType?: string;
        } = {};
        if (definition.role === 'function') {
          const formals = definition.params.flatMap((param) => {
            const type = choice.formalTypes?.[param];
            return typeof type === 'string' &&
              row.formalTypes?.[param] === undefined &&
              prior?.formalTypes?.[param] === undefined
              ? [[param, type] as const]
              : [];
          });
          if (formals.length > 0)
            proposal.formalTypes = Object.fromEntries(formals);
          if (
            choice.resultType !== undefined &&
            row.resultType === undefined &&
            prior?.resultType === undefined
          )
            proposal.resultType = choice.resultType;
        } else if (
          choice.valueType !== undefined &&
          row.valueType === undefined &&
          prior?.valueType === undefined
        ) {
          proposal.valueType = choice.valueType;
        }
        if (Object.keys(proposal).length === 0) continue;
        proposals.push([row.id, proposal]);
        attempted.set(row.id, mergeContracts(prior, proposal));
      }
      if (proposals.length === 0) break;
      const before = accepted;
      tryProposals(proposals);
      if (accepted === before) break;
    }
    return { ...current.revision, promotedContracts: accepted };
  } catch (error) {
    current.revision.dispose();
    throw error;
  }
}
