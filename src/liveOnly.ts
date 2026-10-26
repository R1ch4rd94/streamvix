/// <reference path="./stremio-addon-sdk.d.ts" />
import { Manifest } from 'stremio-addon-sdk';

export const LIVE_ONLY_DEFAULTS = {
  mediaflowMaster: true, useMediaFlow: false, disableLiveTv: false,
  disableVixsrc: true, vixDirect: false, vixDirectFhd: false, vixProxy: false,
  trailerEnabled: false, dvrEnabled: false, vavooNoMfpEnabled: true,
  cb01Enabled: false, guardahdEnabled: false, guardaserieEnabled: false,
  guardoserieEnabled: false, guardaflixEnabled: false, adnEnabled: false,
  vidxgoEnabled: false, cinemacityEnabled: false, eurostreamingEnabled: false,
  toonitaliaEnabled: false, toonEnabled: false, animeunityEnabled: false,
  animeunityDirect: false, animeunityDirectFhd: false, animeunityProxy: false,
  animesaturnEnabled: false, animeworldEnabled: false, fastMode: false,
};

export function liveOnlyConfig<T extends Record<string, unknown>>(config: T = {} as T) {
  return { ...config, ...LIVE_ONLY_DEFAULTS };
}

export function liveOnlyManifest(manifest: Manifest): Manifest {
  const ids = new Set(['streamvix_live', 'streamvix_eventi', 'streamvix_live_search', 'streamvix_eventi_search']);
  return {
    ...manifest,
    name: 'StreamViX Live',
    description: 'Eventi sportivi e sorgenti live. Configura EasyProxy e installa in Stremio.',
    types: ['tv'], idPrefixes: ['tv'],
    resources: [
      { name: 'stream', types: ['tv'] },
      { name: 'catalog', types: ['tv'] },
      { name: 'meta', types: ['tv'] },
    ],
    catalogs: (manifest.catalogs || []).filter(c => ids.has(c.id)).map(c => ({
      ...c,
      extra: c.extra?.map((e: { name: string; isRequired?: boolean }) => e.name === 'genre' ? { ...e, isRequired: false } : e),
    })),
    config: (manifest.config || []).filter(c => ['mediaFlowProxyUrl', 'mediaFlowProxyPassword'].includes(c.key)),
  };
}
