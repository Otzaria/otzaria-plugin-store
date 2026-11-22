import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {crc32} from 'node:zlib';

import {InstalledPluginsScanner} from '../web/js/store/installed_scanner.js';
import {PluginsManager} from '../web/js/store/plugins_manager.js';
import {readHiveStrings} from '../web/js/util/hive_strings.js';

const APP_DATA = 'C:\\Users\\u\\AppData\\Roaming';
const ROOT = `${APP_DATA}\\otzaria`;
const INSTALLED = `${ROOT}\\plugins\\installed`;
const PREFERENCES = `${ROOT}\\app_preferences.hive`;
const DEFAULT_DB = `${ROOT}\\databases\\plugins_host.db`;

/**
 * קובץ Hive כמו ש-`hive_ce` כותב: `[אורך][מפתח מחרוזת][ערך][crc32]`. ערך
 * `null` הוא frame מחיקה.
 */
function hiveFile(entries) {
  const frames = entries.map(([key, value]) => {
    const keyBytes = Buffer.from(key, 'utf8');
    const head = Buffer.from([1, keyBytes.length]);
    let valueBytes = Buffer.alloc(0);
    if (value !== null) {
      const text = Buffer.from(value, 'utf8');
      valueBytes = Buffer.alloc(5 + text.length);
      valueBytes[0] = 4;
      valueBytes.writeUInt32LE(text.length, 1);
      text.copy(valueBytes, 5);
    }
    const length = 4 + head.length + keyBytes.length + valueBytes.length + 4;
    const size = Buffer.alloc(4);
    size.writeUInt32LE(length);
    const body = Buffer.concat([size, head, keyBytes, valueBytes]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32LE(crc32(body));
    return Buffer.concat([body, crc]);
  });
  return Buffer.concat(frames).toString('latin1');
}

// "וורד לאוצריא" הוסר באוצריא, אבל התיקייה שלו נשארה על הדיסק.
function fakeFs({files: extraFiles = [], dirs: extraDirs = [],
                 unreadable = false, readOnly = []} = {}) {
  const dirs = new Set([
    INSTALLED,
    `${INSTALLED}\\word`,
    `${INSTALLED}\\word\\current`,
    `${INSTALLED}\\maps`,
    `${INSTALLED}\\maps\\current`,
    ...extraDirs,
  ]);
  const files = new Map([
    [`${INSTALLED}\\word\\current\\manifest.json`, '{"version":"1.0.0"}'],
    [`${INSTALLED}\\maps\\current\\manifest.json`, '{"version":"2.0.0"}'],
    ...extraFiles,
  ]);
  return {
    dirExists: async (p) => dirs.has(p),
    fileExists: async (p) => files.has(p),
    readText: async (p) => files.get(p),
    writeText: async (p, text) => {
      if (readOnly.some((dir) => p.startsWith(`${dir}\\`))) {
        throw new Error('access denied');
      }
      files.set(p, text);
    },
    remove: async (p) => { files.delete(p); },
    files,
    stat: async (p) => ({size: Buffer.byteLength(files.get(p), 'latin1')}),
    readBase64: async (p, offset, length) => {
      if (unreadable) throw new Error('locked');
      return Buffer.from(files.get(p), 'latin1')
          .subarray(offset, offset + length).toString('base64');
    },
    list: async (p) => [...dirs]
        .filter((d) => d.startsWith(`${p}\\`) &&
                       !d.slice(p.length + 1).includes('\\'))
        .map((d) => ({name: d.slice(p.length + 1), dir: true})),
  };
}

/** הפריסה הרגילה: `<שורש>\databases\plugins_host.db` קיים. */
const DEFAULT_LAYOUT = {
  dirs: [`${ROOT}\\databases`],
  files: [[DEFAULT_DB, '']],
};

const scanner = (readRegistry, layout = DEFAULT_LAYOUT) =>
  new InstalledPluginsScanner({
    fs: fakeFs(layout), env: {appData: APP_DATA}, readRegistry,
  });

/** רישום שעונה רק לנתיב [path], ומתעד מה נשאל. */
function registryAt(path, versions = {maps: '2.0.0'}) {
  const asked = [];
  const read = async (p) => {
    asked.push(p);
    return p === path ? {versions} : null;
  };
  return {read, asked};
}

const FOLDERS = new Map([['word', '1.0.0'], ['maps', '2.0.0']]);

describe('InstalledPluginsScanner', () => {
  it('#303: הרישום של אוצריא גובר על תיקייה שנשארה אחרי הסרה', async () => {
    const registry = registryAt(DEFAULT_DB);
    const result = await scanner(registry.read).scan();
    assert.deepEqual(registry.asked, [DEFAULT_DB]);
    assert.deepEqual([...result], [['maps', '2.0.0']]);
  });

  it('רישום ריק פירושו שאין מותקנים', async () => {
    const result = await scanner(async () => ({versions: {}})).scan();
    assert.equal(result.size, 0);
  });

  it('בלי רישום קריא — סריקת התיקיות, כמו קודם', async () => {
    for (const readRegistry of [null, async () => null,
                                async () => { throw new Error('x'); }]) {
      assert.deepEqual(new Map(await scanner(readRegistry).scan()), FOLDERS);
    }
  });

  it('תיקיית מסדים מההגדרות — הרישום נקרא משם', async () => {
    const custom = 'D:\\OtzariaDB\\plugins_host.db';
    const registry = registryAt(custom);
    const layout = {
      dirs: [`${ROOT}\\databases`, 'D:\\OtzariaDB'],
      files: [
        [PREFERENCES, hiveFile([['key-databases-path', 'D:/OtzariaDB']])],
        [custom, ''],
        [DEFAULT_DB, ''],
      ],
    };
    const result = await scanner(registry.read, layout).scan();
    assert.deepEqual(registry.asked, [custom]);
    assert.deepEqual([...result], [['maps', '2.0.0']]);
  });

  it('תיקיית מסדים מההגדרות בלי רישום — לא נופלים לקובץ ישן בברירת המחדל',
      async () => {
    const registry = registryAt(DEFAULT_DB);
    const layout = {
      dirs: [`${ROOT}\\databases`, 'D:\\OtzariaDB'],
      files: [
        [PREFERENCES, hiveFile([['key-databases-path', 'D:\\OtzariaDB']])],
        [DEFAULT_DB, ''],
      ],
    };
    assert.deepEqual(new Map(await scanner(registry.read, layout).scan()),
                     FOLDERS);
    assert.deepEqual(registry.asked, []);
  });

  it('התקנה חדשה: המסדים ליד הספרייה', async () => {
    const nextToLibrary = 'D:\\Otzaria\\databases\\plugins_host.db';
    const registry = registryAt(nextToLibrary);
    const layout = {
      dirs: ['D:\\Otzaria\\databases'],
      files: [
        [PREFERENCES, hiveFile([['key-library-path', 'D:/Otzaria/אוצריא']])],
        [nextToLibrary, ''],
      ],
    };
    const result = await scanner(registry.read, layout).scan();
    assert.deepEqual(registry.asked, [nextToLibrary]);
    assert.deepEqual([...result], [['maps', '2.0.0']]);
  });

  it('מפתח שנמחק או התרוקן — חזרה לברירת המחדל', async () => {
    for (const entries of [
      [['key-databases-path', 'D:\\Old'], ['key-databases-path', null]],
      [['key-databases-path', '']],
    ]) {
      const registry = registryAt(DEFAULT_DB);
      const layout = {
        dirs: [`${ROOT}\\databases`],
        files: [[PREFERENCES, hiveFile(entries)], [DEFAULT_DB, '']],
      };
      await scanner(registry.read, layout).scan();
      assert.deepEqual(registry.asked, [DEFAULT_DB]);
    }
  });

  it('תיקיית מסדים שאינה כתיבה — הרישום מ-<שורש>\\databases, לא הקפוא',
      async () => {
    const custom = 'D:\\OtzariaDB';
    const registry = registryAt(DEFAULT_DB);
    const fs = fakeFs({
      dirs: [`${ROOT}\\databases`, custom],
      files: [
        [PREFERENCES, hiveFile([['key-databases-path', custom]])],
        [`${custom}\\plugins_host.db`, ''],
        [DEFAULT_DB, ''],
      ],
      readOnly: [custom],
    });
    const result = await new InstalledPluginsScanner({
      fs, env: {appData: APP_DATA}, readRegistry: registry.read,
    }).scan();
    assert.deepEqual(registry.asked, [DEFAULT_DB]);
    assert.deepEqual([...result], [['maps', '2.0.0']]);
  });

  it('בדיקת הכתיבה לא משאירה קובץ בתיקייה', async () => {
    const custom = 'D:\\OtzariaDB';
    const fs = fakeFs({
      dirs: [custom],
      files: [
        [PREFERENCES, hiveFile([['key-databases-path', custom]])],
        [`${custom}\\plugins_host.db`, ''],
      ],
    });
    const before = [...fs.files.keys()];
    await new InstalledPluginsScanner({
      fs, env: {appData: APP_DATA}, readRegistry: async () => ({versions: {}}),
    }).scan();
    assert.deepEqual([...fs.files.keys()], before);
  });

  it('תיקיית מסדים שאינה כתיבה ואין רישום פנימי — סריקת התיקיות', async () => {
    const custom = 'D:\\OtzariaDB';
    const registry = registryAt(`${custom}\\plugins_host.db`);
    const layout = {
      dirs: [custom],
      files: [
        [PREFERENCES, hiveFile([['key-databases-path', custom]])],
        [`${custom}\\plugins_host.db`, ''],
      ],
      readOnly: [custom],
    };
    assert.deepEqual(new Map(await scanner(registry.read, layout).scan()),
                     FOLDERS);
    assert.deepEqual(registry.asked, []);
  });

  it('תיקיית מסדים מההגדרות שלא קיימת בכונן קיים — סריקת התיקיות', async () => {
    const registry = registryAt(DEFAULT_DB);
    const layout = {
      dirs: [`${ROOT}\\databases`, 'E:\\'],
      files: [
        [PREFERENCES, hiveFile([['key-databases-path', 'E:\\Gone\\db']])],
        [DEFAULT_DB, ''],
      ],
    };
    assert.deepEqual(new Map(await scanner(registry.read, layout).scan()),
                     FOLDERS);
    assert.deepEqual(registry.asked, []);
  });

  it('תיקיית מסדים בכונן שנותק — כמו אוצריא, הרישום הפנימי', async () => {
    const registry = registryAt(DEFAULT_DB);
    const layout = {
      dirs: [`${ROOT}\\databases`],
      files: [
        [PREFERENCES, hiveFile([['key-databases-path', 'E:\\Gone']])],
        [DEFAULT_DB, ''],
      ],
    };
    await scanner(registry.read, layout).scan();
    assert.deepEqual(registry.asked, [DEFAULT_DB]);
  });

  it('שיתוף רשת שנותק — הרישום הפנימי, בלי לטפס אל "\\"', async () => {
    for (const custom of ['\\\\server\\share\\db', '\\\\server\\share',
                          '\\\\?\\E:\\db']) {
      const registry = registryAt(DEFAULT_DB);
      const layout = {
        dirs: [`${ROOT}\\databases`, '\\'],
        files: [
          [PREFERENCES, hiveFile([['key-databases-path', custom]])],
          [DEFAULT_DB, ''],
        ],
      };
      await scanner(registry.read, layout).scan();
      assert.deepEqual(registry.asked, [DEFAULT_DB], custom);
    }
  });

  it('שיתוף רשת זמין בלי התיקייה — סריקת התיקיות', async () => {
    const registry = registryAt(DEFAULT_DB);
    const layout = {
      dirs: [`${ROOT}\\databases`, '\\\\server\\share'],
      files: [
        [PREFERENCES, hiveFile([['key-databases-path',
                                 '\\\\server\\share\\db']])],
        [DEFAULT_DB, ''],
      ],
    };
    assert.deepEqual(new Map(await scanner(registry.read, layout).scan()),
                     FOLDERS);
    assert.deepEqual(registry.asked, []);
  });

  it('נתיב בהגדרות ששווה לפנימי (רישיות, /, \\ בסוף) — בלי בדיקת כתיבה',
      async () => {
    for (const spelling of [`${ROOT.toUpperCase()}\\DATABASES\\`,
                            `${ROOT.replace(/\\/g, '/')}/databases`]) {
      const fs = fakeFs({
        ...DEFAULT_LAYOUT,
        files: [...DEFAULT_LAYOUT.files,
                [PREFERENCES, hiveFile([['key-databases-path', spelling]])]],
      });
      let writes = 0;
      const writeText = fs.writeText;
      fs.writeText = async (...args) => { writes++; return writeText(...args); };
      const asked = [];
      await new InstalledPluginsScanner({
        fs, env: {appData: APP_DATA},
        readRegistry: async (p) => { asked.push(p); return {versions: {}}; },
      }).scan();
      assert.equal(writes, 0);
      assert.equal(asked.length, 1);
      assert.equal(asked[0].toLowerCase(), DEFAULT_DB.toLowerCase());
    }
  });

  it('שתי סריקות חופפות — שתיהן קוראות מהתיקייה המועדפת', async () => {
    const custom = 'D:\\DB';
    const fs = fakeFs({
      dirs: [`${ROOT}\\databases`, custom],
      files: [
        [PREFERENCES, hiveFile([['key-databases-path', custom]])],
        [`${custom}\\plugins_host.db`, ''],
        [DEFAULT_DB, ''],
      ],
    });
    // Like WriteTextAtomic: an exclusive handle on the target for a while.
    const open = new Set();
    const writeText = fs.writeText;
    fs.writeText = async (p, text) => {
      if (open.has(p)) throw new Error('sharing violation');
      open.add(p);
      await new Promise((resolve) => setTimeout(resolve, 20));
      open.delete(p);
      return writeText(p, text);
    };
    const asked = [];
    const make = () => new InstalledPluginsScanner({
      fs, env: {appData: APP_DATA},
      readRegistry: async (p) => { asked.push(p); return {versions: {}}; },
    });
    await Promise.all([make().scan(), make().scan()]);
    assert.deepEqual(asked, [`${custom}\\plugins_host.db`,
                             `${custom}\\plugins_host.db`]);
  });

  it('קובץ הבדיקה נכתב אבל לא נמחק — לא כתיבה, כמו אוצריא', async () => {
    const custom = 'D:\\DB';
    const fs = fakeFs({
      dirs: [`${ROOT}\\databases`, custom],
      files: [
        [PREFERENCES, hiveFile([['key-databases-path', custom]])],
        [`${custom}\\plugins_host.db`, ''],
        [DEFAULT_DB, ''],
      ],
    });
    fs.remove = async () => { throw new Error('access denied'); };
    const asked = [];
    await new InstalledPluginsScanner({
      fs, env: {appData: APP_DATA},
      readRegistry: async (p) => { asked.push(p); return {versions: {}}; },
    }).scan();
    assert.deepEqual(asked, [DEFAULT_DB]);
  });

  it('הגדרות שאי אפשר לקרוא — סריקת התיקיות', async () => {
    const registry = registryAt(DEFAULT_DB);
    const layout = {...DEFAULT_LAYOUT, unreadable: true,
                    files: [...DEFAULT_LAYOUT.files, [PREFERENCES, 'x']]};
    assert.deepEqual(new Map(await scanner(registry.read, layout).scan()),
                     FOLDERS);
    assert.deepEqual(registry.asked, []);
  });
});

describe('readHiveStrings', () => {
  const bytes = (entries) => Uint8Array.from(Buffer.from(hiveFile(entries),
                                                         'latin1'));

  it('ה-frame האחרון של מפתח קובע', () => {
    const result = readHiveStrings(bytes([
      ['key-library-path', 'C:\\a'],
      ['other', 'x'],
      ['key-library-path', 'C:\\b'],
    ]), ['key-library-path']);
    assert.deepEqual([...result], [['key-library-path', 'C:\\b']]);
  });

  it('frame קטוע בסוף עוצר בלי לזרוק', () => {
    const full = bytes([['key-library-path', 'C:\\a'], ['k', 'v']]);
    const result = readHiveStrings(full.subarray(0, full.length - 3),
                                   ['key-library-path', 'k']);
    assert.deepEqual([...result], [['key-library-path', 'C:\\a']]);
  });

  it('crc שגוי עוצר שם, כמו Hive — גם ה-frames שאחריו לא נקראים', () => {
    const first = bytes([['key-databases-path', 'D:\\a']]);
    const all = bytes([
      ['key-databases-path', 'D:\\a'],
      ['other', 'x'],
      ['key-databases-path', 'E:\\b'],
    ]);
    all[first.length + 8] ^= 0xFF; // a byte inside the "other" frame's key
    const result = readHiveStrings(all, ['key-databases-path']);
    assert.deepEqual([...result], [['key-databases-path', 'D:\\a']]);
  });
});

describe('PluginsManager.scanInstalled', () => {
  it('מעביר את sys.pluginRegistry לסורק', async () => {
    const manager = new PluginsManager({
      paths: {dataDir: 'C:\\s\\Data', pluginsDir: 'C:\\s\\Data\\plugins',
              catalogPath: 'C:\\s\\Data\\catalog.json'},
      fs: fakeFs(DEFAULT_LAYOUT),
      net: {},
      sys: {pluginRegistry: async () => ({versions: {maps: '2.0.0'}})},
      env: {appData: APP_DATA},
      otzariaLaunchPath: async () => null,
    });
    assert.deepEqual([...await manager.scanInstalled()], [['maps', '2.0.0']]);
  });
});
