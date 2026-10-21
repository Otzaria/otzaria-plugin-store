// מסכי החנות מותאמים לעיצוב otzaria.org מאוקטובר 2026.
// הנתונים, החיפוש, בחירת הגרסה וההתקנה נשארים מקומיים.

import {S} from '../strings.js';
import {InstallStatus} from '../store/models.js';
import {Page, Status, StatusFilter} from '../controller.js';
import {formatBytes} from '../util/bytes.js';
import {formatHebrewDate} from '../util/hebrew_date.js';
import {formatTimestamp} from '../util/timestamps.js';
import {assetUrl, h, icon, replace} from './dom.js';
import {
  actionButton,
  appCard,
  emptyState,
  fieldLabel,
  formatRating,
  iconButton,
  infoCell,
  installChip,
  panel,
  pluginBadge,
  pluginStatusLabel,
  ratingStars,
  statusChip,
  tagPill,
  thumbnail,
} from './components.js';
import {
  showScreenshots,
  showSnack,
  showUpdatesDialog,
  syncOverlay,
  confirmDialog,
  showError,
  showSuccess,
} from './overlays.js';

/** כמה נבחרים מוצגים לפני "הצג עוד נבחרים" — כמו באתר. */
const FEATURED_PREVIEW_COUNT = 6;

/** מספר התגיות הנפוצות לצד הבורר המלא, כמו באתר. */
const COLLAPSED_TAG_COUNT = 8;

/**
 * מצב תצוגה שאינו שייך לבקר — הוא מקומי למסך ומתאפס בניווט, בדיוק כמו
 * ה-`State` של ה-widget במקור.
 */
const local = {
  allFeaturedShown: false,
  busyPluginId: null,
  /** מה שהוקלד בתיבת החיפוש של דף הבית וטרם נשלח (ראו `hero`). */
  heroQuery: '',
};

/**
 * שומר את המיקוד ואת מיקום הסמן לפני שהמסך מוחלף.
 *
 * ⚠️ **בלי זה תיבת החיפוש איבדה את המיקוד אחרי כל תו.** ההקלדה מודיעה
 * לבקר, הבקר מרנדר, והרינדור הוא מלא — `replace` מוחק את השדה שהמשתמש
 * מקליד בו ובונה אותו מחדש, והמיקוד נופל ל-`body`. התו השני כבר לא הגיע
 * לשום מקום.
 *
 * הזיהוי הוא `data-focus-key` ולא מיקום בעץ: הפקדים שצריכים לשרוד
 * רינדור הם בודדים, והמפתח נושא איתו גם את הכוונה.
 */
function captureFocus(host) {
  const active = document.activeElement;
  if (active === null || !host.contains(active)) return null;
  const key = active.dataset?.focusKey;
  if (!key) return null;
  // `selectionStart` קיים בשדות טקסט בלבד: ב-`select` הוא `undefined`,
  // ובשדות מסוימים (`number`, `email`) הגישה אליו **זורקת**. פקד בלי
  // בורר טקסט מקבל את המיקוד בלבד.
  try {
    return {key, start: active.selectionStart, end: active.selectionEnd};
  } catch {
    return {key, start: null, end: null};
  }
}

/** משחזר את מה ש-[captureFocus] שמר, אל המסך שזה עתה נבנה. */
function restoreFocus(host, snapshot) {
  if (snapshot === null) return;
  const element = host.querySelector(
      `[data-focus-key="${snapshot.key}"]`);
  if (element === null) return;
  // `preventScroll`: המיקוד לא יזיז את הגלילה שהקורא (`main.js`) משחזר
  // מיד אחרי הרינדור.
  element.focus({preventScroll: true});
  if (snapshot.start === null || snapshot.start === undefined) return;
  element.setSelectionRange(snapshot.start, snapshot.end);
}

/**
 * מרנדר את מסך החנות כולו לתוך [host].
 *
 * הרינדור הוא מלא ולא מדורג: הבקר הוא מקור האמת היחיד, והמסך הוא כמה
 * עשרות אלמנטים. זה מה שמאפשר לוותר על framework. המחיר היחיד שהוא גובה
 * הוא המיקוד, וזה מה ש-[captureFocus] מחזיר.
 */
