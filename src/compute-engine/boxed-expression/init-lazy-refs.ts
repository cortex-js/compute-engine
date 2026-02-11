// This module wires up lazy references that break circular dependencies.
// Import it once from the main entry point (index.ts) so the registrations
// run before any user code.

import { expand } from './expand';
import { _setExpand } from './compare';

import { serializeJson } from './serialize';
import { _setSerializeJson } from './abstract-boxed-expression';

import { Product } from './product';
import { _setProduct } from './serialize';

_setExpand(expand);
_setSerializeJson(serializeJson);
_setProduct(Product);
