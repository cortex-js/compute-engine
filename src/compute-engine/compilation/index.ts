// Re-export all compilation types and classes
export * from './types';
export * from './base-compiler';
export * from './javascript-target';

// Legacy exports for backward compatibility  
export { BaseCompiler as compile } from './base-compiler';