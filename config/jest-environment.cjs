// The jest `node` test environment, with a faster global object.
//
// Jest runs each test file in a `vm` context. The stock environment makes
// that context with `vm.createContext(proxy)`, which "contextifies" a
// `Proxy`: Node then reads each global name (`Math`, `Number`, `Array`,
// `console`, …) through a named-property interceptor and the proxy trap,
// and V8 cannot cache those reads. The engine reads globals in its inner
// loops, so the source ran 5 to 10 times slower under jest than under
// `tsx` (measured 2026-10-24: a loop of 1e7 `Math.sin` calls took 2.2 s
// under jest and 0.4 s under `tsx`).
//
// `vm.constants.DONT_CONTEXTIFY` (Node 22.8 and later) makes a context whose
// global object is an ordinary object, with no interceptor. The stock
// constructor is kept, so the environment installs the same globals; only
// the call that makes the context is changed. The stock environment also
// records each global that a test file writes, through the proxy, and
// deletes it at teardown; without the proxy nothing is recorded, and the
// context is released with the environment. On a Node without the constant,
// this is the stock environment.
const path = require('node:path');
const util = require('node:util');
const vm = require('node:vm');

// `jest-environment-node` is a dependency of jest, not of this package, so
// it is resolved from the directory where jest is installed. A plain
// `require('jest-environment-node')` works only when npm installs the
// module at the top of `node_modules`, which npm does not promise.
const { TestEnvironment } = require(
  require.resolve('jest-environment-node', {
    paths: [path.dirname(require.resolve('jest/package.json'))],
  })
);

class FastGlobalsEnvironment extends TestEnvironment {
  constructor(config, context) {
    const dontContextify = vm.constants?.DONT_CONTEXTIFY;
    if (dontContextify === undefined) {
      super(config, context);
      return;
    }
    const createContext = vm.createContext;
    let replaced = false;
    vm.createContext = () => {
      replaced = true;
      return createContext(dontContextify);
    };
    try {
      super(config, context);
    } finally {
      vm.createContext = createContext;
    }
    // The change depends on how the stock constructor makes the context,
    // which is private to jest. If a jest update makes the context in a
    // different way, the tests still run, but with the slow global object.
    // This warning tells that the change does not apply any more.
    if (!replaced || util.types.isProxy(this.context))
      console.warn(
        'config/jest-environment.cjs: the test context has the slow proxied ' +
          'global object. The jest environment does not make its context ' +
          'with vm.createContext() as expected.'
      );
  }
}

module.exports = FastGlobalsEnvironment;
