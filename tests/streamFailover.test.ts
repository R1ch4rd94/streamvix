// Test per il failover live (roadmap D.9).
// Usa il runner integrato di Node (`node:test`), nessuna dipendenza aggiuntiva.
//   Esecuzione:  pnpm test   (vedi script in package.json)
//
// Le fixture in tests/fixtures/ sono manifest REALI catturati da stream HLS/DASH
// pubblici e stabili (Apple BipBop, Mux, Akamai/DASH-IF), più il payload d'errore
// reale "#EXTM3U # Error: No player links found on the page" osservato da una
// sorgente morta. Servono a tarare il validatore sul traffico vero.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { filterLiveStreams, _clearFailoverCache } from '../src/utils/streamFailover';

const FIX = path.join(__dirname, 'fixtures');
const fixture = (name: string) => fs.readFileSync(path.join(FIX, name), 'utf8');

const REAL_APPLE_MASTER = fixture('real_apple_master.m3u8');
const REAL_MUX_MASTER = fixture('real_mux_master.m3u8');
const REAL_MUX_MEDIA = fixture('real_mux_media.m3u8');
const REAL_AKAMAI_MPD = fixture('real_akamai.mpd');
const FAKE_ERROR = fixture('fake_error.m3u8');

// Mappa "marker nell'URL" -> { status, body }. Copre i vari esiti reali.
function mockFetch(routes: Record<string, { status: number; body: string }>) {
  return async (url: string) => {
    for (const key of Object.keys(routes)) {
      if (url.includes(key)) {
        const r = routes[key];
        return { status: r.status, body: null, text: async () => r.body } as any;
      }
    }
    throw new Error('unexpected url ' + url);
  };
}

const opts = { enabled: true, perProbeTimeoutMs: 800, budgetMs: 3000, logger: () => {} };

test('manifest reali (Apple/Mux/Akamai) vengono giudicati VIVI', async () => {
  _clearFailoverCache();
  (globalThis as any).fetch = mockFetch({
    apple_master: { status: 200, body: REAL_APPLE_MASTER },
    mux_master: { status: 200, body: REAL_MUX_MASTER },
    mux_media: { status: 200, body: REAL_MUX_MEDIA },
    akamai: { status: 200, body: REAL_AKAMAI_MPD },
    fakeerr: { status: 200, body: FAKE_ERROR },
  });
  const r = await filterLiveStreams(
    [
      { title: '[apple]', url: 'http://x/apple_master.m3u8' },
      { title: '[mux-master]', url: 'http://x/mux_master.m3u8' },
      { title: '[mux-media]', url: 'http://x/mux_media.m3u8' },
      { title: '[akamai]', url: 'http://x/akamai.mpd' },
      { title: '[fakeerr]', url: 'http://x/fakeerr.m3u8' },
    ],
    opts,
  );
  const kept = r.map((s) => s.title);
  // I 4 manifest reali restano, il payload d'errore reale viene scartato.
  assert.deepEqual(kept, ['[apple]', '[mux-master]', '[mux-media]', '[akamai]']);
});

test('payload d\'errore reale "#EXTM3U # Error..." viene scartato', async () => {
  _clearFailoverCache();
  (globalThis as any).fetch = mockFetch({
    fakeerr: { status: 200, body: FAKE_ERROR },
    apple: { status: 200, body: REAL_APPLE_MASTER },
  });
  const r = await filterLiveStreams(
    [
      { title: '[fakeerr]', url: 'http://x/fakeerr.m3u8' },
      { title: '[apple]', url: 'http://x/apple_master.m3u8' },
    ],
    opts,
  );
  assert.equal(r.length, 1);
  assert.equal(r[0].title, '[apple]');
});

test('404/410/5xx scartati, 403 e timeout tenuti', async () => {
  _clearFailoverCache();
  (globalThis as any).fetch = async (url: string) => {
    if (url.includes('boom')) throw new Error('ECONNRESET');
    if (url.includes('dead404')) return { status: 404, body: null, text: async () => '' } as any;
    if (url.includes('gone410')) return { status: 410, body: null, text: async () => '' } as any;
    if (url.includes('err503')) return { status: 503, body: null, text: async () => '' } as any;
    if (url.includes('geo403')) return { status: 403, body: null, text: async () => '' } as any;
    return { status: 200, body: null, text: async () => REAL_MUX_MEDIA } as any;
  };
  const r = await filterLiveStreams(
    [
      { title: '[ok]', url: 'http://x/ok.m3u8' },
      { title: '[404]', url: 'http://x/dead404.m3u8' },
      { title: '[410]', url: 'http://x/gone410.m3u8' },
      { title: '[503]', url: 'http://x/err503.m3u8' },
      { title: '[403]', url: 'http://x/geo403.m3u8' },
      { title: '[boom]', url: 'http://x/boom.m3u8' },
    ],
    opts,
  );
  const kept = r.map((s) => s.title);
  assert.deepEqual(kept, ['[ok]', '[403]', '[boom]']); // 403 e network-error sopravvivono
});

test('voci DVR/placeholder mai sondate né rimosse', async () => {
  _clearFailoverCache();
  (globalThis as any).fetch = async (url: string) =>
    url.includes('dead404')
      ? ({ status: 404, body: null, text: async () => '' } as any)
      : ({ status: 200, body: null, text: async () => REAL_MUX_MEDIA } as any);
  const r = await filterLiveStreams(
    [
      { name: 'DVR', title: '🔴 REC (4h) X', url: 'http://x/dead404' },
      { title: 'Nessuno Stream', url: 'http://x/nostream' },
      { title: '[dead]', url: 'http://x/dead404.m3u8' },
      { title: '[alive]', url: 'http://x/alive.m3u8' },
    ],
    opts,
  );
  const kept = r.map((s) => s.title);
  assert.deepEqual(kept, ['🔴 REC (4h) X', 'Nessuno Stream', '[alive]']);
});

test('safety net: se tutte le sorgenti sondabili sono morte, ritorna la lista originale', async () => {
  _clearFailoverCache();
  (globalThis as any).fetch = async () => ({ status: 404, body: null, text: async () => '' } as any);
  const input = [
    { title: '[a]', url: 'http://x/dead404a.m3u8' },
    { title: '[b]', url: 'http://x/dead404b.m3u8' },
  ];
  const r = await filterLiveStreams(input, opts);
  assert.equal(r.length, 2); // non svuota mai
});

test('disabilitato (default) = passthrough, nessun probing', async () => {
  let called = false;
  (globalThis as any).fetch = async () => {
    called = true;
    return { status: 404, body: null, text: async () => '' } as any;
  };
  const r = await filterLiveStreams(
    [
      { title: '[a]', url: 'http://x/dead404a.m3u8' },
      { title: '[b]', url: 'http://x/dead404b.m3u8' },
    ],
    { enabled: false },
  );
  assert.equal(r.length, 2);
  assert.equal(called, false);
});
