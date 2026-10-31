// Vendored from deepmerge 4.3.1 with the prototype-poisoning fix for
// GHSA-gcqx-w48m-w2h4. To reject constructor.prototype attacks as well as the
// __proto__ setter, this copy intentionally drops own data properties named
// "constructor" or "prototype". This package is used only by development
// tooling, whose configuration does not use those keys.
'use strict';

var canUseSymbol = typeof Symbol === 'function' && Symbol.for;
var REACT_ELEMENT_TYPE = canUseSymbol ? Symbol.for('react.element') : 0xeac7;

function defaultIsMergeableObject(value) {
  if (!value || typeof value !== 'object') return false;
  var stringValue = Object.prototype.toString.call(value);
  return (
    stringValue !== '[object RegExp]' &&
    stringValue !== '[object Date]' &&
    value.$$typeof !== REACT_ELEMENT_TYPE
  );
}

function emptyTarget(value) {
  return Array.isArray(value) ? [] : {};
}

function cloneUnlessOtherwiseSpecified(value, options) {
  return options.clone !== false && options.isMergeableObject(value)
    ? deepmerge(emptyTarget(value), value, options)
    : value;
}

function defaultArrayMerge(target, source, options) {
  return target.concat(source).map(function (element) {
    return cloneUnlessOtherwiseSpecified(element, options);
  });
}

function getMergeFunction(key, options) {
  if (!options.customMerge) return deepmerge;
  var customMerge = options.customMerge(key);
  return typeof customMerge === 'function' ? customMerge : deepmerge;
}

function getEnumerableOwnPropertySymbols(target) {
  return Object.getOwnPropertySymbols
    ? Object.getOwnPropertySymbols(target).filter(function (symbol) {
        return Object.propertyIsEnumerable.call(target, symbol);
      })
    : [];
}

function getKeys(target) {
  return Object.keys(target).concat(getEnumerableOwnPropertySymbols(target));
}

function propertyIsOnObject(object, property) {
  try {
    return property in object;
  } catch (_) {
    return false;
  }
}

function propertyIsUnsafe(target, key) {
  if (isPoisonKey(key)) return true;
  return (
    propertyIsOnObject(target, key) &&
    !(
      Object.hasOwnProperty.call(target, key) &&
      Object.propertyIsEnumerable.call(target, key)
    )
  );
}

function isPoisonKey(key) {
  return key === '__proto__' || key === 'constructor' || key === 'prototype';
}

function setProperty(target, key, value) {
  Object.defineProperty(target, key, {
    value: value,
    configurable: true,
    enumerable: true,
    writable: true,
  });
}

function mergeObject(target, source, options) {
  var destination = {};
  if (options.isMergeableObject(target)) {
    getKeys(target).forEach(function (key) {
      if (!isPoisonKey(key))
        setProperty(
          destination,
          key,
          cloneUnlessOtherwiseSpecified(target[key], options)
        );
    });
  }
  getKeys(source).forEach(function (key) {
    if (propertyIsUnsafe(target, key)) return;

    var value;
    if (
      propertyIsOnObject(target, key) &&
      options.isMergeableObject(source[key])
    )
      value = getMergeFunction(key, options)(target[key], source[key], options);
    else value = cloneUnlessOtherwiseSpecified(source[key], options);
    setProperty(destination, key, value);
  });
  return destination;
}

function deepmerge(target, source, options) {
  options = options || {};
  options.arrayMerge = options.arrayMerge || defaultArrayMerge;
  options.isMergeableObject =
    options.isMergeableObject || defaultIsMergeableObject;
  options.cloneUnlessOtherwiseSpecified = cloneUnlessOtherwiseSpecified;

  var sourceIsArray = Array.isArray(source);
  var targetIsArray = Array.isArray(target);
  if (sourceIsArray !== targetIsArray)
    return cloneUnlessOtherwiseSpecified(source, options);
  if (sourceIsArray) return options.arrayMerge(target, source, options);
  return mergeObject(target, source, options);
}

deepmerge.all = function deepmergeAll(array, options) {
  if (!Array.isArray(array))
    throw new Error('first argument should be an array');
  return array.reduce(function (previous, next) {
    return deepmerge(previous, next, options);
  }, {});
};

module.exports = deepmerge;
