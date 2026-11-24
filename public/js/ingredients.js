// 材料画面：材料マスタの一覧・追加/編集・削除、レシピからの取り込み
import {
  t, h, locNode, toast, errorText, showFormError, matchesKeyword, byName,
  isFallback, untranslatedTag, otherNames,
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
  importGroups: [], // 取り込みの確認画面に出している候補（GET /api/ingredients/import の結果）
  highlight: new Set(), // 取り込み直後に目立たせる材料の ID
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
  importBtn: $('#btn-import-ingredients'),
  importDialog: $('#import-dialog'),
  importForm: $('#import-form'),
  importError: $('#import-form-error'),
  importApply: $('#btn-import-apply'),
  importSections: {
    create: { section: $('#import-create-section'), heading: $('#import-create-heading'), list: $('#import-create-list') },
    link: { section: $('#import-link-section'), heading: $('#import-link-heading'), list: $('#import-link-list') },
  },
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

function renderList() {
  const items = filteredIngredients();
  el.list.replaceChildren(
    ...items.map((ing) => {
      const usage = ingredientUsage(ing.id);
      const aliases = ingredientAliases(ing);
      const cls = state.highlight.has(ing.id) ? 'item-row highlight' : 'item-row';
      return h('button', { type: 'button', class: cls, onclick: () => openForm(ing) },
        h('div', { class: 'item-main' },
          h('div', { class: 'item-title' },
            locNode('span', ing.name, { class: 'item-name' }),
            isFallback(ing.name) && untranslatedTag(),
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

// ---------- レシピからの取り込み ----------
// 先に取り込み内容を確認画面に出し、チェックしたものだけを取り込む

const langLabel = (code) => (I18N.LANGUAGES.find((l) => l.code === code) || { label: code }).label;

// { ja: "玉ねぎ", zh: "洋葱" } → 「日本語: 玉ねぎ / 简体中文: 洋葱」
const namesText = (loc) => Object.entries(loc).map(([lang, v]) => `${langLabel(lang)}: ${v}`).join(' / ');
const aliasesText = (loc) => Object.entries(loc).map(([lang, list]) => `${langLabel(lang)}: ${list.join(', ')}`).join(' / ');

function usedInText(group) {
  const titles = group.recipeIds
    .map((id) => store.recipes.find((r) => r.id === id))
    .filter(Boolean)
    .map((r) => I18N.text(r.title));
  return `${t('ingredient.importUsedIn', { list: titles.join('、') })}（${t('ingredient.importRows', { n: group.rows })}）`;
}

function importItem(group, checked) {
  const isNew = group.action === 'create';
  // 紐付けは、紐付ける先の材料の今の名前で表示する
  const master = !isNew && findIngredient(group.ingredientId);
  const name = master ? master.name : group.name;
  const others = isNew ? otherNames(group.name) : '';
  return h('label', { class: 'import-item' },
    h('input', { type: 'checkbox', 'data-key': group.key, checked, onchange: updateImportApply }),
    h('div', { class: 'item-main' },
      h('div', { class: 'item-title' },
        locNode('span', name, { class: 'item-name' }),
        isFallback(name) && untranslatedTag(),
      ),
      others && h('span', { class: 'item-sub' }, others),
      isNew && Object.keys(group.addedAliases).length > 0 &&
        h('span', { class: 'item-sub' }, `${t('ingredient.aliases')}: ${aliasesText(group.addedAliases)}`),
      !isNew && Object.keys(group.addedNames).length > 0 &&
        h('span', { class: 'item-sub' }, `${t('ingredient.importAddedNames')}: ${namesText(group.addedNames)}`),
      !isNew && Object.keys(group.addedAliases).length > 0 &&
        h('span', { class: 'item-sub' }, `${t('ingredient.importAddedAliases')}: ${aliasesText(group.addedAliases)}`),
      h('span', { class: 'item-sub' }, usedInText(group)),
    ),
  );
}

const importCheckboxes = () => [...el.importForm.querySelectorAll('input[data-key]')];

function updateImportApply() {
  const n = importCheckboxes().filter((c) => c.checked).length;
  el.importApply.textContent = t('ingredient.importApply', { n });
  el.importApply.disabled = n === 0;
}

// 確認画面を描き直す。チェックの状態は描き直す前のものを引き継ぐ
function renderImportDialog() {
  const unchecked = new Set(importCheckboxes().filter((c) => !c.checked).map((c) => c.dataset.key));
  for (const [action, part] of Object.entries(el.importSections)) {
    const groups = state.importGroups
      .filter((g) => g.action === action)
      .sort(byName((g) => (action === 'link' && findIngredient(g.ingredientId)?.name) || g.name));
    part.section.hidden = groups.length === 0;
    part.heading.textContent = t(action === 'create' ? 'ingredient.importCreateSection' : 'ingredient.importLinkSection', { n: groups.length });
    part.list.replaceChildren(...groups.map((g) => importItem(g, !unchecked.has(g.key))));
  }
  updateImportApply();
}

async function openImportDialog() {
  el.importBtn.disabled = true;
  try {
    const preview = await api('/api/ingredients/import');
    if (!preview.groups.length) {
      toast(t('ingredient.importNone'));
      return;
    }
    state.importGroups = preview.groups;
    el.importError.hidden = true;
    // 前回のチェック状態を持ち越さない
    Object.values(el.importSections).forEach((part) => part.list.replaceChildren());
    renderImportDialog();
    el.importDialog.showModal();
  } catch (err) {
    toast(errorText(err), true);
  } finally {
    el.importBtn.disabled = false;
  }
}

function setImportChecked(checked) {
  importCheckboxes().forEach((c) => (c.checked = checked));
  updateImportApply();
}

async function applyImport(event) {
  event.preventDefault();
  const keys = importCheckboxes().filter((c) => c.checked).map((c) => c.dataset.key);
  if (!keys.length) return;
  el.importApply.disabled = true;
  try {
    const result = await api('/api/ingredients/import', { method: 'POST', body: JSON.stringify({ keys }) });
    el.importDialog.close();
    toast(result.linked ? t('ingredient.importDone', result) : t('ingredient.importNone'));
    highlight(result.groups.map((g) => g.ingredientId));
    await reloadAll();
    const first = el.list.querySelector('.item-row.highlight');
    if (first) first.scrollIntoView({ block: 'center', behavior: 'smooth' });
  } catch (err) {
    showFormError(el.importError, err);
    updateImportApply();
  }
}

// 取り込んだ材料を一覧で少しのあいだ目立たせる
let highlightTimer;
function highlight(ids) {
  state.highlight = new Set(ids);
  clearTimeout(highlightTimer);
  highlightTimer = setTimeout(() => {
    state.highlight.clear();
    renderList();
  }, 5000);
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
  if (el.importDialog.open) renderImportDialog();
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
  el.importBtn.addEventListener('click', openImportDialog);
  el.importForm.addEventListener('submit', applyImport);
  $('#btn-import-select-all').addEventListener('click', () => setImportChecked(true));
  $('#btn-import-select-none').addEventListener('click', () => setImportChecked(false));
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
