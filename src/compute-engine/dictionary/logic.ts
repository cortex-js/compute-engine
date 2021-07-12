import type {
  ComputeEngine,
  Dictionary,
  Domain,
} from '../../math-json/compute-engine-interface';

const logicalFunction = (
  ce: ComputeEngine,
  ...doms: Domain[]
): Domain | null => {
  if (doms.every((x) => x === 'Boolean')) return 'Boolean';
  if (doms.every((x) => x === 'Boolean' || x === 'MaybeBoolean'))
    return 'MaybeBoolean';
  return null;
};

export const LOGIC_DICTIONARY: Dictionary = {
  True: { domain: 'Boolean', constant: true },
  False: { domain: 'Boolean', constant: true },
  Maybe: { domain: 'MaybeBoolean', constant: true },
  And: {
    domain: 'LogicalFunction',
    threadable: true,
    associative: true,
    commutative: true,
    idempotent: true,
    evalDomain: logicalFunction,
  },
  Or: {
    domain: 'LogicalFunction',
    threadable: true,
    associative: true,
    commutative: true,
    idempotent: true,
    evalDomain: logicalFunction,
  },
  Not: {
    domain: 'LogicalFunction',
    involution: true,
    evalDomain: logicalFunction,
  },
  Equivalent: {
    domain: 'LogicalFunction',
    evalDomain: logicalFunction,
  },
  Implies: { domain: 'LogicalFunction', evalDomain: logicalFunction },
  Exists: { domain: 'LogicalFunction', evalDomain: logicalFunction },
  Equal: {
    domain: 'Function',
    commutative: true,
    evalDomain: () => 'MaybeBoolean',
  },
  NotEqual: {
    domain: 'Function',
    wikidata: 'Q28113351',
    commutative: true,
    evalDomain: () => 'MaybeBoolean',
  },
};
