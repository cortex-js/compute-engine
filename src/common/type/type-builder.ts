import {
  TypeNode,
  FunctionSignatureNode,
  ForallTypeNode,
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
  satisfiesTypeBound,
  substituteTypeVariables,
} from './instantiate.js';
import type { TypeVariableErrorCode } from './instantiate.js';
import { typeToString } from './serialize.js';

export class TypeBuilder implements ASTVisitor<Type> {
  private typeResolver: TypeResolver;

  /** The type VARIABLES in scope, innermost last: the pre-seed (a generic type
   * alias's own parameters) plus one frame per enclosing `forall` clause. Their
   * declared BOUNDS are what A7 admission compares when a generic alias is
   * applied to an open argument. */
  private _typeVarScopes: (readonly TypeParameter[])[] = [];

  constructor(typeResolver?: TypeResolver, typeVars?: readonly TypeParameter[]) {
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

  visitForallType(node: ForallTypeNode): Type {
    // The clause is built BEFORE its body: a generic-alias application inside
    // the body (`forall T: value. (Keyed<T>) -> T`) is admitted by comparing
    // `T`'s declared bound against the alias parameter's (A7), so the bounds
    // must already be in scope when the body is built. Bounds themselves are
    // built with the clause NOT in scope — they are ground (§7.2).
    const typeParams: TypeParameter[] = node.typeParams.map((p) =>
      p.bound === undefined
        ? { name: p.name }
        : { name: p.name, bound: this.buildType(p.bound) }
    );

    this._typeVarScopes.push(typeParams);
    let body: Type;
    try {
      body = this.buildType(node.body);
    } finally {
      this._typeVarScopes.pop();
    }

    // The clause LIVES on the signature it quantifies. A clause on anything
    // else (a bare intersection, a union, a primitive) has no arm to scope
    // over — §7.2 rejects it here, where the declared type is boxed.
    if (typeof body === 'string' || body.kind !== 'signature')
      throw new TypeVariableError(
        'unsupported-variable-position',
        'A `forall` clause can only be applied to a function signature'
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
    return { kind: 'variable', name: node.name };
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
    const dimensions = node.dimensions?.map((d) => this.buildDimension(d));

    return { kind: 'list', elements, dimensions };
  }

  visitVectorType(node: VectorTypeNode): Type {
    const elements = this.buildType(node.elementType);

    if (node.size !== undefined) {
      return { kind: 'list', elements, dimensions: [node.size] };
    }

    return { kind: 'list', elements };
  }

  visitMatrixType(node: MatrixTypeNode): Type {
    const elements = this.buildType(node.elementType);

    if (node.dimensions) {
      const dimensions = node.dimensions.map((d) => this.buildDimension(d));
      return { kind: 'list', elements, dimensions };
    }

    // Default matrix dimensions (unknown size)
    return { kind: 'list', elements, dimensions: [-1, -1] };
  }

  visitTensorType(node: TensorTypeNode): Type {
    const elements = this.buildType(node.elementType);
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

    const elements: Record<string, Type> = {};
    for (const entry of node.entries) {
      elements[entry.key] = this.buildType(entry.valueType);
    }

    return { kind: 'record', elements };
  }

  visitDictionaryType(node: DictionaryTypeNode): Type {
    const values = this.buildType(node.valueType);

    if (this.isAnyType(values)) {
      return 'dictionary';
    }

    return { kind: 'dictionary', values };
  }

  visitSetType(node: SetTypeNode): Type {
    const elements = this.buildType(node.elementType);

    if (this.isAnyType(elements)) {
      return 'set';
    }

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

    if (node.indexed) {
      if (this.isAnyType(elements)) {
        return 'indexed_collection';
      }
      return { kind: 'indexed_collection', elements };
    }

    if (this.isAnyType(elements)) {
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

    return {
      kind: 'numeric',
      type: node.baseType as any,
      lower,
      upper,
    };
  }

  visitPrimitiveType(node: PrimitiveTypeNode): Type {
    return node.name as Type;
  }

  visitTypeReference(node: TypeReferenceNode): Type {
    // Try to resolve the type reference
    const resolved = this.typeResolver.resolve(node.name);
    const record = asTypeReferenceRecord(resolved);

    // A GENERIC type alias — written applied (`Pair<integer>`) or declared
    // generic (a bare `Pair`, which is an arity error). Everything else falls
    // through to the plain reference path below.
    if (node.args !== undefined || record?.typeParams !== undefined) {
      const expanded = this.expandGenericAlias(node, record);
      if (expanded !== undefined) return expanded;
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
   * Expand an applied generic-alias reference into its substituted body —
   * the whole of the generic-alias feature at the TYPE layer
   * (`docs/plans/2026-08-04-generic-type-aliases-design.md` §3.3).
   *
   * Transparency means the expansion happens HERE, once, at type-resolution
   * time: no applied-reference node exists in the `Type` representation, so
   * nothing downstream (subtype, widen, compile, serialization) ever meets one.
   *
   * Returns `undefined` — "not a generic application, carry on" — only when the
   * resolver does not hand back a type RECORD (the Cortex parser's shim
   * resolves a name to the bare name: it is a syntax check, and the engine
   * re-parses the same text with the real resolver).
   */
  private expandGenericAlias(
    node: TypeReferenceNode,
    record: TypeReference | undefined
  ): Type | undefined {
    const name = node.name;
    const params = record?.typeParams;
    const args = node.args;

    // A generic alias written BARE: there is nothing to expand.
    if (args === undefined)
      fail(
        'generic-alias-arity',
        `The type "${name}" is generic: it takes ${params!.length} type argument${params!.length === 1 ? '' : 's'} (write \`${name}<…>\`)`
      );

    // `type Pair<integer>`: a forward reference has no body to expand against.
    if (node.isForward)
      fail(
        'generic-alias-forward-reference',
        `The forward reference \`type ${name}\` cannot take type arguments: declare "${name}" before applying it`
      );

    // Not a record — the Cortex resolver shim. Nothing checkable here.
    if (record === undefined) return undefined;

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
    // name. Only an alias may be treated that way — `declareType` rejects a
    // clause on the nominal form, so a parameterized non-alias record here
    // would be a declaration-route leak.
    console.assert(
      record.alias === true,
      `The generic type "${name}" is not an alias: only an alias body may be expanded structurally`
    );

    // The record's own body is still parsing: this application is inside it.
    // Recursive generic aliases are out of scope (v1).
    if (record.def === undefined)
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
    for (let i = 0; i < params.length; i++) {
      const arg = this.buildType(args[i]);
      const bound = params[i].bound;
      if (bound !== undefined) this.checkArgumentBound(name, arg, params[i]);
      bindings[params[i].name] = arg;
    }

    return substituteTypeVariables(record.def, bindings);
  }

  /**
   * A7 — per-argument admission.
   *
   * A GROUND argument is checked against the parameter's declared bound
   * directly. An OPEN one (a type variable quantified by an enclosing `forall`
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
    return node.size ?? -1; // -1 represents unknown size (?)
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
}

/** The resolver's answer as a type RECORD, when it is one.
 *
 * `TypeResolver.resolve` is typed as returning a `TypeReference`, but the
 * Cortex parser's shim resolves a known name to the bare NAME (a string): its
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
  return builder.buildType(node);
}
