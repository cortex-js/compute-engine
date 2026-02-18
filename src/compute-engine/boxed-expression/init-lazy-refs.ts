// This module wires up lazy references that break circular dependencies.
// Import it once from the main entry point (index.ts) so the registrations
// run before any user code.

import { expand } from './expand';
import { _setExpand } from './compare';

import { serializeJson, _setProduct } from './serialize';
import { _setSerializeJson } from './abstract-boxed-expression';

import { Product } from './arithmetic-mul-div';

import { compile } from '../compilation/compile-expression';
import { _setCompile } from './stochastic-equal';

_setExpand(expand);
_setSerializeJson(serializeJson);
_setProduct(Product);
_setCompile(compile);
