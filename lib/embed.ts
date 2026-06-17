/**
 * Local semantic embeddings via @xenova/transformers (all-MiniLM-L6-v2, 384-dim).
 *
 * Runs fully on-device: no API key, no network after the one-time model download
 * (~25MB, cached under ~/.claude/history-cache/models). Keeps the tool private and
 * free, which matters both for daily use and an eventual OSS release.
 *
 * Vectors are stored separately from index.json (this file would bloat it) as a
 * base64-packed Float32 map at ~/.claude/history-cache/embeddings.json.
 */
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { CACHE_DIR, loadIndex, saveIndex } from './index-store';
import type { IndexRecord } from './index-store';

export const EMB_PATH = join(CACHE_DIR, 'embeddings.json');
export const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
export const EMB_DIM = 384;

// Bump when embedInputFor() changes — invalidates stale vectors so they re-embed.
export const EMBED_VERSION = 2;

/* eslint-disable @typescript-eslint/no-explicit-any */
let extractorPromise: Promise<any> | null = null;

async function getExtractor(): Promise<any> {
  if (extractorPromise) return extractorPromise;
  extractorPromise = (async () => {
    const tf = await import('@xenova/transformers');
    tf.env.cacheDir = join(CACHE_DIR, 'models');
    tf.env.allowRemoteModels = true;
    return tf.pipeline('feature-extraction', MODEL_ID, { quantized: true });
  })();
  return extractorPromise;
}

export async function isEmbeddingAvailable(): Promise<boolean> {
  try { await getExtractor(); return true; } catch { return false; }
}

/** Embed an array of strings → array of unit-normalized Float32 vectors. */
export async function embedTexts(texts: string[]): Promise<Float32Array[]> {
  if (texts.length === 0) return [];
  const extractor = await getExtractor();
  const out: Float32Array[] = [];
  // batch through the pipeline; it accepts arrays but keep batches modest for memory
  const BATCH = 16;
  for (let i = 0; i < texts.length; i += BATCH) {
    const slice = texts.slice(i, i + BATCH).map(t => t.slice(0, 2000) || ' ');
    const res = await extractor(slice, { pooling: 'mean', normalize: true });
    const list = res.tolist() as number[][];
    for (const v of list) out.push(Float32Array.from(v));
  }
  return out;
}

export async function embedQuery(q: string): Promise<Float32Array> {
  const [v] = await embedTexts([q]);
  return v;
}

export function cosine(a: Float32Array, b: Float32Array): number {
  // both are unit-normalized → dot product is cosine
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** Text we actually embed for a session: prefer enriched fields, fall back to raw. */
export function embedInputFor(r: IndexRecord): string {
  const parts: string[] = [];
  if (r.title) parts.push(r.title);
  if (r.summary) parts.push(r.summary);
  if (r.tags?.length) parts.push(r.tags.join(', '));
  // commit subjects sit early so they land inside MiniLM's ~256-token window
  if (r.commitSubjects?.length) parts.push('Commits: ' + r.commitSubjects.slice(-12).join('; '));
  parts.push(r.fallbackTitle);
  parts.push(r.searchText.slice(0, 1000));
  return parts.filter(Boolean).join('. ');
}

// ---- persistence: { key: base64(Float32) } ----
type EmbFile = { version: number; dim: number; vectors: Record<string, string> };

function packVec(v: Float32Array): string {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString('base64');
}
function unpackVec(s: string): Float32Array {
  const buf = Buffer.from(s, 'base64');
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

export async function loadEmbeddings(): Promise<Map<string, Float32Array>> {
  if (!existsSync(EMB_PATH)) return new Map();
  try {
    const parsed = JSON.parse(await readFile(EMB_PATH, 'utf8')) as EmbFile;
    const m = new Map<string, Float32Array>();
    for (const [k, b64] of Object.entries(parsed.vectors ?? {})) m.set(k, unpackVec(b64));
    return m;
  } catch {
    return new Map();
  }
}

export async function saveEmbeddings(vectors: Map<string, Float32Array>): Promise<void> {
  if (!existsSync(CACHE_DIR)) await mkdir(CACHE_DIR, { recursive: true });
  const obj: EmbFile = { version: 1, dim: EMB_DIM, vectors: {} };
  for (const [k, v] of vectors) obj.vectors[k] = packVec(v);
  const tmp = EMB_PATH + '.tmp';
  await writeFile(tmp, JSON.stringify(obj));
  await rename(tmp, EMB_PATH);
}

export type EmbedProgress = { processed: number; remaining: number; total: number; unavailable?: boolean };

/**
 * Embed up to `limit` not-yet-embedded sessions. Batched + resumable. Local model,
 * so no key needed; only fails if the model can't load (then semantic is disabled
 * but keyword search still works).
 */
export async function embedBatch(limit = 64): Promise<EmbedProgress> {
  const records = await loadIndex();
  const total = records.size;
  // skip templated app/headless ("agent") sessions; re-embed anything whose vector
  // predates the current EMBED_VERSION (e.g. before commit subjects fed the input)
  const pending = [...records.values()].filter(
    r => r.kind !== 'agent' && (!r.embedded || r.embedVersion !== EMBED_VERSION)
  );
  if (pending.length === 0) return { processed: 0, remaining: 0, total };

  if (!(await isEmbeddingAvailable())) {
    return { processed: 0, remaining: pending.length, total, unavailable: true };
  }

  const batch = pending.slice(0, limit);
  const vectors = await loadEmbeddings();
  const inputs = batch.map(embedInputFor);
  const vecs = await embedTexts(inputs);

  for (let i = 0; i < batch.length; i++) {
    const r = batch[i];
    if (vecs[i]) {
      vectors.set(r.key, vecs[i]);
      r.embedded = true;
      r.embeddedMtime = r.mtime;
      r.embedVersion = EMBED_VERSION;
    }
  }
  await saveEmbeddings(vectors);
  await saveIndex(records);

  const remaining = [...records.values()].filter(r => !r.embedded).length;
  return { processed: batch.length, remaining, total };
}
