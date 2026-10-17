// 買い物リスト（右からスライドして開くパネル）と、レシピからの追加
// 品目は「1 レシピの 1 材料行」ごとに 1 行で、同じ材料でもまとめない（まとめるのはコピーするテキストだけ）。
// 品目は最初「買う」（チェックあり）。チェックを外すと「買わないもの」に移る（データ上は skip: true）
import {
  t, h, locNode, toast, errorText, byName, normalize, closeOnBackdropClick,
  api, setShopping, store,
  findIngredient, findIngredientByName, findTag, ingredientName, variantName,
} from './common.js';

const $ = (sel) => document.querySelector(sel);
const el = {
  drawer: $('#shopping-drawer'),
  count: $('#shopping-count'),
  recipes: $('#shopping-recipes'),
  recipeList: $('#shopping-recipe-list'),
  list: $('#shopping-list'),
  empty: $('#shopping-empty'),
  itemForm: $('#shopping-item-form'),
  itemName: $('#shopping-item-name'),
  itemAmount: $('#shopping-item-amount'),
  copyBtn: $('#btn-shopping-copy'),
  clearAllBtn: $('#btn-shopping-clear-all'),
};

const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body || {}) });

async function run(request) {
  try {
    setShopping(await request());
    return true;
  } catch (err) {
    toast(errorText(err), true);
    render(); // チェックボックスなど、操作で変わった見た目を元に戻す
    return false;
  }
}

// ---------- 表示用の補助 ----------

const findRef = (recipeId, variantId) =>
  store.shopping.recipes.find((r) => r.recipeId === recipeId && r.variantId === variantId);

// レシピの表示名。「カレー（4人分）」の形。人数や名前がなければレシピ名だけ。
// compact は分量の後ろに付ける用で、括弧が二重にならないよう「カレー 4人分」の形にする
function recipeVariantName(title, variant, index, compact = false) {
  const hasDetail = I18N.text(variant.label) || variant.servings;
  if (!hasDetail) return title;
  const detail = variantName(variant, Math.max(index, 0));
  return compact ? `${title} ${detail}` : t('variant.nameWithServings', { label: title, servings: detail });
}

// 対象レシピの表示名。今のレシピがあれば最新の名前、削除されていれば追加時の控えを使う
function refName(ref, compact = false) {
  const recipe = store.recipes.find((r) => r.id === ref.recipeId);
  const variants = (recipe && recipe.variants) || [];
  const index = variants.findIndex((v) => v.id === ref.variantId);
  const variant = index >= 0 ? variants[index] : { label: ref.label, servings: ref.servings };
  const title = I18N.text(recipe ? recipe.title : ref.title) || t('shopping.deletedRecipe');
  return recipeVariantName(title, variant, index, compact);
}

// 同じレシピを 2 回以上追加したときの「×2」バッジ（1 回なら何も出さない）
function timesBadge(ref) {
  return ref && ref.times > 1 ? h('span', { class: 'times-badge' }, t('shopping.times', { n: ref.times })) : null;
}

const itemRef = (item) => (item.recipeId ? findRef(item.recipeId, item.variantId) : null);
const itemName = (item) => ingredientName(item);
const toBuy = () => store.shopping.items.filter((x) => !x.skip);

// 同じ材料かどうかの判定キー：材料マスタに紐付いていれば ID、なければ表示名（全角・半角、大文字・小文字の違いは無視）
const mergeKey = (item) => (item.ingredientId ? `id:${item.ingredientId}` : `name:${normalize(I18N.text(itemName(item)))}`);

// 並び順：名前順。同じ材料が隣り合うようにし、同じ材料の中ではレシピ名順（手入力は最後）
function compareItems(a, b) {
  const byItemName = byName(itemName)(a, b);
  if (byItemName) return byItemName;
  if (mergeKey(a) !== mergeKey(b)) return mergeKey(a).localeCompare(mergeKey(b));
  const labelA = itemRef(a) ? refName(itemRef(a), true) : '￿';
  const labelB = itemRef(b) ? refName(itemRef(b), true) : '￿';
  return labelA.localeCompare(labelB);
}

