import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, isLocalAddress, normalizeConfig, parseServerUrl } from '../src/config.js';

test('the address: a bare host gets port 9981, browser pages are dropped', () => {
  assert.equal(parseServerUrl('192.0.2.4'), 'http://192.0.2.4:9981');
  assert.equal(parseServerUrl('192.0.2.4:9982'), 'http://192.0.2.4:9982');
  assert.equal(parseServerUrl('http://tvh.lan:9981/extjs.html'), 'http://tvh.lan:9981');
  assert.equal(parseServerUrl('https://tv.example.org/tvh/'), 'https://tv.example.org/tvh');
  assert.equal(parseServerUrl('http://192.0.2.4:9981/api/serverinfo'), 'http://192.0.2.4:9981');
  assert.equal(parseServerUrl('https://tv.example.org'), 'https://tv.example.org');
  assert.equal(parseServerUrl('https://example.org/tv'), 'https://example.org/tv', 'a proxy path');
  assert.equal(parseServerUrl('http://user:pass@192.0.2.4'), null, 'credentials have fields');
  assert.equal(parseServerUrl('ftp://192.0.2.4'), null);
  assert.equal(parseServerUrl('  '), null);
});

test('normalization: defaults, trimmed user name, password kept as typed', () => {
  assert.deepEqual(normalizeConfig({}), {
    url: '',
    username: '',
    password: '',
    pollIntervalMs: 30_000,
    language: DEFAULT_CONFIG.language,
  });
  const config = normalizeConfig({
    url: 'nope://',
    username: ' gladys ',
    password: ' p ',
    poll_interval: '15',
    language: 'de',
  });
  assert.equal(config.url, null);
  assert.equal(config.username, 'gladys');
  assert.equal(config.password, ' p ');
  assert.equal(config.pollIntervalMs, 15_000);
  assert.equal(normalizeConfig({ poll_interval: '5' }).pollIntervalMs, 30_000);
});

test('local or cloud badge from the address', () => {
  assert.equal(isLocalAddress('http://192.168.1.2:9981'), true);
  assert.equal(isLocalAddress('http://tvheadend:9981'), true);
  assert.equal(isLocalAddress('https://tv.example.org'), false);
});
