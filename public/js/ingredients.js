// 材料画面：材料マスタの一覧・追加/編集・削除、レシピからの取り込み
import {
  t, h, locNode, toast, errorText, showFormError, matchesKeyword, byName,
  api, saveItem, deleteItem, reloadAll, store,
  langInput, collectLoc, isBlankLoc, LangEditor, guardUnsaved,
  findIngredient, ingredientAliases, ingredientUsage,
  tagChips, renderTagFilter, renderTagPicker, pickedTags,
} from './common.js';

const state = {
  keyword: '',
  tag: '',
  editingId: null,
  formSnapshot: '', // フォームを開いた時点の内容（閉じるときに変更があるか比べる）
};

const $ = (sel) => document.querySelector(sel);
const el = {
  list: $('#ingredient-list'),
  empty: $('#ingredient-empty'),
  count: $('#ingredient-count'),
  search: $('#ingredient-search'),
  tagFilter: $('#ingredient-tag-filter'),
  dialog: $('#ingredient-dialog'),
  form: $('#ingredient-form'),
  formTitle: $('#ingredient-form-title'),
  formError: $('#ingredient-form-error'),
  nameFields: $('#ingredient-name-fields'),
  aliasFields: $('#ingredient-alias-fields'),
  tagPicker: $('#ingredient-tag-picker'),
  pantry: $('#ingredient-pantry'),
  usage: $('#ingredient-usage'),
  deleteBtn: $('#btn-delete-ingredient'),
};

const langEditor = new LangEditor({
  form: el.form,
  tabs: $('#ingredient-lang-tabs'),
  nameGroup: el.nameFields,
  nameField: 'name',
});

// 別名はカンマ（全角・読点も可）区切りで入力する
const splitAliases = (text) => text.split(/[,，、]/).map((s) => s.trim()).filter(Boolean);

// ---------- 一覧 ----------

function filteredIngredients() {
  return store.ingredients
    .filter((ing) => !state.tag || (ing.tags || []).includes(state.tag))
    .filter((ing) => matchesKeyword(state.keyword, [...I18N.allTexts(ing.name), ...ingredientAliases(ing)]))
    .sort(byName((ing) => ing.name));
}

// 現在の言語以外の名前を「简体中文: 鸡腿肉」の形で並べる
function otherNames(loc) {
  return I18N.LANGUAGES
    .filter((l) => l.code !== I18N.language && loc && loc[l.code])
    .map((l) => `${l.label}: ${loc[l.code]}`)
    .join(' / ');
}

function renderList() {
  const items = filteredIngredients();
  el.list.replaceChildren(
    ...items.map((ing) => {
      const usage = ingredientUsage(ing.id);
      const aliases = ingredientAliases(ing);
      return h('button', { type: 'button', class: 'item-row', onclick: () => openForm(ing) },
        h('div', { class: 'item-main' },
          h('div', { class: 'item-title' },
            locNode('span', ing.name, { class: 'item-name' }),
            ing.pantry && h('span', { class: 'tag pantry' }, t('ingredient.pantry')),
          ),
          h('span', { class: 'item-sub' }, otherNames(ing.name)),
          aliases.length > 0 && h('span', { class: 'item-sub' }, `${t('ingredient.aliases')}: ${aliases.join(', ')}`),
        ),
        h('div', { class: 'chips' }, tagChips(ing.tags)),
        h('span', { class: `item-usage${usage ? '' : ' unused'}` },
          usage ? t('ingredient.usage', { n: usage }) : t('ingredient.unused')),
      );
    }),
  );
  el.empty.hidden = items.length > 0;
  el.count.textContent = t('list.count', { shown: items.length, total: store.ingredients.length });
}

export function render() {
  state.tag = renderTagFilter(el.tagFilter, state.tag, 'ingredient', 'filter.ingredientTagsAllShort');
  renderList();
}

async function importFromRecipes() {
  try {
    const result = await api('/api/ingredients/import', { method: 'POST' });
    toast(result.linked ? t('ingredient.importDone', result) : t('ingredient.importNone'));
    await reloadAll();
  } catch (err) {
    toast(errorText(err), true);
  }
}

// ---------- フォーム ----------

