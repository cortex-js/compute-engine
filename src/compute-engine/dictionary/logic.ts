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
  },
  Or: {
    domain: 'LogicalFunction',
    threadable: true,
    associative: true,
    commutative: true,
    idempotent: true,
  },
  Not: {
    domain: 'LogicalFunction',
    involution: true,
  },
  Equivalent: {
    domain: 'LogicalFunction',
  },
  Implies: { domain: 'LogicalFunction' },
  Exists: { domain: 'LogicalFunction' },
  Equal: { domain: 'LogicalFunction' },
  NotEqual: { domain: 'LogicalFunction' },
};