export function renderStore(host, controller, {readOnly = false} = {}) {
  const focus = captureFocus(host);
  const hasNav = controller.categories.length > 0;
  const wide = host.clientWidth >= 1024;
  const showSidebar = hasNav && wide;

  const detail = controller.openPlugin_;

  const layout = h('div.store');
  if (detail !== null) {
    layout.append(detailHeader(controller, detail));
  } else {
    layout.append(syncHeader(controller, {readOnly}));
  }

  const scroll = h('div.store__scroll');
  const columns = h('div.store__columns');
  if (detail === null && showSidebar) columns.append(sidebar(controller));
  columns.append(scroll);
  layout.append(columns);

  if (detail !== null) {
    scroll.append(detailBody(controller, detail));
  } else if (controller.errorMessage !== null) {
    scroll.append(h('div.store__pad',
        appCard({
          className: 'error-row',
          children: [
            icon('error-circle', 22),
            h('span.error-row__text', {text: controller.errorMessage}),
            actionButton({text: S.common.retry, variant: 'neutral',
                          onPressed: () => void controller.load()}),
          ],
        })));
  } else if (controller.status === Status.loading) {
    scroll.append(h('div.store__pad',
        appCard({
          className: 'progress-row',
          children: [h('span.spinner'),
                     h('span', {text: S.plugins.loadingCatalog})],
        })));
  } else if (controller.plugins.length === 0) {
    // מראה מלאה שאף תוסף בה אינו רץ כאן אינה "מעולם לא סונכרן" — הסנכרון
    // דווקא הצליח, וההסבר היחיד שעוזר הוא שאוצריא כאן אינה מתאימה.
    scroll.append(h('div.store__pad', controller.hiddenCount > 0
        ? hiddenOnlyState(controller)
        : neverSyncedState(controller, readOnly)));
  } else {
    switch (controller.view) {
      case Page.home: scroll.append(...homeSections(controller)); break;
      case Page.all: scroll.append(...allSections(controller)); break;
      case Page.category: scroll.append(...categorySections(controller)); break;
    }
    if (hasNav && !showSidebar) {
      const nav = categoryBar(controller);
      if (controller.view === Page.home) scroll.children[0]?.after(nav);
      else scroll.prepend(nav);
    }
    // בתחתית **כל** המסכים: התוסף החסר עשוי להיות מאוצר בדף הבית או
    // משובץ בקטגוריה, ולא רק ברשימה המלאה.
    const hidden = hiddenNote(controller);
    if (hidden !== null) scroll.append(hidden);
  }

  replace(host, layout);
  restoreFocus(host, focus);
  if (controller.status === Status.syncing) {
    host.append(syncOverlay(controller));
  }
}

// ── שורת הסנכרון ─────────────────────────────────────────────────────────────

function syncHeader(controller, {readOnly}) {
  const t = S.plugins;
  const lastSync = controller.lastSync;

  const updates = controller.updatablePlugins;
  const updatesChip = updates.length === 0 ? null : h('button.pill.pill--active', {
    type: 'button',
    title: t.updatesChipTooltip,
    onclick: () => showUpdatesDialog({
      controller,
      updatable: updates,
      onOpenDetail: (id) => controller.openPlugin(id),
    }),
  }, icon('arrow-download', 14),
     h('span', {text: t.updatesAvailableChip(updates.length)}));

  return h('div.toolbar',
      h('div.toolbar__main',
        // ⚠️ הסנכרון הוא הפעולה היחידה שדורשת אינטרנט, והיא תמיד יזומה
        // בלחיצה. על כונן מוגן מפני כתיבה אין לאן להוריד, ולכן היא כבויה.
        actionButton({
          text: t.syncButton,
          variant: 'recommended',
          iconName: 'arrow-sync',
          onPressed: readOnly ? null : () => confirmDialog({
            title: t.syncDialogTitle,
            message: t.syncDialogContent,
            confirmText: t.syncDialogConfirm,
            onConfirm: () => void runSync(controller),
          }),
        }),
        iconButton({
          iconName: 'arrow-sync',
          tooltip: t.reloadTooltip,
          className: 'toolbar__reload',
          onPressed: () => void controller.load(),
        }),
        h('span.toolbar__stamp', {
          text: lastSync === null ? t.syncNeverRan
                                  : t.syncedAt(formatTimestamp(lastSync)),
        })),
      h('div.toolbar__side',
        updatesChip,
        hideInstalledToggle(controller)));
}

/**
 * מתג "רק מה שלא מותקן". תוספת של הלאנצ'ר (אין לו מקבילה באתר) והוא חל
 * על **כל** מסכי החנות, ולכן הוא בשורה העליונה ולא בשורת הסינון.
 */
function hideInstalledToggle(controller) {
  const t = S.plugins;
  const isOn = controller.hideInstalled;
  return h('label.switch', {
    title: isOn ? t.hideInstalledOnTooltip(controller.installedCount)
                : t.hideInstalledOffTooltip(controller.installedCount),
  },
      h('input', {
        type: 'checkbox',
        checked: isOn,
        onchange: (event) => controller.setHideInstalled(event.target.checked),
      }),
      h('span.switch__track', h('span.switch__thumb')),
      h('span.switch__label', {text: t.hideInstalledLabel}));
}

async function runSync(controller) {
  const before = controller.plugins.length;
  await controller.sync();
  const outcome = controller.lastSyncOutcome;
  if (controller.status === Status.error) {
    showError(controller.errorMessage ?? S.plugins.syncFailedSnack);
    return;
  }
  if (outcome === null) return;
  // ביטול מחזיר תוצאה רגילה (מה שהספיק לרדת נשמר), ולכן בלי הבדיקה הזאת
  // המשתמש שלחץ "ביטול" קיבל "הסנכרון הושלם". אין כאן הודעה משלו:
  // היעלמות השכבה היא התשובה ללחיצה, והמצב שנשאר הוא מה שכבר במראה.
  if (controller.syncCancelled) return;
  if (controller.syncWarnings.length > 0) {
    showSnack(S.plugins.syncDoneWithWarningsSnack(
        controller.syncWarnings.length), 'error');
  } else {
    showSuccess(S.plugins.syncDoneSnack(
        outcome.fetched, controller.plugins.length || before));
  }
}

// ── ניווט הקטגוריות ──────────────────────────────────────────────────────────

/**
 * סרגל הצד. יושב **מחוץ** לאזור הגלילה כדי שגלילת התוכן לא תזיז אותו,
 * כמו ה-`sticky` שבאתר.
 */
