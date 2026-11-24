// API のテスト：レシピ・材料・タグの追加・取得・更新・削除と入力エラー、削除時の後始末
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers/server');

describe('レシピ・材料・タグ', () => {
  let app;
  before(async () => {
    app = await startServer();
  });
  after(() => app.stop());

  test('初回起動では一覧が空', async () => {
    for (const name of ['recipes', 'ingredients', 'tags']) {
      const res = await app.get(`/api/${name}`);
      assert.equal(res.status, 200);
      assert.deepEqual(res.body, []);
    }
  });

  test('タグ：追加・更新（種類は変えられない）・入力エラー', async () => {
    const created = await app.post('/api/tags', { type: 'recipe', name: { ja: '時短', en: '' } });
    assert.equal(created.status, 201);
    assert.equal(created.body.type, 'recipe');
    assert.deepEqual(created.body.name, { ja: '時短' }); // 空の言語は保存しない
    assert.ok(created.body.id && created.body.createdAt);

    const updated = await app.put(`/api/tags/${created.body.id}`, { type: 'ingredient', name: { ja: '時短', en: 'Quick' } });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.type, 'recipe');
    assert.deepEqual(updated.body.name, { ja: '時短', en: 'Quick' });

    assert.equal((await app.post('/api/tags', { type: 'other', name: { ja: 'x' } })).body.code, 'INVALID_REQUEST');
    assert.equal((await app.post('/api/tags', { type: 'recipe', name: {} })).body.code, 'NAME_REQUIRED');
  });

  test('材料：別名の重複・空欄を除き、存在しないタグや種類の違うタグは外す', async () => {
    const recipeTag = (await app.post('/api/tags', { type: 'recipe', name: { ja: 'レシピ用' } })).body;
    const ingTag = (await app.post('/api/tags', { type: 'ingredient', name: { ja: '野菜' } })).body;
    const res = await app.post('/api/ingredients', {
      name: { ja: '玉ねぎ' },
      aliases: { ja: ['たまねぎ', 'たまねぎ', ' ', 'タマネギ'] },
      tags: [ingTag.id, recipeTag.id, 'nope'],
      pantry: true,
    });
    assert.equal(res.status, 201);
    assert.deepEqual(res.body.aliases, { ja: ['たまねぎ', 'タマネギ'] });
    assert.deepEqual(res.body.tags, [ingTag.id]);
    assert.equal(res.body.pantry, true);
    assert.equal((await app.post('/api/ingredients', { name: { ja: '' } })).body.code, 'NAME_REQUIRED');
  });

  test('レシピ：入力の整形（人数・時間・空の行・材料マスタの紐付け・重複したバリエーション ID）', async () => {
    const ing = (await app.post('/api/ingredients', { name: { ja: '鶏もも肉', zh: '鸡腿肉' } })).body;
    const res = await app.post('/api/recipes', {
      title: { ja: '照り焼き' },
      category: ' main ',
      variants: [
        {
          id: 'v1',
          servings: '2',
          time: 'abc',
          ingredients: [
            { ingredientId: ing.id, name: {}, amount: { ja: '1枚' } },
            { ingredientId: 'nope', name: { ja: '醤油' }, amount: { ja: '大さじ1' } },
            { name: {} },
          ],
          steps: [{ ja: '焼く' }, {}, ''],
        },
        { id: 'v1', servings: 4 },
      ],
    });
    assert.equal(res.status, 201);
    const r = res.body;
    assert.equal(r.category, 'main');
    assert.equal(r.variants.length, 2);
    assert.notEqual(r.variants[0].id, r.variants[1].id);
    const [v1] = r.variants;
    assert.equal(v1.servings, 2);
    assert.equal(v1.time, null);
    // 名前が空の紐付け行には材料マスタの名前が入り、存在しない材料 ID は外れる
    assert.deepEqual(v1.ingredients, [
      { ingredientId: ing.id, name: { ja: '鶏もも肉', zh: '鸡腿肉' }, amount: { ja: '1枚' } },
      { name: { ja: '醤油' }, amount: { ja: '大さじ1' } },
    ]);
    assert.deepEqual(v1.steps, [{ ja: '焼く' }]);
  });

  test('レシピ：旧形式（バリエーションなし・文字列）でも受け付ける', async () => {
    const res = await app.post('/api/recipes', { title: '旧形式', servings: 3, ingredients: [{ name: '塩', amount: '少々' }], steps: ['混ぜる'] });
    assert.equal(res.status, 201);
    assert.equal(res.body.title, '旧形式');
    assert.equal(res.body.variants.length, 1);
    assert.equal(res.body.variants[0].servings, 3);
    assert.deepEqual(res.body.variants[0].ingredients, [{ name: '塩', amount: '少々' }]);
  });

  test('レシピ：取得・更新・削除と、見つからないとき', async () => {
    const created = (await app.post('/api/recipes', { title: { ja: 'A' } })).body;
    assert.equal((await app.get(`/api/recipes/${created.id}`)).body.title.ja, 'A');

    const updated = await app.put(`/api/recipes/${created.id}`, { ...created, title: { ja: 'B' } });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.title.ja, 'B');
    assert.equal(updated.body.createdAt, created.createdAt);

    assert.equal((await app.post('/api/recipes', { title: {} })).body.code, 'TITLE_REQUIRED');
    assert.equal((await app.get('/api/recipes/nope')).body.code, 'RECIPE_NOT_FOUND');
    assert.equal((await app.put('/api/recipes/nope', { title: 'x' })).body.code, 'RECIPE_NOT_FOUND');

    assert.equal((await app.del(`/api/recipes/${created.id}`)).status, 204);
    assert.equal((await app.get(`/api/recipes/${created.id}`)).status, 404);
    assert.equal((await app.del(`/api/recipes/${created.id}`)).body.code, 'RECIPE_NOT_FOUND');
  });

  test('保存した内容が data のファイルに書かれる', async () => {
    const created = (await app.post('/api/tags', { type: 'ingredient', name: { ja: 'ファイル確認' } })).body;
    assert.ok(app.readData('tags.json').some((t) => t.id === created.id));
  });
});

