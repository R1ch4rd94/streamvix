import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDlhdPlayerLinks, parseDlhdIframeLinks } from '../src/extractors/dlhdPage';

test('player buttons: current markup, legacy, relative links, duplicates and unrelated controls', () => {
  const html = `
    <button data-url='/stream/stream-870.php' title='PLAYER 1'
      class='btn player-btn is-active'><span>1</span></button>
    <button title="PLAYER 2" data-url="//thedaddy.pk/cast/stream-870.php">2</button>
    <button data-url="/watch/stream-870.php">Player 3</button>
    <button class="player-btn" data-url="/stream/stream-870.php">Duplicate</button>
    <button data-url="/advertisement">Open ad</button>
    <button class="player-btn" data-url="javascript:alert(1)">Invalid</button>`;
  assert.deepEqual(parseDlhdPlayerLinks(html, 'https://thedaddy.pk/watch.php?id=870'), [
    'https://thedaddy.pk/stream/stream-870.php',
    'https://thedaddy.pk/cast/stream-870.php',
    'https://thedaddy.pk/watch/stream-870.php',
  ]);
});

test('iframe attributes may vary; relative URLs resolve against redirected page', () => {
  assert.deepEqual(parseDlhdIframeLinks(`<iframe allowfullscreen
    src='/embed?id=870&amp;lang=it'></iframe><iframe src='about:blank'></iframe>`,
  'https://thedaddy.pk/stream/stream-870.php'), [
    'https://thedaddy.pk/embed?id=870&lang=it',
  ]);
});

test('unexpected JSON and error pages do not become player links', () => {
  assert.deepEqual(parseDlhdPlayerLinks({ error: 'unavailable' }, 'https://thedaddy.pk/'), []);
  assert.deepEqual(parseDlhdIframeLinks(null, 'https://thedaddy.pk/'), []);
  assert.deepEqual(parseDlhdPlayerLinks('<html>Unavailable</html>', 'https://thedaddy.pk/'), []);
});
