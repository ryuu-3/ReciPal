// 名前の照合などで使う、多言語テキストの小さな共通処理
const { DEFAULT_LANG } = require('./config');

const nameKey = (s) => String(s).normalize('NFKC').trim().toLowerCase();
const locObject = (v) => (typeof v === 'string' ? (v ? { [DEFAULT_LANG]: v } : {}) : v && typeof v === 'object' ? v : {});

module.exports = { nameKey, locObject };
