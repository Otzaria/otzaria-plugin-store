// סורק את התוספים שאוצריא כבר התקינה במחשב הזה. פורט של
// `packages/plugins_manager/lib/src/services/installed_plugins_scanner.dart`.
//
// המבנה של אוצריא:
// `<pluginsDir>/installed/<manifestId>/<הוצאה>/manifest.json`,
// וה-`version` שבתוכו הוא הגרסה המותקנת בפועל. תיקיית ההוצאה היא
// `current` בהתקנות הישנות ו-`.release-<hash>` בחדשות — **שתיהן**
// נסרקות, אחרת כל תוסף שהותקן במבנה החדש נראה כלא-מותקן.
//
// הנתיב **מתגלה ולא מונח כקבוע**: קודם נתיב שנמסר במפורש, אחר כך
// ההתקנה שזוהתה (התקנה ניידת שומרת את הנתונים לידה ולא ב-`%APPDATA%`),
// ולבסוף ברירת המחדל של הפלטפורמה. תיקייה שלא קיימת מחזירה מפה ריקה
// בשקט — זה המצב התקין כשאוצריא לא מותקנת או שאין עדיין תוספים.

import {readHiveStrings} from '../util/hive_strings.js';

/** שם תיקיית המשנה שאוצריא מתקינה לתוכה כל תוסף. */
export const INSTALLED_DIR_NAME = 'installed';

/** רישום ההתקנות של אוצריא — `pluginsRegistryFileName` במשגר. */
const REGISTRY_FILE_NAME = 'plugins_host.db';

/** הגדרות אוצריא והמפתחות שלהן ב-`SettingsRepository`. */
const PREFERENCES_FILE_NAME = 'app_preferences.hive';
const DATABASES_PATH_KEY = 'key-databases-path';
const LIBRARY_PATH_KEY = 'key-library-path';
const MAX_PREFERENCES_BYTES = 16 * 1024 * 1024;

/** שם נפרד מ-`.otzaria_write_probe` של אוצריא, כדי לא למחוק בדיקה שלה. */
const WRITE_PROBE_FILE_NAME = '.otzaria_store_write_probe';

/** תיקיות ההוצאה — המבנה הישן והחדש. */
const CURRENT_DIR_NAME = 'current';
const RELEASE_DIR_PREFIX = '.release-';

/**
 * סימון ההתקנה הניידת של אוצריא, ליד ה-executable שלה, ותיקיית הנתונים
 * שהוא מפעיל. **חייבים להישאר תואמים ל-`LibraryDbLocator`** של אוצריא —
 * אותו זיהוי בדיוק.
 */
const PORTABLE_MARKER_FILE_NAME = 'portable.marker';
const PORTABLE_DATA_FOLDER_NAME = 'otzaria_data';

const dirNameOf = (path) => {
  const cut = path.replace(/[\\/]+$/, '').lastIndexOf('\\');
  return cut < 0 ? path : path.slice(0, cut);
};

const baseNameOf = (path) => {
  const trimmed = path.replace(/[\\/]+$/, '');
  const cut = trimmed.lastIndexOf('\\');
  return cut < 0 ? trimmed : trimmed.slice(cut + 1);
};

/**
 * שורש הכרך של נתיב מוחלט — `D:\`, `\\server\share` או `\\?\D:\` — או
 * null לנתיב שאינו כזה.
 */
const volumeRootOf = (path) => {
  const match = /^(\\\\\?\\[A-Za-z]:\\|[A-Za-z]:\\|\\\\[^\\?]+\\[^\\]+)/
      .exec(path);
  return match ? match[1] : null;
};

