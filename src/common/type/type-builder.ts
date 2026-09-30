import { makeNumericRangeType } from './numeric-range.js';
import type { NumericPrimitiveType } from './types.js';
import {
  TypeNode,
  FunctionSignatureNode,
  ConstrainedTypeNode,
  TypeVariableNode,
  UnionTypeNode,
  IntersectionTypeNode,
  NegationTypeNode,
  GroupTypeNode,
  ListTypeNode,
  VectorTypeNode,
  MatrixTypeNode,
  TensorTypeNode,
  TupleTypeNode,
  RecordTypeNode,
  ObjectTypeNode,
  DictionaryTypeNode,
  SetTypeNode,
  BroadcastableTypeNode,
  CollectionTypeNode,
  ExpressionTypeNode,
  SymbolTypeNode,
  NumericTypeNode,
  PrimitiveTypeNode,
  TypeReferenceNode,
  ValueNode,
  ASTVisitor,
  visitNode,
  NamedElementNode,
  DimensionNode,
} from './ast-nodes.js';
import {
  Type,
  NamedElement,
  TypeResolver,
  TypeParameter,
  TypeReference,
  FunctionSignature,
} from './types.js';
import {
  TypeVariableError,
  freeTypeVariables,
  LENGTH_BOUND,
  markValueVariables,
  valueVariableNamesOf,
  satisfiesTypeBound,
  substituteTypeVariables,
} from './instantiate.js';
import type { TypeVariableErrorCode } from './instantiate.js';
import { typeToString } from './serialize.js';
import { applyTypeReference, recordForwardArity } from './reference.js';

export class TypeBuilder implements ASTVisitor<Type> {
  private typeResolver: TypeResolver;

  /** The type VARIABLES in scope, innermost last: the pre-seed (a generic type
   * alias's own parameters) plus one frame per enclosing `where` clause. Their
   * declared BOUNDS are what A7 admission compares when a generic alias is
   * applied to an open argument. */
  private _typeVarScopes: (readonly TypeParameter[])[] = [];

  constructor(
    typeResolver?: TypeResolver,
    typeVars?: readonly TypeParameter[]
  ) {
    this.typeResolver = typeResolver ?? {
      forward: () => undefined,
      resolve: () => undefined,
      get names() {
        return [];
      },
    };
    if (typeVars !== undefined && typeVars.length > 0)
      this._typeVarScopes.push(typeVars);
  }

  buildType(node: TypeNode): Type {
    return visitNode(node, this);
  }

  visitFunctionSignature(node: FunctionSignatureNode): Type {
    const args: NamedElement[] = [];
    const optArgs: NamedElement[] = [];
    let variadicArg: NamedElement | undefined;
    let variadicMin: 0 | 1 | undefined;

    for (const argNode of node.arguments) {
      const element = this.buildNamedElement(argNode.element);

      switch (argNode.modifier) {
        case 'optional':
          optArgs.push(element);
          break;
        case 'variadic_zero':
          variadicArg = element;
          variadicMin = 0;
          break;
        case 'variadic_one':
          variadicArg = element;
          variadicMin = 1;
          break;
        default:
          args.push(element);
          break;
      }
    }

    const result = this.buildType(node.returnType);

    const signature: any = {
      kind: 'signature',
      args: args.length > 0 ? args : undefined,
      result,
    };

    // An EMPTY slot states nothing and leaves the field off; `pure` states the
    // empty set and attaches `[]`, which serializes back as ` pure`.
    if (node.effects !== undefined) signature.effects = node.effects;
    if (optArgs.length > 0) signature.optArgs = optArgs;
    if (variadicArg) {
      signature.variadicArg = variadicArg;
      signature.variadicMin = variadicMin;
    }

    return signature;
  }

