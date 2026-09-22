// סיווג הכשל של `PluginStoreError` — מה נחשב "האתר סגור עכשיו" ומה
// נחשב תקלה. זו ההבחנה שהג'וב היומי נשען עליה: otzaria.org מחזיר 503
// בשבתות ובחגים, והריצה חייבת לדלג ולא להיכשל באדום.

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {PluginStoreError} from '../web/js/store/store_client.js';

describe('PluginStoreError — sourceClosed', () => {
  it('503 הוא אתר סגור', () => {
    // ⚠️ המקרה שכל הדגל נועד לו. otzaria.org מחזיר בדיוק את זה בשבת.
    assert.equal(new PluginStoreError('', {status: 503}).sourceClosed, true);
  });

  it('כל 5xx הוא אתר סגור', () => {
    for (const status of [500, 502, 504, 599]) {
      assert.equal(new PluginStoreError('', {status}).sourceClosed, true,
                   `status ${status}`);
    }
  });

  it('ניתוק בלי תשובה כלל הוא אתר סגור', () => {
    // `fetch failed` — ניתוק, timeout או DNS. קרה ב-2026-09-15.
    assert.equal(new PluginStoreError('', {unreachable: true}).sourceClosed,
                 true);
  });

  it('4xx אינו אתר סגור — הבקשה עצמה שגויה', () => {
    // ⚠️ הכיוון המסוכן: 404 על הקטלוג פירושו שמשהו זז באתר, וזו בדיוק
    // התקלה שאסור לבלוע. אתר שסגור לשבת מצהיר על כך ב-5xx.
    for (const status of [400, 403, 404, 429]) {
      assert.equal(new PluginStoreError('', {status}).sourceClosed, false,
                   `status ${status}`);
    }
  });

  it('כשל בלי סיווג אינו אתר סגור', () => {
    // JSON פגום, תשובה בצורה לא צפויה — נזרקים בלי אופציות.
    assert.equal(new PluginStoreError('תשובה שאינה JSON').sourceClosed, false);
  });

  it('ההודעה וה-name אינם משתנים בגלל הסיווג', () => {
    const error = new PluginStoreError('שלום', {status: 503});
    assert.equal(error.message, 'שלום');
    assert.equal(error.name, 'PluginStoreError');
    assert.ok(error instanceof Error);
  });
});
