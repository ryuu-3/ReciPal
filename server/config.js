// 設定値：フォルダの場所・ホスト・ポートなど
const path = require('path');

// ReciPal のフォルダ（server.js がある場所）
const ROOT = path.join(__dirname, '..');

const HOST = '127.0.0.1';
const BASE_PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const NO_OPEN = process.argv.includes('--no-open');
// 旧形式の文字列データを何語のテキストとして扱うか（public/i18n/i18n.js の DEFAULT_LANG と合わせる）
const DEFAULT_LANG = 'ja';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

module.exports = { ROOT, HOST, BASE_PORT, PUBLIC_DIR, DATA_DIR, NO_OPEN, DEFAULT_LANG, MIME };
