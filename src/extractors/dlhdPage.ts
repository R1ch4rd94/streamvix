import { load } from 'cheerio';

function httpUrl(value: string | undefined, baseUrl: string): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim(), baseUrl);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

/** Parse public player navigation without depending on attribute order or casing. */
export function parseDlhdPlayerLinks(html: unknown, pageUrl: string): string[] {
  if (typeof html !== 'string') return [];
  const $ = load(html);
  const links = new Set<string>();
  $('button[data-url]').each((_, element) => {
    const button = $(element);
    const label = button.attr('title') || button.text();
    if (!button.hasClass('player-btn') && !/^\s*player\s*\d+\s*$/i.test(label)) return;
    const url = httpUrl(button.attr('data-url'), pageUrl);
    if (url) links.add(url);
  });
  return [...links];
}

export function parseDlhdIframeLinks(html: unknown, pageUrl: string): string[] {
  if (typeof html !== 'string') return [];
  const $ = load(html);
  const links = new Set<string>();
  $('iframe[src]').each((_, element) => {
    const url = httpUrl($(element).attr('src'), pageUrl);
    if (url) links.add(url);
  });
  return [...links];
}
