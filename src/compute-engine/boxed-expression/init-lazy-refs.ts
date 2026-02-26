// This module wires up lazy references that break circular dependencies.
// Import it once from the main entry point (index.ts) so the registrations
// run before any user code.

import { expand } from './expand';
import { _setExpand } from './compare';

import { serializeJson, _setProduct } from './serialize';
import {
  _setSerializeJson,
  _setExpandForIs,
  _setGetPolynomialCoefficients,
} from './abstract-boxed-expression';

import { Product } from './arithmetic-mul-div';
import { getPolynomialCoefficients } from './polynomials';

// eslint-disable-next-line import/no-restricted-paths
import { compile } from '../compilation/compile-expression';
import { _setCompile } from './stochastic-equal';

_setExpand(expand);
_setExpandForIs(expand);
_setSerializeJson(serializeJson);
_setProduct(Product);
_setCompile(compile);
_setGetPolynomialCoefficients(getPolynomialCoefficients);
