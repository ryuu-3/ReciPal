const fs = require('fs/promises');
const path = require('path');
const { DATA_DIR } = require('./config');
const { exists } = require('./files');
const { HttpError } = require('./http-utils');
const { LANG_KEY, MAX_LANGS, requireObject } = require('./validate');

// 設定
// data/settings.json に保存する。ファイルがなければ既定値を使う（以前のデータと同じ日本語・中国語）

const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const DEFAULT_SETTINGS = { dataLanguages: ['ja', 'zh'] };

async function loadSettings() {
  if (!(await exists(SETTINGS_FILE))) return { ...DEFAULT_SETTINGS };
  try {
    return sanitizeSettings(JSON.parse(await fs.readFile(SETTINGS_FILE, 'utf8')));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

// dataLanguages：入力フォームで使う言語のコード（1 つ以上）
function sanitizeSettings(body) {
  requireObject(body);
  const list = Array.isArray(body.dataLanguages) ? body.dataLanguages : [];
  const dataLanguages = [...new Set(list.filter((c) => typeof c === 'string' && LANG_KEY.test(c)))].slice(0, MAX_LANGS);
  if (!dataLanguages.length) throw new HttpError(400, 'DATA_LANGUAGES_REQUIRED', 'データの言語を 1 つ以上選んでください');
  return { dataLanguages };
}

module.exports = { SETTINGS_FILE, loadSettings, sanitizeSettings };