  visitConstrainedType(node: ConstrainedTypeNode): Type {
    // The clause is built BEFORE its body: a generic-alias application inside
    // the body (`(Keyed<T>) -> T where T: value`) is admitted by comparing
    // `T`'s declared bound against the alias parameter's (A7), so the bounds
    // must already be in scope when the body is built. The PARSER seeds all
    // names before parsing any bound, so a bound referencing a clause
    // variable arrives here as a variable node — and is rejected by the
    // declaration-time ground-bound validation (§7.2), not by the parse.
    const typeParams: TypeParameter[] = node.typeParams.map((p) => {
      const param: TypeParameter = { name: p.name };
      if (p.bound !== undefined) {
        const bound = this.buildType(p.bound);
        // An explicit `: unknown` bound IS the identity bound (`where T`
        // means "some value type" since the bare-synonym ruling,
        // 2026-08-17), so it normalizes to NO bound — one representation.
        // Without this, the serializer's shorthand elision produced a
        // string that re-parsed with `bound: undefined` while the original
        // carried `bound: 'unknown'`, and the two behave differently in
        // the solver's upper-constraint collection and in polytype
        // α-equivalence (which compares bounds structurally).
        if (bound !== 'unknown') param.bound = bound;
      }
      if (p.protocols !== undefined && p.protocols.length > 0)
        param.protocols = p.protocols;
      return param;
    });

    this._typeVarScopes.push(typeParams);
    let body: Type;
    try {
      body = this.buildType(node.body);
    } finally {
      this._typeVarScopes.pop();
    }
    // The clause's VALUE variables are known only once the whole body is
    // built (a length slot may come after a type-position use: `(n: N, x:
    // list<T^N>)`). The clause entries are this builder's own fresh objects,
    // so the kind is recorded on them here, and the body's type-position
    // occurrences are marked in one pass over the finished body.
    for (const p of typeParams)
      if (this._valueNames.has(p.name)) p.kind = 'value';
    body = markValueVariables(body, valueVariableNames(typeParams));

    // The clause LIVES on the signature it quantifies. A clause on anything
    // else (a bare intersection, a union, a primitive) has no arm to scope
    // over — §7.2 rejects it here, where the declared type is boxed.
    if (typeof body === 'string' || body.kind !== 'signature')
      throw new TypeVariableError(
        'unsupported-variable-position',
        'A `where` clause can only quantify a function signature. To constrain one arm of an overload set, parenthesize it: `((list<T>) -> T where T) & …`'
      );

    const signature: FunctionSignature = { ...body, typeParams };
    return signature;
  }

  /** The declared upper bound of the in-scope type variable `name` (`any` when
   * unbounded), or `undefined` when no enclosing clause — nor the pre-seed —
   * declares it. */
  private variableBound(name: string): Type | undefined {
    for (let i = this._typeVarScopes.length - 1; i >= 0; i--) {
      const p = this._typeVarScopes[i].find((x) => x.name === name);
      if (p !== undefined) return p.bound ?? 'any';
    }
    return undefined;
  }

  visitTypeVariable(node: TypeVariableNode): Type {
    // A variable whose kind is ALREADY known to be a value (a length slot
    // seen earlier in the same body, or a pre-seeded clause entry that says
    // so) is built marked; the others are marked by the post-pass over the
    // finished body (`markValueVariables`).
    if (
      this._valueNames.has(node.name) ||
      this.typeParameter(node.name)?.kind === 'value'
    )
      return { kind: 'variable', name: node.name, value: true };
    return { kind: 'variable', name: node.name };
  }

  /** The in-scope variable names this build has met in a length slot or as
   * the argument of a value parameter. Kept on the builder, never written
   * onto a pre-seeded clause entry: a declaration's clause objects may be
   * shared with sibling declarations (the variants of a sum type), so the
   * route that owns them decides the kind from the finished body
   * (`valueVariableNamesOf`). */
  private readonly _valueNames = new Set<string>();

  /** The in-scope clause entry for `name` (innermost clause first), or
   * `undefined` when no enclosing clause nor the pre-seed declares it. */
  private typeParameter(name: string): TypeParameter | undefined {
    for (let i = this._typeVarScopes.length - 1; i >= 0; i--) {
      const p = this._typeVarScopes[i].find((x) => x.name === name);
      if (p !== undefined) return p;
    }
    return undefined;
  }

