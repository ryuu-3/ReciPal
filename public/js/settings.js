// 設定画面：データの言語（入力フォームに出す言語）を選ぶ。バックアップの状態を表示する（変更はできない）
import { t, h, toast, showFormError, errorText, api, reloadAll, store, guardUnsaved } from './common.js';

const $ = (sel) => document.querySelector(sel);
const el = {
  dialog: $('#settings-dialog'),
  form: $('#settings-form'),
  languages: $('#settings-data-languages'),
  error: $('#settings-form-error'),
  backup: $('#settings-backup'),
};

const state = {
  snapshot: '', // 開いた時点の選択（閉じるときに変更があるか比べる）
  backup: null, // GET /api/backup の結果（言語を切り替えたときの描き直し用）
};

// 多言語テキストの中に、その言語の値が 1 つでもあるか（{ ja: "...", en: "..." } や別名の { ja: [...] } を探す）
function hasLanguage(value, code) {
  if (Array.isArray(value)) return value.some((v) => hasLanguage(v, code));
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, v]) => {
    if (key === code && (typeof v === 'string' ? v.trim() : Array.isArray(v) && v.length)) return true;
    return typeof v === 'object' && hasLanguage(v, code);
  });
}

// その言語のデータがあるレシピ・材料・タグの件数
const usageCount = (code) =>
  [...store.recipes, ...store.ingredients, ...store.tags].filter((item) => hasLanguage(item, code)).length;

const checked = () => [...el.languages.querySelectorAll('input:checked')].map((c) => c.value);

function renderLanguages(selected) {
  el.languages.replaceChildren(
    ...I18N.DATA_LANGUAGES.map((l) => {
      const n = usageCount(l.code);
      return h('label', { class: 'check-field settings-language' },
        h('input', { type: 'checkbox', value: l.code, checked: selected.includes(l.code) }),
        h('span', { lang: l.htmlLang }, l.label),
        n > 0 && h('span', { class: 'muted' }, t('settings.inUse', { n })),
      );
    }),
  );
}

// ---------- バックアップ（表示のみ） ----------

function renderBackup() {
  const b = state.backup;
  if (!b) {
    el.backup.replaceChildren(h('p', { class: 'muted' }, t('backup.loading')));
    return;
  }
  if (b.loadError) {
    el.backup.replaceChildren(h('p', { class: 'error' }, errorText(b.loadError)));
    return;
  }
  const row = (label, ...value) => [h('dt', {}, label), h('dd', {}, ...value)];
  const date = b.lastBackupAt ? new Date(b.lastBackupAt).toLocaleString(I18N.htmlLang(I18N.language)) : t('backup.none');
  el.backup.replaceChildren(
    h('dl', {},
      ...row(t('backup.location'),
        h('code', { class: 'backup-dir' }, b.dir),
        h('span', { class: 'muted' }, t(b.custom ? 'backup.locationCustom' : 'backup.locationDefault'))),
      ...row(t('backup.last'), date),
      ...row(t('backup.keep'), t('backup.keepDays', { n: b.keep, count: b.count })),
    ),
    // replaceChildren は null を文字列として表示するので、条件付きの要素は配列で渡す
    ...(b.error ? [h('p', { class: 'error' }, t(`backup.error.${b.error.code}`, { message: b.error.message }))] : []),
  );
}

async function loadBackup() {
  state.backup = null;
  renderBackup();
  try {
    state.backup = await api('/api/backup');
  } catch (err) {
    state.backup = { loadError: err };
  }
  renderBackup();
}

function openSettings() {
  el.error.hidden = true;
  renderLanguages(I18N.dataLanguages);
  state.snapshot = JSON.stringify(checked());
  el.dialog.showModal();
  loadBackup();
}

async function submit(event) {
  event.preventDefault();
  const dataLanguages = checked();
  if (!dataLanguages.length) {
    showFormError(el.error, 'error.DATA_LANGUAGES_REQUIRED');
    return;
  }
  const submitBtn = el.form.querySelector('[type="submit"]');
  submitBtn.disabled = true;
  try {
    await api('/api/settings', { method: 'PUT', body: JSON.stringify({ dataLanguages }) });
    el.dialog.close();
    toast(t('toast.saved'));
    await reloadAll();
  } catch (err) {
    showFormError(el.error, err);
  } finally {
    submitBtn.disabled = false;
  }
}

export function render() {}

export function onLanguageChange() {
  if (!el.dialog.open) return;
  renderLanguages(checked());
  renderBackup();
}

export function init() {
  $('#btn-open-settings').addEventListener('click', openSettings);
  el.form.addEventListener('submit', submit);
  guardUnsaved(el.dialog, () => JSON.stringify(checked()) !== state.snapshot);
}
