// קורא ערכי מחרוזת מקובץ Hive (`app_preferences.hive` של אוצריא) — רק
// מה שהחנות צריכה כדי לאתר את `plugins_host.db` כמו אוצריא.
//
// הפורמט (`hive_ce` `BinaryReaderImpl.readFrame`): רצף frames, כל אחד
// `[uint32 אורך כולל][מפתח][ערך][uint32 crc]`, little-endian. מפתח: בית
// סוג (0 = uint32, 1 = מחרוזת עם בית אורך). ערך: בית סוג, ומחרוזת (4) היא
// `uint32` אורך ואחריו UTF-8. frame בלי ערך הוא מחיקה; הקובץ נכתב בהוספה,
// ולכן ה-frame האחרון של מפתח קובע. ה-crc הוא CRC-32 רגיל על כל מה שלפניו
// ב-frame (הקופסה אינה מוצפנת), ו-Hive עוצר ב-frame הראשון שאינו תואם.

const KEY_UINT = 0;
const KEY_STRING = 1;
const VALUE_STRING = 4;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes, start, end) {
  let crc = 0xFFFFFFFF;
  for (let i = start; i < end; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/**
 * הערך האחרון של כל אחד מ-[keys] בקובץ: מחרוזת, `null` כשנמחק או שאינו
 * מחרוזת, וחסר במפה כשלא הופיע בכלל. frame פגום (אורך, מבנה או crc) עוצר
 * את הקריאה — כמו ש-Hive עוצר בו וקוטע את הקובץ שם.
 *
 * @param {Uint8Array} bytes
 * @param {Iterable<string>} keys
 * @returns {Map<string, string|null>}
 */
export function readHiveStrings(bytes, keys) {
  const wanted = new Set(keys);
  const result = new Map();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const utf8 = new TextDecoder('utf-8', {fatal: false});

  let offset = 0;
  while (offset + 4 <= bytes.length) {
    const length = view.getUint32(offset, true);
    if (length < 8 || offset + length > bytes.length) break;
    const end = offset + length - 4; // the crc is not part of key/value
    if (crc32(bytes, offset, end) !== view.getUint32(end, true)) break;
    let at = offset + 4;

    const keyType = bytes[at++];
    let key = null;
    if (keyType === KEY_UINT) {
      at += 4;
    } else if (keyType === KEY_STRING) {
      const keyLength = bytes[at++];
      if (at + keyLength > end) break;
      key = utf8.decode(bytes.subarray(at, at + keyLength));
      at += keyLength;
    } else {
      break;
    }
    if (at > end) break;

    if (key !== null && wanted.has(key)) {
      if (at === end) {
        result.set(key, null);
      } else if (bytes[at] === VALUE_STRING && at + 5 <= end) {
        const valueLength = view.getUint32(at + 1, true);
        const start = at + 5;
        result.set(key, start + valueLength <= end
            ? utf8.decode(bytes.subarray(start, start + valueLength))
            : null);
      } else {
        result.set(key, null);
      }
    }
    offset += length;
  }
  return result;
}