  /**
   * Record that the in-scope variable `name` occurred in a LENGTH slot (or
   * filled a nominal type's value parameter): it is a value variable. The
   * clause entry is the object the parser or the declaration handed in, so
   * the kind is visible to everything that reads the clause afterwards — the
   * declaration validation, the solver, the variance walker.
   */
  private markValueVariable(name: string): void {
    if (this.typeParameter(name) !== undefined) this._valueNames.add(name);
  }

  /** `dimensions` and `dimensionVariables` for a list built from dimension
   * nodes: a named node is the `-1` wildcard plus its name. */
  private buildDimensions(nodes: readonly DimensionNode[]): {
    dimensions: number[];
    dimensionVariables?: (string | undefined)[];
  } {
    const dimensions = nodes.map((d) => this.buildDimension(d));
    if (nodes.every((d) => d.name === undefined)) return { dimensions };
    const dimensionVariables = nodes.map((d) => d.name);
    for (const name of dimensionVariables)
      if (name !== undefined) this.markValueVariable(name);
    return { dimensions, dimensionVariables };
  }

  visitUnionType(node: UnionTypeNode): Type {
    const types = node.types.map((t) => this.buildType(t));
    return { kind: 'union', types };
  }

  visitIntersectionType(node: IntersectionTypeNode): Type {
    const types = node.types.map((t) => this.buildType(t));
    return { kind: 'intersection', types };
  }

  visitNegationType(node: NegationTypeNode): Type {
    const type = this.buildType(node.type);
    return { kind: 'negation', type };
  }

  visitGroupType(node: GroupTypeNode): Type {
    // Groups are just for parsing - return the inner type
    return this.buildType(node.type);
  }

  visitListType(node: ListTypeNode): Type {
    const elements = this.buildType(node.elementType);

    // Bare `list` is a SYNONYM for `list<unknown>` (user ruling 2026-08-17),
    // so the explicit spelling normalizes to the bare canonical form — but
    // only when no dimensions constrain the rank, which the bare form cannot
    // express. An explicit `<any>` is a different, wider type (it admits
    // absence elements) and always survives.
    if (node.dimensions === undefined) {
      if (this.isUnknownType(elements)) return 'list';
      return { kind: 'list', elements, dimensions: undefined };
    }

    return { kind: 'list', elements, ...this.buildDimensions(node.dimensions) };
  }

  visitVectorType(node: VectorTypeNode): Type {
    const elements = this.buildType(node.elementType);

    if (node.dimension !== undefined) {
      return {
        kind: 'list',
        elements,
        ...this.buildDimensions([node.dimension]),
      };
    }

    // An UNSIZED vector is rank-1 with an open length, and `-1` is how this
    // system spells an open dimension. Recording it is what separates
    // `vector<T>` from a bare `list<T>`, whose rank is unconstrained: without
    // the dimension the two built the identical type and the rank-1 promise
    // was silently dropped at parse time. `visitMatrixType` below already
    // defaults the same way, to `[-1, -1]`.
    return { kind: 'list', elements, dimensions: [-1] };
  }

  visitMatrixType(node: MatrixTypeNode): Type {
    const elements = this.buildType(node.elementType);

    if (node.dimensions) {
      return {
        kind: 'list',
        elements,
        ...this.buildDimensions(node.dimensions),
      };
    }

    // Default matrix dimensions (unknown size)
    return { kind: 'list', elements, dimensions: [-1, -1] };
  }

  visitTensorType(node: TensorTypeNode): Type {
    const elements = this.buildType(node.elementType);

    // The tensor spelling does not survive as its own kind — it normalizes
    // to the `list` family. Since bare `list` means `list<unknown>` (user
    // ruling 2026-08-17), it is `tensor<unknown>` that collapses to the bare
    // name; `tensor<any>` keeps its element type (`list<any>` is the wider,
    // absence-admitting contract and must not silently narrow).
    if (this.isUnknownType(elements)) return 'list';

    return { kind: 'list', elements };
  }

