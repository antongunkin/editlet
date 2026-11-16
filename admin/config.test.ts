import { describe, expect, it } from 'vitest';

import {
  buildAdminConfig,
  DEFAULT_SESSION_MINUTES,
  parseAdminConfig,
  resolveParam,
  type AdminConfigOptions,
} from './config';

const ctx = { baseBranch: 'main', env: {} };

describe('buildAdminConfig', () => {
  it('carries preview: true', () => {
    expect(buildAdminConfig({ repo: 'acme/site', preview: true }, ctx).preview).toBe(true);
    expect(buildAdminConfig({ repo: 'acme/site', preview: false }, ctx)).not.toHaveProperty('preview');
  });

  it('rejects a non-boolean preview', () => {
    expect(() => buildAdminConfig({ preview: 'yes' } as unknown as AdminConfigOptions, ctx)).toThrow(/admin\.preview/);
  });

  it('builds github from the repo option', () => {
    expect(buildAdminConfig({ repo: 'acme/site' }, ctx)).toEqual({
      github: { owner: 'acme', repo: 'site', baseBranch: 'main' },
    });
  });

  it('falls back to the Vercel env, then GITHUB_REPOSITORY', () => {
    const vercel = { VERCEL_GIT_REPO_OWNER: 'v', VERCEL_GIT_REPO_SLUG: 'vsite', GITHUB_REPOSITORY: 'g/gsite' };
    expect(buildAdminConfig(undefined, { baseBranch: 'main', env: vercel }).github).toEqual({
      owner: 'v',
      repo: 'vsite',
      baseBranch: 'main',
    });
    expect(
      buildAdminConfig(undefined, { baseBranch: 'main', env: { GITHUB_REPOSITORY: 'g/gsite' } }).github?.owner,
    ).toBe('g');
  });

  it('prefers the option over the env and ignores an invalid env value', () => {
    expect(
      buildAdminConfig({ repo: 'a/b' }, { baseBranch: 'main', env: { GITHUB_REPOSITORY: 'c/d' } }).github?.owner,
    ).toBe('a');
    expect(buildAdminConfig(undefined, { baseBranch: 'main', env: { GITHUB_REPOSITORY: 'nope' } })).toEqual({});
  });

  it('omits github without a base branch', () => {
    expect(buildAdminConfig({ repo: 'acme/site' }, { baseBranch: null, env: {} })).toEqual({});
  });

  it('rejects bad options', () => {
    expect(() => buildAdminConfig({ repo: 'nope' }, ctx)).toThrow(TypeError);
    expect(() => buildAdminConfig({ authUrl: 'http://example.com/x' }, ctx)).toThrow(TypeError);
    expect(() => buildAdminConfig({ authUrl: '//evil.com' }, ctx)).toThrow(TypeError);
  });

  it('accepts a valid authUrl', () => {
    expect(buildAdminConfig({ authUrl: '/api/editlet/oauth' }, ctx).authUrl).toBe('/api/editlet/oauth');
    expect(buildAdminConfig({ authUrl: 'http://localhost:8787' }, ctx).authUrl).toBe('http://localhost:8787');
    expect(buildAdminConfig({ authUrl: 'https://auth.example.com' }, ctx).authUrl).toBe('https://auth.example.com');
  });

  it('ignores the removed deployHookUrl option (the admin never merges)', () => {
    const old = { repo: 'acme/site', deployHookUrl: 'https://api.vercel.com/hook' } as AdminConfigOptions;
    expect(buildAdminConfig(old, ctx)).toEqual({ github: { owner: 'acme', repo: 'site', baseBranch: 'main' } });
  });

  it('sessionMinutes: the option, else CMS_SESSION_MINUTES, else omitted (the admin uses 60)', () => {
    expect(buildAdminConfig({ sessionMinutes: 30 }, ctx).sessionMinutes).toBe(30);
    expect(buildAdminConfig(undefined, { ...ctx, env: { CMS_SESSION_MINUTES: '15' } }).sessionMinutes).toBe(15);
    expect(
      buildAdminConfig({ sessionMinutes: 1440 }, { ...ctx, env: { CMS_SESSION_MINUTES: '15' } }).sessionMinutes,
    ).toBe(1440);
    expect(buildAdminConfig(undefined, ctx)).toEqual({});
    expect(DEFAULT_SESSION_MINUTES).toBe(60);
  });

  it('sessionMinutes: an invalid option throws, an invalid env value is ignored', () => {
    for (const bad of [0, -5, 1.5, 1441, Number.NaN]) {
      expect(() => buildAdminConfig({ sessionMinutes: bad }, ctx)).toThrow(/admin\.sessionMinutes/);
    }
    for (const bad of ['0', 'abc', '1.5', '2000', '']) {
      expect(buildAdminConfig(undefined, { ...ctx, env: { CMS_SESSION_MINUTES: bad } }).sessionMinutes).toBeUndefined();
    }
  });
});

