const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { DATA_DIR } = require('./config');
const { exists } = require('./files');
const { nameKey, locObject } = require('./text');
const { HttpError, sendJson, readBody, methodNotAllowed, decodePath } = require('./http-utils');
const { load, writeJson, withLock } = require('./storage');
const { ID_PATTERN, locText, isBlank, requireObject } = require('./validate');

// 買い物リスト
// リストは 1 つだけ。recipes：追加したレシピ（バリエーション）、items：品目。
// 品目は「1 レシピの 1 材料行」または「手入力 1 件」ごとに 1 行で、同じ材料でもまとめない
// （まとめるのはコピーするテキストだけ。画面側で行う）。
// 品目は最初「買う」状態で、skip: true は「買わないもの」（家にある・常備品など）を表す。
// 分量や名前は追加した時点の控えで、あとでレシピを編集してもリストは変わらない

const SHOPPING_FILE = path.join(DATA_DIR, 'shopping.json');

async function loadShopping() {
  if (!(await exists(SHOPPING_FILE))) return { recipes: [], items: [] };
  const data = JSON.parse(await fs.readFile(SHOPPING_FILE, 'utf8')) || {};
  return {
    recipes: Array.isArray(data.recipes) ? data.recipes : [],
    items: Array.isArray(data.items) ? data.items.flatMap(upgradeShoppingItem) : [],
  };
}

// 旧形式の変換
// - checked（チェック済み＝もう買わなくてよい）は skip（買わないもの）とほぼ同じ意味なのでそのまま移す
// - entries（同じ材料を 1 行にまとめた形）は、entry ごとの行に分ける。状態は各行に引き継ぐ。
//   変換結果は次の更新まで保存されないので、ID は読み込むたびに同じになるよう「元の ID-番号」にする
function upgradeShoppingItem(item) {
  if (!item || typeof item !== 'object') return [];
  const { checked, entries, ...rest } = item;
  const skip = 'skip' in item ? Boolean(item.skip) : Boolean(checked);
  if (!Array.isArray(entries)) return [{ ...rest, skip }];
  return entries.map((entry, i) => ({ ...rest, id: i === 0 ? item.id : `${item.id}-${i}`, skip, ...entry }));
}

const saveShopping = (list) => writeJson(SHOPPING_FILE, list);

// 同じ材料かどうかの判定キー：材料マスタの ID、なければ名前（全言語）
function shoppingKey(ingredientId, name) {
  if (ingredientId) return `id:${ingredientId}`;
  return `name:${Object.values(locObject(name)).filter((v) => typeof v === 'string').map(nameKey).sort().join('|')}`;
}

// どの品目からも参照されなくなったレシピを取り除く
function tidyShopping(list) {
  const used = new Set(list.items.filter((i) => i.recipeId).map((i) => `${i.recipeId}/${i.variantId}`));
  list.recipes = list.recipes.filter((r) => used.has(`${r.recipeId}/${r.variantId}`));
  return list;
}

// レシピ（バリエーション）の材料をすべて追加する。材料行ごとに 1 品目で、常備品は「買わないもの」に入る。
// 同じバリエーションをもう一度追加したら、行は増やさずに times を増やし（分量は換算しない）、
// その行を「買う」に戻す（常備品は今の状態のまま）
async function addRecipeToShopping(body) {
  requireObject(body);
  const recipe = (await load('recipes')).find((r) => r.id === body.recipeId);
  if (!recipe) throw new HttpError(404, 'RECIPE_NOT_FOUND', 'Not Found');
  const variant = (recipe.variants || []).find((v) => v.id === body.variantId);
  if (!variant) throw new HttpError(404, 'VARIANT_NOT_FOUND', 'Not Found');
  const rows = variant.ingredients || [];
  if (!rows.length) throw new HttpError(400, 'NO_INGREDIENTS', '追加できる材料がありません');

  const masters = new Map((await load('ingredients')).map((i) => [i.id, i]));
  const list = await loadShopping();
  const snapshot = { title: recipe.title, label: variant.label, servings: variant.servings };
  const ref = list.recipes.find((r) => r.recipeId === recipe.id && r.variantId === variant.id);
  if (ref) {
    ref.times = (ref.times || 1) + 1;
    Object.assign(ref, snapshot);
  } else {
    list.recipes.push({ recipeId: recipe.id, variantId: variant.id, times: 1, ...snapshot, addedAt: new Date().toISOString() });
  }

  // 既存の行は「同じレシピ・バリエーションの同じ材料」で探す。
  // 行番号だけで探すと、追加後にレシピを編集して材料の順番が変わったとき、別の材料の行と取り違えるため
  const sameVariant = list.items.filter((i) => i.recipeId === recipe.id && i.variantId === variant.id);
  const matched = new Set();
  rows.forEach((row, index) => {
    const master = row.ingredientId ? masters.get(row.ingredientId) : null;
    const pantry = Boolean(master && master.pantry);
    const key = shoppingKey(master ? master.id : null, row.name);
    const candidates = sameVariant.filter((i) => !matched.has(i) && shoppingKey(i.ingredientId, i.name) === key);
    const existing = candidates.find((i) => i.row === index) || candidates[0];
    if (existing) {
      matched.add(existing);
      existing.row = index;
      if (!pantry) existing.skip = false;
      return;
    }
    list.items.push({
      id: crypto.randomUUID(),
      ...(master ? { ingredientId: master.id } : {}),
      name: master ? { ...locObject(row.name), ...master.name } : locObject(row.name),
      skip: pantry,
      recipeId: recipe.id,
      variantId: variant.id,
      row: index,
      amount: locObject(row.amount),
    });
  });
  return list;
}