  visitTupleType(node: TupleTypeNode): Type {
    const elements = node.elements.map((e) => this.buildNamedElement(e));
    return { kind: 'tuple', elements };
  }

  visitRecordType(node: RecordTypeNode): Type {
    if (node.entries.length === 0) {
      return 'record';
    }

    // Prototype-free: a record KEY is an arbitrary identifier, and
    // `elements['__proto__'] = t` on an ordinary object invokes the inherited
    // setter instead of creating an own key — so `record{__proto__: integer}`
    // parsed back to a record with that field MISSING, and a dictionary whose
    // keys include `__proto__` did not round-trip through its own type
    // spelling.
    const elements: Record<string, Type> = Object.create(null);
    for (const entry of node.entries) {
      elements[entry.key] = this.buildType(entry.valueType);
    }

    return { kind: 'record', elements };
  }

  /** `object` with no field list is the bare primitive ("any object"); with
   * one it is the stored-field layout, which only ever appears as the
   * definition of a declared nominal type. */
  visitObjectType(node: ObjectTypeNode): Type {
    if (node.entries.length === 0) return 'object';

    // Prototype-free — see `visitRecordType`.
    const elements: Record<string, Type> = Object.create(null);
    for (const entry of node.entries)
      elements[entry.key] = this.buildType(entry.valueType);

    return { kind: 'object', elements };
  }

  visitDictionaryType(node: DictionaryTypeNode): Type {
    const values = this.buildType(node.valueType);

    // Bare `dictionary` = `dictionary<unknown>` (user ruling 2026-08-17), so
    // that spelling collapses; an explicit `<any>` is the wider,
    // absence-admitting contract and survives (it used to collapse here,
    // which under the synonym reading would silently narrow it).
    if (this.isUnknownType(values)) return 'dictionary';

    return { kind: 'dictionary', values };
  }

  visitSetType(node: SetTypeNode): Type {
    const elements = this.buildType(node.elementType);

    // Bare `set` = `set<unknown>` (user ruling 2026-08-17); see
    // `visitDictionaryType` above.
    if (this.isUnknownType(elements)) return 'set';

    return { kind: 'set', elements };
  }

  visitBroadcastableType(node: BroadcastableTypeNode): Type {
    // Do NOT collapse `broadcastable<any>` to a primitive — keep the object
    // form so the constructor is always object-only.
    const elements = this.buildType(node.elementType);
    return { kind: 'broadcastable', elements };
  }

  visitCollectionType(node: CollectionTypeNode): Type {
    const elements = this.buildType(node.elementType);

    // Bare `collection`/`indexed_collection` = their `<unknown>` forms (user
    // ruling 2026-08-17), so those spellings collapse; an explicit `<any>`
    // is the wider, absence-admitting contract and survives (it used to
    // collapse here, which under the synonym reading would silently narrow).
    if (node.indexed) {
      if (this.isUnknownType(elements)) {
        return 'indexed_collection';
      }
      return { kind: 'indexed_collection', elements };
    }

    if (this.isUnknownType(elements)) {
      return 'collection';
    }

    return { kind: 'collection', elements };
  }

  visitExpressionType(node: ExpressionTypeNode): Type {
    return { kind: 'expression', operator: node.operator };
  }

  visitSymbolType(node: SymbolTypeNode): Type {
    return { kind: 'symbol', name: node.name };
  }

  visitNumericType(node: NumericTypeNode): Type {
    if (!node.lowerBound && !node.upperBound) {
      return node.baseType as Type;
    }

    const lower = node.lowerBound
      ? this.buildValue(node.lowerBound)
      : -Infinity;
    const upper = node.upperBound ? this.buildValue(node.upperBound) : Infinity;

    if (lower === -Infinity && upper === Infinity) {
      return node.baseType as Type;
    }

    return makeNumericRangeType(
      node.baseType as NumericPrimitiveType,
      lower,
      upper,
      node.lowerOpen === true,
      node.upperOpen === true
    );
  }

  visitPrimitiveType(node: PrimitiveTypeNode): Type {
    return node.name as Type;
  }

