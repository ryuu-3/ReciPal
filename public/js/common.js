// 画面共通の部品：API 呼び出し、DOM 生成、多言語入力欄、データストア、タグ表示

export const t = (key, params) => I18N.t(key, params);

// ---------- API ----------

export class ApiError extends Error {
  constructor(code, status, message) {
    super(message || code);
    this.code = code;
    this.status = status;
  }
}

export async function api(path, options = {}) {
  let res;
  try {
    res = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
  } catch {
    throw new ApiError('NETWORK', 0);
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.code || 'UNKNOWN', res.status, data.error);
  return data;
}

// 保存（新規なら POST、既存なら PUT）
export const saveItem = (collection, id, data) =>
  id
    ? api(`/api/${collection}/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(data) })
    : api(`/api/${collection}`, { method: 'POST', body: JSON.stringify(data) });

export const deleteItem = (collection, id) =>
  api(`/api/${collection}/${encodeURIComponent(id)}`, { method: 'DELETE' });

const errorKey = (err) =>
  err && err.code && err.code !== 'UNKNOWN' && I18N.has(`error.${err.code}`) ? `error.${err.code}` : null;

// エラーを現在の言語の文言に変換する
export function errorText(err) {
  const key = errorKey(err);
  return key ? t(key) : t('error.UNKNOWN', { status: (err && err.status) || '-' });
}

// フォームのエラー欄に表示する。翻訳キーなら言語切り替え時に訳し直される
export function showFormError(target, keyOrErr) {
  const key = typeof keyOrErr === 'string' ? keyOrErr : errorKey(keyOrErr);
  if (key) {
    target.dataset.i18n = key;
    target.textContent = t(key);
  } else {
    delete target.dataset.i18n;
    target.textContent = errorText(keyOrErr);
  }
  target.hidden = false;
}

// ---------- DOM ----------

export function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false || child === '') continue;
    node.append(child instanceof Node ? child : String(child));
  }
  return node;
}

// data-i18n 系の属性を付けた要素は、言語切り替え時に I18N.apply() で自動的に訳し直される
export function translated(node) {
  I18N.apply(node.parentNode || node);
  return node;
}

// 多言語テキストを現在の言語で表示する要素を作る。訳がなければ他の言語で表示し、fallback に記録する
export function locNode(tag, value, props = {}, fallback = null) {
  const picked = I18N.pick(value);
  const node = h(tag, props, picked.text);
  if (picked.lang) node.lang = I18N.htmlLang(picked.lang);
  if (picked.fallback) {
    node.classList.add('fallback');
    if (fallback && !fallback.lang) fallback.lang = picked.lang;
  }
  return node;
}

export const normalize = (s) => String(s || '').normalize('NFKC').trim().toLowerCase();

// スペース区切りの全キーワードが含まれるか
export function matchesKeyword(keyword, texts) {
  const words = normalize(keyword).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = normalize(texts.filter(Boolean).join('\n'));
  return words.every((w) => haystack.includes(w));
}

// 現在の言語の名前順に並べる
export const byName = (getName) => (a, b) =>
  I18N.text(getName(a)).localeCompare(I18N.text(getName(b)), I18N.htmlLang(I18N.language));

// 通知はポップオーバー（最上位レイヤー）として表示し、モーダルのダイアログを開いていても隠れないようにする。
// 最上位レイヤーでは後から表示したものが上に来るので、表示中でも一度閉じてから出し直す。
// Popover API に対応していないブラウザでは hidden 属性で表示を切り替える
let toastTimer;
export function toast(message, isError = false) {
  const el = document.getElementById('toast');
  const popover = typeof el.showPopover === 'function';
  el.textContent = message;
  el.classList.toggle('error', isError);
  el.hidden = false;
  if (popover) {
    if (el.matches(':popover-open')) el.hidePopover();
    el.showPopover();
  }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    if (popover) el.hidePopover();
    else el.hidden = true;
  }, 3000);
}

// ---------- ダイアログ ----------

// 閉じる。編集中の内容がある（dialog.isDirty() が true）なら、破棄してよいか確認する
export function requestClose(dialog) {
  if (dialog.isDirty && dialog.isDirty() && !confirm(t('form.confirmDiscard'))) return false;
  dialog.close();
  return true;
}

// 編集フォームのダイアログ：内容を変えていたら、Esc キーやキャンセルで閉じる前に確認する
export function guardUnsaved(dialog, isDirty) {
  dialog.isDirty = isDirty;
  dialog.addEventListener('cancel', (e) => {
    if (isDirty() && !confirm(t('form.confirmDiscard'))) e.preventDefault();
  });
}

// ダイアログの外側（背景）をクリックしたら閉じる。
// 押した位置と離した位置の両方が外側のときだけ閉じる（ダイアログ内で文字を選択しながら外で離したときに閉じないように）
export function closeOnBackdropClick(dialog) {
  const outside = (e) => {
    const r = dialog.getBoundingClientRect();
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  };
  let pressedOutside = false;
  dialog.addEventListener('pointerdown', (e) => {
    pressedOutside = e.target === dialog && outside(e);
  });
  dialog.addEventListener('click', (e) => {
    if (pressedOutside && e.target === dialog && outside(e)) requestClose(dialog);
    pressedOutside = false;
  });
}

// ---------- 多言語入力欄 ----------
// 翻訳する入力欄は .lang-pane[data-lang] で包み、入力中の言語の欄だけを表示する。
// [data-lang-group] の中で data-field が同じ欄どうしが、同じ項目の各言語版になる。

// 1 言語分の入力欄。placeholder は LangEditor.refreshPlaceholders() で設定する
export function langInput(field, lang, value, { max, multiline = false, rows = 2, ph }) {
  const input = multiline
    ? h('textarea', { rows: String(rows), maxlength: String(max) })
    : h('input', { maxlength: String(max) });
  input.dataset.field = field;
  input.dataset.ph = ph;
  input.lang = I18N.htmlLang(lang);
  input.value = value || '';
  return input;
}

export function collectLoc(group, field) {
  const loc = {};
  group.querySelectorAll(`[data-field="${field}"]`).forEach((input) => {
    const value = input.value.trim();
    if (value) loc[input.closest('.lang-pane').dataset.lang] = value;
  });
  return loc;
}

export const isBlankLoc = (loc) => Object.keys(loc).length === 0;

// フォーム 1 つ分の「入力言語」タブと、言語ごとの入力欄の表示切り替え
export class LangEditor {
  // nameGroup / nameField：名前が未入力の言語のタブに印を付けるための入力欄
  constructor({ form, tabs, nameGroup, nameField, incompleteKey = 'form.incompleteName', onChange = null }) {
    Object.assign(this, { form, tabs, nameGroup, nameField, incompleteKey, onChange });
    this.lang = I18N.language;
    nameGroup.addEventListener('input', () => this.renderTabs());
  }

  reset() {
    this.lang = I18N.language;
  }

  // 全言語分の入力欄を lang-pane に包んで返す。build(lang) が各言語の中身を作る
  panes(build) {
    return I18N.LANGUAGES.map((l) => {
      const pane = h('div', { class: 'lang-pane', 'data-lang': l.code });
      pane.append(...[].concat(build(l.code)));
      pane.hidden = l.code !== this.lang;
      return pane;
    });
  }

  set(code, focus = false) {
    this.lang = code;
    this.form.querySelectorAll('.lang-pane').forEach((pane) => (pane.hidden = pane.dataset.lang !== code));
    this.renderTabs();
    this.refreshPlaceholders();
    if (this.onChange) this.onChange();
    if (focus) this.focusIn(this.nameGroup);
  }

  focusIn(root) {
    const input = root.querySelector(`.lang-pane[data-lang="${this.lang}"] [data-field]`);
    if (input) input.focus();
  }

  renderTabs() {
    const names = collectLoc(this.nameGroup, this.nameField);
    this.tabs.replaceChildren(
      ...I18N.LANGUAGES.map((l) => {
        const active = l.code === this.lang;
        const incomplete = !names[l.code];
        return h('button', {
          type: 'button',
          role: 'tab',
          class: `lang-tab${active ? ' active' : ''}${incomplete ? ' incomplete' : ''}`,
          'aria-selected': String(active),
          title: incomplete ? t(this.incompleteKey) : null,
          onclick: () => this.set(l.code, true),
        }, l.label);
      }),
    );
  }

  // 空欄には、他の言語で入力済みの内容を参考として薄く表示する
  refreshPlaceholders() {
    this.form.querySelectorAll('[data-lang-group]').forEach((group) => {
      group.querySelectorAll(`.lang-pane[data-lang="${this.lang}"] [data-field]`).forEach((input) => {
        const ref = [...group.querySelectorAll(`[data-field="${input.dataset.field}"]`)]
          .find((other) => other !== input && other.value.trim());
        input.placeholder = ref ? ref.value.trim() : t(input.dataset.ph);
      });
    });
  }
}

// ---------- データストア ----------

export const store = { recipes: [], ingredients: [], tags: [], shopping: { recipes: [], items: [] } };
const storeListeners = [];
export const onStoreChange = (fn) => storeListeners.push(fn);
const notifyStore = () => storeListeners.forEach((fn) => fn());

export async function reloadAll() {
  try {
    const [recipes, ingredients, tags, shopping] = await Promise.all([
      api('/api/recipes'),
      api('/api/ingredients'),
      api('/api/tags'),
      api('/api/shopping'),
    ]);
    // 以前の表示名で保存されたカテゴリもキーにそろえる
    store.recipes = recipes.map((r) => ({ ...r, category: I18N.categoryKey(r.category) }));
    store.ingredients = ingredients;
    store.tags = tags;
    store.shopping = shopping;
    notifyStore();
  } catch (err) {
    toast(t('toast.loadFailed', { message: errorText(err) }), true);
  }
}

// 買い物リストの API はリスト全体を返すので、それで置き換える（全体の再読み込みはしない）
export function setShopping(list) {
  store.shopping = list;
  notifyStore();
}

// バリエーションの表示名：名前があれば「名前（4人分）」、なければ「4人分」、どちらもなければ「パターン1」
export function variantName(v, index) {
  const label = I18N.text(v.label);
  const servings = v.servings ? t('meta.servings', { n: v.servings }) : '';
  if (label && servings) return t('variant.nameWithServings', { label, servings });
  return label || servings || t('variant.untitled', { n: index + 1 });
}

export const findIngredient = (id) => (id ? store.ingredients.find((i) => i.id === id) : null);
export const findTag = (id) => store.tags.find((x) => x.id === id);

// レシピの材料行の表示名。材料マスタに紐付いていればマスタの名前（最新の翻訳）を使う
export function ingredientName(row) {
  const master = findIngredient(row.ingredientId);
  return master ? { ...I18N.toLoc(row.name), ...master.name } : row.name;
}

export const ingredientAliases = (ing) => Object.values((ing && ing.aliases) || {}).flat();

// 名前または別名（どの言語でも）が一致する材料を探す
export function findIngredientByName(text) {
  const key = normalize(text);
  if (!key) return null;
  return store.ingredients.find((ing) =>
    [...I18N.allTexts(ing.name), ...ingredientAliases(ing)].some((n) => normalize(n) === key),
  ) || null;
}

export function ingredientRows(recipe) {
  return (recipe.variants || []).flatMap((v) => v.ingredients || []);
}

export const ingredientUsage = (id) =>
  store.recipes.filter((r) => ingredientRows(r).some((row) => row.ingredientId === id)).length;

// タグの種類：recipe（レシピの特徴）/ ingredient（材料の分類）
export const TAG_TYPES = ['recipe', 'ingredient'];

// タグが付いている件数（レシピのタグならレシピ数、材料のタグなら材料数）
export function tagUsage(tag) {
  const items = tag.type === 'recipe' ? store.recipes : store.ingredients;
  return items.filter((x) => (x.tags || []).includes(tag.id)).length;
}

// レシピが使っている材料のタグ（材料マスタに紐付いた材料のみ）
export function ingredientTagIds(recipe) {
  const ids = new Set();
  for (const row of ingredientRows(recipe)) {
    const master = findIngredient(row.ingredientId);
    if (master) (master.tags || []).forEach((id) => ids.add(id));
  }
  return ids;
}

// ---------- タグ表示・選択 ----------

export const sortedTags = (type) => store.tags.filter((x) => x.type === type).sort(byName((x) => x.name));

export function tagChips(ids = []) {
  return ids
    .map(findTag)
    .filter(Boolean)
    .map((tag) => locNode('span', tag.name, { class: 'chip' }));
}

// 絞り込み用のセレクト。allKey は「すべて」の選択肢の文言。選択中のタグが消えていたら「すべて」に戻す
export function renderTagFilter(select, current, type, allKey) {
  const tags = sortedTags(type);
  select.replaceChildren(
    h('option', { value: '' }, t(allKey)),
    ...tags.map((tag) => h('option', { value: tag.id }, I18N.text(tag.name))),
  );
  select.value = tags.some((x) => x.id === current) ? current : '';
  return select.value;
}

// チェックボックス形式のタグ選択。表示するタグの種類は container の data-tag-type で指定する
export function renderTagPicker(container, selected = pickedTags(container)) {
  const tags = sortedTags(container.dataset.tagType);
  const set = new Set(selected);
  container.replaceChildren(
    ...(tags.length
      ? tags.map((tag) => h('label', { class: 'chip-option' },
          h('input', { type: 'checkbox', value: tag.id, checked: set.has(tag.id) }),
          locNode('span', tag.name)))
      : [h('span', { class: 'muted' }, t('form.noTags'))]),
  );
}

export const pickedTags = (container) =>
  [...container.querySelectorAll('input[type="checkbox"]:checked')].map((c) => c.value);
