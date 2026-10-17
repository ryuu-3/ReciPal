// タグ画面：レシピのタグ（料理の特徴）と材料のタグ（材料の分類）の一覧・追加/編集・削除
import {
  t, h, locNode, toast, showFormError,
  saveItem, deleteItem, reloadAll,
  langInput, collectLoc, isBlankLoc, LangEditor, guardUnsaved,
  findTag, tagUsage, sortedTags,
} from './common.js';

const TYPE_TEXT = {
  recipe: { type: 'tag.typeRecipe', usage: 'tag.usageRecipe', confirm: 'tag.confirmDeleteRecipe' },
  ingredient: { type: 'tag.typeIngredient', usage: 'tag.usageIngredient', confirm: 'tag.confirmDeleteIngredient' },
};

const state = {
  editingId: null,
  type: 'recipe', // 新規作成時の種類（編集時は既存タグの種類）
  formSnapshot: '', // フォームを開いた時点の名前（閉じるときに変更があるか比べる）
};

const $ = (sel) => document.querySelector(sel);
const el = {
  sections: [...document.querySelectorAll('#view-tags .tag-section')],
  dialog: $('#tag-dialog'),
  form: $('#tag-form'),
  formTitle: $('#tag-form-title'),
  formError: $('#tag-form-error'),
  typeLabel: $('#tag-type-label'),
  nameFields: $('#tag-name-fields'),
  usage: $('#tag-usage'),
  deleteBtn: $('#btn-delete-tag'),
};

const langEditor = new LangEditor({
  form: el.form,
  tabs: $('#tag-lang-tabs'),
  nameGroup: el.nameFields,
  nameField: 'name',
});

const usageText = (tag) => t(TYPE_TEXT[tag.type].usage, { n: tagUsage(tag) });

// 現在の言語以外の名前を「简体中文: 肉类」の形で並べる
function otherNames(loc) {
  return I18N.LANGUAGES
    .filter((l) => l.code !== I18N.language && loc && loc[l.code])
    .map((l) => `${l.label}: ${loc[l.code]}`)
    .join(' / ');
}

export function render() {
  for (const section of el.sections) {
    const tags = sortedTags(section.dataset.tagType);
    section.querySelector('.tag-list').replaceChildren(
      ...tags.map((tag) => h('button', { type: 'button', class: 'item-row', onclick: () => openForm(tag) },
        h('div', { class: 'item-main' },
          locNode('span', tag.name, { class: 'item-name chip' }),
          h('span', { class: 'item-sub' }, otherNames(tag.name)),
        ),
        h('span', { class: 'item-usage' }, usageText(tag)),
      )),
    );
    section.querySelector('.tag-empty').hidden = tags.length > 0;
  }
}

function openForm(tag = null, type = 'recipe') {
  state.editingId = tag ? tag.id : null;
  state.type = tag ? tag.type : type;
  langEditor.reset();
  el.formTitle.dataset.i18n = tag ? 'tag.editTitle' : 'tag.newTitle';
  el.formTitle.textContent = t(el.formTitle.dataset.i18n);
  el.typeLabel.dataset.i18n = TYPE_TEXT[state.type].type;
  el.typeLabel.textContent = t(el.typeLabel.dataset.i18n);
  el.formError.hidden = true;

  const name = I18N.toLoc(tag && tag.name);
  el.nameFields.replaceChildren(
    ...langEditor.panes((lang) => langInput('name', lang, name[lang], { max: 50, ph: 'tag.name' })),
  );
  el.usage.hidden = !tag;
  if (tag) el.usage.textContent = usageText(tag);
  el.deleteBtn.hidden = !tag;

  el.dialog.showModal();
  langEditor.set(langEditor.lang, true);
  state.formSnapshot = JSON.stringify(collectLoc(el.nameFields, 'name'));
}

async function submitForm(event) {
  event.preventDefault();
  // 種類は新規作成時だけ使われる（既存タグの種類はサーバー側で変えない）
  const data = { type: state.type, name: collectLoc(el.nameFields, 'name') };
  if (isBlankLoc(data.name)) {
    showFormError(el.formError, 'error.NAME_REQUIRED');
    langEditor.set(langEditor.lang, true);
    return;
  }
  const submitBtn = el.form.querySelector('[type="submit"]');
  submitBtn.disabled = true;
  try {
    await saveItem('tags', state.editingId, data);
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
  const tag = findTag(state.editingId);
  if (!tag) return;
  if (!confirm(t(TYPE_TEXT[tag.type].confirm, { name: I18N.text(tag.name), n: tagUsage(tag) }))) return;
  try {
    await deleteItem('tags', tag.id);
    el.dialog.close();
    toast(t('toast.deleted'));
    await reloadAll();
  } catch (err) {
    showFormError(el.formError, err);
  }
}

export function onLanguageChange() {
  render();
  if (el.dialog.open) {
    langEditor.renderTabs();
    langEditor.refreshPlaceholders();
    const tag = findTag(state.editingId);
    if (tag) el.usage.textContent = usageText(tag);
  }
}

export function init() {
  for (const section of el.sections) {
    section.querySelector('.btn-new-tag').addEventListener('click', () => openForm(null, section.dataset.tagType));
  }
  el.deleteBtn.addEventListener('click', deleteCurrent);
  el.form.addEventListener('submit', submitForm);
  guardUnsaved(el.dialog, () => JSON.stringify(collectLoc(el.nameFields, 'name')) !== state.formSnapshot);
}
