/// <reference path="../src/stremio-addon-sdk.d.ts" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liveOnlyConfig, liveOnlyManifest } from '../src/liveOnly';
import { Manifest } from 'stremio-addon-sdk';

test('old installation settings cannot enable VOD or DVR; proxy credentials remain exact', () => {
  const config = liveOnlyConfig({ animeworldEnabled: true, disableLiveTv: true,
    dvrEnabled: true, mediaFlowProxyUrl: 'https://proxy.example', mediaFlowProxyPassword: 'a&dè' });
  assert.equal(config.animeworldEnabled, false);
  assert.equal(config.disableLiveTv, false);
  assert.equal(config.dvrEnabled, false);
  assert.equal(config.mediaFlowProxyPassword, 'a&dè');
});

test('only live catalogs and proxy fields are advertised; event genre is optional', () => {
  const manifest = liveOnlyManifest({ id: 'test', version: '1.0.0', name: 'test',
    types: ['movie', 'tv'], resources: ['stream'],
    catalogs: ['streamvix_tv', 'streamvix_live', 'streamvix_eventi', 'streamvix_dvr'].map(id => ({
      id, name: id, type: 'tv', extra: [{ name: 'genre', isRequired: true }],
    })),
    config: [{key:'tmdbApiKey',type:'text',title:'TMDB'}, {key:'mediaFlowProxyUrl',type:'text',title:'Proxy'},
      {key:'mediaFlowProxyPassword',type:'text',title:'Password'}],
  } as Manifest);
  assert.deepEqual(manifest.types, ['tv']);
  assert.deepEqual(manifest.catalogs?.map(c => c.id), ['streamvix_live', 'streamvix_eventi']);
  assert.equal(manifest.catalogs?.[1].extra?.[0].isRequired, false);
  assert.deepEqual(manifest.config?.map(c => c.key), ['mediaFlowProxyUrl', 'mediaFlowProxyPassword']);
});
