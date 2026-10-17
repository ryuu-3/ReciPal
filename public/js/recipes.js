// レシピ画面：一覧・詳細・追加/編集フォーム
import {
  t, h, translated, locNode, toast, errorText, showFormError, matchesKeyword,
  saveItem, deleteItem, reloadAll, store,
  langInput, collectLoc, isBlankLoc, LangEditor, guardUnsaved, closeOnBackdropClick,
  findIngredient, findIngredientByName, ingredientName, ingredientAliases, ingredientTagIds,
  findTag, tagChips, renderTagFilter, renderTagPicker, pickedTags, variantName,
} from './common.js';
import { addRecipe } from './shopping.js';

const state = {
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

const $ = (sel) => document.querySelector(sel);
const el = {
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

const langEditor = new LangEditor({
  form: el.form,
  tabs: $('#edit-lang-tabs'),
  nameGroup: el.titleFields,
  nameField: 'title',
  incompleteKey: 'form.incomplete',
  onChange: () => renderVariantTabs(),
});

// ---------- バリエーション ----------

const variantsOf = (r) => (r && Array.isArray(r.variants) && r.variants.length ? r.variants : [{}]);

function currentVariant(r) {
  const variants = variantsOf(r);
  return variants.find((v) => v.id === state.selectedVariant[r.id]) || variants[0];
}

function variantMeta(v) {
  const parts = [];
  if (v.servings) parts.push(t('meta.servings', { n: v.servings }));
  if (v.time) parts.push(t('meta.time', { n: v.time }));
  if (v.ingredients && v.ingredients.length) parts.push(t('meta.ingredients', { n: v.ingredients.length }));
  return parts.join(t('meta.separator'));
}

// 一覧カード用：複数バリエーションなら「2/4人分 ・ 2パターン」
function cardMeta(r) {
  const variants = variantsOf(r);
  if (variants.length === 1) return variantMeta(variants[0]);
  const servings = [...new Set(variants.map((v) => v.servings).filter(Boolean))].sort((a, b) => a - b);
  const parts = [];
  if (servings.length) parts.push(t('meta.servingsList', { list: servings.join('/') }));
  parts.push(t('meta.variantCount', { n: variants.length }));
  return parts.join(t('meta.separator'));
}

// ---------- 一覧 ----------

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

function renderFilters() {
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

// 材料名欄の候補（言語ごと）。別名も候補に出し、選ぶと正式名で紐付く
function renderIngredientDatalists() {
  el.ingredientDatalists.replaceChildren(
    ...I18N.LANGUAGES.map((l) => h('datalist', { id: `ingredient-options-${l.code}` },
      ...store.ingredients.flatMap((ing) => {
        const name = ing.name[l.code];
        const aliases = (ing.aliases && ing.aliases[l.code]) || [];
        return [
          name && h('option', { value: name }),
          ...aliases.map((a) => h('option', { value: a, label: name || I18N.text(ing.name) })),
        ];
      }),
    )),
  );
}

function renderList() {
  const items = filteredRecipes();
  el.list.replaceChildren(
    ...items.map((r) => {
      const fallback = {};
      const title = locNode('h2', r.title, {}, fallback);
      const desc = I18N.text(r.description) && locNode('p', r.description, { class: 'description' }, fallback);
      return h('button', { class: 'recipe-card', type: 'button', onclick: () => openDetail(r.id) },
        h('div', { class: 'card-tags' },
          r.category && h('span', { class: 'tag' }, I18N.categoryLabel(r.category)),
          fallback.lang && h('span', { class: 'tag untranslated' }, t('translation.missing')),
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

export function render() {
  renderFilters();
  renderIngredientDatalists();
  renderList();
  if (el.detailDialog.open) renderDetail();
}

// ---------- 詳細 ----------

function renderDetail() {
  const r = store.recipes.find((x) => x.id === state.currentId);
  if (!r) return false;
  const fallback = {};
  const variants = variantsOf(r);
  const v = currentVariant(r);

  $('#detail-title').replaceWith(locNode('h2', r.title, { id: 'detail-title' }, fallback));
  const tag = $('#detail-category');
  tag.textContent = I18N.categoryLabel(r.category || '');
  tag.hidden = !r.category;
  $('#detail-description').replaceWith(locNode('p', r.description, { id: 'detail-description' }, fallback));
  $('#detail-description').hidden = !I18N.text(r.description);
  el.detailTags.replaceChildren(...tagChips(r.tags));
  el.detailTags.hidden = !(r.tags || []).length;

  // バリエーションが複数あるときだけ切り替えタブを出す
  el.detailVariants.hidden = variants.length < 2;
  el.detailVariants.replaceChildren(
    ...variants.map((x, i) => h('button', {
      type: 'button',
      role: 'tab',
      class: `variant-tab${x === v ? ' active' : ''}`,
      'aria-selected': String(x === v),
      onclick: () => {
        state.selectedVariant[r.id] = x.id;
        resetAddToShopping();
        renderDetail();
      },
    }, variantName(x, i))),
  );
  $('#detail-meta').textContent = variantMeta(v);

  const ingredients = v.ingredients || [];
  const steps = v.steps || [];
  const none = () => h('li', { class: 'muted' }, t('detail.none'));
  $('#detail-ingredients').replaceChildren(
    ...(ingredients.length
      ? ingredients.map((row) => h('li', {},
          locNode('span', ingredientName(row), {}, fallback),
          locNode('span', row.amount, { class: 'amount' }, fallback)))
      : [none()]),
  );
  $('#detail-steps').replaceChildren(
    ...(steps.length ? steps.map((s) => locNode('li', s, {}, fallback)) : [none()]),
  );

  const notice = $('#detail-fallback');
  notice.hidden = !fallback.lang;
  if (fallback.lang) notice.textContent = t('translation.fallbackNotice', { lang: I18N.langLabel(fallback.lang) });
  return true;
}

function openDetail(id) {
  state.currentId = id;
  resetAddToShopping();
  if (renderDetail()) el.detailDialog.showModal();
}

// 「🛒 買い物リストに追加」：成功したら 2 秒間「✓ 追加しました」と表示し、その間は押せなくする
// （ダブルクリックなどで意図せず ×2 にならないように）。
// 文言は data-i18n で切り替えるので、表示中に言語を変えても訳し直される
let addedTimer;
function setAddToShoppingLabel(key, done) {
  el.addToShopping.dataset.i18n = key;
  el.addToShopping.textContent = t(key);
  el.addToShopping.classList.toggle('done', done);
  el.addToShopping.disabled = done;
}

function resetAddToShopping() {
  clearTimeout(addedTimer);
  setAddToShoppingLabel('shopping.addToList', false);
}

async function addCurrentToShopping() {
  const r = store.recipes.find((x) => x.id === state.currentId);
  if (!r) return;
  const variant = currentVariant(r);
  el.addToShopping.disabled = true; // 処理中の連打で重複して追加しないように
  const ok = await addRecipe(r, variant);
  // 失敗したとき、または通信中に別のレシピ・バリエーションに切り替えたときは、元の表示に戻す
  if (!ok || state.currentId !== r.id || currentVariant(r) !== variant) {
    resetAddToShopping();
    return;
  }
  clearTimeout(addedTimer);
  setAddToShoppingLabel('shopping.addedButton', true);
  addedTimer = setTimeout(resetAddToShopping, 2000);
}

async function deleteCurrent() {
  const r = store.recipes.find((x) => x.id === state.currentId);
  if (!r || !confirm(t('detail.confirmDelete', { title: I18N.text(r.title) }))) return;
  try {
    await deleteItem('recipes', r.id);
    el.detailDialog.close();
    toast(t('toast.deleted'));
    await reloadAll();
  } catch (err) {
    toast(errorText(err), true);
  }
}

// ---------- フォーム：材料・手順の行 ----------

function rowControls(row, container) {
  const btn = (key, label, extraClass, onclick) =>
    h('button', {
      type: 'button',
      class: `btn icon small ${extraClass}`.trim(),
      'data-i18n-title': key,
      'data-i18n-aria-label': key,
      onclick,
    }, label);

  return h('div', { class: 'row-controls' },
    btn('form.moveUp', '↑', '', () =>
      row.previousElementSibling && container.insertBefore(row, row.previousElementSibling)),
    btn('form.moveDown', '↓', '', () =>
      row.nextElementSibling && container.insertBefore(row.nextElementSibling, row)),
    btn('form.remove', '✕', 'danger-text', () => row.remove()),
  );
}

// 材料名が材料マスタの名前・別名と一致したら紐付け、他の言語の名前を自動で入れる。
// 自動で入れた欄には data-autofilled を付け、紐付けが外れたら消す
function linkIngredientRow(row, source) {
  const ing = findIngredientByName(source.value);
  const nameInputs = [...row.querySelectorAll('[data-field="name"]')];
  if (ing) {
    row.dataset.ingredientId = ing.id;
    for (const input of nameInputs) {
      if (input === source) continue;
      const name = ing.name[input.closest('.lang-pane').dataset.lang];
      if (name && (!input.value.trim() || input.dataset.autofilled)) {
        input.value = name;
        input.dataset.autofilled = '1';
      }
    }
  } else if (row.dataset.ingredientId) {
    delete row.dataset.ingredientId;
    for (const input of nameInputs) {
      if (input.dataset.autofilled) {
        input.value = '';
        delete input.dataset.autofilled;
      }
    }
  }
  row.classList.toggle('linked', Boolean(row.dataset.ingredientId));
  langEditor.refreshPlaceholders();
}

function addIngredientRow(container, item = {}, focus = false) {
  const master = findIngredient(item.ingredientId);
  // 紐付いていればマスタの名前（最新の翻訳）を表示する
  const name = master ? { ...I18N.toLoc(item.name), ...master.name } : I18N.toLoc(item.name);
  const amount = I18N.toLoc(item.amount);
  const row = h('div', { class: `dyn-row${master ? ' linked' : ''}`, 'data-lang-group': '' });
  if (master) row.dataset.ingredientId = master.id;

  row.append(
    h('span', { class: 'link-badge', 'data-i18n-title': 'form.linked', 'data-i18n-aria-label': 'form.linked' }, '✓'),
    ...langEditor.panes((lang) => {
      const nameInput = langInput('name', lang, name[lang], { max: 100, ph: 'form.ingredientName' });
      nameInput.setAttribute('list', `ingredient-options-${lang}`);
      if (master && master.name[lang] === name[lang]) nameInput.dataset.autofilled = '1';
      return [nameInput, langInput('amount', lang, amount[lang], { max: 50, ph: 'form.ingredientAmount' })];
    }),
    rowControls(row, container),
  );
  row.addEventListener('input', (e) => {
    if (e.target.dataset.field !== 'name') return;
    delete e.target.dataset.autofilled;
    linkIngredientRow(row, e.target);
  });
  // 別名で選んだ場合は、入力欄を正式名に置き換える
  row.addEventListener('change', (e) => {
    if (e.target.dataset.field !== 'name') return;
    const ing = findIngredient(row.dataset.ingredientId);
    const official = ing && ing.name[e.target.closest('.lang-pane').dataset.lang];
    if (official) e.target.value = official;
  });

  container.append(row);
  translated(row);
  langEditor.refreshPlaceholders();
  if (focus) langEditor.focusIn(row);
}

function addStepRow(container, step = {}, focus = false) {
  const text = I18N.toLoc(step);
  const row = h('div', { class: 'dyn-row', 'data-lang-group': '' });
  row.append(
    h('span', { class: 'step-num' }),
    ...langEditor.panes((lang) => langInput('step', lang, text[lang], { max: 1000, multiline: true, ph: 'form.stepPlaceholder' })),
    rowControls(row, container),
  );
  container.append(row);
  translated(row);
  langEditor.refreshPlaceholders();
  if (focus) langEditor.focusIn(row);
}

function renumberSteps(container) {
  container.querySelectorAll('.step-num').forEach((n, i) => (n.textContent = `${i + 1}.`));
}

// ---------- フォーム：バリエーション ----------

const editors = () => [...el.variantEditors.children];

function createVariantEditor(variant = {}) {
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

function collectVariant(editor) {
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

function renderVariantTabs() {
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

function selectVariantEditor(editor, focusSelector = null) {
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

// ---------- フォーム：開く・保存 ----------

// variantId を指定すると、そのバリエーションを開いた状態で表示する
function openForm(recipe = null, variantId = null) {
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

// ---------- 言語切り替え ----------

export function onLanguageChange() {
  render();
  if (el.formDialog.open) {
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
}

// ---------- 初期化 ----------

export function init() {
  $('#btn-new-recipe').addEventListener('click', () => openForm());
  $('#btn-edit').addEventListener('click', () => {
    const r = store.recipes.find((x) => x.id === state.currentId);
    if (!r) return;
    el.detailDialog.close();
    openForm(r, currentVariant(r).id);
  });
  $('#btn-delete').addEventListener('click', deleteCurrent);
  el.addToShopping.addEventListener('click', addCurrentToShopping);
  el.form.addEventListener('submit', submitForm);
  guardUnsaved(el.formDialog, () => JSON.stringify(collectForm()) !== state.formSnapshot);

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

  // ダイアログの外側クリックで閉じる（詳細のみ。フォームは入力消失を防ぐため閉じない）
  closeOnBackdropClick(el.detailDialog);
}