  visitTypeReference(node: TypeReferenceNode): Type {
    // Try to resolve the type reference
    const resolved = this.typeResolver.resolve(node.name);
    const record = asTypeReferenceRecord(resolved);

    // A BARE use of a not-yet-declared name (`type forest`) is an application
    // at arity zero: it is recorded too, so a declaration that turns the name
    // generic is caught against it (§4.2).
    if (
      node.isForward &&
      node.args === undefined &&
      record !== undefined &&
      record.def === undefined &&
      record.typeParams === undefined
    )
      recordForwardArity(record, 0);

    // A GENERIC type — written applied (`Pair<integer>`, `tree<integer>`) or
    // declared generic (a bare `Pair`, which is an arity error). Everything
    // else falls through to the plain reference path below.
    if (node.args !== undefined || record?.typeParams !== undefined) {
      const applied = this.applyTypeReference(node, record);
      if (applied !== undefined) return applied;
    }

    if (resolved) {
      return resolved;
    }

    // If it was a forward reference, handle it
    if (node.isForward) {
      const forwardResult = this.typeResolver.forward(node.name);
      if (forwardResult) {
        return forwardResult;
      }
    }

    // Return the name as a primitive type (fallback)
    return node.name as Type;
  }

  /**
   * Apply a generic type reference — the two halves of the feature at the TYPE
   * layer.
   *
   * A generic ALIAS is TRANSPARENT, so the application is EXPANDED here, once,
   * at type-resolution time: no applied-alias node exists in the `Type`
   * representation, and nothing downstream ever meets one
   * (`docs/TYPE-SYSTEM.md`).
   *
   * A parameterized NOMINAL type is OPAQUE, so the application is KEPT: the
   * node carries its `args` and delegates `def` to the declaration record, and
   * subtyping relates two applications by name plus arguments without ever
   * consulting the body (`docs/TYPE-SYSTEM.md`). That is what makes a
   * RECURSIVE parametric type work: the
   * `tree<T>` inside `tree`'s own body needs no definition to be built.
   *
   * Returns `undefined` — "not a generic application, carry on" — only when the
   * resolver does not hand back a type RECORD (the Epsil parser's shim
   * resolves a name to the bare name: it is a syntax check, and the engine
   * re-parses the same text with the real resolver).
   */
  private applyTypeReference(
    node: TypeReferenceNode,
    record: TypeReference | undefined
  ): Type | undefined {
    const name = node.name;
    const params = record?.typeParams;
    const args = node.args;

    // A generic type written BARE (§6/N7): an arity error, for an alias and a
    // nominal type alike.
    if (args === undefined)
      fail(
        'generic-alias-arity',
        `The type "${name}" is generic: it takes ${params!.length} type argument${params!.length === 1 ? '' : 's'} (write \`${name}<…>\`)`
      );

    // Not a record — the Epsil resolver shim. Nothing checkable here.
    if (record === undefined) return undefined;

    // An APPLIED FORWARD REFERENCE (`type forest<T>`): the name has no
    // declaration yet, so there is nothing to check the application against.
    // Record the argument count instead — the declaration that fulfills the
    // promise is checked against every recorded use (§4.2).
    if (node.isForward && record.def === undefined && params === undefined) {
      recordForwardArity(record, args.length);
      return applyTypeReference(
        record,
        args.map((a) => this.buildType(a))
      );
    }

    if (params === undefined) {
      if (record.def === undefined)
        fail(
          'generic-alias-forward-reference',
          `The type "${name}" is a forward reference and cannot take type arguments`
        );
      fail(
        'generic-alias-arity',
        `The type "${name}" is not generic: it takes no type arguments, but ${args.length} ${args.length === 1 ? 'was' : 'were'} given`
      );
    }

    // Expansion is STRUCTURAL: it substitutes into the body and drops the
    // name. Only an alias may be treated that way. The record's own body is
    // still parsing when `def` is undefined: that application is inside it,
    // and recursive generic aliases are out of scope (v1).
    if (record.alias === true && record.def === undefined)
      fail(
        'generic-alias-self-reference',
        `The generic type alias "${name}" cannot refer to itself: a generic alias is expanded eagerly, so its body has no definition to expand into yet`
      );

    if (args.length !== params.length)
      fail(
        'generic-alias-arity',
        `The type "${name}" takes ${params.length} type argument${params.length === 1 ? '' : 's'}, but ${args.length} ${args.length === 1 ? 'was' : 'were'} given`
      );

    // `Object.create(null)`: a type-variable name may legally be `__proto__`
    // or `toString`, and a plain object literal would treat both as inherited
    // members rather than as bindings.
    const bindings: Record<string, Type> = Object.create(null);
    const built: Type[] = [];
    for (let i = 0; i < params.length; i++) {
      let arg = this.buildType(args[i]);
      const param = params[i];
      if (param.kind === 'value') {
        // A VALUE parameter (`type permutation<N> = list<integer^N>`) takes a
        // value: a literal (`permutation<3>`), or an in-scope variable, which
        // this use makes a value variable of ITS clause (`(p: permutation<N>)
        // -> … where N`).
        if (typeof arg === 'object' && arg.kind === 'variable') {
          // A7 for a value parameter: the variable's own bound (`integer<1..>`
          // when its clause declares none) must satisfy the parameter's, or a
          // call could instantiate an application the builder itself refuses
          // (`(n: N) -> big<N> where N` with `big<N: integer<2..>>`, called
          // with `1`).
          const argBound = this.typeParameter(arg.name)?.bound ?? LENGTH_BOUND;
          const bound = param.bound ?? LENGTH_BOUND;
          if (!satisfiesTypeBound(argBound, bound))
            fail(
              'generic-alias-bound',
              `The variable \`${arg.name}\`, whose bound is \`${typeToString(argBound)}\`, does not satisfy the bound \`${typeToString(bound)}\` of the value parameter \`${param.name}\` of "${name}"`
            );
          this.markValueVariable(arg.name);
          arg = { kind: 'variable', name: arg.name, value: true };
        } else {
          // A value (`permutation<3>`), or a FAMILY of values written as a
          // type within the bound (`permutation<integer<1..>>`, which is how
          // an application whose length was never solved prints): anything
          // else is a type where a value belongs.
          const bound = param.bound ?? LENGTH_BOUND;
          if (!satisfiesTypeBound(arg, bound))
            fail(
              'type-argument-kind',
              `The parameter \`${param.name}\` of "${name}" is a value parameter (a length): its argument must be a value such as \`3\`, a variable of the enclosing \`where\` clause, or a range within \`${typeToString(bound)}\`, not \`${typeToString(arg)}\``
            );
        }
      }
      // A value where a TYPE parameter expects a type (`tree<3>`) is a legal
      // singleton type today, and is admitted by the ordinary bound check.
      const bound = param.bound;
      if (param.kind !== 'value' && bound !== undefined)
        this.checkArgumentBound(name, arg, param);
      bindings[param.name] = arg;
      built.push(arg);
    }

    if (record.alias !== true) return applyTypeReference(record, built);

    return substituteTypeVariables(record.def!, bindings);
  }