describe('resolveParam', () => {
  it('the option, else a valid EDITLET_PARAM, else editlet', () => {
    expect(resolveParam(undefined, {})).toBe('editlet');
    expect(resolveParam(undefined, { EDITLET_PARAM: ' cms ' })).toBe('cms');
    expect(resolveParam({ param: 'edit_me' }, { EDITLET_PARAM: 'cms' })).toBe('edit_me');
    expect(resolveParam(undefined, { EDITLET_PARAM: '1cms' })).toBe('editlet');
    expect(resolveParam(undefined, { EDITLET_PARAM: 'a=b' })).toBe('editlet');
  });

  it('throws for an invalid option', () => {
    expect(() => resolveParam({ param: '' }, {})).toThrow(/admin\.param/);
    expect(() => resolveParam({ param: 'a b' }, {})).toThrow(TypeError);
  });

  it('config.json carries a param other than editlet', () => {
    expect(buildAdminConfig(undefined, { baseBranch: 'main', env: { EDITLET_PARAM: 'cms' } }).param).toBe('cms');
    expect(buildAdminConfig({ param: 'editlet' }, ctx)).not.toHaveProperty('param');
  });
});

describe('parseAdminConfig', () => {
  it('keeps a valid param and drops an invalid or default one', () => {
    expect(parseAdminConfig({ param: 'cms' })).toEqual({ param: 'cms' });
    expect(parseAdminConfig({ param: 'a&b' })).toEqual({});
    expect(parseAdminConfig({ param: 'editlet' })).toEqual({});
  });

  it('returns null for non-objects', () => {
    expect(parseAdminConfig('x')).toBeNull();
    expect(parseAdminConfig(null)).toBeNull();
    expect(parseAdminConfig([])).toBeNull();
  });

  it('drops invalid members', () => {
    expect(parseAdminConfig({ github: { owner: 'a' } })).toEqual({});
    expect(parseAdminConfig({ authUrl: '//evil.com' })).toEqual({});
    expect(parseAdminConfig({ sessionMinutes: 0 })).toEqual({});
    expect(parseAdminConfig({ sessionMinutes: '30' })).toEqual({});
    expect(parseAdminConfig({ sessionMinutes: 2.5 })).toEqual({});
  });

  it('keeps valid members', () => {
    const value = {
      github: { owner: 'acme', repo: 'site', baseBranch: 'main' },
      authUrl: '/api/editlet/oauth',
      sessionMinutes: 90,
    };
    expect(parseAdminConfig({ ...value, extra: 1 })).toEqual(value);
  });

  it('an old config.json with deployHookUrl still parses; the field is ignored', () => {
    const old = {
      github: { owner: 'acme', repo: 'site', baseBranch: 'main' },
      deployHookUrl: 'https://h.example.com/x',
    };
    expect(parseAdminConfig(old)).toEqual({ github: old.github });
  });

  it('keeps preview: true and drops a non-boolean preview', () => {
    expect(parseAdminConfig({ preview: true })).toEqual({ preview: true });
    expect(parseAdminConfig({ preview: 'true' })).toEqual({});
    expect(parseAdminConfig({ preview: false })).toEqual({});
  });
});
