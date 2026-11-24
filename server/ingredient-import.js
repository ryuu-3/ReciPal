// 材料マスタの自動生成（レシピからの材料の取り込み）
const crypto = require('crypto');
const { nameKey, locObject } = require('./text');
const { forEachIngredientRow } = require('./storage');

// 材料マスタに紐付いていないレシピの材料を、名前（別名を含む）で照合して紐付ける。
// 見つからなければ材料マスタに新規登録する。recipes / ingredients はその場で書き換える。
// 取り込みは「登録・紐付けする先の材料」ごとのグループに分かれ、accept(key) が false のグループは取り込まない。
// key は同じデータなら毎回同じになるので、プレビューで選んだグループだけを後から取り込める
//   - 新規登録：new:<言語>:<最初に出てきた名前>
//   - 既存の材料への紐付け：link:<材料 ID>
function importFromRecipes(recipes, ingredients, accept = () => true) {
  const index = new Map();
  const register = (ing) => {
    const names = [...Object.values(ing.name || {}), ...Object.values(ing.aliases || {}).flat()];
    names.filter(Boolean).forEach((n) => index.set(nameKey(n), ing));
  };
  ingredients.forEach(register);
  const known = new Set(ingredients.map((i) => i.id));
  const newKeys = new Map(); // 今回新規登録した材料の ID → グループの key
  const groups = new Map();

  const now = new Date().toISOString();
  let created = 0;
  let linked = 0;

  for (const recipe of recipes) {
    for (const variant of recipe.variants || []) {
      for (const row of variant.ingredients || []) {
        if (row.ingredientId && known.has(row.ingredientId)) continue;
        const names = locObject(row.name);
        const entries = Object.entries(names).filter(([, v]) => typeof v === 'string' && v.trim());
        if (!entries.length) continue;

        let ing = entries.map(([, v]) => index.get(nameKey(v))).find(Boolean);
        const key = ing
          ? newKeys.get(ing.id) || `link:${ing.id}`
          : `new:${entries[0][0]}:${nameKey(entries[0][1])}`;
        if (!accept(key)) continue;

        if (!ing) {
          ing = { id: crypto.randomUUID(), name: {}, aliases: {}, tags: [], createdAt: now, updatedAt: now };
          ingredients.push(ing);
          known.add(ing.id);
          newKeys.set(ing.id, key);
          created++;
        }
        if (!ing.name) ing.name = {};
        if (!ing.aliases) ing.aliases = {};
        if (!groups.has(key)) {
          groups.set(key, { key, ingredient: ing, before: JSON.stringify({ name: ing.name, aliases: ing.aliases }), recipeIds: new Set(), rows: 0 });
        }
        const group = groups.get(key);
        group.recipeIds.add(recipe.id);
        group.rows++;

        // 足りない言語の名前を補い、表記が違うものは別名として残す
        for (const [lang, value] of entries) {
          const v = value.trim();
          if (!ing.name[lang]) {
            ing.name[lang] = v;
            ing.updatedAt = now;
          } else if (nameKey(ing.name[lang]) !== nameKey(v)) {
            const list = (ing.aliases[lang] = ing.aliases[lang] || []);
            if (!list.some((a) => nameKey(a) === nameKey(v))) {
              list.push(v);
              ing.updatedAt = now;
            }
          }
        }
        register(ing);
        row.ingredientId = ing.id;
        linked++;
      }
    }
  }

  // ingredientId を先頭に並べ替える（JSON を読みやすくするため）
  forEachIngredientRow(recipes, (row) => {
    if (!row.ingredientId) return;
    const { ingredientId, ...rest } = row;
    for (const key of Object.keys(row)) delete row[key];
    Object.assign(row, { ingredientId }, rest);
  });

  return { created, linked, groups: [...groups.values()].map(describeImportGroup) };
}

// 取り込みのグループを画面に返す形にする。紐付けの場合は、既存の材料に追加される名前・別名だけを返す
function describeImportGroup({ key, ingredient, before, recipeIds, rows }) {
  const isNew = key.startsWith('new:');
  const old = isNew ? {} : JSON.parse(before);
  const oldName = old.name || {};
  const oldAliases = old.aliases || {};
  const addedNames = {};
  for (const [lang, v] of Object.entries(ingredient.name)) {
    if (!oldName[lang]) addedNames[lang] = v;
  }
  const addedAliases = {};
  for (const [lang, list] of Object.entries(ingredient.aliases || {})) {
    const added = list.filter((a) => !(oldAliases[lang] || []).includes(a));
    if (added.length) addedAliases[lang] = added;
  }
  return {
    key,
    action: isNew ? 'create' : 'link',
    ingredientId: ingredient.id,
    name: { ...ingredient.name },
    addedNames,
    addedAliases,
    recipeIds: [...recipeIds],
    rows,
  };
}

module.exports = { importFromRecipes };
