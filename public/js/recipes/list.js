// レシピ一覧：検索・絞り込み・カード
import {
  t, h, locNode, matchesKeyword, untranslatedTag, store,
  findIngredient, ingredientName, ingredientAliases, ingredientTagIds,
  findTag, tagChips, renderTagFilter,
} from '../common.js';
import { state, el, variantsOf, cardMeta } from './shared.js';
import { openDetail } from './detail.js';

// どの言語・どのバリエーションで検索しても見つかるよう、すべてのテキストを対象にする
function searchTexts(r) {
  return [
    ...I18N.allTexts(r.title),
    ...I18N.allTexts(r.description),
    I18N.categoryLabel(r.category),
    ...(r.tags || []).flatMap((id) => I18N.allTexts((findTag(id) || {}).name)),
    ...variantsOf(r).flatMap((v) => [
      ...I18N.allTexts(v.label),
      ...(v.ingredients || []).flatMap((row) => [
        ...I18N.allTexts(ingredientName(row)),
        ...ingredientAliases(findIngredient(row.ingredientId)),
      ]),
      ...(v.steps || []).flatMap((s) => I18N.allTexts(s)),
    ]),
  ];
}

function filteredRecipes() {
  return store.recipes
    .filter((r) => !state.category || r.category === state.category)
    .filter((r) => !state.recipeTag || (r.tags || []).includes(state.recipeTag))
    .filter((r) => !state.ingredientTag || ingredientTagIds(r).has(state.ingredientTag))
    .filter((r) => matchesKeyword(state.keyword, searchTexts(r)))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

// 既定カテゴリ（キー）＋ ユーザーが入力した独自カテゴリ
function allCategories() {
  const set = new Set(I18N.CATEGORY_KEYS);
  store.recipes.forEach((r) => r.category && set.add(r.category));
  return [...set];
}

export function renderFilters() {
  const categories = allCategories();
  el.categoryFilter.replaceChildren(
    h('option', { value: '' }, t('filter.allCategories')),
    ...categories.map((c) => h('option', { value: c }, I18N.categoryLabel(c))),
  );
  el.categoryFilter.value = categories.includes(state.category) ? state.category : '';
  state.category = el.categoryFilter.value;
  el.categoryOptions.replaceChildren(...categories.map((c) => h('option', { value: I18N.categoryLabel(c) })));

  state.recipeTag = renderTagFilter(el.recipeTagFilter, state.recipeTag, 'recipe', 'filter.recipeTagsAll');
  state.ingredientTag = renderTagFilter(el.ingredientTagFilter, state.ingredientTag, 'ingredient', 'filter.ingredientTagsAll');
}

export function renderList() {
  const items = filteredRecipes();
  el.list.replaceChildren(
    ...items.map((r) => {
      const fallback = {};
      const title = locNode('h2', r.title, {}, fallback);
      const desc = I18N.text(r.description) && locNode('p', r.description, { class: 'description' }, fallback);
      return h('button', { class: 'recipe-card', type: 'button', onclick: () => openDetail(r.id) },
        h('div', { class: 'card-tags' },
          r.category && h('span', { class: 'tag' }, I18N.categoryLabel(r.category)),
          fallback.lang && untranslatedTag(),
        ),
        title,
        desc,
        (r.tags || []).length > 0 && h('div', { class: 'chips' }, tagChips(r.tags)),
        h('p', { class: 'muted' }, cardMeta(r)),
      );
    }),
  );
  el.empty.hidden = items.length > 0;
  el.count.textContent = t('list.count', { shown: items.length, total: store.recipes.length });
}

export function initList() {
  el.search.addEventListener('input', () => {
    state.keyword = el.search.value;
    renderList();
  });
  el.categoryFilter.addEventListener('change', () => {
    state.category = el.categoryFilter.value;
    renderList();
  });
  el.recipeTagFilter.addEventListener('change', () => {
    state.recipeTag = el.recipeTagFilter.value;
    renderList();
  });
  el.ingredientTagFilter.addEventListener('change', () => {
    state.ingredientTag = el.ingredientTagFilter.value;
    renderList();
  });
}