function openForm(ing = null) {
  state.editingId = ing ? ing.id : null;
  langEditor.reset();
  el.formTitle.dataset.i18n = ing ? 'ingredient.editTitle' : 'ingredient.newTitle';
  el.formTitle.textContent = t(el.formTitle.dataset.i18n);
  el.formError.hidden = true;

  const name = I18N.toLoc(ing && ing.name);
  const aliases = (ing && ing.aliases) || {};
  el.nameFields.replaceChildren(
    ...langEditor.panes((lang) => langInput('name', lang, name[lang], { max: 100, ph: 'ingredient.name' })),
  );
  el.aliasFields.replaceChildren(
    ...langEditor.panes((lang) => langInput('aliases', lang, (aliases[lang] || []).join(', '), { max: 500, ph: 'ingredient.aliasesPlaceholder' })),
  );
  renderTagPicker(el.tagPicker, ing ? ing.tags || [] : []);
  el.pantry.checked = Boolean(ing && ing.pantry);

  const usage = ing ? ingredientUsage(ing.id) : 0;
  el.usage.hidden = !ing;
  el.usage.textContent = usage ? t('ingredient.usage', { n: usage }) : t('ingredient.unused');
  el.deleteBtn.hidden = !ing;

  el.dialog.showModal();
  langEditor.set(langEditor.lang, true);
  state.formSnapshot = JSON.stringify(collectForm());
}

function collectForm() {
  const aliases = {};
  el.aliasFields.querySelectorAll('[data-field="aliases"]').forEach((input) => {
    const list = splitAliases(input.value);
    if (list.length) aliases[input.closest('.lang-pane').dataset.lang] = list;
  });
  return {
    name: collectLoc(el.nameFields, 'name'),
    aliases,
    tags: pickedTags(el.tagPicker),
    pantry: el.pantry.checked,
  };
}

async function submitForm(event) {
  event.preventDefault();
  const data = collectForm();
  if (isBlankLoc(data.name)) {
    showFormError(el.formError, 'error.NAME_REQUIRED');
    langEditor.set(langEditor.lang, true);
    return;
  }
  const submitBtn = el.form.querySelector('[type="submit"]');
  submitBtn.disabled = true;
  try {
    await saveItem('ingredients', state.editingId, data);
    el.dialog.close();
    toast(t('toast.saved'));
    await reloadAll();
  } catch (err) {
    showFormError(el.formError, err);
  } finally {
    submitBtn.disabled = false;
  }
}

async function deleteCurrent() {
  const ing = findIngredient(state.editingId);
  if (!ing) return;
  const usage = ingredientUsage(ing.id);
  const name = I18N.text(ing.name);
  const message = usage
    ? t('ingredient.confirmDeleteUsed', { name, n: usage })
    : t('ingredient.confirmDelete', { name });
  if (!confirm(message)) return;
  try {
    await deleteItem('ingredients', ing.id);
    el.dialog.close();
    toast(t('toast.deleted'));
    await reloadAll();
  } catch (err) {
    showFormError(el.formError, err);
  }
}

// ---------- 言語切り替え・初期化 ----------

export function onLanguageChange() {
  render();
  if (el.dialog.open) {
    renderTagPicker(el.tagPicker);
    langEditor.renderTabs();
    langEditor.refreshPlaceholders();
    const ing = findIngredient(state.editingId);
    if (ing) {
      const usage = ingredientUsage(ing.id);
      el.usage.textContent = usage ? t('ingredient.usage', { n: usage }) : t('ingredient.unused');
    }
  }
}

export function init() {
  $('#btn-new-ingredient').addEventListener('click', () => openForm());
  $('#btn-import-ingredients').addEventListener('click', importFromRecipes);
  el.deleteBtn.addEventListener('click', deleteCurrent);
  el.form.addEventListener('submit', submitForm);
  guardUnsaved(el.dialog, () => JSON.stringify(collectForm()) !== state.formSnapshot);
  el.search.addEventListener('input', () => {
    state.keyword = el.search.value;
    renderList();
  });
  el.tagFilter.addEventListener('change', () => {
    state.tag = el.tagFilter.value;
    renderList();
  });
}
