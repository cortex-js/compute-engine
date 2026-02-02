// Re-export all compilation types and classes
export * from './types';
export * from './base-compiler';
export * from './javascript-target';
export * from './glsl-target';
export * from './python-target';

// Legacy exports for backward compatibility
export { BaseCompiler as compile } from './base-compiler';
