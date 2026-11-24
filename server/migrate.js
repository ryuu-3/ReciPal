// 起動時のデータの準備と、以前の形式のデータの移行
const fs = require('fs/promises');
const { DATA_DIR } = require('./config');
const { exists } = require('./files');
const { COLLECTIONS, dataPath, load, save } = require('./storage');
const { TAG_TYPES } = require('./validate');
const { importFromRecipes } = require('./ingredient-import');


async function ensureDataFiles() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  if (!(await exists(dataPath('recipes')))) {
    // 初回起動：空のデータで始める
    for (const name of Object.keys(COLLECTIONS)) {
      if (!(await exists(dataPath(name)))) await save(name, []);
    }
    return;
  }

  if (!(await exists(dataPath('tags')))) await save('tags', []);
  await assignTagTypes();

  if (!(await exists(dataPath('ingredients')))) {
    // 材料マスタ導入前のデータ：既存レシピの材料から材料マスタを作る
    const recipes = await load('recipes');
    const ingredients = [];
    const result = importFromRecipes(recipes, ingredients);
    await save('ingredients', ingredients);
    await save('recipes', recipes);
    console.log(`既存レシピから材料を ${result.created} 件登録しました（紐付け ${result.linked} か所）`);
  }
}

// タグの種類（type）導入前のデータを振り分ける。
// レシピだけで使われていればレシピ用、ほかは材料用にする。振り分け後、種類の合わないタグは材料・レシピから外す
async function assignTagTypes() {
  const tags = await load('tags');
  if (tags.every((t) => TAG_TYPES.includes(t.type))) return;

  const recipes = await load('recipes');
  const ingredients = (await exists(dataPath('ingredients'))) ? await load('ingredients') : [];
  const usedBy = (items, id) => items.some((x) => Array.isArray(x.tags) && x.tags.includes(id));

  for (const tag of tags) {
    if (TAG_TYPES.includes(tag.type)) continue;
    tag.type = usedBy(recipes, tag.id) && !usedBy(ingredients, tag.id) ? 'recipe' : 'ingredient';
  }
  const typeOf = new Map(tags.map((t) => [t.id, t.type]));
  const keepOnly = (items, type) => {
    let changed = false;
    for (const item of items) {
      if (!Array.isArray(item.tags)) continue;
      const kept = item.tags.filter((id) => typeOf.get(id) === type);
      if (kept.length !== item.tags.length) {
        item.tags = kept;
        changed = true;
      }
    }
    return changed;
  };

  await save('tags', tags);
  if (keepOnly(recipes, 'recipe')) await save('recipes', recipes);
  if (keepOnly(ingredients, 'ingredient')) await save('ingredients', ingredients);
  console.log('タグを「レシピ用」「材料用」に振り分けました');
}

module.exports = { ensureDataFiles };
