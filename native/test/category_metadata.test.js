import assert from 'node:assert/strict';
import {test} from 'node:test';
import {PluginCatalog, PluginStoreCategory} from '../web/js/store/models.js';

test('קטגוריה שומרת סדר דירוג מהאתר ומטא-דאטה גם בקטלוג לא-מקוון', () => {
  const category = PluginStoreCategory.fromApi({
    slug: 'study', name: 'לימוד', sortMode: 'rating',
    plugins: [{id: 'weighted-first'}, {id: 'highest-average'}],
  });
  const catalog = PluginCatalog.fromJson(JSON.parse(JSON.stringify(
      new PluginCatalog({categories: [category]}))));
  assert.equal(catalog.categories[0].sortMode, 'rating');
  assert.deepEqual(catalog.categories[0].pluginIds,
      ['weighted-first', 'highest-average']);
  assert.equal(category.copyWith({showOnHome: true}).sortMode, 'rating');
});

test('קטלוג ישן או מצב מיון לא מוכר נשאר בסדר שהתקבל מהאתר', () => {
  for (const sortMode of [undefined, 'unknown', null]) {
    const category = PluginStoreCategory.fromJson({
      slug: 'study', plugins: ['second', 'first'], sortMode,
    });
    assert.equal(category.sortMode, 'manual');
    assert.deepEqual(category.pluginIds, ['second', 'first']);
  }
});
