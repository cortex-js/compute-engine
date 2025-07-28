import {
  TypeNode,
  FunctionSignatureNode,
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
} from './ast-nodes';
import { Type, NamedElement, TypeResolver } from './types';

export class TypeBuilder implements ASTVisitor<Type> {
  private typeResolver: TypeResolver;

  constructor(typeResolver?: TypeResolver) {
    this.typeResolver = typeResolver ?? {
      forward: () => undefined,
      resolve: () => undefined,
      get names() {
        return [];
      },
    };
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

    if (optArgs.length > 0) signature.optArgs = optArgs;
    if (variadicArg) {
      signature.variadicArg = variadicArg;
      signature.variadicMin = variadicMin;
    }

    return signature;
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

export function buildTypeFromAST(
  node: TypeNode,
  typeResolver?: TypeResolver
): Type {
  const builder = new TypeBuilder(typeResolver);
  return builder.buildType(node);
}
