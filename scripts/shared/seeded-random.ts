/**
 * seeded-random.ts
 * Deterministic random numbers for the seed scripts: the same seed always gives the
 * same sequence, so a generator run is reproducible. Used by
 * generate-prospect-directory.ts (seeded from the secret TEMPO_DIRECTORY_SEED env
 * var, never from the config) and the integrity tests (their own fixed test seeds).
 */

/**
 * Mulberry32 PRNG: returns a function producing a deterministic [0, 1) sequence
 * from a 32-bit seed.
 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
