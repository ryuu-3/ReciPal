// 編集フォーム：開く・保存
import { t, toast, showFormError, saveItem, reloadAll, collectLoc, isBlankLoc, langInput, guardUnsaved, renderTagPicker, pickedTags } from '../common.js';
import { state, $, el, langEditor, variantsOf } from './shared.js';
import { editors, createVariantEditor, collectVariant, renderVariantTabs, selectVariantEditor } from './variants.js';
import { openDetail } from './detail.js';

// variantId を指定すると、そのバリエーションを開いた状態で表示する
export function openForm(recipe = null, variantId = null) {
  state.editingId = recipe ? recipe.id : null;
  langEditor.reset();
  el.formTitle.dataset.i18n = recipe ? 'form.editTitle' : 'form.newTitle';
  el.formTitle.textContent = t(el.formTitle.dataset.i18n);
  el.form.reset();
  el.formError.hidden = true;

  const title = I18N.toLoc(recipe && recipe.title);
  const description = I18N.toLoc(recipe && recipe.description);
  el.titleFields.replaceChildren(
    ...langEditor.panes((lang) => langInput('title', lang, title[lang], { max: 100, ph: 'form.title' })),
  );
  el.descriptionFields.replaceChildren(
    ...langEditor.panes((lang) => langInput('description', lang, description[lang], { max: 1000, multiline: true, ph: 'form.description' })),
  );
  el.form.elements.category.value = I18N.categoryLabel(recipe ? recipe.category || '' : state.category);
  renderTagPicker(el.tagPicker, recipe ? recipe.tags || [] : []);

  el.variantEditors.replaceChildren();
  const created = variantsOf(recipe).map((v) => createVariantEditor(v));
  selectVariantEditor(created.find((e) => variantId && e.dataset.variantId === variantId) || created[0]);

  el.formDialog.showModal();
  langEditor.set(langEditor.lang, true);
  state.formSnapshot = JSON.stringify(collectForm());
}

function collectForm() {
  return {
    title: collectLoc(el.titleFields, 'title'),
    category: I18N.categoryKey(el.form.elements.category.value),
    description: collectLoc(el.descriptionFields, 'description'),
    tags: pickedTags(el.tagPicker),
    variants: editors().map(collectVariant),
  };
}

async function submitForm(event) {
  event.preventDefault();
  const data = collectForm();
  if (isBlankLoc(data.title)) {
    showFormError(el.formError, 'form.titleRequired');
    langEditor.set(langEditor.lang, true);
    return;
  }

  const activeIndex = editors().indexOf(state.activeEditor);
  const submitBtn = el.form.querySelector('[type="submit"]');
  submitBtn.disabled = true;
  try {
    const saved = await saveItem('recipes', state.editingId, data);
    el.formDialog.close();
    toast(t('toast.saved'));
    // フォームで開いていたバリエーションを詳細でも表示する
    const savedVariant = saved.variants && saved.variants[activeIndex];
    if (savedVariant) state.selectedVariant[saved.id] = savedVariant.id;
    await reloadAll();
    openDetail(saved.id);
  } catch (err) {
    showFormError(el.formError, err);
  } finally {
    submitBtn.disabled = false;
  }
}

// 表示言語を切り替えたとき、開いているフォームの表示を合わせる
export function refreshFormLanguage() {
  // 入力中のカテゴリが既定カテゴリなら、新しい言語の表示名に置き換える
  const cat = el.form.elements.category;
  if (I18N.CATEGORY_KEYS.includes(I18N.categoryKey(cat.value))) {
    cat.value = I18N.categoryLabel(I18N.categoryKey(cat.value));
  }
  renderTagPicker(el.tagPicker);
  langEditor.renderTabs();
  langEditor.refreshPlaceholders();
  renderVariantTabs();
}

export function initForm() {
  $('#btn-new-recipe').addEventListener('click', () => openForm());
  el.form.addEventListener('submit', submitForm);
  guardUnsaved(el.formDialog, () => JSON.stringify(collectForm()) !== state.formSnapshot);
}
