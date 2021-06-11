import type { Dictionary } from '../public';

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
    range: 'MaybeBoolean',
  },
  Or: {
    domain: 'LogicalFunction',
    threadable: true,
    associative: true,
    commutative: true,
    idempotent: true,
    range: 'MaybeBoolean',
  },
  Not: {
    domain: 'LogicalFunction',
    involution: true,
    range: 'MaybeBoolean',
  },
  Equivalent: {
    domain: 'LogicalFunction',
    range: 'MaybeBoolean',
  },
  Implies: { domain: 'LogicalFunction', range: 'MaybeBoolean' },
  Exists: { domain: 'LogicalFunction', range: 'MaybeBoolean' },
  Equal: { domain: 'LogicalFunction', range: 'MaybeBoolean' },
  NotEqual: {
    domain: 'Function',
    wikidata: 'Q28113351',
    commutative: true,
    range: 'MaybeBoolean',
  },
};
