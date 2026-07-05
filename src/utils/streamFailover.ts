// =============================================================================
// Live stream failover / probing (roadmap D.9)
//
// Quando un canale/evento live espone PIÙ sorgenti (SPON, SportZX, Sports99,
// Freeshot, Vavoo, ...) questo modulo le sonda in parallelo e scarta quelle
// palesemente morte PRIMA di restituirle a Stremio, così l'utente non deve
// provare a mano una lista di link rotti.
//
// Principi di sicurezza (per non peggiorare l'esperienza):
//   1. OPT-IN: disattivo di default. Si accende con LIVE_FAILOVER=1.
//   2. Scarta SOLO con certezza: 404/410/5xx oppure HTTP 200 con manifest non
//      valido. Timeout, errori di rete, 401/403 => "unknown" => si TIENE
//      (un 403 può essere un geoblocco sul nostro egress ma non sul client).
//   3. Mai svuotare la lista: se dopo il probing non sopravvive nessuna
//      sorgente sondabile, si restituisce la lista ORIGINALE invariata.
//   4. Non tocca voci DVR/registrazione/placeholder: restano sempre.
//   5. Budget temporale complessivo, così non allunga la risposta all'infinito.
// =============================================================================

export interface FailoverCandidate {
  name?: string;
  title?: string;
  url: string;
  behaviorHints?: any;
}

export interface FailoverOptions {
  /** Default: env LIVE_FAILOVER in {1,true,on,yes}. */
  enabled?: boolean;
  /** Timeout della singola sonda (ms). Default 2500. */
  perProbeTimeoutMs?: number;
  /** Budget wall-clock complessivo (ms). Default 4500. */
  budgetMs?: number;
  /** Sonde in parallelo. Default 8. */
  concurrency?: number;
  /** TTL cache esito per URL (ms). Default 60000. */
  cacheTtlMs?: number;
  /** Logger opzionale (es. debugLog). */
  logger?: (msg: string) => void;
}

type ProbeVerdict = 'alive' | 'dead' | 'unknown';

const DEFAULTS = {
  perProbeTimeoutMs: 2500,
  budgetMs: 4500,
  concurrency: 8,
  cacheTtlMs: 60_000,
};

// Status HTTP che consideriamo prova certa di sorgente morta.
// 401/403 volutamente ESCLUSI: ambigui (auth/geoblocco lato server).
const DEAD_STATUSES = new Set([404, 410, 500, 502, 503, 504, 520, 521, 522, 523, 524]);

// Cache in-memory degli esiti (una richiesta stream in Stremio arriva più volte).
const _probeCache = new Map<string, { verdict: ProbeVerdict; ts: number }>();

function envEnabled(): boolean {
  try {
    const v = String((globalThis as any)?.process?.env?.LIVE_FAILOVER ?? '').toLowerCase();
    return v === '1' || v === 'true' || v === 'on' || v === 'yes';
  } catch {
    return false;
  }
}

