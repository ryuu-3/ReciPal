// 編集フォーム：バリエーション（タブ・追加・コピー・削除）
import { t, h, translated, collectLoc, isBlankLoc, langInput, variantName } from '../common.js';
import { state, el, langEditor } from './shared.js';
import { addIngredientRow, addStepRow, renumberSteps } from './form-rows.js';

// 入力言語を切り替えたら、バリエーションのタブを描き直す（タブの名前が入力言語で変わるため）
langEditor.onChange = () => renderVariantTabs();

export const editors = () => [...el.variantEditors.children];

export function createVariantEditor(variant = {}) {
  const editor = el.variantTemplate.content.firstElementChild.cloneNode(true);
  if (variant.id) editor.dataset.variantId = variant.id;

  const label = I18N.toLoc(variant.label);
  editor.querySelector('.variant-label-fields').append(
    ...langEditor.panes((lang) => langInput('label', lang, label[lang], { max: 50, ph: 'variant.labelPlaceholder' })),
  );
  editor.querySelector('.v-servings').value = variant.servings || '';
  editor.querySelector('.v-time').value = variant.time || '';

  const ingredientRowsEl = editor.querySelector('.ingredient-rows');
  const stepRows = editor.querySelector('.step-rows');
  // 追加・削除・並べ替えのたびに手順の番号を振り直す
  new MutationObserver(() => renumberSteps(stepRows)).observe(stepRows, { childList: true });

  editor.querySelector('.btn-add-ingredient').addEventListener('click', () => addIngredientRow(ingredientRowsEl, {}, true));
  editor.querySelector('.btn-add-step').addEventListener('click', () => addStepRow(stepRows, {}, true));
  editor.querySelector('.btn-copy-variant').addEventListener('click', () => copyVariant(editor));
  editor.querySelector('.btn-remove-variant').addEventListener('click', () => removeVariant(editor));
  // 人数や名前を変えたらタブの表示名も更新する
  editor.addEventListener('input', (e) => {
    if (e.target.matches('.v-servings, [data-field="label"]')) renderVariantTabs();
  });

  editor.hidden = true;
  el.variantEditors.append(editor);
  translated(editor);

  const ingredients = variant.ingredients && variant.ingredients.length ? variant.ingredients : [{}];
  const steps = variant.steps && variant.steps.length ? variant.steps : [{}];
  ingredients.forEach((i) => addIngredientRow(ingredientRowsEl, i));
  steps.forEach((s) => addStepRow(stepRows, s));
  renumberSteps(stepRows);
  return editor;
}

export function collectVariant(editor) {
  return {
    id: editor.dataset.variantId || undefined, // 新しいバリエーションの ID はサーバーで採番する
    label: collectLoc(editor.querySelector('.variant-label-fields'), 'label'),
    servings: editor.querySelector('.v-servings').value,
    time: editor.querySelector('.v-time').value,
    ingredients: [...editor.querySelector('.ingredient-rows').children]
      .map((row) => ({
        ingredientId: row.dataset.ingredientId || undefined,
        name: collectLoc(row, 'name'),
        amount: collectLoc(row, 'amount'),
      }))
      .filter((i) => !isBlankLoc(i.name)),
    steps: [...editor.querySelector('.step-rows').children]
      .map((row) => collectLoc(row, 'step'))
      .filter((s) => !isBlankLoc(s)),
  };
}

export function renderVariantTabs() {
  const list = editors();
  el.variantTabs.replaceChildren(
    ...list.map((editor, i) => h('button', {
      type: 'button',
      role: 'tab',
      class: `variant-tab${editor === state.activeEditor ? ' active' : ''}`,
      'aria-selected': String(editor === state.activeEditor),
      onclick: () => selectVariantEditor(editor),
    }, variantName(collectVariant(editor), i))),
    h('button', { type: 'button', class: 'variant-tab add', onclick: () => addVariant() }, t('variant.add')),
  );
  list.forEach((editor) => (editor.querySelector('.btn-remove-variant').disabled = list.length <= 1));
}

export function selectVariantEditor(editor, focusSelector = null) {
  state.activeEditor = editor;
  editors().forEach((e) => (e.hidden = e !== editor));
  renderVariantTabs();
  if (focusSelector) {
    const target = editor.querySelector(focusSelector);
    if (target) {
      target.focus();
      if (target.select) target.select();
    }
  }
}

function addVariant() {
  selectVariantEditor(createVariantEditor({}), '.v-servings');
}

// 内容をそのままコピーして直後に追加する。人数を変えて使う想定なので人数欄にフォーカスする
function copyVariant(source) {
  const data = collectVariant(source);
  delete data.id;
  const editor = createVariantEditor(data);
  el.variantEditors.insertBefore(editor, source.nextSibling);
  selectVariantEditor(editor, '.v-servings');
}

function removeVariant(editor) {
  const list = editors();
  if (list.length <= 1) return;
  const index = list.indexOf(editor);
  if (!confirm(t('variant.confirmRemove', { name: variantName(collectVariant(editor), index) }))) return;
  editor.remove();
  const rest = editors();
  selectVariantEditor(rest[Math.min(index, rest.length - 1)]);
}
