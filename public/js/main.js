// エントリポイント：画面の切り替え、言語選択、データの読み込み
import { h, onStoreChange, reloadAll, requestClose } from './common.js';
import * as recipes from './recipes.js';
import * as ingredients from './ingredients.js';
import * as tags from './tags.js';
import * as shopping from './shopping.js';

// ナビで切り替える画面。買い物リストは画面ではなく、ヘッダーの 🛒 から開くパネル
const views = { recipes, ingredients, tags };
const modules = [recipes, ingredients, tags, shopping];
const DEFAULT_VIEW = 'recipes';

// URL の #recipes / #ingredients / #tags で表示する画面を決める（再読み込みしても同じ画面に戻れる）
function showView(name) {
  const view = views[name] ? name : DEFAULT_VIEW;
  document.querySelectorAll('.view').forEach((section) => (section.hidden = section.id !== `view-${view}`));
  document.querySelectorAll('#main-nav [data-view]').forEach((btn) => {
    const active = btn.dataset.view === view;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-current', active ? 'page' : 'false');
  });
}

const currentHashView = () => location.hash.replace(/^#/, '');

function initNavigation() {
  document.querySelectorAll('#main-nav [data-view]').forEach((btn) =>
    btn.addEventListener('click', () => {
      location.hash = btn.dataset.view;
    }),
  );
  window.addEventListener('hashchange', () => showView(currentHashView()));
  showView(currentHashView());
}

function initLanguageSelect() {
  const select = document.getElementById('lang-select');
  select.replaceChildren(...I18N.LANGUAGES.map((l) => h('option', { value: l.code }, l.label)));
  select.value = I18N.language;
  select.addEventListener('change', () => I18N.setLanguage(select.value));
  I18N.onChange(() => {
    select.value = I18N.language;
    modules.forEach((m) => m.onLanguageChange());
  });
}

// キャンセル・✕ ボタン。編集フォームで内容を変えていたら、破棄してよいか確認してから閉じる
function initDialogs() {
  document.querySelectorAll('[data-close]').forEach((btn) =>
    btn.addEventListener('click', () => requestClose(btn.closest('dialog'))),
  );
}

// ヘッダーの 🛒 に未チェックの品数を出す
function renderShoppingBadge() {
  const badge = document.getElementById('nav-shopping-badge');
  const n = shopping.uncheckedCount();
  badge.hidden = n === 0;
  badge.textContent = String(n);
}

initNavigation();
initLanguageSelect();
initDialogs();
modules.forEach((m) => m.init());
onStoreChange(() => {
  modules.forEach((m) => m.render());
  renderShoppingBadge();
});
I18N.apply();
reloadAll();
