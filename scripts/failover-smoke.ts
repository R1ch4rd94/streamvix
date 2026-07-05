// Smoke test del failover live (D.9) contro la RETE VERA — nessun mock.
// Manda una lista realistica di sorgenti (stream pubblici vivi + link morti
// reali + un errore DNS + una voce DVR) dentro filterLiveStreams e stampa
// cosa viene tenuto e cosa scartato.
//
// Eseguibile con:  pnpm failover:smoke
//
// Nota: usa stream HLS/DASH pubblici e stabili come sorgenti "vive" (Mux,
// Apple, Akamai). Non tocca le sorgenti dell'addon (che sono attive solo
// durante gli eventi). Serve a vedere la logica del failover funzionare su
// HTTP reale, on-demand.

import { filterLiveStreams } from '../src/utils/streamFailover';

const input = [
  { title: '[Mux master — VIVO]', url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8' },
  { title: '[Apple master — VIVO]', url: 'https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_ts/master.m3u8' },
  { title: '[Akamai MPD — VIVO]', url: 'https://dash.akamaized.net/akamai/bbb_30fps/bbb_30fps.mpd' },
  { title: '[404 — MORTO]', url: 'https://test-streams.mux.dev/x36xhzz/inesistente_deadlink_streamvix.m3u8' },
  { title: '[DNS fail — tenuto (errore nostro)]', url: 'https://host-inesistente.streamvix-test.invalid/live.m3u8' },
  { name: 'DVR', title: '🔴 REC (4h) partita', url: 'https://example/rec' },
];

async function main() {
  console.log('== Smoke test failover D.9 (rete reale) ==\n');
  console.log('INPUT:');
  input.forEach((s) => console.log('  -', s.title));

  const t0 = Date.now();
  const out = await filterLiveStreams(input, {
    enabled: true, // forza attivo indipendentemente da LIVE_FAILOVER
    logger: (m) => console.log('   ·', m),
  });
  const ms = Date.now() - t0;

  const keptTitles = out.map((s) => s.title);
  const dropped = input.filter((s) => !out.includes(s)).map((s) => s.title);

  console.log(`\nRISULTATO (${ms}ms):`);
  console.log('  TENUTI  :');
  keptTitles.forEach((t) => console.log('    ✓', t));
  console.log('  SCARTATI:');
  if (dropped.length) dropped.forEach((t) => console.log('    ✗', t));
  else console.log('    (nessuno)');

  // Atteso: i 3 stream reali + DNS-fail + DVR restano; solo il 404 sparisce.
  const ok = dropped.length === 1 && dropped[0].includes('404');
  console.log(`\n${ok ? '✅ Comportamento atteso: solo il 404 scartato.' : '⚠️  Risultato inatteso — controlla i log sopra.'}`);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error('Errore smoke test:', e);
  process.exit(1);
});
