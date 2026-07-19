// This module wires up lazy references that break circular dependencies.
// Import it once from the main entry point (index.ts) so the registrations
// run before any user code.

import { expand } from './expand.js';
import { _setExpand } from './compare.js';

import { serializeJson, _setProduct } from './serialize.js';
import {
  _setSerializeJson,
  _setExpandForIs,
  _setGetPolynomialCoefficients,
  _setGetPolynomialDegree,
  _setFindUnivariateRoots,
} from './abstract-boxed-expression.js';

import { Product } from './arithmetic-mul-div.js';
import { getPolynomialCoefficients, polynomialDegree } from './polynomials.js';

import { findUnivariateRoots } from './solve.js';

import { implicitCompile } from '../implicit-compile.js';
import { _setCompile } from './stochastic-equal.js';

import { validateArguments } from './validate.js';
import { _setValidateArguments } from '../function-utils.js';

_setExpand(expand);
_setExpandForIs(expand);
_setSerializeJson(serializeJson);
_setProduct(Product);
// The stochastic-equality probes are an implicit compilation path: route them
// through `implicitCompile` so they honor the `ce.jit` flag (and its CSP
// latch); a no-compile returns an empty record, and the caller's interpreter
// fallback takes over.
_setCompile((expr) => implicitCompile(expr.engine, expr) ?? {});
_setGetPolynomialCoefficients(getPolynomialCoefficients);
_setGetPolynomialDegree(polynomialDegree);
_setFindUnivariateRoots(findUnivariateRoots);
_setValidateArguments(validateArguments);