// 手入力の品目を追加する。買うつもりで入力するので、常備品でも「買う」にする
async function addManualShoppingItem(body) {
  requireObject(body);
  const name = locText(body.name, 100);
  if (isBlank(name)) throw new HttpError(400, 'NAME_REQUIRED', '名前は必須です');
  const masters = new Map((await load('ingredients')).map((i) => [i.id, i]));
  const master = typeof body.ingredientId === 'string' ? masters.get(body.ingredientId) : null;
  const list = await loadShopping();
  list.items.push({
    id: crypto.randomUUID(),
    ...(master ? { ingredientId: master.id } : {}),
    name: master ? { ...locObject(name), ...master.name } : locObject(name),
    skip: false,
    amount: locObject(locText(body.amount, 50)),
  });
  return list;
}

// /api/shopping 以下のルーティング。更新系はすべてリスト全体を返す
async function handleShopping(req, res, url) {
  const [kind, a, b] = url.pathname.split('/').filter(Boolean).slice(2).map(decodePath);
  if (!kind) {
    if (req.method !== 'GET') throw methodNotAllowed();
    return sendJson(res, 200, await loadShopping());
  }
  const idOk = (id) => typeof id === 'string' && ID_PATTERN.test(id);
  const body = req.method === 'POST' || req.method === 'PATCH' ? await readBody(req) : null;

  const list = await withLock(async () => {
    let result;
    if (kind === 'recipes' && !a && req.method === 'POST') {
      result = await addRecipeToShopping(body);
    } else if (kind === 'recipes' && idOk(a) && idOk(b) && req.method === 'DELETE') {
      // そのレシピ分の行を取り除く
      result = await loadShopping();
      result.items = result.items.filter((i) => !(i.recipeId === a && i.variantId === b));
    } else if (kind === 'items' && !a && req.method === 'POST') {
      result = await addManualShoppingItem(body);
    } else if (kind === 'items' && idOk(a) && (req.method === 'PATCH' || req.method === 'DELETE')) {
      result = await loadShopping();
      const item = result.items.find((x) => x.id === a);
      if (!item) throw new HttpError(404, 'SHOPPING_ITEM_NOT_FOUND', 'Not Found');
      if (req.method === 'PATCH') {
        // 「買う」/「買わない」の切り替え
        if (body && typeof body.skip === 'boolean') item.skip = body.skip;
      } else {
        // 削除できるのは手入力の行だけ。レシピの行はレシピ単位で外す（DELETE /api/shopping/recipes/...）
        if (item.recipeId) throw new HttpError(400, 'ITEM_NOT_DELETABLE', 'レシピの材料は個別に削除できません');
        result.items = result.items.filter((x) => x !== item);
      }
    } else if (kind === 'clear' && !a && req.method === 'POST') {
      // すべて削除
      result = { recipes: [], items: [] };
    } else {
      throw new HttpError(404, 'NOT_FOUND', 'Not Found');
    }
    tidyShopping(result);
    await saveShopping(result);
    return result;
  });
  return sendJson(res, 200, list);
}

module.exports = { loadShopping, saveShopping, handleShopping };
