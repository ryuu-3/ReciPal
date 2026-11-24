// 設定（データの言語）のテスト
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers/server');

describe('設定', () => {
  let app;
  before(async () => {
    app = await startServer();
  });
  after(() => app.stop());

  test('設定ファイルがなければ、既定値（日本語・中国語）を返す', async () => {
    assert.deepEqual((await app.get('/api/settings')).body, { dataLanguages: ['ja', 'zh'] });
    assert.equal(app.readData('settings.json'), undefined);
  });

  test('保存すると settings.json に書かれ、重複や不正な言語コードは除く', async () => {
    const res = await app.put('/api/settings', { dataLanguages: ['en', 'ja', 'en', '../x', 3, 'zh-TW'] });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { dataLanguages: ['en', 'ja', 'zh-TW'] });
    assert.deepEqual(app.readData('settings.json'), res.body);
    assert.deepEqual((await app.get('/api/settings')).body, res.body);
  });

  test('データの言語が 1 つもなければエラー', async () => {
    for (const body of [{ dataLanguages: [] }, { dataLanguages: ['../x'] }, {}]) {
      const res = await app.put('/api/settings', body);
      assert.equal(res.status, 400);
      assert.equal(res.body.code, 'DATA_LANGUAGES_REQUIRED');
    }
  });
});

describe('設定ファイルが壊れているとき', () => {
  test('既定値を使って起動する', async () => {
    const app = await startServer({ data: { 'recipes.json': [], 'ingredients.json': [], 'tags.json': [], 'settings.json': '{broken' } });
    try {
      assert.deepEqual((await app.get('/api/settings')).body, { dataLanguages: ['ja', 'zh'] });
    } finally {
      await app.stop();
    }
  });
});
