// 画面の文言（public/i18n/locales/*.json）のチェック
// 実行: node scripts/check-i18n.js
//
// - LANGUAGES の言語ごとに JSON があるか
// - 日本語（基準）と同じキーがそろっているか
// - 値の形式（文字列、または単数・複数の { one, other }）
// - {n} などの差し込み箇所が日本語と同じか
// - HTML・JS で使っている翻訳キーが日本語の JSON にあるか
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const I18N_DIR = path.join(ROOT, 'public', 'i18n');
const LOCALES_DIR = path.join(I18N_DIR, 'locales');
const BASE_LANG = 'ja';

const errors = [];
const error = (message) => errors.push(message);

// i18n.js の LANGUAGES から言語コードを読み取る
function languageCodes() {
  const src = fs.readFileSync(path.join(I18N_DIR, 'i18n.js'), 'utf8');
  const block = src.match(/const LANGUAGES = \[([\s\S]*?)\];/);
  if (!block) throw new Error('i18n.js に LANGUAGES が見つかりません');
  return [...block[1].matchAll(/code: '([^']+)'/g)].map((m) => m[1]);
}

function loadLocale(code) {
  const file = path.join(LOCALES_DIR, `${code}.json`);
  if (!fs.existsSync(file)) {
    error(`${code}.json がありません`);
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    error(`${code}.json の JSON の形式が正しくありません: ${err.message}`);
    return null;
  }
}

// 値に含まれる差し込み箇所（{n} など）。単数・複数の形はまとめて数える
const forms = (value) => (typeof value === 'string' ? [value] : Object.values(value));
const placeholders = (value) =>
  [...new Set(forms(value).flatMap((text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1])))].sort();

function checkValue(code, key, value) {
  if (typeof value === 'string') return true;
  const ok = value && typeof value === 'object' && !Array.isArray(value)
    && typeof value.other === 'string' && Object.values(value).every((v) => typeof v === 'string');
  if (!ok) error(`${code}.json の "${key}"：値は文字列か { "one": "...", "other": "..." } にしてください`);
  return ok;
}

// HTML・JS で使っている翻訳キー（キーの先頭部分が JSON にあるものだけを対象にする）
function usedKeys(prefixes) {
  const files = [
    path.join(ROOT, 'public', 'index.html'),
    ...fs.readdirSync(path.join(ROOT, 'public', 'js')).map((f) => path.join(ROOT, 'public', 'js', f)),
  ];
  const used = new Map();
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    const pattern = file.endsWith('.html')
      ? /data-i18n(?:-[a-z-]+)?="([\w.]+)"/g
      : /['"`]([a-zA-Z]+\.[\w.]+)['"`]/g;
    for (const m of src.matchAll(pattern)) {
      if (!prefixes.has(m[1].split('.')[0])) continue;
      if (!used.has(m[1])) used.set(m[1], path.relative(ROOT, file));
    }
  }
  return used;
}

const codes = languageCodes();
const locales = Object.fromEntries(codes.map((code) => [code, loadLocale(code)]));

for (const file of fs.readdirSync(LOCALES_DIR)) {
  const code = path.basename(file, '.json');
  if (!codes.includes(code)) error(`${file} は LANGUAGES にない言語です（i18n.js の LANGUAGES に追加してください）`);
}

const base = locales[BASE_LANG];
if (base) {
  const validBase = new Set(Object.keys(base).filter((key) => checkValue(BASE_LANG, key, base[key])));

  for (const code of codes.filter((c) => c !== BASE_LANG && locales[c])) {
    const messages = locales[code];
    for (const key of Object.keys(base)) {
      if (!(key in messages)) error(`${code}.json に "${key}" がありません`);
    }
    for (const [key, value] of Object.entries(messages)) {
      if (!(key in base)) {
        error(`${code}.json の "${key}" は ${BASE_LANG}.json にありません`);
        continue;
      }
      if (!checkValue(code, key, value) || !validBase.has(key)) continue;
      const expected = placeholders(base[key]).join(', ');
      const actual = placeholders(value).join(', ');
      if (expected !== actual) error(`${code}.json の "${key}"：差し込み箇所が ${BASE_LANG}.json と違います（{${expected}} と {${actual}}）`);
    }
  }

  const prefixes = new Set(Object.keys(base).map((k) => k.split('.')[0]));
  for (const [key, file] of usedKeys(prefixes)) {
    if (!(key in base)) error(`${file} で使っている "${key}" が ${BASE_LANG}.json にありません`);
  }
}

if (errors.length) {
  console.error(`画面の文言に ${errors.length} 件の問題があります：`);
  errors.forEach((e) => console.error(`  - ${e}`));
  process.exit(1);
}
const counts = codes.map((c) => `${c} ${Object.keys(locales[c]).length}`).join(' / ');
console.log(`画面の文言に問題はありません（${counts} キー）`);
