// 起動時の処理のテスト：初回起動・以前の形式のデータからの移行
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer } = require('./helpers/server');

describe('起動時の処理', () => {
  test('data フォルダがなければ、空のレシピ・材料・タグのファイルを作る', async () => {
    const app = await startServer();
    try {
      assert.deepEqual(fs.readdirSync(path.join(app.dir, 'data')).sort(), ['ingredients.json', 'recipes.json', 'tags.json']);
      for (const file of ['recipes.json', 'ingredients.json', 'tags.json']) assert.deepEqual(app.readData(file), []);
      // 買い物リストと設定は、最初に保存したときに作る
      assert.deepEqual((await app.get('/api/shopping')).body, { recipes: [], items: [] });
      assert.deepEqual((await app.get('/api/settings')).body, { dataLanguages: ['ja', 'zh'] });
    } finally {
      await app.stop();
    }
  });

  test('以前の形式のデータを移行する（材料マスタの作成・タグの種類の振り分け）', async () => {
    const app = await startServer({
      data: {
        // 旧形式：レシピ直下に人数・材料・手順を持ち、テキストは文字列。材料マスタ（ingredients.json）はまだない
        'recipes.json': [
          { id: 'r1', title: '肉じゃが', tags: ['t-recipe', 't-quick'], servings: 2, ingredients: [{ name: '玉ねぎ', amount: '1個' }, { name: 'じゃがいも' }], steps: ['煮る'] },
          { id: 'r2', title: { ja: 'カレー' }, variants: [{ id: 'v1', ingredients: [{ name: { ja: '玉ねぎ', zh: '洋葱' } }], steps: [] }] },
        ],
        // 種類（type）のないタグ：レシピだけで使われていればレシピ用、ほかは材料用
        'tags.json': [
          { id: 't-recipe', name: { ja: '定番' } },
          { id: 't-quick', name: { ja: '時短' } },
          { id: 't-unused', name: { ja: '未使用' } },
        ],
      },
    });
    try {
      const tags = Object.fromEntries(app.readData('tags.json').map((t) => [t.id, t.type]));
      assert.deepEqual(tags, { 't-recipe': 'recipe', 't-quick': 'recipe', 't-unused': 'ingredient' });

      const ingredients = app.readData('ingredients.json');
      assert.deepEqual(ingredients.map((i) => i.name).sort((a, b) => a.ja.localeCompare(b.ja)), [
        { ja: 'じゃがいも' },
        { ja: '玉ねぎ', zh: '洋葱' },
      ]);
      // レシピの材料行が材料マスタに紐付く
      const recipes = (await app.get('/api/recipes')).body;
      const rows = recipes.flatMap((r) => r.variants.flatMap((v) => v.ingredients));
      assert.equal(rows.length, 3);
      assert.ok(rows.every((row) => ingredients.some((i) => i.id === row.ingredientId)));
      // 旧形式のレシピは、バリエーション 1 つの形で返す
      const r1 = recipes.find((r) => r.id === 'r1');
      assert.equal(r1.variants.length, 1);
      assert.equal(r1.variants[0].servings, 2);
      assert.match(app.output(), /材料を 2 件登録しました/);
      assert.match(app.output(), /タグを「レシピ用」「材料用」に振り分けました/);
    } finally {
      await app.stop();
    }
  });

  test('タグのファイルがなければ作り、すでに移行済みのデータは変えない', async () => {
    const recipes = [{ id: 'r1', title: { ja: 'A' }, variants: [{ id: 'v1', ingredients: [], steps: [] }] }];
    const app = await startServer({ data: { 'recipes.json': recipes, 'ingredients.json': [] } });
    try {
      assert.deepEqual(app.readData('tags.json'), []);
      assert.deepEqual(app.readData('recipes.json'), recipes);
      assert.doesNotMatch(app.output(), /登録しました|振り分けました/);
    } finally {
      await app.stop();
    }
  });
});
