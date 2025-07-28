export interface ASTNode {
  kind: string;
  position: number;
  line: number;
  column: number;
}

export interface NamedElementNode extends ASTNode {
  kind: 'named_element';
  name?: string;
  type: TypeNode;
}

export interface ArgumentNode extends ASTNode {
  kind: 'argument';
  element: NamedElementNode;
  modifier?: 'optional' | 'variadic_zero' | 'variadic_one';
}

export interface FunctionSignatureNode extends ASTNode {
  kind: 'function_signature';
  arguments: ArgumentNode[];
  returnType: TypeNode;
}

export interface UnionTypeNode extends ASTNode {
  kind: 'union';
  types: TypeNode[];
}

export interface IntersectionTypeNode extends ASTNode {
  kind: 'intersection';
  types: TypeNode[];
}

export interface NegationTypeNode extends ASTNode {
  kind: 'negation';
  type: TypeNode;
}

export interface GroupTypeNode extends ASTNode {
  kind: 'group';
  type: TypeNode;
}

export interface ListTypeNode extends ASTNode {
  kind: 'list';
  elementType: TypeNode;
  dimensions?: DimensionNode[];
}

export interface VectorTypeNode extends ASTNode {
  kind: 'vector';
  elementType: TypeNode;
  size?: number;
}

export interface MatrixTypeNode extends ASTNode {
  kind: 'matrix';
  elementType: TypeNode;
  dimensions?: DimensionNode[];
}

export interface TensorTypeNode extends ASTNode {
  kind: 'tensor';
  elementType: TypeNode;
}

export interface TupleTypeNode extends ASTNode {
  kind: 'tuple';
  elements: NamedElementNode[];
}

export interface RecordTypeNode extends ASTNode {
  kind: 'record';
  entries: RecordEntryNode[];
}

export interface RecordEntryNode extends ASTNode {
  kind: 'record_entry';
  key: string;
  valueType: TypeNode;
}

export interface DictionaryTypeNode extends ASTNode {
  kind: 'dictionary';
  valueType: TypeNode;
}

export interface SetTypeNode extends ASTNode {
  kind: 'set';
  elementType: TypeNode;
}

export interface CollectionTypeNode extends ASTNode {
  kind: 'collection';
  elementType: TypeNode;
  indexed?: boolean;
}

export interface ExpressionTypeNode extends ASTNode {
  kind: 'expression';
  operator: string;
}

export interface SymbolTypeNode extends ASTNode {
  kind: 'symbol';
  name: string;
}

export interface NumericTypeNode extends ASTNode {
  kind: 'numeric';
  baseType: string;
  lowerBound?: ValueNode;
  upperBound?: ValueNode;
}

export interface PrimitiveTypeNode extends ASTNode {
  kind: 'primitive';
  name: string;
}

export interface TypeReferenceNode extends ASTNode {
  kind: 'type_reference';
  name: string;
  isForward?: boolean;
}

export interface ValueNode extends ASTNode {
  kind: 'value';
  value: any;
  valueType: 'string' | 'number' | 'boolean' | 'infinity' | 'nan';
}

export interface DimensionNode extends ASTNode {
  kind: 'dimension';
  size: number | null; // null for '?'
}

export interface IdentifierNode extends ASTNode {
  kind: 'identifier';
  name: string;
}

export interface VerbatimStringNode extends ASTNode {
  kind: 'verbatim_string';
  value: string;
}

export type TypeNode =
  | FunctionSignatureNode
  | UnionTypeNode
  | IntersectionTypeNode
  | NegationTypeNode
  | GroupTypeNode
  | ListTypeNode
  | VectorTypeNode
  | MatrixTypeNode
  | TensorTypeNode
  | TupleTypeNode
  | RecordTypeNode
  | DictionaryTypeNode
  | SetTypeNode
  | CollectionTypeNode
  | ExpressionTypeNode
  | SymbolTypeNode
  | NumericTypeNode
  | PrimitiveTypeNode
  | TypeReferenceNode
  | ValueNode;

export interface ASTVisitor<T> {
  visitFunctionSignature(node: FunctionSignatureNode): T;
  visitUnionType(node: UnionTypeNode): T;
  visitIntersectionType(node: IntersectionTypeNode): T;
  visitNegationType(node: NegationTypeNode): T;
  visitGroupType(node: GroupTypeNode): T;
  visitListType(node: ListTypeNode): T;
  visitVectorType(node: VectorTypeNode): T;
  visitMatrixType(node: MatrixTypeNode): T;
  visitTensorType(node: TensorTypeNode): T;
  visitTupleType(node: TupleTypeNode): T;
  visitRecordType(node: RecordTypeNode): T;
  visitDictionaryType(node: DictionaryTypeNode): T;
  visitSetType(node: SetTypeNode): T;
  visitCollectionType(node: CollectionTypeNode): T;
  visitExpressionType(node: ExpressionTypeNode): T;
  visitSymbolType(node: SymbolTypeNode): T;
  visitNumericType(node: NumericTypeNode): T;
  visitPrimitiveType(node: PrimitiveTypeNode): T;
  visitTypeReference(node: TypeReferenceNode): T;
  visitValue(node: ValueNode): T;
}

export function visitNode<T>(node: TypeNode, visitor: ASTVisitor<T>): T {
  switch (node.kind) {
    case 'function_signature':
      return visitor.visitFunctionSignature(node);
    case 'union':
      return visitor.visitUnionType(node);
    case 'intersection':
      return visitor.visitIntersectionType(node);
    case 'negation':
      return visitor.visitNegationType(node);
    case 'group':
      return visitor.visitGroupType(node);
    case 'list':
      return visitor.visitListType(node);
    case 'vector':
      return visitor.visitVectorType(node);
    case 'matrix':
      return visitor.visitMatrixType(node);
    case 'tensor':
      return visitor.visitTensorType(node);
    case 'tuple':
      return visitor.visitTupleType(node);
    case 'record':
      return visitor.visitRecordType(node);
    case 'dictionary':
      return visitor.visitDictionaryType(node);
    case 'set':
      return visitor.visitSetType(node);
    case 'collection':
      return visitor.visitCollectionType(node);
    case 'expression':
      return visitor.visitExpressionType(node);
    case 'symbol':
      return visitor.visitSymbolType(node);
    case 'numeric':
      return visitor.visitNumericType(node);
    case 'primitive':
      return visitor.visitPrimitiveType(node);
    case 'type_reference':
      return visitor.visitTypeReference(node);
    case 'value':
      return visitor.visitValue(node);
    default:
      throw new Error(`Unknown node kind: ${(node as any).kind}`);
  }
}