// 売り場グループ：材料のタグのうち名前順で最初のもの。タグがなければ「その他」
function groupTag(item) {
  const master = findIngredient(item.ingredientId);
  const tags = ((master && master.tags) || []).map(findTag).filter(Boolean).sort(byName((x) => x.name));
  return tags[0] || null;
}

// 「買う」品目を売り場ごとにまとめる
function groupedItems() {
  const groups = new Map();
  for (const item of toBuy()) {
    const tag = groupTag(item);
    const key = tag ? tag.id : '';
    if (!groups.has(key)) groups.set(key, { tag, items: [] });
    groups.get(key).items.push(item);
  }
  const sorted = [...groups.values()].sort((a, b) => {
    if (!a.tag) return 1;
    if (!b.tag) return -1;
    return byName((g) => g.tag.name)(a, b);
  });
  sorted.forEach((g) => g.items.sort(compareItems));
  return sorted;
}

const groupName = (group) => (group.tag ? I18N.text(group.tag.name) : t('shopping.other'));

// ヘッダーのバッジに出す「買う」品数。コピーするテキストと同じく、同じ材料は 1 品と数える
export const uncheckedCount = () => new Set(toBuy().map(mergeKey)).size;

// ---------- 一覧 ----------

// 行の出どころ：レシピ名、手入力、または（データの不整合で）参照先のレシピがない場合
function sourceLabel(item) {
  if (!item.recipeId) return t('shopping.manual');
  const ref = itemRef(item);
  return ref ? refName(ref, true) : t('shopping.deletedRecipe');
}

