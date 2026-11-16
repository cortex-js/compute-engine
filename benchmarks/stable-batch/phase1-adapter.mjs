import { ComputeEngine } from '../../src/compute-engine.ts';
import { prepareBatch, transferBatchData, transferLiteral, mixPreparedEntries } from '../../src/compute-engine/experimental/stable-batch.ts';

/** Executes the frozen semantic protocol; assertions live in phase1.test.mjs. */
export class Phase1Adapter {
  constructor(route = 'name') {
    this.route = route;
    this.engine = new ComputeEngine();
    this.engine.jit = 'off';
    this.records = new Map();
    this.external = new Map();
    this.instances = new Map();
  }
  unit(id) { return this.records.get(id)?.unit; }
  instance(id) {
    if (this.records.get(id)?.instance) return this.records.get(id).instance;
    if (!this.instances.has(id)) this.instances.set(id, this.unit(id).instantiate());
    return this.instances.get(id).instance;
  }
  evaluate(instance, name) {
    if (this.route === 'name') return instance.evaluate(name);
    const resolved = instance.unit.resolve(name);
    return resolved.status === 'ready' ? instance.evaluateHandle(resolved.handle) : resolved;
  }
  reference(path) {
    const [id, name] = path.split('.');
    return { instance: this.instance(id), name };
  }
  step(step) {
    let result;
    switch (step.op) {
      case 'prepare': result = prepareBatch(this.engine, step.entries, [...this.external.values()]); break;
      case 'revise': result = this.unit(step.unit).revise(step.replace); break;
      case 'instantiate': result = this.unit(step.unit).instantiate(); break;
      case 'write': result = this.instance(step.instance).write(step.name, step.value); break;
      case 'writeMany':
        for (const value of step.values) result = this.instance(step.instance).write(step.name, value);
        break;
      case 'evaluate': result = this.evaluate(this.instance(step.instance ?? step.unit), step.entry); break;
      case 'execute': {
        const initialized = this.unit(step.unit).instantiate();
        const values = {};
        for (const binding of this.unit(step.unit).entries) {
          if (binding.kind !== 'expression') continue;
          const evaluated = this.evaluate(initialized.instance, binding.name);
          if (evaluated.status === 'ready') values[binding.name] = evaluated.value.json;
        }
        result = { status: 'ready', diagnostics: initialized.diagnostics, values };
        break;
      }
      case 'hostDeclare': this.engine.declare(step.name, step.type); result = { status: 'ready' }; break;
      case 'hostOperator': {
        // The host registers a declarative operator body, not an arbitrary callback.
        const info = { kind: 'definition', name: step.name, parameters: step.parameters.map(name => ({ name, type: 'real' })), resultType: 'real', body: structuredClone(step.body) };
        this.external.set(step.name, info);
        result = { status: 'ready' };
        break;
      }
      case 'inspect': result = {
        status: 'ready', hostType: this.engine.symbolInfo(step.hostName).type.toString(),
        numericRequirement: this.unit(step.units[0]).binding(step.hostName).type,
        logicalRequirement: this.unit(step.units[1]).binding(step.hostName).type,
      }; break;
      case 'mix': {
        result = mixPreparedEntries(step.entries.map(path => ({ unit: this.unit(path.split('.')[0]), name: path.split('.')[1] })));
        break;
      }
      case 'transfer': {
        const [targetId, targetName] = step.target.split('.');
        const source = step.hostValue ? { literal: step.hostValue }
          : step.sourceAggregate ? { aggregate: step.sourceAggregate.map(value => typeof value === 'string' && value.includes('.') ? this.reference(value) : { literal: value }) }
          : this.reference(step.source);
        result = transferBatchData(source, this.instance(targetId), targetName);
        break;
      }
      default: result = { status: 'unsupported', reasonCode: `unsupported-operation:${step.op}` };
    }
    this.records.set(step.id, result);
    return result;
  }
}

export function observable(result) {
  const { unit: _unit, instance: _instance, value, ...rest } = result;
  return { ...rest, ...(value === undefined ? {} : { value: transferLiteral(value) ?? value.json ?? value }) };
}