  /**
   * A7 — per-argument admission.
   *
   * A GROUND argument is checked against the parameter's declared bound
   * directly. An OPEN one (a type variable quantified by an enclosing `where`
   * clause, or by the enclosing alias's own clause) is checked BOUND AGAINST
   * BOUND: the argument variable's declared bound (`any` when unbounded) must
   * satisfy the parameter's. Both sides are then ground, so the type algebra
   * never sees an open type — the ground-invariant tripwires are never
   * approached. An unbounded variable therefore does NOT satisfy a bounded
   * parameter.
   */
  private checkArgumentBound(
    aliasName: string,
    arg: Type,
    param: TypeParameter
  ): void {
    const bound = param.bound!;

    // Read every free variable occurrence in the argument as its declared
    // bound. For a BARE variable that is exactly A7's bound-vs-bound test; for
    // a composite argument (`Pair<list<T>>`) it is the same rule applied
    // pointwise. A variable no clause declares reads as `any`.
    let subject = arg;
    const free = freeTypeVariables(arg);
    if (free.size > 0) {
      const bindings: Record<string, Type> = Object.create(null);
      for (const v of free) bindings[v] = this.variableBound(v) ?? 'any';
      subject = substituteTypeVariables(arg, bindings);
    }

    if (satisfiesTypeBound(subject, bound)) return;

    const openNote =
      free.size > 0
        ? ` (an open argument is admitted by its own declared bound, \`${typeToString(subject)}\`)`
        : '';
    fail(
      'generic-alias-bound',
      `The type argument \`${typeToString(arg)}\` does not satisfy the bound \`${typeToString(bound)}\` of the parameter \`${param.name}\` of "${aliasName}"${openNote}`
    );
  }

