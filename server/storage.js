// データの保存：コレクション（レシピ・材料・タグ）ごとに 1 ファイル。初回起動時は空のファイルを作成する
const fs = require('fs/promises');
const path = require('path');
const { DATA_DIR } = require('./config');
const { isInside } = require('./files');
const { backupData } = require('./backup');

const COLLECTIONS = {
  recipes: { file: 'recipes.json' },
  ingredients: { file: 'ingredients.json' },
  tags: { file: 'tags.json' },
};

const dataPath = (name) => path.join(DATA_DIR, COLLECTIONS[name].file);

async function load(name) {
  const data = JSON.parse(await fs.readFile(dataPath(name), 'utf8'));
  if (!Array.isArray(data)) return [];
  return name === 'recipes' ? data.map(upgradeRecipe) : data;
}

// 一時ファイル → rename で書き込み、途中で落ちても JSON が壊れないようにする。
// Windows ではウイルス対策ソフトやエディタがファイルを一瞬開いていると rename が失敗することがあるので、少し待って再試行する。
// data フォルダへの書き込みの前には、その日の最初の 1 回だけバックアップを取る
async function writeJson(file, data) {
  if (isInside(file, DATA_DIR)) await backupData();
  const tmp = file + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  for (let attempt = 1; ; attempt++) {
    try {
      await fs.rename(tmp, file);
      return;
    } catch (err) {
      if (attempt >= 5 || !['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) throw err;
      await new Promise((resolve) => setTimeout(resolve, 50 * attempt));
    }
  }
}

const save = (name, items) => writeJson(dataPath(name), items);

// 更新系の処理は 1 つずつ順番に実行する（読み込み → 変更 → 保存 の間に割り込ませない）
let lock = Promise.resolve();
function withLock(fn) {
  const run = lock.then(fn, fn);
  lock = run.catch(() => {});
  return run;
}

// 旧形式（servings / time / ingredients / steps を直接持つ）をバリエーション 1 つの形に変換する
function upgradeRecipe(recipe) {
  if (!recipe || typeof recipe !== 'object' || Array.isArray(recipe.variants)) return recipe;
  const { servings = null, time = null, ingredients = [], steps = [], ...rest } = recipe;
  return { ...rest, variants: [{ id: 'v1', label: {}, servings, time, ingredients, steps }] };
}

function forEachIngredientRow(recipes, fn) {
  for (const recipe of recipes) {
    for (const variant of recipe.variants || []) {
      for (const row of variant.ingredients || []) fn(row);
    }
  }
}

module.exports = { COLLECTIONS, dataPath, load, writeJson, save, withLock, upgradeRecipe, forEachIngredientRow };
