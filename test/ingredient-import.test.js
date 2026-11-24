// 材料の取り込み（レシピで使っている未登録の材料を材料マスタに登録・紐付けする）のテスト
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { ROOT, startServer } = require('./helpers/server');

const { importFromRecipes } = require(path.join(ROOT, 'server', 'ingredient-import.js'));

const recipe = (id, rows) => ({ id, title: { ja: id }, variants: [{ id: 'v1', ingredients: rows, steps: [] }] });
const rowsOf = (recipes) => recipes.flatMap((r) => r.variants.flatMap((v) => v.ingredients));

describe('importFromRecipes（関数を直接呼ぶ）', () => {
  test('同じ名前の行は 1 つの材料にまとめ、表記が違う名前は別名として追加する', () => {
    const ingredients = [{ id: 'ing-onion', name: { ja: '玉ねぎ' }, aliases: {}, tags: [] }];
    const recipes = [
      recipe('r1', [{ name: { ja: 'ベーコン' } }, { name: { ja: '玉ねぎ', zh: '洋葱' } }]),
      recipe('r2', [{ name: { ja: 'ベーコン' } }, { name: { ja: 'タマネギ' } }]),
    ];
    // 「タマネギ」は名前が違うので、玉ねぎとは別の新しい材料になる
    const result = importFromRecipes(recipes, ingredients);

    assert.equal(result.created, 2);
    assert.equal(result.linked, 4);
    const byKey = Object.fromEntries(result.groups.map((g) => [g.key, g]));
    assert.deepEqual(Object.keys(byKey).sort(), ['link:ing-onion', 'new:ja:タマネギ', 'new:ja:ベーコン']);
    assert.deepEqual(byKey['new:ja:ベーコン'].recipeIds, ['r1', 'r2']);
    assert.equal(byKey['new:ja:ベーコン'].rows, 2);
    assert.equal(byKey['new:ja:ベーコン'].action, 'create');
    // 既存の材料には、足りない言語の名前（zh）が追加される
    assert.equal(byKey['link:ing-onion'].action, 'link');
    assert.deepEqual(byKey['link:ing-onion'].addedNames, { zh: '洋葱' });
    assert.deepEqual(ingredients[0].name, { ja: '玉ねぎ', zh: '洋葱' });
    // すべての行が紐付き、ingredientId が先頭に来る
    for (const row of rowsOf(recipes)) assert.equal(Object.keys(row)[0], 'ingredientId');
  });

  test('別名で一致した行は既存の材料に紐付け、違う表記は別名に追加する', () => {
    const ingredients = [{ id: 'ing-chicken', name: { ja: '鶏もも肉', zh: '鸡腿肉' }, aliases: {}, tags: [] }];
    const recipes = [recipe('r1', [{ name: { ja: 'とりもも肉', zh: '鸡腿肉' } }])];
    const result = importFromRecipes(recipes, ingredients);
    assert.equal(result.created, 0);
    assert.deepEqual(result.groups[0].addedAliases, { ja: ['とりもも肉'] });
    assert.deepEqual(ingredients[0].aliases, { ja: ['とりもも肉'] });
    assert.equal(rowsOf(recipes)[0].ingredientId, 'ing-chicken');
  });

  test('accept で選ばなかったグループは取り込まず、レシピの行もそのまま残す', () => {
    const ingredients = [];
    const recipes = [recipe('r1', [{ name: { ja: 'ズッキーニ', zh: '西葫芦' } }, { name: { ja: 'ベーコン' } }]), recipe('r2', [{ name: { zh: '西葫芦' } }])];
    const result = importFromRecipes(recipes, ingredients, (key) => key === 'new:ja:ベーコン');
    assert.equal(result.created, 1);
    assert.deepEqual(ingredients.map((i) => i.name.ja), ['ベーコン']);
    // ズッキーニ（中国語だけの行も含む）は紐付かない
    assert.deepEqual(rowsOf(recipes).filter((r) => r.ingredientId).map((r) => r.name.ja), ['ベーコン']);
  });

  test('グループの key は同じデータなら毎回同じ（プレビューで選んだものを後から取り込めるように）', () => {
    const make = () => [recipe('r1', [{ name: { ja: '塩' } }, { name: { ja: '胡椒' } }])];
    const keys1 = importFromRecipes(make(), []).groups.map((g) => g.key);
    const keys2 = importFromRecipes(make(), []).groups.map((g) => g.key);
    assert.deepEqual(keys1, keys2);
  });

  test('すでに紐付いている行・名前が空の行は対象にしない', () => {
    const ingredients = [{ id: 'ing-salt', name: { ja: '塩' }, aliases: {}, tags: [] }];
    const recipes = [recipe('r1', [{ ingredientId: 'ing-salt', name: { ja: '塩' } }, { name: {} }, { name: { ja: '  ' } }])];
    const result = importFromRecipes(recipes, ingredients);
    assert.equal(result.linked, 0);
    assert.deepEqual(result.groups, []);
  });

  test('旧形式（文字列）の名前は日本語として扱う', () => {
    const ingredients = [];
    importFromRecipes([recipe('r1', [{ name: '味噌' }])], ingredients);
    assert.deepEqual(ingredients[0].name, { ja: '味噌' });
  });
});

describe('取り込みの API', () => {
  let app;
  before(async () => {
    app = await startServer({
      data: {
        'tags.json': [],
        'ingredients.json': [{ id: 'ing-onion', name: { ja: '玉ねぎ' }, aliases: {}, tags: [] }],
        'recipes.json': [
          recipe('r1', [{ name: { ja: 'ベーコン' } }, { name: { ja: 'たまねぎ' } }, { name: { ja: '玉ねぎ' } }]),
          recipe('r2', [{ name: { ja: 'ズッキーニ' } }]),
        ],
      },
    });
  });
  after(() => app.stop());

  test('GET はプレビューだけで、データを変えない', async () => {
    const before = app.readData('recipes.json');
    const res = await app.get('/api/ingredients/import');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.groups.map((g) => g.key).sort(), ['link:ing-onion', 'new:ja:たまねぎ', 'new:ja:ズッキーニ', 'new:ja:ベーコン']);
    assert.deepEqual(app.readData('recipes.json'), before);
    assert.equal(app.readData('ingredients.json').length, 1);
  });

  test('POST の keys の形式が不正ならエラー', async () => {
    const res = await app.post('/api/ingredients/import', { keys: 'x' });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'INVALID_REQUEST');
  });

  test('POST は keys で選んだグループだけを取り込み、残りは次のプレビューに出る', async () => {
    const res = await app.post('/api/ingredients/import', { keys: ['new:ja:ベーコン', 'link:ing-onion'] });
    assert.equal(res.status, 200);
    assert.equal(res.body.created, 1);
    assert.equal(res.body.linked, 2);
    assert.deepEqual(app.readData('ingredients.json').map((i) => i.name.ja).sort(), ['ベーコン', '玉ねぎ']);

    const rest = await app.get('/api/ingredients/import');
    assert.deepEqual(rest.body.groups.map((g) => g.key).sort(), ['new:ja:たまねぎ', 'new:ja:ズッキーニ']);
  });

  test('keys がなければすべて取り込み、取り込むものがなければ何も変えない', async () => {
    const all = await app.post('/api/ingredients/import', {});
    assert.equal(all.body.created, 2);
    const none = await app.post('/api/ingredients/import', {});
    assert.equal(none.body.linked, 0);
    assert.deepEqual(none.body.groups, []);
  });
});