/** Voci che NON vanno mai sondate né rimosse (registrazioni, placeholder, no-url). */
function isProtected(s: FailoverCandidate): boolean {
  if (!s || !s.url) return true;
  const url = s.url;
  const title = s.title || '';
  const name = s.name || '';
  if (name === 'DVR') return true;
  if (/🔴\s*REC|\[DVR\]|Recording\.\.\.|Stop & Watch|🗑️\s*DELETE/i.test(title)) return true;
  if (/nostream|Nessuno Stream/i.test(url) || /Nessuno Stream/i.test(title)) return true;
  // Solo http(s) è sondabile; qualsiasi altro schema (magnet, data, ...) lo teniamo.
  if (!/^https?:\/\//i.test(url)) return true;
  return false;
}

/** Estrae gli header di richiesta dalle varie forme usate nel codebase. */
function extractHeaders(s: FailoverCandidate): Record<string, string> {
  const bh = s.behaviorHints || {};
  const out: Record<string, string> = {};
  const merge = (h: any) => {
    if (h && typeof h === 'object') {
      for (const k of Object.keys(h)) {
        const val = h[k];
        if (typeof val === 'string') out[k] = val;
      }
    }
  };
  merge(bh.headers);
  merge(bh.proxyHeaders);
  merge(bh.proxyHeaders?.request);
  return out;
}

function guessKind(url: string): 'm3u8' | 'mpd' | 'other' {
  const u = url.toLowerCase();
  // Considera anche il param ?d= (URL upstream wrappato in MFP/EasyProxy).
  if (/\.m3u8(\?|$)/.test(u) || /manifest\.m3u8|video\.m3u8|[?&]d=[^&]*m3u8/.test(u)) return 'm3u8';
  if (/\.mpd(\?|$)/.test(u) || /[?&]d=[^&]*mpd/.test(u)) return 'mpd';
  return 'other';
}

async function readBounded(res: Response, maxBytes: number): Promise<string> {
  const body: any = (res as any).body;
  // Web ReadableStream (fetch globale di Node)
  if (body && typeof body.getReader === 'function') {
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (total < maxBytes) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          total += value.length;
        }
      }
    } finally {
      try { await reader.cancel(); } catch { /* ignore */ }
    }
    const decoder = new TextDecoder('utf-8');
    let text = '';
    for (const c of chunks) text += decoder.decode(c, { stream: true });
    text += decoder.decode();
    return text.slice(0, maxBytes);
  }
  // Fallback: node-fetch v2 style o body assente
  try {
    const txt = await res.text();
    return txt.slice(0, maxBytes);
  } catch {
    return '';
  }
}

// Un manifest HLS valido (RFC 8216) DEVE avere `#EXTM3U` come primissima riga
// e contenere almeno un tag reale o una riga-URI. Non basta che `#EXTM3U`
// compaia da qualche parte: sorgenti morte spesso restituiscono HTTP 200 con
// corpi tipo "#EXTM3U # Error: No player links found on the page", che sono
// pagine d'errore travestite da playlist e vanno considerate MORTE.
function isValidM3u8(body: string): boolean {
  if (!body) return false;
  const clean = body.replace(/^﻿/, ''); // strip BOM
  const firstLine = (clean.split(/\r?\n/, 1)[0] || '').trim();
  if (firstLine !== '#EXTM3U') return false; // deve essere ESATTAMENTE questo, niente testo in coda
  // Serve almeno un tag HLS reale...
  if (/#EXT-X-(STREAM-INF|TARGETDURATION|MEDIA|VERSION|PLAYLIST-TYPE|KEY|MAP|BYTERANGE|ENDLIST)|#EXTINF/i.test(clean)) {
    return true;
  }
  // ...oppure almeno una riga non-commento (URI di variante/segmento).
  return clean.split(/\r?\n/).some((l) => {
    const t = l.trim();
    return t.length > 0 && !t.startsWith('#');
  });
}

function isValidMpd(body: string): boolean {
  if (!body) return false;
  // Un vero MPD DASH ha il tag <MPD ...> e tipicamente un <Period>.
  if (!/<MPD[\s>]/i.test(body)) return false;
  if (/no player links|not found|<html/i.test(body) && !/<Period[\s>]/i.test(body)) return false;
  return true;
}

