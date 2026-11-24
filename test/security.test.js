// アクセス制限のテスト：ローカル専用のサーバーなので、ほかのサイトからのアクセスや、public の外のファイルの読み出しを拒否する
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers/server');

describe('アクセス制限', () => {
  let app;
  before(async () => {
    app = await startServer();
  });
  after(() => app.stop());

  const newTag = { type: 'recipe', name: { ja: 'x' } };

  test('Host が localhost / 127.0.0.1 以外なら拒否する（DNS リバインディング対策）', async () => {
    assert.equal((await app.get('/api/recipes', { headers: { Host: 'evil.example.com' } })).status, 403);
    assert.equal((await app.get('/api/recipes', { headers: { Host: `localhost:${app.port + 1}` } })).status, 403);
    assert.equal((await app.get('/api/recipes', { headers: { Host: `127.0.0.1:${app.port}` } })).status, 200);
  });

  test('更新系は、Origin がほかのサイトなら拒否する', async () => {
    const res = await app.post('/api/tags', newTag, { headers: { Origin: 'http://evil.example.com' } });
    assert.equal(res.status, 403);
    assert.equal(res.body.code, 'FORBIDDEN');
    const ok = await app.post('/api/tags', newTag, { headers: { Origin: `http://localhost:${app.port}` } });
    assert.equal(ok.status, 201);
  });

  test('更新系は、Content-Type が application/json 以外なら拒否する', async () => {
    const res = await app.post('/api/tags', JSON.stringify(newTag), { headers: { 'Content-Type': 'text/plain' } });
    assert.equal(res.status, 415);
    assert.equal(res.body.code, 'UNSUPPORTED_MEDIA_TYPE');
  });

  test('不正な JSON・大きすぎるデータ・不正な URL はエラーにする', async () => {
    assert.equal((await app.post('/api/tags', '{bad')).body.code, 'INVALID_JSON');
    assert.equal((await app.post('/api/tags', [1, 2])).body.code, 'INVALID_REQUEST');
    assert.equal((await app.get('/api/shopping/items/%E0%A4%A')).body.code, 'INVALID_REQUEST');
    // 1MB を超えるデータは、受け取りの途中で接続を切る
    const big = await app.post('/api/tags', { name: 'x'.repeat(1100000) }).catch((err) => ({ error: err.code }));
    assert.ok(big.error || big.status === 413);
  });

  test('存在しない API・許可されていない操作', async () => {
    assert.equal((await app.get('/api/nope')).status, 404);
    assert.equal((await app.request('PATCH', '/api/recipes', { body: {} })).body.code, 'METHOD_NOT_ALLOWED');
    assert.equal((await app.post('/api/settings', {})).body.code, 'METHOD_NOT_ALLOWED');
    assert.equal((await app.post('/api/backup', {})).body.code, 'METHOD_NOT_ALLOWED');
  });

  test('画面のファイルを返す（種類に合った Content-Type、HEAD）', async () => {
    const index = await app.get('/');
    assert.equal(index.status, 200);
    assert.match(index.headers['content-type'], /^text\/html/);
    assert.match((await app.get('/js/main.js')).headers['content-type'], /^text\/javascript/);
    assert.match((await app.get('/i18n/locales/ja.json')).headers['content-type'], /^application\/json/);
    const head = await app.request('HEAD', '/style.css');
    assert.equal(head.status, 200);
    assert.equal(head.text, '');
    assert.equal((await app.get('/nope.js')).status, 404);
    assert.equal((await app.post('/index.html', {})).status, 405);
  });

  test('public の外のファイル（server.js・data など）は読み出せない', async () => {
    for (const p of ['/..%2fserver.js', '/%2e%2e/data/recipes.json', '/..%5cserver.js', '/%2e%2e%2f%2e%2e%2fetc%2fpasswd']) {
      const res = await app.get(p);
      assert.ok([403, 404].includes(res.status), `${p} → ${res.status}`);
      assert.doesNotMatch(res.text, /require\(|"recipes"|root:/);
    }
  });

  test('API の返り値はキャッシュさせない', async () => {
    assert.equal((await app.get('/api/recipes')).headers['cache-control'], 'no-store');
  });
});