function sidebar(controller) {
  const t = S.plugins;
  const item = ({label, iconName, active, onTap, count = null,
                 tooltip = null, muted = false}) =>
      h('button', {
        type: 'button',
        class: 'nav-item' + (active ? ' nav-item--active' : '') +
            (muted ? ' nav-item--muted' : ''),
        title: tooltip,
        onclick: onTap,
      },
         h('span.nav-item__label', {text: label}),
         count === null ? null : h('span.nav-item__count', {text: count}));

  return h('nav.sidebar',
      h('div.sidebar__title', {text: t.categoriesTitle}),
      controller.view === Page.home ? null : item({
        label: t.storeHomeItem,
        iconName: 'home',
        active: controller.view === Page.home,
        onTap: () => controller.showHome(),
      }),
      controller.categories.map((category) => item({
        label: category.name,
        tooltip: category.description,
        // ⚠️ **מה שיוצג בפועל, ולא `pluginCount`.** המספר שהאתר שמר
        // מונה גם תוסף שאינו רץ כאן וגם כזה שמתג "רק מה שלא מותקן"
        // מסתיר — ומספר שאינו תואם לרשימה שמתחתיו הוא מספר שקרי.
        count: controller.pluginsIn(category).length,
        iconName: 'puzzle-piece',
        active: controller.openCategorySlug === category.slug,
        onTap: () => controller.showCategory(category.slug),
      })),
      h('hr.sidebar__divider'),
      // "כל התוספים" — מוצא אחרון, מוצנע בתחתית הסרגל, כמו באתר.
      item({
        label: t.allPluginsPage,
        count: controller.plugins.length,
        iconName: 'apps-list',
        active: controller.view === Page.all,
        muted: true,
        onTap: () => controller.showAllPlugins(),
      }));
}

/** שורת הקטגוריות למסך צר — המקבילה ל-`nav` האופקי שבאתר. */
function categoryBar(controller) {
  const t = S.plugins;
  return h('div.category-bar',
      tagPill({
        label: t.storeHomeChip,
        active: controller.view === Page.home,
        onTap: () => controller.showHome(),
      }),
      controller.categories.map((category) => tagPill({
        // אותו מספר שבסרגל הצד — מה שיוצג בפועל.
        label: `${category.name} (${controller.pluginsIn(category).length})`,
        active: controller.openCategorySlug === category.slug,
        onTap: () => controller.showCategory(category.slug),
      })),
      tagPill({
        label: t.allPluginsWithCount(controller.plugins.length),
        active: controller.view === Page.all,
        onTap: () => controller.showAllPlugins(),
      }));
}

// ── דף הבית האצור ────────────────────────────────────────────────────────────

function homeSections(controller) {
  const t = S.plugins;
  const featured = controller.featured;
  const visibleFeatured = local.allFeaturedShown
      ? featured
      : featured.slice(0, FEATURED_PREVIEW_COUNT);
  const sections = [h('div.store__pad', hero(controller))];

  // אין אצירה להציג — שער אל כל התוספים, כמו המצב הריק של דף הבית באתר.
  if (!controller.hasCuratedHome) {
    sections.push(h('div.store__pad', emptyState({
      title: t.emptyStoreTitle,
      body: t.emptyStoreBody,
      action: actionButton({
        text: t.allPluginsWithCount(controller.plugins.length),
        variant: 'recommended',
        iconName: 'apps-list',
        onPressed: () => controller.showAllPlugins(),
      }),
    })));
  }

  // יש אצירה, אבל המתג "רק מה שלא מותקן" הסתיר את כולה.
  if (controller.hasCuratedHome && featured.length === 0 &&
      controller.homeCategories.length === 0) {
    sections.push(h('div.store__pad', allInstalledState(controller)));
  }

  if (featured.length > 0) {
    sections.push(h('div.store__pad.store__pad--section',
        sectionHeader({title: t.featuredTitle})));
    sections.push(h('div.store__pad', grid(controller, visibleFeatured)));
    if (featured.length > FEATURED_PREVIEW_COUNT && !local.allFeaturedShown) {
      sections.push(h('div.store__pad.store__pad--center', actionButton({
        text: t.showMoreFeatured,
        variant: 'neutral',
        onPressed: () => {
          local.allFeaturedShown = true;
          controller.notifyRerender();
        },
      })));
    }
  }

  for (const category of controller.homeCategories) {
    sections.push(h('div.store__pad.store__pad--section', sectionHeader({
      title: category.name,
      description: category.description,
      action: actionButton({
        // אותו מספר שדף הקטגוריה עצמו יציג.
        text: t.categoryLinkButton(controller.pluginsIn(category).length),
        variant: 'ghost',
        iconName: 'arrow-left',
        onPressed: () => controller.showCategory(category.slug),
      }),
    })));
    sections.push(h('div.store__pad',
        grid(controller, controller.pluginsIn(category, category.homeLimit))));
  }

  if (controller.hasCuratedHome) {
    sections.push(h('div.store__pad.store__pad--section',
        discoveryStrip(controller)));
  }
  return sections;
}

/**
 * ה-hero של דף הבית: כותרת, תקציר ותיבת חיפוש בולטת. באתר החיפוש מוביל
 * לדף חיפוש צד-שרת; כאן — לסינון המקומי ב"כל התוספים".
 */
