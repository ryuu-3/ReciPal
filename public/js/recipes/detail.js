// レシピ詳細：表示・バリエーションの切り替え・買い物リストへの追加・削除
import { t, h, locNode, toast, errorText, deleteItem, reloadAll, store, closeOnBackdropClick, ingredientName, tagChips, variantName } from '../common.js';
import { addRecipe } from '../shopping.js';
import { state, $, el, variantsOf, currentVariant, variantMeta } from './shared.js';

export function renderDetail() {
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

export function openDetail(id) {
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

export function initDetail() {
  $('#btn-delete').addEventListener('click', deleteCurrent);
  el.addToShopping.addEventListener('click', addCurrentToShopping);

  // ダイアログの外側クリックで閉じる（詳細のみ。フォームは入力消失を防ぐため閉じない）
  closeOnBackdropClick(el.detailDialog);
}
