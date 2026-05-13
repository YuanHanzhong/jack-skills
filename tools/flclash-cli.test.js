import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  chooseByIndexOrName,
  detectWesternCountry,
  filterNodes,
  formatDelay,
  hasAllKimiRules,
  isWesternNode,
  kimiRulesHealth,
  nodesForGroup,
  patchKimiRulesInProfile,
  parseArgs,
  sanitizeConfigSummary,
  validateRuleIndent,
} from './flclash-cli.js';

describe('flclash-cli helpers', () => {
  test('parses command options', () => {
    const parsed = parseArgs([
      'delay',
      '1',
      '--all',
      '--controller',
      'http://127.0.0.1:9091',
      '--timeout=3000',
      '--url',
      'https://example.com/204',
    ]);

    expect(parsed.command).toBe('delay');
    expect(parsed.args).toEqual(['1']);
    expect(parsed.options.all).toBe(true);
    expect(parsed.options.controller).toBe('http://127.0.0.1:9091');
    expect(parsed.options.timeout).toBe(3000);
    expect(parsed.options.url).toBe('https://example.com/204');
  });

  test('selects groups and nodes by one-based index or exact name', () => {
    const groups = [
      { name: 'GLOBAL' },
      { name: 'Proxy' },
    ];

    expect(chooseByIndexOrName(groups, '2', 'group')).toEqual({ name: 'Proxy' });
    expect(chooseByIndexOrName(groups, 'GLOBAL', 'group')).toEqual({ name: 'GLOBAL' });
    expect(() => chooseByIndexOrName(groups, '3', 'group')).toThrow('Unknown group');
  });

  test('marks current node as selected', () => {
    const nodes = nodesForGroup({
      now: 'b',
      all: ['a', 'b', 'c'],
    });

    expect(nodes).toEqual([
      { index: 1, name: 'a', country: '', selected: false },
      { index: 2, name: 'b', country: '', selected: true },
      { index: 3, name: 'c', country: '', selected: false },
    ]);
  });

  test('filters nodes to Europe and North America by default', () => {
    const nodes = [
      { index: 1, name: '🇺🇸 美国 01' },
      { index: 2, name: '🇭🇰 香港 01' },
      { index: 3, name: '🇩🇪 德国 01' },
      { index: 4, name: '🇯🇵 日本 01' },
    ];

    expect(isWesternNode('🇺🇸 美国 01')).toBe(true);
    expect(isWesternNode('🇭🇰 香港 01')).toBe(false);
    expect(detectWesternCountry('🇩🇪 德国 01')).toBe('德国');
    expect(filterNodes(nodes, {}).map((node) => node.name)).toEqual(['🇺🇸 美国 01', '🇩🇪 德国 01']);
    expect(filterNodes(nodes, { allRegions: true }).map((node) => node.name)).toEqual([
      '🇺🇸 美国 01',
      '🇭🇰 香港 01',
      '🇩🇪 德国 01',
      '🇯🇵 日本 01',
    ]);
  });

  test('formats delay with Chinese brackets', () => {
    expect(formatDelay(123)).toBe('【123ms】');
    expect(formatDelay(-1)).toBe('【超时】');
  });

  test('sanitizes current config to counts and public settings', () => {
    expect(sanitizeConfigSummary({
      'mixed-port': 7890,
      mode: 'rule',
      'external-controller': '127.0.0.1:9090',
      'allow-lan': false,
      proxies: [{ password: 'secret' }],
      'proxy-groups': [{ name: 'Proxy' }],
    })).toEqual({
      mixedPort: 7890,
      mode: 'rule',
      externalController: '127.0.0.1:9090',
      allowLan: false,
      proxyCount: 1,
      groupCount: 1,
    });
  });

  test('patches Kimi direct rules before MATCH without duplicating existing rules', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flclash-profile-'));
    const profilePath = path.join(dir, 'airport.yaml');
    fs.writeFileSync(profilePath, [
      'rules:',
      "    - 'DOMAIN-SUFFIX,cn,DIRECT'",
      "    - 'GEOIP,CN,DIRECT'",
      "    - 'MATCH,快雷GO'",
      '',
    ].join('\n'));

    const first = patchKimiRulesInProfile(profilePath);
    const content = fs.readFileSync(profilePath, 'utf8');
    const second = patchKimiRulesInProfile(profilePath);

    expect(first.status).toBe('patched');
    expect(first.changed).toBe(true);
    expect(hasAllKimiRules(content)).toBe(true);
    expect(content.indexOf('DOMAIN,api.kimi.com,DIRECT')).toBeLessThan(content.indexOf('MATCH,快雷GO'));
    expect(second.status).toBe('ok');
    expect(second.changed).toBe(false);
  });

  test('rejects mismatched rule indentation', () => {
    const validation = validateRuleIndent([
      'rules:',
      "    - 'DOMAIN-SUFFIX,cn,DIRECT'",
      "  - 'DOMAIN,api.kimi.com,DIRECT'",
    ]);

    expect(validation.ok).toBe(false);
  });

  test('repairs existing Kimi rules when indentation is malformed', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flclash-profile-'));
    const profilePath = path.join(dir, 'airport.yaml');
    fs.writeFileSync(profilePath, [
      'rules:',
      "    - 'DOMAIN-SUFFIX,cn,DIRECT'",
      "  - 'DOMAIN,api.kimi.com,DIRECT'",
      "  - 'DOMAIN-SUFFIX,kimi.com,DIRECT'",
      "  - 'DOMAIN-SUFFIX,moonshot.cn,DIRECT'",
      "  - 'DOMAIN-SUFFIX,api.moonshot.cn,DIRECT'",
      "  - 'DOMAIN-SUFFIX,statics.moonshot.cn,DIRECT'",
      "  - 'DOMAIN,platform.kimi.com,DIRECT'",
      "  - 'DOMAIN,www.kimi.com,DIRECT'",
      "  - 'DOMAIN,www.moonshot.cn,DIRECT'",
      "  - 'DOMAIN-SUFFIX,kimi.moonshot.cn,DIRECT'",
      "    - 'MATCH,飞鸟云'",
      '',
    ].join('\n'));

    expect(kimiRulesHealth(fs.readFileSync(profilePath, 'utf8')).ok).toBe(false);

    const result = patchKimiRulesInProfile(profilePath);
    const content = fs.readFileSync(profilePath, 'utf8');

    expect(result.status).toBe('patched');
    expect(kimiRulesHealth(content).ok).toBe(true);
  });
});