describe('削除時の後始末', () => {
  let app;
  before(async () => {
    app = await startServer();
  });
  after(() => app.stop());

  test('タグを削除すると、付いていたレシピ・材料からも外れる', async () => {
    const rt = (await app.post('/api/tags', { type: 'recipe', name: { ja: 'R' } })).body;
    const it = (await app.post('/api/tags', { type: 'ingredient', name: { ja: 'I' } })).body;
    const ing = (await app.post('/api/ingredients', { name: { ja: '材料' }, tags: [it.id] })).body;
    const recipe = (await app.post('/api/recipes', { title: { ja: 'レシピ' }, tags: [rt.id] })).body;

    assert.equal((await app.del(`/api/tags/${rt.id}`)).status, 204);
    assert.equal((await app.del(`/api/tags/${it.id}`)).status, 204);
    assert.deepEqual((await app.get(`/api/recipes/${recipe.id}`)).body.tags, []);
    assert.deepEqual((await app.get(`/api/ingredients/${ing.id}`)).body.tags, []);
  });

  test('材料を削除すると、レシピと買い物リストの紐付けだけが外れ、名前は残る', async () => {
    const ing = (await app.post('/api/ingredients', { name: { ja: '卵' } })).body;
    const recipe = (await app.post('/api/recipes', {
      title: { ja: '卵焼き' },
      variants: [{ ingredients: [{ ingredientId: ing.id, name: { ja: '卵' }, amount: { ja: '2個' } }] }],
    })).body;
    await app.post('/api/shopping/recipes', { recipeId: recipe.id, variantId: recipe.variants[0].id });
    await app.post('/api/shopping/items', { name: { ja: '卵' }, amount: { ja: '1パック' }, ingredientId: ing.id });

    assert.equal((await app.del(`/api/ingredients/${ing.id}`)).status, 204);
    const row = (await app.get(`/api/recipes/${recipe.id}`)).body.variants[0].ingredients[0];
    assert.equal(row.ingredientId, undefined);
    assert.deepEqual(row.name, { ja: '卵' });
    const shopping = (await app.get('/api/shopping')).body;
    assert.equal(shopping.items.length, 2);
    assert.ok(shopping.items.every((i) => i.ingredientId === undefined && i.name.ja === '卵'));
  });
});