/** נתיב מהגדרות אוצריא (Dart עשוי לשמור `/`) בצורת ווינדוס; ריק = null. */
const windowsPath = (value) => typeof value === 'string' && value.trim()
    ? value.trim().replace(/\//g, '\\')
    : null;

export class InstalledPluginsScanner {
  /**
   * @param {{fs: object, env: {appData?: string, programData?: string},
   *          customPluginsDir?: string|null,
   *          otzariaLaunchPath?: string|null}} options
   */
  constructor({fs, env, customPluginsDir = null, otzariaLaunchPath = null,
               readRegistry = null}) {
    this.fs = fs;
    this.env = env;
    this.customPluginsDir = customPluginsDir;
    this.otzariaLaunchPath = otzariaLaunchPath;
    this.readRegistry = readRegistry;
  }

  /** מחזיר `Map<manifestId, גרסה מותקנת>`. */
  async scan() {
    const root = await this.resolveInstalledDir();
    if (root === null) return new Map();

    // רישום ההתקנות של אוצריא קודם לתיקיות: תיקייה שנשארה אחרי הסרה
    // נראתה מותקנת, והחנות הציעה לעדכן תוסף שאינו מותקן (#303).
    const registered = await this.#readRegistry(root);
    if (registered !== null) return registered;

    if (!await this.fs.dirExists(root)) return new Map();

    const result = new Map();
    const entries = await this.fs.list(root);
    for (const entry of entries) {
      if (!entry.dir) continue;
      const version = await this.#readInstalledVersion(`${root}\\${entry.name}`);
      if (version !== null) result.set(entry.name, version);
    }
    return result;
  }

  /**
   * תיקיית ה-`installed` שתיסרק בפועל, או null אם אי אפשר לגזור אותה.
   */
  async resolveInstalledDir() {
    const plugins = await this.resolvePluginsDir();
    if (plugins === null) return null;
    // מי שמוסר נתיב יכול להצביע על `plugins` או ישירות על
    // `plugins\installed`.
    return baseNameOf(plugins).toLowerCase() === INSTALLED_DIR_NAME
        ? plugins
        : `${plugins}\\${INSTALLED_DIR_NAME}`;
  }

  /** תיקיית ה-`plugins` של אוצריא, לפי סדר העדיפות שבתיאור המודול. */
  async resolvePluginsDir() {
    if (this.customPluginsDir) return this.customPluginsDir;

    const portable = await this.portablePluginsDir(this.otzariaLaunchPath);
    if (portable !== null) return portable;

    const candidates = this.defaultPluginsDirs();
    for (const dir of candidates) {
      if (await this.fs.dirExists(`${dir}\\${INSTALLED_DIR_NAME}`)) return dir;
    }
    return candidates.length === 0 ? null : candidates[0];
  }

  /**
   * תיקיית התוספים של התקנה **ניידת** — `<exeDir>\otzaria_data\plugins` —
   * או null כשההתקנה שזוהתה אינה ניידת.
   *
   * הסימון הוא התנאי; תיקיית נתונים קיימת לצד קובץ ההרצה מתקבלת גם
   * בלעדיו, כדי שהתקנה שהסימון שלה נמחק לא תיפול חזרה ל-`%APPDATA%` של
   * מחשב אחר לגמרי.
   */
  async portablePluginsDir(launchPath) {
    if (!launchPath) return null;
    const exeDir = dirNameOf(launchPath);
    const plugins = `${exeDir}\\${PORTABLE_DATA_FOLDER_NAME}\\plugins`;
    if (await this.fs.fileExists(`${exeDir}\\${PORTABLE_MARKER_FILE_NAME}`) ||
        await this.fs.dirExists(`${plugins}\\${INSTALLED_DIR_NAME}`)) {
      return plugins;
    }
    return null;
  }

  /**
   * שורשי הנתונים של אוצריא, לפי סדר עדיפות — התקנה למשתמש הנוכחי לפני
   * התקנה מערכתית.
   */
  defaultPluginsDirs() {
    const dirs = [];
    if (this.env.appData) {
      dirs.push(`${this.env.appData}\\otzaria\\plugins`);
    }
    if (this.env.programData) {
      dirs.push(`${this.env.programData}\\otzaria\\plugins`);
    }
    return dirs;
  }

  /**
   * `plugin_installation` מתוך `plugins_host.db` של אוצריא, או null כשאין
   * רישום קריא — ואז נשארת סריקת התיקיות.
   */
  async #readRegistry(installedDir) {
    if (typeof this.readRegistry !== 'function') return null;
    try {
      const path = await this.registryPath(dirNameOf(dirNameOf(installedDir)));
      if (path === null) return null;
      const versions = (await this.readRegistry(path))?.versions;
      if (versions === null || typeof versions !== 'object') return null;
      return new Map(Object.entries(versions)
          .filter(([, version]) => typeof version === 'string' && version));
    } catch {
      return null;
    }
  }

  /**
   * איפה אוצריא מחזיקה את `plugins_host.db`, או null כשלא ידוע — פורט של
   * `AppPaths.resolvePluginsDbPath` שלה (ושל `locateUserStateDb` במשגר):
   * תיקיית המסדים שבהגדרות, אחרת `<שורש>\databases` אם קיימת, אחרת
   * `databases` שליד הספרייה; וכשהמועדפת אינה כתיבה — `<שורש>\databases`,
   * שאליה אוצריא העתיקה את המסד ובה היא ממשיכה לעבוד.
   *
   * ⚠️ קובץ שחסר בתיקייה הפעילה אינו נלקח מתיקייה אחרת: שם הוא יכול להיות
   * שארית מלפני שהתיקייה הוזזה — בדיוק הבאג של #303.
   */
  async registryPath(dataRoot) {
    const settings = await this.#readOtzariaSettings(dataRoot);
    if (settings === null) return null;
    const internal = `${dataRoot}\\databases`;
    const custom = windowsPath(settings.get(DATABASES_PATH_KEY));
    const library = windowsPath(settings.get(LIBRARY_PATH_KEY));

    let preferred;
    if (custom) {
      preferred = custom;
    } else if (await this.fs.dirExists(internal)) {
      preferred = internal;
    } else if (library) {
      preferred = `${dirNameOf(library)}\\databases`;
    } else {
      preferred = internal;
    }
    preferred = preferred.replace(/\\+$/, '');
    let active;
    if (preferred.toLowerCase() === internal.toLowerCase()) {
      active = internal;
    } else if (await this.fs.dirExists(preferred)) {
      active = await this.#isWritable(preferred) ? preferred : internal;
    } else if (await this.#anyAncestorExists(preferred)) {
      // אוצריא תיצור כאן תיקייה ומסד ריקים; אין עדיין רישום לקרוא.
      return null;
    } else {
      active = internal; // כונן שנותק: היצירה של אוצריא נכשלת והיא עוברת לפנימי
    }
    const path = `${active}\\${REGISTRY_FILE_NAME}`;
    return await this.fs.fileExists(path) ? path : null;
  }

  /** הורים עד שורש הכרך בלבד — `\` לבדו הוא הכונן הנוכחי, לא הורה. */
  async #anyAncestorExists(dir) {
    const root = volumeRootOf(dir);
    if (root === null) return false;
    for (let parent = dirNameOf(dir);
         parent !== dir && parent.length >= root.length - 1;
         dir = parent, parent = dirNameOf(dir)) {
      const probe = parent.endsWith(':') ? `${parent}\\` : parent; // "D:\"
      if (await this.fs.dirExists(probe)) return true;
    }
    return false;
  }

  /**
   * כמו `isDirectoryWritable` של אוצריא: קובץ שנכתב ונמחק בפועל. שם ייחודי
   * לכל בדיקה — שתי סריקות חופפות על אותו שם נכשלות זו בגלל זו.
   */
  async #isWritable(dir) {
    const suffix = Math.random().toString(36).slice(2, 10);
    const probe = `${dir}\\${WRITE_PROBE_FILE_NAME}-${suffix}`;
    try {
      await this.fs.writeText(probe, '');
      await this.fs.remove(probe);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * המפתחות של הגדרות אוצריא שהאיתור צריך. קובץ שאינו קיים = ברירות מחדל
   * (מפה ריקה); קובץ שאי אפשר לקרוא = null, כי אז אי אפשר לדעת איפה המסד.
   */
  async #readOtzariaSettings(dataRoot) {
    const path = `${dataRoot}\\${PREFERENCES_FILE_NAME}`;
    if (!await this.fs.fileExists(path)) return new Map();
    try {
      const {size} = await this.fs.stat(path);
      if (size > MAX_PREFERENCES_BYTES) return null;
      const binary = atob(await this.fs.readBase64(path, 0, size));
      const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
      return readHiveStrings(bytes, [DATABASES_PATH_KEY, LIBRARY_PATH_KEY]);
    } catch {
      return null;
    }
  }

  /** הגרסה המותקנת של תוסף אחד — מתוך תיקיית ההוצאה הפעילה שלו. */
  async #readInstalledVersion(pluginDir) {
    for (const dir of await this.#releaseDirs(pluginDir)) {
      const version = await this.#versionIn(dir);
      if (version !== null) return version;
    }
    return null;
  }

  /**
   * תיקיות ההוצאה של תוסף, בסדר עדיפות. `current` קודמת כי היא המצביע
   * המפורש של המבנה הישן; אחריה `.release-<hash>` מהחדשה לישנה, כי זו
   * שאוצריא כתבה אחרונה היא הפעילה.
   */
  async #releaseDirs(pluginDir) {
    const result = [];
    const current = `${pluginDir}\\${CURRENT_DIR_NAME}`;
    if (await this.fs.dirExists(current)) result.push(current);

    let entries;
    try {
      entries = await this.fs.list(pluginDir);
    } catch {
      return result; // תיקייה שאי אפשר לקרוא — מה שנמצא עד כה
    }

    const releases = entries.filter(
        (entry) => entry.dir && entry.name.startsWith(RELEASE_DIR_PREFIX));
    // מיון משני לפי השם, כדי ששתי הוצאות באותה חותמת זמן ייבחרו בקביעות.
    releases.sort((a, b) => {
      const byTime = (b.modified ?? 0) - (a.modified ?? 0);
      return byTime !== 0 ? byTime : b.name.localeCompare(a.name);
    });
    for (const entry of releases) result.push(`${pluginDir}\\${entry.name}`);
    return result;
  }

  async #versionIn(releaseDir) {
    try {
      const path = `${releaseDir}\\manifest.json`;
      if (!await this.fs.fileExists(path)) return null;
      const decoded = JSON.parse(
          (await this.fs.readText(path)).replace(/^﻿/, ''));
      if (decoded === null || typeof decoded !== 'object') return null;
      const version = decoded.version;
      return typeof version === 'string' && version.length > 0 ? version : null;
    } catch {
      return null; // מניפסט פגום — מתעלמים בשקט מההוצאה הזו
    }
  }
}
