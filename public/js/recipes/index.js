// レシピ画面：一覧・詳細・追加/編集フォーム。各ファイルをまとめ、画面同士をつなぐ
import { store } from '../common.js';
import { state, $, el, currentVariant } from './shared.js';
import { renderFilters, renderList, initList } from './list.js';
import { renderDetail, initDetail } from './detail.js';
import { renderIngredientDatalists } from './form-rows.js';
import { openForm, refreshFormLanguage, initForm } from './form.js';

export function render() {
  renderFilters();
  renderIngredientDatalists();
  renderList();
  if (el.detailDialog.open) renderDetail();
}

export function onLanguageChange() {
  render();
  if (el.formDialog.open) refreshFormLanguage();
}

export function init() {
  $('#btn-edit').addEventListener('click', () => {
    const r = store.recipes.find((x) => x.id === state.currentId);
    if (!r) return;
    el.detailDialog.close();
    openForm(r, currentVariant(r).id);
  });
  initList();
  initDetail();
  initForm();
}
