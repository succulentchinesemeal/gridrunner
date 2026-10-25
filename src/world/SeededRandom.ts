/**
 * Deterministic 32-bit PRNG (mulberry32) used across all clients with matchSeed
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function (): number {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class SeededRandom {
  private nextFn: () => number;

  constructor(seed: number) {
    this.nextFn = mulberry32(seed);
  }

  public next(): number {
    return this.nextFn();
  }

  public range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  public int(min: number, maxInclusive: number): number {
    return Math.floor(this.range(min, maxInclusive + 1));
  }

  public pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
}
