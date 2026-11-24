// レシピ画面の共通部分：状態・要素の参照・入力言語のタブ・バリエーションの表示用の部品
import { t, LangEditor } from '../common.js';

export const state = {
  keyword: '',
  category: '',
  recipeTag: '', // レシピの特徴（レシピ自体のタグ）
  ingredientTag: '', // 使っている材料の分類（材料のタグ）
  currentId: null, // 詳細表示中のレシピ
  selectedVariant: {}, // レシピ ID → 詳細で選択中のバリエーション ID
  editingId: null, // 編集中のレシピ（新規なら null）
  activeEditor: null, // フォームで編集中のバリエーション（.variant-editor 要素）
  formSnapshot: '', // フォームを開いた時点の内容（閉じるときに変更があるか比べる）
};

export const $ = (sel) => document.querySelector(sel);
export const el = {
  list: $('#recipe-list'),
  empty: $('#empty'),
  count: $('#result-count'),
  search: $('#search'),
  categoryFilter: $('#category-filter'),
  recipeTagFilter: $('#recipe-tag-filter'),
  ingredientTagFilter: $('#recipe-ingredient-tag-filter'),
  categoryOptions: $('#category-options'),
  ingredientDatalists: $('#ingredient-datalists'),
  detailDialog: $('#detail-dialog'),
  detailVariants: $('#detail-variants'),
  detailTags: $('#detail-tags'),
  addToShopping: $('#btn-add-to-shopping'),
  formDialog: $('#form-dialog'),
  form: $('#recipe-form'),
  formTitle: $('#form-title'),
  formError: $('#form-error'),
  titleFields: $('#title-fields'),
  descriptionFields: $('#description-fields'),
  tagPicker: $('#recipe-tag-picker'),
  variantTabs: $('#variant-tabs'),
  variantEditors: $('#variant-editors'),
  variantTemplate: $('#variant-template'),
};

// 入力言語のタブ。言語を切り替えたときにバリエーションのタブを描き直す処理（onChange）は variants.js で設定する
export const langEditor = new LangEditor({
  form: el.form,
  tabs: $('#edit-lang-tabs'),
  nameGroup: el.titleFields,
  nameField: 'title',
  incompleteKey: 'form.incomplete',
});

// バリエーション

export const variantsOf = (r) => (r && Array.isArray(r.variants) && r.variants.length ? r.variants : [{}]);

export function currentVariant(r) {
  const variants = variantsOf(r);
  return variants.find((v) => v.id === state.selectedVariant[r.id]) || variants[0];
}

export function variantMeta(v) {
  const parts = [];
  if (v.servings) parts.push(t('meta.servings', { n: v.servings }));
  if (v.time) parts.push(t('meta.time', { n: v.time }));
  if (v.ingredients && v.ingredients.length) parts.push(t('meta.ingredients', { n: v.ingredients.length }));
  return parts.join(t('meta.separator'));
}

// 一覧カード用：複数バリエーションなら「2/4人分 ・ 2パターン」
export function cardMeta(r) {
  const variants = variantsOf(r);
  if (variants.length === 1) return variantMeta(variants[0]);
  const servings = [...new Set(variants.map((v) => v.servings).filter(Boolean))].sort((a, b) => a - b);
  const parts = [];
  if (servings.length) parts.push(t('meta.servingsList', { list: servings.join('/') }));
  parts.push(t('meta.variantCount', { n: variants.length }));
  return parts.join(t('meta.separator'));
}