function hero(controller) {
  const t = S.plugins;
  const input = h('input.hero__input', {type: 'search', placeholder: t.heroSearchHint,
    'aria-label': t.filterSearchLabel, role: 'combobox', 'aria-autocomplete': 'list',
    'aria-expanded': 'false', 'aria-controls': 'store-suggestions',
    value: local.heroQuery, dataset: {focusKey: 'hero-search'}});
  const list = h('div.search-suggestions', {id: 'store-suggestions', role: 'listbox', hidden: true});
  let matches = [], selected = -1;
  const close = () => {list.hidden = true; input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');};
  const update = () => {
    local.heroQuery = input.value; selected = -1;
    matches = controller.plugins.filter(p => p.matchesQuery(input.value) &&
      (!controller.hideInstalled || controller.statusOf(p) !== InstallStatus.upToDate)).slice(0, 6);
    list.replaceChildren(...matches.map((p, i) => h('button.search-suggestions__item', {
      id: 'store-suggestion-' + i, role: 'option', type: 'button', tabindex: '-1',
      'aria-selected': 'false', onmousedown: e => e.preventDefault(),
      onclick: () => controller.openPlugin(p.id)},
      thumbnail({relativePath: p.imagePath, aspect: '1'}),
      h('span', h('strong', {text: p.name}), h('small', {text: p.shortDescription})))));
    list.hidden = !input.value.trim() || matches.length === 0;
    input.setAttribute('aria-expanded', String(!list.hidden));
  };
  input.addEventListener('input', update);
  input.addEventListener('focus', update);
  input.addEventListener('blur', close);
  input.addEventListener('keydown', event => {
    if (event.key === 'Escape') {close(); return;}
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !list.hidden) {
      event.preventDefault();
      selected = (selected + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length;
      [...list.children].forEach((el, i) => el.setAttribute('aria-selected', String(i === selected)));
      input.setAttribute('aria-activedescendant', 'store-suggestion-' + selected);
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (selected >= 0 && !list.hidden) controller.openPlugin(matches[selected].id);
      else controller.showAllPlugins(input.value);
    }
  });
  return h('header.hero',
    h('div.hero__heading', h('span.hero__icon', icon('puzzle-piece', 30)),
      h('div', h('h1.hero__title', {text: controller.homeTitle}),
        h('p.hero__subtitle', {text: controller.homeSubtitle}))),
    h('div.hero__search', icon('search', 24), input, list));
}

function discoveryStrip(controller) {
  const t = S.plugins;
  return appCard({
    className: 'discovery',
    children: [
      h('span.discovery__prompt', {text: t.browseAllPrompt}),
      actionButton({
        text: t.browseAllButton(controller.plugins.length),
        variant: 'neutral',
        iconName: 'apps-list',
        onPressed: () => controller.showAllPlugins(),
      }),
    ],
  });
}

function sectionHeader({title, description = null,
                        action = null}) {
  return h('div.section-header',
      h('div.section-header__text',

        h('h2.section-header__title', {text: title}),
        description ? h('p.section-header__desc', {text: description}) : null),
      action);
}

// ── "כל התוספים" ─────────────────────────────────────────────────────────────

function listingHeading(controller, title) {
  return h('div.listing-heading',
    h('nav.breadcrumb', {'aria-label': 'פירורי לחם'},
      actionButton({text: S.plugins.storeHomeItem, variant: 'ghost',
        onPressed: () => controller.showHome()}), icon('arrow-left', 16), h('span', {text: title})),
    h('h1.hero__title', {text: title}));
}

function allSections(controller) {
  const t = S.plugins;
  const filtered = controller.filtered;
  const sections = [
    h('div.store__pad', listingHeading(controller, t.allPluginsPage), filtersBar(controller)),
    h('div.store__pad.store__pad--section', sectionHeader({
      title: t.listTitle,
      description: summaryText(controller, filtered),
    })),
  ];

  if (filtered.length === 0) {
    sections.push(h('div.store__pad', noResultsState(controller)));
  } else {
    sections.push(h('div.store__pad', grid(controller, filtered)));
  }
  return sections;
}

function summaryText(controller, filtered) {
  const t = S.plugins;
  if (filtered.length === 0) return t.summaryNoResults;
  if (filtered.length === controller.plugins.length) return t.summaryAllShown;
  return t.summaryPartial(filtered.length, controller.plugins.length);
}

/**
 * שורת החיפוש והסינון. מוצגת **רק** במסך "כל התוספים", בדיוק כמו
 * `/plugins/all` באתר: דף הבית ודף הקטגוריה מציגים אצירה ואין בהם סינון.
 * הקטגוריות אינן כאן אלא בסרגל הצד — הן הניווט הראשי, והתגיות סינון
 * משני בתוך הרשימה השטוחה.
 */
function filtersBar(controller) {
  const t = S.plugins;

  const search = h('input.text-field', {
    type: 'search',
    value: controller.search,
    placeholder: t.filterSearchHint,
    'aria-label': t.filterSearchLabel,
    // כל תו מרנדר את המסך מחדש — המיקוד והסמן משוחזרים לפי המפתח הזה
    // (ראו `captureFocus`), אחרת ההקלדה נעצרת אחרי התו הראשון.
    dataset: {focusKey: 'filters-search'},
  });
  // `input` ולא `change`: הסינון מקומי ומיד, כמו במקור.
  search.addEventListener('input', () => controller.setSearch(search.value));

  const statusLabels = {
    [StatusFilter.all]: t.filterStatusAll,
    [StatusFilter.stable]: t.statusStable,
    [StatusFilter.beta]: t.statusBeta,
    [StatusFilter.experimental]: t.statusExperimental,
  };
  const select = h('select.select', {
    'aria-label': t.filterStatusLabel,
    onchange: (event) => controller.setStatusFilter(event.target.value),
    dataset: {focusKey: 'filters-status'},
  }, Object.entries(statusLabels).map(([value, label]) => h('option', {
    value, text: label, selected: controller.statusFilter === value,
  })));

  const counts = new Map(controller.allTags.map(tag => [tag,
    controller.plugins.filter(p => p.tags.includes(tag) &&
      (!controller.hideInstalled || controller.statusOf(p) !== InstallStatus.upToDate)).length]));
  const tags = [...counts.keys()].filter(tag => counts.get(tag) > 0)
    .sort((a, b) => counts.get(b) - counts.get(a) || a.localeCompare(b, 'he'));
  const tagSelect = h('select.select.tags-select', {
    'aria-label': t.filterTagsLabel, dataset: {focusKey: 'filters-tags'},
    onchange: event => controller.setTagFilter(event.target.value || null)},
    h('option', {value: '', text: t.filterAllTags, selected: controller.tagFilter === null}),
    tags.map(tag => h('option', {value: tag, text: tag + ' (' + counts.get(tag) + ')',
      selected: controller.tagFilter === tag})));
  return h('div.filters',
    h('div.filters__row',
      h('div.filters__field.filters__field--grow', fieldLabel(t.filterSearchLabel),
        h('div.text-field__wrap', icon('search', 20), search)),
      h('div.filters__field.filters__field--status', fieldLabel(t.filterStatusLabel), select)),
    tags.length === 0 ? null : h('div.filters__tags', fieldLabel(t.filterTagsLabel),
      h('div.pill-row', tagSelect, tags.slice(0, COLLAPSED_TAG_COUNT).map(tag => tagPill({
        label: tag + ' (' + counts.get(tag) + ')', active: controller.tagFilter === tag,
        onTap: () => controller.setTagFilter(controller.tagFilter === tag ? null : tag)})))));

}

// ── דף קטגוריה ───────────────────────────────────────────────────────────────

function categorySections(controller) {
  const t = S.plugins;
  const category = controller.openCategory;
  if (category === null) return [];

  const plugins = controller.pluginsIn(category);
  const sections = [h('div.store__pad.category-heading',
    listingHeading(controller, category.name),
    category.description ? h('p.section-header__desc', {text: category.description}) : null,
    h('p.category-summary', {text: t.categoryPluginCount(plugins.length) +
      (category.sortMode === 'rating' ? ' · מסודרים לפי דירוג המשתמשים' : '')}))];

  if (plugins.length === 0) {
    // הקטגוריה אינה בהכרח ריקה — ייתכן שהמתג "רק מה שלא מותקן" הסתיר
    // את כולה, ואז ההסבר הנכון הוא אחר לגמרי (כמו ב-`noResultsState`).
    const hiddenByToggle = controller.hideInstalled &&
        category.pluginIds.some((id) => {
          const plugin = controller.byId(id);
          return plugin !== null &&
              controller.statusOf(plugin) === InstallStatus.upToDate;
        });
    sections.push(h('div.store__pad', hiddenByToggle
        ? allInstalledState(controller)
        : emptyState({
            title: t.emptyCategoryTitle,
            body: t.emptyCategoryBody,
            action: actionButton({
              text: t.allPluginsButton,
              variant: 'neutral',
              iconName: 'apps-list',
              onPressed: () => controller.showAllPlugins(),
            }),
          })));
  } else {
    sections.push(h('div.store__pad', grid(controller, plugins)));
  }
  return sections;
}

// ── תוספים שהוסתרו בגלל תאימות ───────────────────────────────────────────────

/**
 * שורת ההסבר בתחתית הרשימה, או `null` כשלא הוסתר כלום.
 *
 * **שורה אחת ולא התראה**: זה מצב תקין של מראה שנבנתה עבור גרסה אחרת, לא
 * תקלה — אבל בלי שום אזכור, "התוסף קיים באתר ואצלי הוא נעלם" אינו ניתן
 * לאבחון מרחוק, וזו בדיוק השאלה שמגיעה מהמשתמשים.
 */
function hiddenNote(controller) {
  if (controller.hiddenCount === 0) return null;
  return h('div.store__pad',
      appCard({
        className: 'hidden-note',
        children: [
          icon('info', 20),
          h('span.hidden-note__text', {
            text: S.plugins.hiddenByCompatibility(
                controller.hiddenCount, controller.appVersion,
                controller.targetAppVersions),
          }),
        ],
      }));
}

// ── מצבים ריקים ──────────────────────────────────────────────────────────────

/** מראה שאין בה אף תוסף שירוץ על אוצריא שכאן. */
function hiddenOnlyState(controller) {
  const t = S.plugins;
  return emptyState({
    title: t.hiddenOnlyTitle,
    body: t.hiddenOnlyBody(controller.hiddenCount, controller.appVersion,
                           controller.targetAppVersions),
  });
}

function neverSyncedState(controller, readOnly) {
  const t = S.plugins;
  return emptyState({
    title: t.neverSyncedTitle,
    body: readOnly ? S.readOnlyDrive.downloadsDisabledSnack : t.neverSyncedBody,
    action: readOnly ? null : actionButton({
      text: t.syncButton,
      variant: 'recommended',
      iconName: 'arrow-sync',
      onPressed: () => void runSync(controller),
    }),
  });
}

function allInstalledState(controller) {
  const t = S.plugins;
  return emptyState({
    title: t.allInstalledTitle,
    body: t.allInstalledBody,
    action: actionButton({
      text: t.showInstalledButton,
      variant: 'neutral',
      onPressed: () => controller.setHideInstalled(false),
    }),
  });
}

function noResultsState(controller) {
  const t = S.plugins;
  // כשהמתג הוא שהסתיר הכול, ההסבר הנכון הוא אחר.
  const hiddenByToggle = controller.hideInstalled &&
      controller.plugins.some(
          (p) => p.matchesQuery(controller.search) &&
              controller.statusOf(p) === InstallStatus.upToDate);
  if (hiddenByToggle) return allInstalledState(controller);

  return emptyState({
    title: t.noResultsTitle,
    body: t.noResultsBody,
    action: actionButton({
      text: t.showInstalledButton,
      variant: 'ghost',
      onPressed: () => controller.setHideInstalled(false),
    }),
  });
}

// ── רשת הכרטיסים ─────────────────────────────────────────────────────────────

function grid(controller, plugins) {
  return h('div.grid', plugins.map((plugin) => storeCard(controller, plugin)));
}

/** כרטיס תוסף בודד ברשת. פורט של `PluginStoreCard`. */
function storeCard(controller, plugin) {
  const t = S.plugins;
  const status = controller.statusOf(plugin);
  const target = controller.targetOf(plugin);
  const busy = local.busyPluginId === plugin.id;
  const supportsInstall = target?.supportsDirectInstall ??
      plugin.supportsDirectInstall;

  return appCard({
    className: 'plugin-card',
    onTap: () => controller.openPlugin(plugin.id),
    children: [
      h('div.plugin-card__heading',
        thumbnail({relativePath: plugin.imagePath, aspect: '1'}),
        h('div.plugin-card__identity',
          h('h3.plugin-card__name', {text: plugin.name, dir: 'auto'}),
          h('div.plugin-card__meta',
            plugin.ratingCount > 0 ? h('span.plugin-card__rating',
              icon('star-filled-16', 14), h('span', {text:
                formatRating(plugin.ratingAvg) + ' (' + plugin.ratingCount + ')'})) : null,
            h('span.plugin-card__downloads', {title: 'מספר הורדות'},
              icon('arrow-download', 15), h('span', {text: plugin.downloadCount.toLocaleString('he-IL')})),
            h('span.plugin-card__version', {text: t.pluginVersionBadge(controller.versionOf(plugin))}),
            (target?.status ?? plugin.status) === 'stable' ? null :
              h('span.plugin-card__status', {text: pluginStatusLabel(target?.status ?? plugin.status)})),
          installChip({status, compact: true}))),
      h('p.plugin-card__desc', {text: plugin.shortDescription, dir: 'auto'}),
      h('div.plugin-card__actions',
        actionButton({text: t.saveButton, variant: 'neutral', iconName: 'arrow-download',
          loading: busy, className: 'grow',
          onPressed: controller.hasFileFor(plugin) ? (event) => {
            event.stopPropagation(); void saveCopy(controller, plugin);
          } : null}),
        !supportsInstall ? null : actionButton({text: t.installButton,
          variant: 'outlined', iconName: 'install-desktop', loading: busy, className: 'grow',
          onPressed: target === null ? null : (event) => {
            event.stopPropagation(); void install(controller, plugin);
          }})),
    ],
  });
}

/**
 * תאריך העדכון של התוסף בגימטריה, או `null` כשהקטלוג לא נשא תאריך
 * (שני השדות הם מחרוזות, וברירת המחדל שלהן ריקה).
 */
function updatedOn(plugin) {
  return formatHebrewDate(plugin.originalDate || plugin.updatedAt) || null;
}

// ── דף פרטי התוסף ────────────────────────────────────────────────────────────

function detailHeader(controller, plugin) {
  return h('div.detail-header',
      actionButton({
        text: S.plugins.backToStore,
        variant: 'ghost',
        // בעברית "חזרה" היא ימינה.
        iconName: 'arrow-right',
        onPressed: () => controller.closePlugin(),
      }),
      h('span.detail-header__name', {text: plugin.name}));
}

function detailBody(controller, plugin) {
  const t = S.plugins;
  const target = controller.targetOf(plugin);
  const facts = [
    [t.ratingPanelTitle, plugin.ratingCount ? formatRating(plugin.ratingAvg) + ' (' + plugin.ratingCount + ')' : t.ratingEmpty],
    ['הורדות', plugin.downloadCount.toLocaleString('he-IL')],
    [t.infoVersion, controller.versionOf(plugin)],
    [t.infoCompatibility, compatibilityValue(plugin, target)],
    [t.infoAuthor, plugin.author || t.valueUnspecifiedMasculine],
  ];
  const panels = [heroPanel(controller, plugin), h('div.detail-facts', facts.map(([label, value]) =>
    h('div.detail-fact', h('div.detail-fact__label', {text: label}),
      h('div.detail-fact__value', {text: value}))))];
  panels.push(infoPanel(controller, plugin));
  if (plugin.tags.length) panels.push(panel({title: t.tagsPanelTitle,
    children: [h('div.pill-row', plugin.tags.map(tag => tagPill({label: tag,
      onTap: () => {controller.setTagFilter(tag); controller.showAllPlugins();}})))]}));
  panels.push(panel({title: t.ratingPanelTitle, children: [ratingSummary(plugin)]}));
  if (plugin.versions.length) panels.push(panel({title: 'היסטוריית גרסאות', children: [
    h('table.version-history',
      h('thead', h('tr', ['גרסה', 'סטטוס', 'תאריך', 'תאימות לאוצריא'].map(text => h('th', {text, scope: 'col'})))),
      h('tbody', plugin.versions.map(v => h('tr',
        h('td', h('bdi', {text: v.version}),
          v.version === target?.version ? h('small', {text: ' · הגרסה המתאימה למחשב זה'}) : null),
        h('td', {text: pluginStatusLabel(v.status)}),
        h('td', {text: formatHebrewDate(v.releasedAt) || t.valueUnspecifiedMasculine}),
        h('td', {text: compatibilityValue(plugin, v)}))))) ]}));
  return h('div.store__pad.detail', panels);
}

function heroPanel(controller, plugin) {
  const t = S.plugins;
  const target = controller.targetOf(plugin);
  const busy = local.busyPluginId === plugin.id;
  const supportsInstall = target?.supportsDirectInstall ?? plugin.supportsDirectInstall;
  const shots = plugin.screenshotPaths;
  let shotIndex = 0;
  const image = shots.length ? h('img.detail-preview__image', {src: assetUrl(shots[0]), alt: t.screenshotsPanelTitle}) : null;
  const preview = !shots.length ? null : h('div.detail-preview',
    h('button.detail-preview__zoom', {type: 'button', 'aria-label': t.screenshotsPanelTitle,
      onclick: () => showScreenshots({paths: shots, initialIndex: shotIndex})}, image),
    shots.length < 2 ? null : h('div.detail-preview__nav', shots.map((relative, index) =>
      h('button', {type: 'button', 'aria-label': 'צילום מסך ' + (index + 1),
        'aria-pressed': String(index === 0), onclick: event => {
          shotIndex = index; image.src = assetUrl(relative);
          [...event.currentTarget.parentElement.children].forEach((el, i) =>
            el.setAttribute('aria-pressed', String(i === index)));
        }}, h('img', {src: assetUrl(relative), alt: '', loading: 'lazy'})))));
  return h('div.detail-hero',
    h('div.detail-hero__text',
      h('div.detail-hero__identity', thumbnail({relativePath: plugin.imagePath, aspect: '1'}),
        h('div', h('h1.detail-hero__name', {text: plugin.name, dir: 'auto'}),
          h('div.badge-row', pluginBadge({label: pluginStatusLabel(target?.status ?? plugin.status), emphasized: true}),
            installChip({status: controller.statusOf(plugin), installedVersion: controller.installedVersionOf(plugin)})))),
      h('p.detail-hero__desc', {text: plugin.shortDescription}),
      h('div.detail-hero__actions',
        actionButton({text: t.saveButton, variant: 'recommended', iconName: 'arrow-download', loading: busy,
          onPressed: controller.hasFileFor(plugin) ? () => void saveCopy(controller, plugin) : null}),
        !supportsInstall ? null : actionButton({text: t.directInstallButton, variant: 'outlined',
          iconName: 'install-desktop', loading: busy, onPressed: target === null ? null : () => void install(controller, plugin)}),
        !plugin.homepage ? null : actionButton({text: t.sourcePageButton, variant: 'ghost',
          iconName: 'open', onPressed: () => void openHomepage(controller, plugin)}))), preview);
}

function infoPanel(controller, plugin) {
  const t = S.plugins;
  // כל השדות התלויי-גרסה מתארים את הבילד שיותקן כאן, לא את החי באתר.
  const target = controller.targetOf(plugin);
  const localFile = plugin.localFileFor(target?.version);
  const version = controller.versionOf(plugin);

  const cells = [
    {label: t.infoVersion, value: version || t.valueUnspecifiedFeminine},
    {label: t.infoStatus,
     value: pluginStatusLabel(target?.status ?? plugin.status)},
    {label: t.infoAuthor,
     value: plugin.author || t.valueUnspecifiedMasculine},
    // כמו כל תא אחר כאן: חוסר נאמר במפורש ולא נשאר תא ריק.
    {label: t.infoUpdated,
     value: updatedOn(plugin) ?? t.valueUnspecifiedMasculine},
    {label: t.infoNetwork,
     value: (target?.requiresNetwork ?? plugin.requiresNetwork)
         ? t.infoNetworkRequired : t.infoNetworkNotRequired},
    {label: t.infoCompatibility, value: compatibilityValue(plugin, target),
     wide: true},
    {label: t.infoLocalFile,
     value: localFile === null
         ? t.infoLocalFileMissing
         : t.localFileDescription(localFile.fileName,
                                  formatSize(localFile.size)),
     wide: true},
  ];

  return panel({
    title: t.infoPanelTitle,
    className: 'panel--info',
    children: [h('p.detail-description', {text: plugin.description}), h('div.info-grid', cells.map(infoCell))],
  });
}

/** טווח התאימות של הבילד שנבחר; בלי בילד תואם — של התוסף בכללותו. */
function compatibilityValue(plugin, target) {
  const t = S.plugins;
  const from = target?.compatibleWith ?? plugin.compatibleWith;
  const to = target?.maxAppVersion ?? plugin.maxAppVersion;
  if (!from) return t.valueUnspecifiedFeminine;
  return to === null || to === undefined ? from : t.compatibilityRange(from, to);
}

/**
 * גודל ידוע מוצג דרך `formatBytes` המשותף — כפילות כאן החזירה יחידות
 * קבועות באנגלית בתוך משפט עברי.
 */
const formatSize = (bytes) =>
    bytes <= 0 ? S.plugins.sizeUnknown : formatBytes(bytes);

/**
 * סעיף "דירוג המשתמשים" — הממוצע, הכוכבים, מספר המדרגים והפילוח לפי
 * ציון. פורט של `PluginRatingSummary`.
 *
 * **תצוגה בלבד.** הדירוג נעשה באתר ודורש חשבון; המראה רק נושאת את
 * המספרים אל המחשב הלא-מקוון.
 */
function ratingSummary(plugin) {
  const t = S.plugins;
  const rated = plugin.ratingCount > 0;

  const average = h('div.rating__average',
      rated ? h('div.rating__value', {text: formatRating(plugin.ratingAvg)})
            : null,
      ratingStars({value: rated ? plugin.ratingAvg : 0, size: 22}),
      h('div.rating__count',
        {text: rated ? t.ratingCountLabel(plugin.ratingCount)
                     : t.ratingEmpty}),
      plugin.ratingVerifiedCount > 0
          ? h('div', {title: t.ratingVerifiedTooltip},
              statusChip({kind: 'ok',
                          label: t.ratingVerifiedLabel(
                              plugin.ratingVerifiedCount)}))
          : null);

  // בלי דירוגים אין מה לפלח — נשארת רק ההודעה "עדיין לא דורג".
  if (!rated) return average;

  const rows = [];
  for (let score = 5; score >= 1; score--) {
    // פילוח קצר (קטלוג פגום) נקרא כאפס ולא מפיל את השורה.
    const count = score <= plugin.ratingBreakdown.length
        ? plugin.ratingBreakdown[score - 1] : 0;
    const fraction = plugin.ratingCount <= 0 ? 0 : count / plugin.ratingCount;
    rows.push(h('div.rating__row',
        h('span.rating__score', h('span', {text: String(score)}),
          icon('star-filled-16', 13)),
        h('span.rating__meter',
          h('span.rating__meter-fill',
            {style: {width: `${fraction * 100}%`}})),
        h('span.rating__row-count', {text: String(count)})));
  }

  return h('div.rating', average, h('div.rating__breakdown', rows));
}

// ── פעולות ───────────────────────────────────────────────────────────────────

// ⚠️ **שתי הפעולות האלה חייבות `finally`.** הן מדליקות ספינר על הכפתור
// (`local.busyPluginId`) וממתינות לגשר. כישלון שאינו מוחזר כערך אלא
// נזרק — חלון שמירה שלא נפתח, תשובה שלא חזרה מה-host — היה יוצא מכאן
// דרך `void`, בלי הודעה, ומשאיר את הספינר דולק עד סוף ההרצה.

async function saveCopy(controller, plugin) {
  let destPath;
  try {
    destPath = await controller.manager.sys.saveDialog(
        controller.suggestedFileName(plugin));
  } catch (error) {
    // מערכת ההפעלה כבר מנסחת את הסיבה ("לא נבחר מקום לשמירה"), ולכן
    // היא מוצגת כמו שהיא.
    showError(error?.message ?? S.plugins.saveFailedSnack);
    return;
  }
  // ביטול אינו שגיאה.
  if (destPath === null) return;

  local.busyPluginId = plugin.id;
  controller.notifyRerender();
  try {
    const result = await controller.saveCopy(plugin, destPath);
    if (result.success) showSuccess(S.plugins.saveDoneSnack);
    else showError(result.error ?? S.plugins.saveFailedSnack);
  } catch (error) {
    showError(error?.message ?? S.plugins.saveFailedSnack);
  } finally {
    local.busyPluginId = null;
    controller.notifyRerender();
  }
}

async function install(controller, plugin) {
  local.busyPluginId = plugin.id;
  controller.notifyRerender();
  try {
    const result = await controller.install(plugin);
    // ההצלחה כאן היא של ה**מסירה** בלבד — ההתקנה נגמרת בחלון של אוצריא,
    // וההודעה על סיומה מגיעה מהסריקה שרצה ברקע.
    if (result.success) showSnack(S.plugins.installOpenedSnack(plugin.name));
    else showError(result.error ?? S.plugins.installFailedSnack);
  } catch (error) {
    showError(error?.message ?? S.plugins.installFailedSnack);
  } finally {
    local.busyPluginId = null;
    controller.notifyRerender();
  }
}

/**
 * פותח את עמוד המקור בדפדפן.
 *
 * התוצאה נבדקת: `openExternalUrl` מחזירה כישלון כערך, ובלי לקרוא אותו
 * לחיצה שלא פתחה כלום נראתה כמו כפתור מקולקל.
 */
async function openHomepage(controller, plugin) {
  try {
    const result = await controller.openHomepage(plugin.homepage);
    if (!result.success) showError(result.error ?? S.common.error);
  } catch (error) {
    showError(error?.message ?? S.common.error);
  }
}

/** מאפס את מצב התצוגה המקומי — נקרא בניווט. */
export function resetLocalViewState() {
  local.allFeaturedShown = false;
  local.heroQuery = '';
}