function itemRow(item) {
  return h('div', { class: `shopping-item${item.skip ? ' skipped' : ''}` },
    h('label', { class: 'shopping-check' },
      h('input', {
        type: 'checkbox',
        checked: !item.skip,
        onchange: (e) => run(() => api(`/api/shopping/items/${encodeURIComponent(item.id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ skip: !e.target.checked }),
        })),
      }),
      locNode('span', itemName(item), { class: 'shopping-name' }),
      h('span', { class: 'shopping-amounts' }, I18N.text(item.amount), timesBadge(itemRef(item))),
      h('span', { class: 'shopping-source' }, sourceLabel(item)),
    ),
    // 削除できるのは手入力の行だけ（レシピの行は上部の対象レシピの ✕ で外す）。入れ直しも簡単なので確認は出さない
    !item.recipeId && h('button', {
      type: 'button',
      class: 'btn icon small danger-text',
      title: t('shopping.removeItem'),
      'aria-label': t('shopping.removeItem'),
      onclick: () => run(() => api(`/api/shopping/items/${encodeURIComponent(item.id)}`, { method: 'DELETE' })),
    }, '✕'),
  );
}

export function render() {
  const { recipes, items } = store.shopping;
  const skipped = items.filter((x) => x.skip).sort(compareItems);

  el.recipes.hidden = recipes.length === 0;
  el.recipeList.replaceChildren(
    ...recipes.map((ref) => h('span', { class: 'shopping-recipe' },
      refName(ref),
      timesBadge(ref),
      h('button', {
        type: 'button',
        class: 'btn icon small',
        title: t('shopping.removeRecipe'),
        'aria-label': t('shopping.removeRecipe'),
        onclick: () => {
          if (!confirm(t('shopping.confirmRemoveRecipe', { name: refName(ref) }))) return;
          run(() => api(`/api/shopping/recipes/${encodeURIComponent(ref.recipeId)}/${encodeURIComponent(ref.variantId)}`, { method: 'DELETE' }));
        },
      }, '✕'),
    )),
  );

  // replaceChildren は false を文字列として表示するので、条件付きの要素は配列で渡す
  el.list.replaceChildren(
    ...groupedItems().map((group) => h('section', { class: 'shopping-group' },
      h('h3', {}, groupName(group)),
      ...group.items.map(itemRow),
    )),
    ...(skipped.length
      ? [h('section', { class: 'shopping-group skipped' }, h('h3', {}, t('shopping.skipped')), ...skipped.map(itemRow))]
      : []),
  );

  el.empty.hidden = items.length > 0;
  // コピーは「買う」品目がないと無効、すべて削除は品目が 1 件もないと無効
  el.copyBtn.disabled = uncheckedCount() === 0;
  el.clearAllBtn.disabled = items.length === 0;
  el.count.hidden = items.length === 0;
  el.count.textContent = t('shopping.count', { n: uncheckedCount() });
  // 入力候補は表示中の言語の材料名
  el.itemName.setAttribute('list', `ingredient-options-${I18N.language}`);
}

// ---------- パネルの開閉 ----------

export function openDrawer() {
  if (!el.drawer.open) el.drawer.showModal();
  el.itemName.focus();
}

// ---------- 追加 ----------

// レシピ詳細の「🛒 買い物リストに追加」から呼ぶ。全材料を追加し、常備品は「買わないもの」に入る。
// 成功したら true を返す
export async function addRecipe(recipe, variant) {
  try {
    const list = await post('/api/shopping/recipes', { recipeId: recipe.id, variantId: variant.id });
    setShopping(list);
    toast(t('shopping.added'));
    return true;
  } catch (err) {
    toast(errorText(err), true);
    return false;
  }
}

async function addManualItem(event) {
  event.preventDefault();
  const text = el.itemName.value.trim();
  if (!text) {
    el.itemName.focus();
    return;
  }
  const master = findIngredientByName(text);
  const lang = I18N.language;
  const ok = await run(() => post('/api/shopping/items', {
    ingredientId: master ? master.id : undefined,
    name: { [lang]: text },
    amount: { [lang]: el.itemAmount.value.trim() },
  }));
  if (ok) {
    el.itemForm.reset();
    el.itemName.focus();
  }
}

// ---------- テキストでコピー（「買う」品目だけ） ----------
// 同じ材料は 1 行にまとめ、分量だけを並べる：「・玉ねぎ 2個×2 ＋ 1個」
// （×2 は同じレシピを 2 回追加した分。数量なしの行は省く。分量の合算はしない）

function mergedAmounts(items) {
  return items
    .map((item) => {
      const amount = I18N.text(item.amount);
      if (!amount) return '';
      const ref = itemRef(item);
      return ref && ref.times > 1 ? `${amount}${t('shopping.times', { n: ref.times })}` : amount;
    })
    .filter(Boolean)
    .join(' ＋ ');
}

function shoppingText() {
  const date = new Date().toLocaleDateString(I18N.htmlLang(I18N.language));
  const lines = [t('shopping.copyTitle', { date })];
  for (const group of groupedItems()) {
    lines.push('', `【${groupName(group)}】`);
    // 並び順で同じ材料は隣り合っているので、出てきた順にまとめる
    const merged = new Map();
    for (const item of group.items) {
      const key = mergeKey(item);
      if (!merged.has(key)) merged.set(key, []);
      merged.get(key).push(item);
    }
    for (const items of merged.values()) {
      const amounts = mergedAmounts(items);
      lines.push(`・${I18N.text(itemName(items[0]))}${amounts ? ` ${amounts}` : ''}`);
    }
  }
  return lines.join('\n');
}

async function copyText() {
  if (!uncheckedCount()) return;
  const text = shoppingText();
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // クリップボード API が使えない環境向け
    const area = h('textarea', { style: 'position:fixed;opacity:0' });
    area.value = text;
    document.body.append(area);
    area.select();
    const ok = document.execCommand && document.execCommand('copy');
    area.remove();
    if (!ok) {
      toast(t('shopping.copyFailed'), true);
      return;
    }
  }
  toast(t('shopping.copied'));
}

// ---------- 言語切り替え・初期化 ----------

export function onLanguageChange() {
  render();
}

export function init() {
  $('#btn-open-shopping').addEventListener('click', openDrawer);
  // パネルの外側（背景）をクリックしたら閉じる
  closeOnBackdropClick(el.drawer);
  el.itemForm.addEventListener('submit', addManualItem);
  el.clearAllBtn.addEventListener('click', () => {
    if (confirm(t('shopping.confirmClearAll'))) run(() => post('/api/shopping/clear'));
  });
  el.copyBtn.addEventListener('click', copyText);
}
