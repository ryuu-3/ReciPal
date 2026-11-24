// 買い物リストのテスト
const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers/server');

// 常備品（塩）と普通の材料（玉ねぎ）を使うレシピを用意する
const DATA = {
  'tags.json': [],
  'ingredients.json': [
    { id: 'ing-onion', name: { ja: '玉ねぎ', zh: '洋葱' }, aliases: {}, tags: [] },
    { id: 'ing-salt', name: { ja: '塩' }, aliases: {}, tags: [], pantry: true },
  ],
  'recipes.json': [
    {
      id: 'r1',
      title: { ja: 'スープ' },
      variants: [
        {
          id: 'v1',
          servings: 2,
          ingredients: [
            { ingredientId: 'ing-onion', name: { ja: '玉ねぎ' }, amount: { ja: '1個' } },
            { ingredientId: 'ing-salt', name: { ja: '塩' }, amount: { ja: '少々' } },
            { name: { ja: '水' }, amount: { ja: '400ml' } },
          ],
          steps: [],
        },
        { id: 'v2', servings: 4, ingredients: [], steps: [] },
      ],
    },
  ],
};

describe('買い物リスト', () => {
  let app;
  beforeEach(async () => {
    app = await startServer({ data: DATA });
  });
  afterEach(() => app.stop());

  const addRecipe = (variantId = 'v1') => app.post('/api/shopping/recipes', { recipeId: 'r1', variantId });

  test('最初は空で、shopping.json は最初に追加したときに作られる', async () => {
    assert.deepEqual((await app.get('/api/shopping')).body, { recipes: [], items: [] });
    assert.equal(app.readData('shopping.json'), undefined);
    await addRecipe();
    assert.ok(app.readData('shopping.json'));
  });

  test('レシピを追加すると材料行ごとに 1 品目になり、常備品は「買わないもの」に入る', async () => {
    const { body } = await addRecipe();
    assert.equal(body.recipes.length, 1);
    assert.equal(body.recipes[0].times, 1);
    assert.equal(body.items.length, 3);
    const byName = Object.fromEntries(body.items.map((i) => [i.name.ja, i]));
    assert.equal(byName['玉ねぎ'].skip, false);
    assert.equal(byName['塩'].skip, true);
    assert.equal(byName['水'].skip, false);
    // 紐付いた材料は、材料マスタの名前（他の言語を含む）で入る
    assert.deepEqual(byName['玉ねぎ'].name, { ja: '玉ねぎ', zh: '洋葱' });
    assert.equal(byName['玉ねぎ'].ingredientId, 'ing-onion');
  });

  test('同じバリエーションをもう一度追加すると、行は増えずに ×2 になり、「買う」に戻る（常備品はそのまま）', async () => {
    const first = (await addRecipe()).body;
    const onion = first.items.find((i) => i.name.ja === '玉ねぎ');
    await app.patch(`/api/shopping/items/${onion.id}`, { skip: true });

    const { body } = await addRecipe();
    assert.equal(body.recipes[0].times, 2);
    assert.equal(body.items.length, 3);
    assert.equal(body.items.find((i) => i.id === onion.id).skip, false);
    assert.equal(body.items.find((i) => i.name.ja === '塩').skip, true);
  });

  test('「買う / 買わない」を切り替えられる', async () => {
    const item = (await addRecipe()).body.items[0];
    const { body } = await app.patch(`/api/shopping/items/${item.id}`, { skip: true });
    assert.equal(body.items.find((i) => i.id === item.id).skip, true);
  });

  test('手入力の品目は常備品でも「買う」で入り、1 件ずつ削除できる', async () => {
    const { body } = await app.post('/api/shopping/items', { name: { ja: '塩' }, amount: { ja: '1袋' }, ingredientId: 'ing-salt' });
    assert.equal(body.items.length, 1);
    const [item] = body.items;
    assert.equal(item.skip, false);
    assert.equal(item.recipeId, undefined);
    assert.equal((await app.post('/api/shopping/items', { name: { ja: '' } })).body.code, 'NAME_REQUIRED');

    const after = await app.del(`/api/shopping/items/${item.id}`);
    assert.equal(after.status, 200);
    assert.deepEqual(after.body.items, []);
  });

  test('レシピの品目は 1 件ずつは削除できず、レシピ単位で外す', async () => {
    const { items } = (await addRecipe()).body;
    const res = await app.del(`/api/shopping/items/${items[0].id}`);
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'ITEM_NOT_DELETABLE');

    const removed = await app.del('/api/shopping/recipes/r1/v1');
    assert.deepEqual(removed.body, { recipes: [], items: [] });
  });

  test('すべて削除', async () => {
    await addRecipe();
    await app.post('/api/shopping/items', { name: { ja: '牛乳' } });
    const { body } = await app.post('/api/shopping/clear', {});
    assert.deepEqual(body, { recipes: [], items: [] });
  });

  test('追加できないときのエラー', async () => {
    assert.equal((await app.post('/api/shopping/recipes', { recipeId: 'nope', variantId: 'v1' })).body.code, 'RECIPE_NOT_FOUND');
    assert.equal((await app.post('/api/shopping/recipes', { recipeId: 'r1', variantId: 'nope' })).body.code, 'VARIANT_NOT_FOUND');
    assert.equal((await addRecipe('v2')).body.code, 'NO_INGREDIENTS');
    assert.equal((await app.patch('/api/shopping/items/nope', { skip: true })).body.code, 'SHOPPING_ITEM_NOT_FOUND');
  });

  test('以前の形式（checked・同じ材料を 1 行にまとめた entries）を読み込める', async () => {
    await app.stop();
    app = await startServer({
      data: {
        ...DATA,
        'shopping.json': {
          recipes: [],
          items: [
            { id: 'a', name: { ja: '牛乳' }, checked: true },
            { id: 'b', name: { ja: '卵' }, entries: [{ amount: { ja: '1個' } }, { amount: { ja: '2個' } }] },
          ],
        },
      },
    });
    const { items } = (await app.get('/api/shopping')).body;
    assert.deepEqual(items.map((i) => [i.id, i.skip, i.amount && i.amount.ja]), [
      ['a', true, undefined],
      ['b', false, '1個'],
      ['b-1', false, '2個'],
    ]);
  });
});