  visitValue(node: ValueNode): Type {
    return { kind: 'value', value: node.value };
  }

  private buildNamedElement(node: NamedElementNode): NamedElement {
    const type = this.buildType(node.type);

    if (node.name) {
      return { name: node.name, type };
    }

    return { type };
  }

  private buildDimension(node: DimensionNode): number {
    // -1 represents an unknown size: `?`, and a dimension VARIABLE, whose name
    // rides beside it in `dimensionVariables` (see `buildDimensions`).
    return node.size ?? -1;
  }

  private buildValue(node: ValueNode): any {
    return node.value;
  }

  private isAnyType(type: Type): boolean {
    return (
      type === 'any' ||
      (typeof type === 'object' &&
        'kind' in type &&
        (type as any).kind === 'primitive' &&
        'name' in type &&
        (type as any).name === 'any')
    );
  }

  /** An explicit `unknown` element argument spells the same type as the bare
   * constructor (user ruling 2026-08-17: bare `list` IS `list<unknown>`), so
   * the collection visitors collapse it to the bare canonical form. Mirrors
   * `isAnyType` above for the two shapes an element argument arrives in. */
  private isUnknownType(type: Type): boolean {
    return (
      type === 'unknown' ||
      (typeof type === 'object' &&
        'kind' in type &&
        (type as any).kind === 'primitive' &&
        'name' in type &&
        (type as any).name === 'unknown')
    );
  }
}

/** The resolver's answer as a type RECORD, when it is one.
 *
 * `TypeResolver.resolve` is typed as returning a `TypeReference`, but the
 * Epsil parser's shim resolves a known name to the bare NAME (a string): its
 * type subparse is a syntax check and the built `Type` is discarded. Every
 * generic-alias check needs the record (its `typeParams` and its `def`), so
 * guard on the shape rather than on the declared type. */
function asTypeReferenceRecord(t: unknown): TypeReference | undefined {
  if (typeof t !== 'object' || t === null) return undefined;
  return (t as { kind?: string }).kind === 'reference'
    ? (t as TypeReference)
    : undefined;
}

function fail(code: TypeVariableErrorCode, message: string): never {
  throw new TypeVariableError(code, message);
}

export function buildTypeFromAST(
  node: TypeNode,
  typeResolver?: TypeResolver,
  typeVars?: readonly TypeParameter[]
): Type {
  const builder = new TypeBuilder(typeResolver, typeVars);
  const type = builder.buildType(node);
  // A pre-seeded clause (a generic type declaration's own parameters) learns
  // its value variables from the body just built — a length slot, or an
  // application of another type's value parameter — so the body's
  // type-position occurrences of them are marked once it is complete. The
  // clause entries themselves are NOT written here: they belong to the
  // declaring route, which sets their kind from the finished body
  // (`valueVariableNamesOf`) — see the engine's `declareType`.
  if (typeVars === undefined) return type;
  const names = valueVariableNamesOf(type);
  for (const p of typeVars) if (p.kind === 'value') names.add(p.name);
  return markValueVariables(type, names);
}

/** The names of the `kind: 'value'` entries of a clause. */
function valueVariableNames(params: readonly TypeParameter[]): Set<string> {
  const names = new Set<string>();
  for (const p of params) if (p.kind === 'value') names.add(p.name);
  return names;
}
