// 画面の文言のチェック（scripts/check-i18n.js）を、node --test でまとめて実行できるようにする
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { ROOT } = require('./helpers/server');

test('画面の文言（public/i18n/locales/*.json）に問題がない', () => {
  const res = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'check-i18n.js')], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr || res.stdout);
});
