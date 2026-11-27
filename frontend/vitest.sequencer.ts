import { BaseSequencer, type TestSpecification } from 'vitest/node';
import durations from './vitest.durations.json';

const DURATIONS = durations as Record<string, number>;

function key(spec: TestSpecification): string {
  const id = spec.moduleId.replace(/\\/g, '/');
  const at = id.indexOf('/frontend/');
  return at >= 0 ? id.slice(at + '/frontend/'.length) : id;
}

const FILE_COST_FLOOR_SECONDS = 0.1;

function cost(spec: TestSpecification): number {
  return Math.max(DURATIONS[key(spec)] ?? 0, FILE_COST_FLOOR_SECONDS);
}

export default class DurationSequencer extends BaseSequencer {
  override async shard(files: TestSpecification[]): Promise<TestSpecification[]> {
    const shard = this.ctx.config.shard;
    if (!shard) return files;
    const bins = Array.from({ length: shard.count }, () => ({ total: 0, specs: [] as TestSpecification[] }));
    const sorted = [...files].sort((a, b) => cost(b) - cost(a) || key(a).localeCompare(key(b)));
    for (const spec of sorted) {
      let target = bins[0];
      for (const bin of bins) {
        if (bin.total < target.total) target = bin;
      }
      target.total += cost(spec);
      target.specs.push(spec);
    }
    return bins[shard.index - 1]?.specs ?? [];
  }
}