async function probeOne(
  s: FailoverCandidate,
  perProbeTimeoutMs: number,
  logger?: (m: string) => void,
): Promise<ProbeVerdict> {
  const url = s.url;
  const cached = _probeCache.get(url);
  const now = Date.now();
  if (cached && now - cached.ts < DEFAULTS.cacheTtlMs) return cached.verdict;

  const kind = guessKind(url);
  const headers = extractHeaders(s);
  if (!('Range' in headers) && !('range' in headers)) headers['Range'] = 'bytes=0-8191';

  const fetchFn: any = (globalThis as any).fetch;
  if (typeof fetchFn !== 'function') return 'unknown'; // niente fetch => non decidiamo

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), perProbeTimeoutMs);
  let verdict: ProbeVerdict = 'unknown';
  try {
    const res: Response = await fetchFn(url, {
      method: 'GET',
      headers,
      redirect: 'follow',
      signal: controller.signal,
    });
    if (DEAD_STATUSES.has(res.status)) {
      verdict = 'dead';
    } else if (res.status >= 400) {
      verdict = 'unknown'; // 401/403/etc: ambiguo, si tiene
    } else if (kind === 'm3u8' || kind === 'mpd') {
      const body = await readBounded(res, 8192);
      const ok = kind === 'm3u8' ? isValidM3u8(body) : isValidMpd(body);
      verdict = ok ? 'alive' : 'dead';
    } else {
      verdict = 'alive'; // media diretto: status buono => vivo, non scarichiamo il body
    }
  } catch (err: any) {
    // abort/timeout/errore rete => non sappiamo, si tiene
    verdict = 'unknown';
    if (logger) logger(`[Failover] probe error ${url}: ${err?.message || err}`);
  } finally {
    clearTimeout(timer);
  }

  _probeCache.set(url, { verdict, ts: now });
  return verdict;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) break;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Sonda le sorgenti live e restituisce la lista con quelle morte rimosse.
 * Preserva l'ordine originale e le voci "protette" (DVR/placeholder).
 */
export async function filterLiveStreams<T extends FailoverCandidate>(
  streams: T[],
  opts: FailoverOptions = {},
): Promise<T[]> {
  const enabled = opts.enabled ?? envEnabled();
  const log = opts.logger;
  if (!enabled || !Array.isArray(streams) || streams.length <= 1) return streams;

  const perProbeTimeoutMs = opts.perProbeTimeoutMs ?? DEFAULTS.perProbeTimeoutMs;
  const budgetMs = opts.budgetMs ?? DEFAULTS.budgetMs;
  const concurrency = opts.concurrency ?? DEFAULTS.concurrency;

  // Indici sondabili vs protetti (questi ultimi non si toccano).
  const probeIdx: number[] = [];
  for (let i = 0; i < streams.length; i++) {
    if (!isProtected(streams[i])) probeIdx.push(i);
  }
  // Serve almeno 2 sorgenti sondabili perché il failover abbia senso:
  // con una sola non abbiamo alternativa e non vogliamo rischiare di toglierla.
  if (probeIdx.length <= 1) return streams;

  // Budget complessivo: se scade, ciò che non ha risposto resta "unknown" (tenuto).
  const budget = new Promise<'timeout'>((resolve) =>
    setTimeout(() => resolve('timeout'), budgetMs),
  );
  const verdictsByIndex = new Map<number, ProbeVerdict>();
  const work = mapWithConcurrency(probeIdx, concurrency, async (idx) => {
    const v = await probeOne(streams[idx], perProbeTimeoutMs, log);
    verdictsByIndex.set(idx, v);
  });

  await Promise.race([work.then(() => 'done' as const), budget]);

  // Costruisci il risultato mantenendo l'ordine.
  let aliveOrUnknownProbeable = 0;
  let dropped = 0;
  const kept: T[] = [];
  for (let i = 0; i < streams.length; i++) {
    const v = verdictsByIndex.get(i);
    if (v === undefined) {
      // protetto oppure non ancora sondato entro il budget => si tiene
      kept.push(streams[i]);
      if (probeIdx.includes(i)) aliveOrUnknownProbeable++;
      continue;
    }
    if (v === 'dead') {
      dropped++;
      continue;
    }
    kept.push(streams[i]);
    aliveOrUnknownProbeable++;
  }

  // Rete di sicurezza: se abbiamo tolto tutte le sorgenti sondabili
  // (nessuna sopravvissuta), meglio restituire la lista originale.
  if (aliveOrUnknownProbeable === 0) {
    if (log) log('[Failover] tutte le sorgenti sondabili risultano morte: restituisco la lista originale');
    return streams;
  }

  if (dropped > 0 && log) {
    log(`[Failover] rimosse ${dropped} sorgenti morte (${streams.length} -> ${kept.length})`);
  }
  return dropped > 0 ? kept : streams;
}

/** Esposto per test / diagnostica. */
export function _clearFailoverCache(): void {
  _probeCache.clear();
}
