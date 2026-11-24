// ReciPal 画面の表示言語の切り替えと、多言語テキストの表示
// 画面の文言は locales/<言語コード>.json に置く。
// 表示言語を追加するときは、locales に JSON を追加し、LANGUAGES に 1 行追加する。
// データ（レシピの中身など）に使える言語は、今は表示言語と同じ（DATA_LANGUAGES）
(() => {
  'use strict';

  const STORAGE_KEY = 'recipal.lang';

  // code: 内部キー / htmlLang: <html lang> の値 / label: セレクトに表示する名前
  const LANGUAGES = [
    { code: 'ja', htmlLang: 'ja', label: '日本語' },
    { code: 'zh', htmlLang: 'zh-CN', label: '简体中文' },
    { code: 'en', htmlLang: 'en', label: 'English' },
  ];

  // データの言語として選べるもの。並び順が入力フォームのタブの順になる。
  // どれを使うかは設定画面で選び、data/settings.json に保存する。
  // 今は表示言語と同じにしている。画面を翻訳せずにデータだけ使える言語を増やすときは、ここに追加する
  const DATA_LANGUAGES = [...LANGUAGES];
  const DEFAULT_DATA_LANGUAGES = ['ja', 'zh'];

  // 既定カテゴリはこのキーでデータに保存し、表示時に翻訳する
  const CATEGORY_KEYS = ['main', 'side', 'soup', 'staple', 'dessert', 'other'];

  // 画面の文言（翻訳キー → 翻訳値）。言語ごとに locales/<code>.json に置き、起動時にすべて読み込む
  const MESSAGES = {};
  const LOCALES_URL = new URL('locales/', document.currentScript.src);

  async function loadMessages(code) {
    const url = new URL(`${code}.json`, LOCALES_URL);
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`${url.pathname} を読み込めませんでした（${res.status}）`);
    try {
      MESSAGES[code] = await res.json();
    } catch (err) {
      throw new Error(`${url.pathname} の JSON の形式が正しくありません: ${err.message}`);
    }
  }

  // 全言語の文言の読み込みが終わると解決する。画面の初期化はこれを待ってから行う
  const ready = Promise.all(LANGUAGES.map((l) => loadMessages(l.code)));

  const DEFAULT_LANG = 'ja';
  const listeners = [];
  const isLanguage = (code) => LANGUAGES.some((l) => l.code === code);
  let current = detectLanguage();

  function readStored() {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  }

  function detectLanguage() {
    const stored = readStored();
    if (stored && isLanguage(stored)) return stored;
    const prefs = navigator.languages || [navigator.language || ''];
    for (const pref of prefs) {
      const base = String(pref).toLowerCase().split('-')[0];
      if (isLanguage(base)) return base;
    }
    return DEFAULT_LANG;
  }

  // 数で形が変わる文言（英語の単数・複数など）は { one: '...', other: '...' } と書き、params.n で選ぶ
  const pluralRules = {};
  function plural(forms, n) {
    const rules = (pluralRules[current] = pluralRules[current] || new Intl.PluralRules(htmlLang(current)));
    return forms[rules.select(Number(n))] ?? forms.other;
  }

  // t('list.count', { shown: 1, total: 3 })
  function t(key, params = {}) {
    let text = MESSAGES[current]?.[key] ?? MESSAGES[DEFAULT_LANG]?.[key] ?? key;
    if (typeof text === 'object') text = plural(text, params.n);
    return text.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m));
  }

  function has(key) {
    return (MESSAGES[current]?.[key] ?? MESSAGES[DEFAULT_LANG]?.[key]) !== undefined;
  }

  // data-i18n / data-i18n-placeholder / data-i18n-aria-label / data-i18n-title を一括反映
  function apply(root = document) {
    const lang = LANGUAGES.find((l) => l.code === current);
    document.documentElement.lang = lang ? lang.htmlLang : current;
    root.querySelectorAll('[data-i18n]').forEach((n) => (n.textContent = t(n.dataset.i18n)));
    root.querySelectorAll('[data-i18n-placeholder]').forEach((n) => (n.placeholder = t(n.dataset.i18nPlaceholder)));
    root.querySelectorAll('[data-i18n-aria-label]').forEach((n) => n.setAttribute('aria-label', t(n.dataset.i18nAriaLabel)));
    root.querySelectorAll('[data-i18n-title]').forEach((n) => (n.title = t(n.dataset.i18nTitle)));
  }

  function setLanguage(code) {
    if (!isLanguage(code) || code === current) return;
    current = code;
    try {
      localStorage.setItem(STORAGE_KEY, code);
    } catch {
      // 保存できなくても切り替え自体は続行する
    }
    apply();
    listeners.forEach((fn) => fn(code));
  }

  // ---------- カテゴリ ----------

  // 表示名（どの言語でも）→ キー。既定カテゴリでなければ入力値のまま返す
  function categoryKey(value) {
    const v = String(value || '').trim();
    if (!v) return '';
    if (CATEGORY_KEYS.includes(v)) return v;
    for (const key of CATEGORY_KEYS) {
      for (const msgs of Object.values(MESSAGES)) {
        if (msgs[`category.${key}`] === v) return key;
      }
    }
    return v;
  }

  // キー → 現在の言語の表示名。独自カテゴリはそのまま
  function categoryLabel(value) {
    return CATEGORY_KEYS.includes(value) ? t(`category.${value}`) : value;
  }

  // ---------- 多言語テキスト（レシピの中身） ----------
  // 形式は { ja: '...', zh: '...' }。旧形式の文字列は既定言語のテキストとして扱う

  function toLoc(value) {
    if (typeof value === 'string') return value ? { [DEFAULT_LANG]: value } : {};
    return value && typeof value === 'object' ? value : {};
  }

  // 現在の言語のテキストを返す。なければ他の言語で代用し fallback: true を返す
  function pick(value) {
    const loc = toLoc(value);
    if (loc[current]) return { text: loc[current], lang: current, fallback: false };
    const order = [...dataLanguages, ...DATA_LANGUAGES.map((l) => l.code), ...Object.keys(loc)];
    for (const code of order) {
      if (loc[code]) return { text: loc[code], lang: code, fallback: true };
    }
    return { text: '', lang: null, fallback: false };
  }

  const text = (value) => pick(value).text;
  const allTexts = (value) => Object.values(toLoc(value)).filter(Boolean);

  function langLabel(code) {
    const lang = DATA_LANGUAGES.find((l) => l.code === code);
    return lang ? lang.label : code;
  }

  function htmlLang(code) {
    const lang = DATA_LANGUAGES.find((l) => l.code === code);
    return lang ? lang.htmlLang : code;
  }

  // ---------- データの言語 ----------
  // 入力フォームに出す言語。画面の表示言語とは別に選ぶ（例：画面は日本語、データは日本語と英語）

  let dataLanguages = [...DEFAULT_DATA_LANGUAGES];

  // 一覧にある言語だけを、一覧の順に並べて使う
  function setDataLanguages(codes) {
    const picked = DATA_LANGUAGES.map((l) => l.code).filter((c) => (codes || []).includes(c));
    dataLanguages = picked.length ? picked : [...DEFAULT_DATA_LANGUAGES];
  }

  // 新しく入力するときに最初に選ぶ言語。表示言語がデータの言語にあればそれ、なければ最初のデータの言語
  const inputLanguage = () => (dataLanguages.includes(current) ? current : dataLanguages[0]);

  window.I18N = {
    ready,
    LANGUAGES,
    DATA_LANGUAGES,
    CATEGORY_KEYS,
    t,
    has,
    toLoc,
    pick,
    text,
    allTexts,
    langLabel,
    htmlLang,
    apply,
    setLanguage,
    get language() {
      return current;
    },
    get dataLanguages() {
      return [...dataLanguages];
    },
    setDataLanguages,
    inputLanguage,
    onChange: (fn) => listeners.push(fn),
    categoryKey,
    categoryLabel,
  };
})();
