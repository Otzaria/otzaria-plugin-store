// המראה נוסעת למחשב אחר; יעד התאימות הוא Latest ולא ההתקנה המסנכרנת.
const OWNER = 'Otzaria';
const REPO = 'otzaria';
const API_BASE = 'https://api.github.com';
const RELEASE_TAG = /^v?(\d+(?:\.\d+)*)(?:\+\d+)?$/;

export const OTZARIA_RELEASES_PAGE_URL =
    `https://github.com/${OWNER}/${REPO}/releases/latest`;

/** גרסת התאימות ללא קידומת v ומספר בנייה, כולל מספר hotfix. */
export function otzariaVersionOf(tag) {
  const match = RELEASE_TAG.exec(String(tag ?? '').trim());
  return match === null ? null : match[1];
}

export class OtzariaReleaseClient {
  constructor({net, timeoutMs = 20000}) {
    this.net = net;
    this.timeoutMs = timeoutMs;
  }

  async fetchTargetVersions() {
    const url = `${API_BASE}/repos/${OWNER}/${REPO}/releases/latest`;
    // ה-host מצרף User-Agent לכל הבקשות.
    const response = await this.net.get(url, this.timeoutMs);
    if (response.status !== 200) {
      throw new Error(`GitHub החזיר ${response.status} עבור ${url}`);
    }
    return pickTargetVersions(JSON.parse(response.body));
  }
}

/** יעד יחיד מתוך תשובת /releases/latest; רשימת ריליסים אינה הוכחת Latest. */
export function pickTargetVersions(release) {
  if (release === null || typeof release !== 'object' ||
      Array.isArray(release) || release.draft === true ||
      release.prerelease === true) {
    throw new Error('תשובת Latest של אוצריא אינה תקינה');
  }
  const latest = otzariaVersionOf(release.tag_name);
  if (latest === null) {
    throw new Error('ל-Latest של אוצריא אין תג גרסה תקין');
  }
  return {versions: [latest], latest};
}
