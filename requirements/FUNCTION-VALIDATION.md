# Function Validation Guidelines

This document provides guidelines for implementing proper validation in function
definitions, especially for functions with custom canonical handlers.

## The Problem

When a function has a custom `canonical` handler, signature validation may not
run automatically. This can lead to missing error expressions for invalid
arguments.

## Best Practices

### 1. Functions with Required Arguments

Always validate that required arguments are present and of the correct type:

```typescript
{
  signature: '(value, collection) -> boolean',
  canonical: (args, { engine: ce }) => {
    // Validate required arguments
    if (args.length === 0) {
      return ce._fn('MyFunction', [ce.error('missing'), ce.error('missing')]);
    }
    if (args.length === 1) {
      return ce._fn('MyFunction', [args[0].canonical, ce.error('missing')]);
    }

    // Continue with normal canonicalization...
    return ce._fn('MyFunction', [args[0].canonical, args[1].canonical]);
  }
}
```

### 2. Functions with Optional Arguments

Validate optional arguments when present:

```typescript
{
  signature: '(value, collection, boolean?) -> boolean',
  canonical: (args, { engine: ce }) => {
    // Handle missing required arguments
    if (args.length < 2) {
      // ... add errors as shown above
    }

    const [value, collection, condition] = args;

    // Validate optional argument type if present
    if (condition && !condition.type.matches('boolean')) {
      return ce._fn('MyFunction', [
        value.canonical,
        collection.canonical,
        ce.error(['incompatible-type', "'boolean'", condition.type.toString()])
      ]);
    }

    // Continue with normal canonicalization...
  }
}
```

### 3. Type Validation

Validate argument types and add appropriate errors:

```typescript
{
  canonical: (args, { engine: ce }) => {
    // ... handle missing arguments ...

    const collection = args[1];

    // Validate that collection is the right type
    if (!collection.type.matches('collection') && !collection.symbol) {
      return ce._fn('MyFunction', [
        args[0].canonical,
        ce.error(['incompatible-type', "'collection'", collection.type.toString()])
      ]);
    }

    // Continue...
  }
}
```

## Examples from the Codebase

### Good Example: Element (sets.ts)

```typescript
Element: {
  signature: '(value, collection, boolean?) -> boolean',
  canonical: (args, { engine: ce }) => {
    // Explicit validation for missing required arguments
    if (args.length === 0) {
      return ce._fn('Element', [ce.error('missing'), ce.error('missing')]);
    }
    if (args.length === 1) {
      return ce._fn('Element', [args[0].canonical, ce.error('missing')]);
    }

    const [value, collection, condition] = args;

    // ... canonicalization logic ...

    // Validate optional third argument
    if (condition && !condition.type.matches('boolean')) {
      return ce._fn('Element', [
        value.canonical,
        canonicalCollection,
        ce.error(['incompatible-type', "'boolean'", collection.type.toString()])
      ]);
    }

    // ... continue ...
  }
}
```

### Good Example: Rational (arithmetic.ts)

```typescript
Rational: {
  signature: '(number, integer?) -> rational',
  canonical: (args, { engine }) => {
    const ce = engine;
    args = flatten(args);

    if (args.length === 0) return ce._fn('Rational', [ce.error('missing')]);

    if (args.length === 1)
      return ce._fn('Rational', [checkType(ce, args[0], 'real')]);

    args = checkTypes(ce, args, ['integer', 'integer']);

    if (args.length !== 2 || !args[0].isValid || !args[1].isValid)
      return ce._fn('Rational', args);

    return args[0].div(args[1]);
  }
}
```

## Common Pitfalls

### ❌ Bad: No validation

```typescript
canonical: (args, { engine: ce }) => {
  if (args.length < 2) return ce._fn('MyFunction', args); // Missing validation!
  // ...
}
```

### ✅ Good: Explicit validation

```typescript
canonical: (args, { engine: ce }) => {
  if (args.length === 0) {
    return ce._fn('MyFunction', [ce.error('missing'), ce.error('missing')]);
  }
  if (args.length === 1) {
    return ce._fn('MyFunction', [args[0].canonical, ce.error('missing')]);
  }
  // ...
}
```

## Testing Validation

Always add tests for invalid arguments:

```typescript
test('INVALID', () => {
  expect(ce.box(['MyFunction']).evaluate()).toMatchInlineSnapshot(
    `["MyFunction", ["Error", "'missing'"], ["Error", "'missing'"]]`
  );
  expect(ce.box(['MyFunction', 2]).evaluate()).toMatchInlineSnapshot(
    `["MyFunction", 2, ["Error", "'missing'"]]`
  );
  expect(ce.box(['MyFunction', 2, 'wrongType']).evaluate()).toMatchInlineSnapshot(
    `["MyFunction", 2, ["Error", ["ErrorCode", "incompatible-type", ...]]]`
  );
});
```

## Helper Functions

Consider using these helper functions from the library:

- `checkType(ce, arg, expectedType)` - Validates a single argument type
- `checkTypes(ce, args, types)` - Validates multiple argument types
- `ce.error(message)` - Creates an error expression
- `ce.error(['incompatible-type', expected, actual])` - Creates a type error

## Summary

1. **Always validate** required arguments in custom canonical handlers
2. **Check types** for both required and optional arguments
3. **Add error expressions** using `ce.error()` for invalid cases
4. **Test thoroughly** with missing, extra, and wrong-type arguments
5. **Follow the patterns** shown in Element and Rational functions
