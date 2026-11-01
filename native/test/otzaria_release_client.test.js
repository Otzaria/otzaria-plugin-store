import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {OtzariaReleaseClient, otzariaVersionOf, pickTargetVersions}
    from '../web/js/store/otzaria_release_client.js';
import {Status, StoreController} from '../web/js/controller.js';

const release = (tag, flags = {}) =>
    ({tag_name: tag, prerelease: false, draft: false, ...flags});

describe('otzariaVersionOf', () => {
  it('מפרש תגים קיימים ומסיר רק את מספר הבנייה', () => {
    assert.equal(otzariaVersionOf('0.9.96+736'), '0.9.96');
    assert.equal(otzariaVersionOf('v0.2.7'), '0.2.7');
    assert.equal(otzariaVersionOf('1.0.0.2+807'), '1.0.0.2');
  });

  it('פוסל תגים שאינם גרסאות הפצה', () => {
    for (const tag of ['0.9.53-pr-715-146', 'v0.2.7-dev-110',
      'latest', '', null, undefined]) {
      assert.equal(otzariaVersionOf(tag), null);
    }
  });
});

describe('Latest target', () => {
  it('מפיק יעד אחד ללא שדות ערוצים וללא תלות בשם או בענף', () => {
    assert.deepEqual(pickTargetVersions({
      ...release('1.0.0+807'),
      name: 'Otzaria 1.0.0 (Preview from feature/example)',
      target_commitish: 'feature/example',
    }), {versions: ['1.0.0'], latest: '1.0.0'});
  });

  it('רשימת ריליסים רגילים אינה מאפשרת לבחור את הגבוה', () => {
    assert.throws(() => pickTargetVersions([
      release('9.0.0'), release('1.0.0'),
    ]), /Latest/);
  });

  it('דוחה טיוטה, prerelease ותשובות לא תקינות', () => {
    for (const value of [null, 7, [], {}, release('nightly'),
      release('1.0.0', {draft: true}),
      release('1.0.0', {prerelease: true})]) {
      assert.throws(() => pickTargetVersions(value), /Latest/);
    }
  });

  it('מבקש רק את Latest ולא ריליס חדש יותר שאינו Latest', async () => {
    const requests = [];
    const client = new OtzariaReleaseClient({
      timeoutMs: 1234,
      net: {get: async (url, timeout) => {
        requests.push([url, timeout]);
        return {status: 200, body: JSON.stringify(url.endsWith('/latest')
          ? release('1.0.0.2+807') : [release('9.0.0')])};
      }},
    });
    assert.deepEqual(await client.fetchTargetVersions(),
      {versions: ['1.0.0.2'], latest: '1.0.0.2'});
    assert.deepEqual(requests, [[
      'https://api.github.com/repos/Otzaria/otzaria/releases/latest', 1234,
    ]]);
  });

  it('אין נסיגה לרשימת ריליסים כש-Latest לא זמין', async () => {
    for (const status of [404, 403, 500]) {
      let calls = 0;
      const client = new OtzariaReleaseClient({net: {get: async () => {
        calls++;
        return {status, body: '[]'};
      }}});
      await assert.rejects(client.fetchTargetVersions(), /GitHub/);
      assert.equal(calls, 1);
    }
  });
});

describe('Latest lookup failure', () => {
  it('עוצר סנכרון בלי להוריד בילדים לא מסוננים', async () => {
    let syncCalls = 0;
    const controller = new StoreController({
      manager: {sync: async () => { syncCalls++; }},
      probe: {},
      releaseClient: {fetchTargetVersions: async () => {
        throw new Error('Latest unavailable');
      }},
    });
    await controller.sync();
    assert.equal(syncCalls, 0);
    assert.equal(controller.status, Status.error);
    assert.equal(controller.errorMessage, 'Latest unavailable');
  });

  it('כשל אינו נשמר במטמון; בדיקה חוזרת משתמשת רק ביעד המאושר', async () => {
    let attempts = 0;
    const targets = [];
    const controller = new StoreController({
      manager: {peekOnlineUpdates: async ({appVersions}) => {
        targets.push(appVersions);
        return {hasUpdate: false};
      }},
      probe: {},
      releaseClient: {fetchTargetVersions: async () => {
        if (++attempts === 1) throw new Error('Latest unavailable');
        return pickTargetVersions(release('1.0.0'));
      }},
    });
    await controller.checkOnline();
    assert.equal(controller.onlineCheckError, 'Latest unavailable');
    assert.deepEqual(targets, []);
    await controller.checkOnline();
    assert.equal(controller.onlineCheckError, null);
    assert.deepEqual(targets, [['1.0.0']]);
  });
});
