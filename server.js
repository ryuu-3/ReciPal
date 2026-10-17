// ReciPal - Node.js 標準モジュールのみで動くレシピ管理サーバー
const http = require('http');
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { exec } = require('child_process');

const HOST = '127.0.0.1';
const BASE_PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const NO_OPEN = process.argv.includes('--no-open');
// 旧形式の文字列データを何語のテキストとして扱うか（public/i18n.js の DEFAULT_LANG と合わせる）
const DEFAULT_LANG = 'ja';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// ---------- データ保存 ----------
// コレクションごとに 1 ファイル。初回起動時は空のファイルを作成する

const COLLECTIONS = {
  recipes: { file: 'recipes.json' },
  ingredients: { file: 'ingredients.json' },
  tags: { file: 'tags.json' },
};

const dataPath = (name) => path.join(DATA_DIR, COLLECTIONS[name].file);

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function load(name) {
  const data = JSON.parse(await fs.readFile(dataPath(name), 'utf8'));
  if (!Array.isArray(data)) return [];
  return name === 'recipes' ? data.map(upgradeRecipe) : data;
}

// 一時ファイル → rename で書き込み、途中で落ちても JSON が壊れないようにする。
// Windows ではウイルス対策ソフトやエディタがファイルを一瞬開いていると rename が失敗することがあるので、少し待って再試行する
async function writeJson(file, data) {
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

// ---------- 材料マスタの自動生成 ----------

const nameKey = (s) => String(s).normalize('NFKC').trim().toLowerCase();
const locObject = (v) => (typeof v === 'string' ? (v ? { [DEFAULT_LANG]: v } : {}) : v && typeof v === 'object' ? v : {});

// 材料マスタに紐付いていないレシピの材料を、名前（別名を含む）で照合して紐付ける。
// 見つからなければ材料マスタに新規登録する。recipes / ingredients はその場で書き換える
function importFromRecipes(recipes, ingredients) {
  const index = new Map();
  const register = (ing) => {
    const names = [...Object.values(ing.name || {}), ...Object.values(ing.aliases || {}).flat()];
    names.filter(Boolean).forEach((n) => index.set(nameKey(n), ing));
  };
  ingredients.forEach(register);
  const known = new Set(ingredients.map((i) => i.id));

  const now = new Date().toISOString();
  let created = 0;
  let linked = 0;

  forEachIngredientRow(recipes, (row) => {
    if (row.ingredientId && known.has(row.ingredientId)) return;
    const names = locObject(row.name);
    const entries = Object.entries(names).filter(([, v]) => typeof v === 'string' && v.trim());
    if (!entries.length) return;

    let ing = entries.map(([, v]) => index.get(nameKey(v))).find(Boolean);
    if (!ing) {
      ing = { id: crypto.randomUUID(), name: {}, aliases: {}, tags: [], createdAt: now, updatedAt: now };
      ingredients.push(ing);
      known.add(ing.id);
      created++;
    }
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
  });

  // ingredientId を先頭に並べ替える（JSON を読みやすくするため）
  forEachIngredientRow(recipes, (row) => {
    if (!row.ingredientId) return;
    const { ingredientId, ...rest } = row;
    for (const key of Object.keys(row)) delete row[key];
    Object.assign(row, { ingredientId }, rest);
  });

  return { created, linked };
}

// ---------- 入力検証 ----------

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// 多言語テキスト：{ "ja": "...", "zh": "..." } の形。旧形式の文字列もそのまま受け付ける
const LANG_KEY = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/;
const MAX_LANGS = 20;
const ID_PATTERN = /^[\w-]{1,64}$/;
const MAX_VARIANTS = 30;
const TAG_TYPES = ['recipe', 'ingredient'];

function locText(v, max) {
  if (typeof v === 'string') return str(v, max);
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out = {};
  for (const [lang, text] of Object.entries(v).slice(0, MAX_LANGS)) {
    const s = LANG_KEY.test(lang) ? str(text, max) : '';
    if (s) out[lang] = s;
  }
  return out;
}

const isBlank = (loc) => (typeof loc === 'string' ? !loc : Object.keys(loc).length === 0);

const positiveInt = (v) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const requireObject = (body) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'INVALID_REQUEST', 'リクエストの形式が不正です');
  }
};

// 存在し、種類（recipe / ingredient）が合うタグ ID だけを残す
const tagIds = (v, ctx, type) =>
  [...new Set((Array.isArray(v) ? v : []).filter((id) => typeof id === 'string' && ctx.tagTypes.get(id) === type))];

// 別名：{ "ja": ["とりもも", ...], "zh": [...] }
function sanitizeAliases(v) {
  const out = {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  for (const [lang, list] of Object.entries(v).slice(0, MAX_LANGS)) {
    if (!LANG_KEY.test(lang) || !Array.isArray(list)) continue;
    const items = [...new Set(list.map((s) => str(s, 50)).filter(Boolean))].slice(0, 30);
    if (items.length) out[lang] = items;
  }
  return out;
}

// タグの種類は作成時に決め、後から変えない（付いている材料・レシピとの整合を保つため）
function sanitizeTag(body, ctx, existing) {
  requireObject(body);
  const name = locText(body.name, 50);
  if (isBlank(name)) throw new HttpError(400, 'NAME_REQUIRED', '名前は必須です');
  if (existing) return { name };
  if (!TAG_TYPES.includes(body.type)) throw new HttpError(400, 'INVALID_REQUEST', 'タグの種類が不正です');
  return { type: body.type, name };
}

function sanitizeIngredient(body, ctx) {
  requireObject(body);
  const name = locText(body.name, 100);
  if (isBlank(name)) throw new HttpError(400, 'NAME_REQUIRED', '名前は必須です');
  return {
    name,
    aliases: sanitizeAliases(body.aliases),
    tags: tagIds(body.tags, ctx, 'ingredient'),
    pantry: body.pantry === true, // 常備品（買い物リストに追加するとき、最初はチェックを外す）
  };
}

// レシピの材料行：材料マスタに紐付く場合は ingredientId を持ち、name は表示用の控えとして残す
function sanitizeIngredientRow(i, ctx) {
  const src = i && typeof i === 'object' ? i : {};
  const master = typeof src.ingredientId === 'string' ? ctx.ingredients.get(src.ingredientId) : null;
  let name = locText(src.name, 100);
  if (master && isBlank(name)) name = { ...master.name };
  const amount = locText(src.amount, 50);
  return master ? { ingredientId: master.id, name, amount } : { name, amount };
}

// バリエーション：人数・時間・材料・手順をそれぞれ独立して持つ
function sanitizeVariant(v, ctx) {
  const src = v && typeof v === 'object' ? v : {};

  const ingredients = (Array.isArray(src.ingredients) ? src.ingredients : [])
    .map((i) => sanitizeIngredientRow(i, ctx))
    .filter((i) => !isBlank(i.name));

  const steps = (Array.isArray(src.steps) ? src.steps : [])
    .map((s) => locText(s, 1000))
    .filter((s) => !isBlank(s));

  return {
    id: typeof src.id === 'string' && ID_PATTERN.test(src.id) ? src.id : crypto.randomUUID(),
    label: locText(src.label, 50),
    servings: positiveInt(src.servings),
    time: positiveInt(src.time),
    ingredients,
    steps,
  };
}

function sanitizeRecipe(body, ctx) {
  requireObject(body);
  const title = locText(body.title, 100);
  if (isBlank(title)) throw new HttpError(400, 'TITLE_REQUIRED', 'レシピ名は必須です');

  // variants がなければ旧形式とみなし、本体の値から 1 つ作る
  const source = Array.isArray(body.variants) && body.variants.length
    ? body.variants.slice(0, MAX_VARIANTS)
    : [body];
  const seen = new Set();
  const variants = source.map((v) => sanitizeVariant(v, ctx)).map((v) => {
    if (seen.has(v.id)) v.id = crypto.randomUUID();
    seen.add(v.id);
    return v;
  });

  return {
    title,
    category: str(body.category, 50),
    description: locText(body.description, 1000),
    tags: tagIds(body.tags, ctx, 'recipe'),
    variants,
  };
}

// 入力検証で参照する、存在するタグ・材料の一覧
async function loadContext() {
  const [tags, ingredients] = await Promise.all([load('tags'), load('ingredients')]);
  return {
    tagTypes: new Map(tags.map((t) => [t.id, t.type])),
    ingredients: new Map(ingredients.map((i) => [i.id, i])),
  };
}

// ---------- 削除時の後始末 ----------

// 材料を削除しても、レシピ側には名前の控えが残るので紐付けだけ外す
async function unlinkIngredient(id) {
  const recipes = await load('recipes');
  let changed = false;
  forEachIngredientRow(recipes, (row) => {
    if (row.ingredientId === id) {
      delete row.ingredientId;
      changed = true;
    }
  });
  if (changed) await save('recipes', recipes);

  const list = await loadShopping();
  const items = list.items.filter((item) => item.ingredientId === id);
  items.forEach((item) => delete item.ingredientId);
  if (items.length) await saveShopping(list);
}

// タグを削除したら、材料・レシピからも外す
async function detachTag(id) {
  for (const name of ['ingredients', 'recipes']) {
    const items = await load(name);
    let changed = false;
    for (const item of items) {
      if (Array.isArray(item.tags) && item.tags.includes(id)) {
        item.tags = item.tags.filter((x) => x !== id);
        changed = true;
      }
    }
    if (changed) await save(name, items);
  }
}

// ---------- 買い物リスト ----------
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

const RESOURCES = {
  recipes: { sanitize: sanitizeRecipe, notFound: 'RECIPE_NOT_FOUND' },
  ingredients: { sanitize: sanitizeIngredient, notFound: 'INGREDIENT_NOT_FOUND', onDelete: unlinkIngredient },
  tags: { sanitize: sanitizeTag, notFound: 'TAG_NOT_FOUND', onDelete: detachTag },
};

// ---------- HTTP ユーティリティ ----------

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new HttpError(413, 'TOO_LARGE', 'データが大きすぎます'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(new HttpError(400, 'INVALID_JSON', 'JSON の形式が不正です'));
      }
    });
    req.on('error', reject);
  });
}

const methodNotAllowed = () => new HttpError(405, 'METHOD_NOT_ALLOWED', 'Method Not Allowed');

function decodePath(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    throw new HttpError(400, 'INVALID_REQUEST', 'URL の形式が不正です');
  }
}

// ローカル専用のサーバーなので、ほかのサイトからのアクセスを拒否する
// - Host が localhost / 127.0.0.1 以外なら拒否する（DNS リバインディングでデータを読まれないように）
// - 更新系は、Origin が自分以外なら拒否し、Content-Type は application/json に限る
//   （閲覧中のほかのサイトから、勝手にデータを書き換えられないように）
function checkRequest(req) {
  const port = server.address().port;
  const allowed = [`localhost:${port}`, `127.0.0.1:${port}`];
  if (!allowed.includes(String(req.headers.host || '').toLowerCase())) {
    throw new HttpError(403, 'FORBIDDEN', 'Forbidden');
  }
  if (req.method === 'GET' || req.method === 'HEAD') return;
  const origin = req.headers.origin;
  if (origin && !allowed.some((host) => origin.toLowerCase() === `http://${host}`)) {
    throw new HttpError(403, 'FORBIDDEN', 'Forbidden');
  }
  if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type は application/json にしてください');
  }
}

// ---------- API ----------
// /api/recipes, /api/ingredients, /api/tags は同じ形の CRUD
// POST /api/ingredients/import でレシピの未登録の材料を材料マスタに取り込む

async function handleApi(req, res, url) {
  if (url.pathname === '/api/health') {
    return sendJson(res, 200, { app: 'ReciPal' });
  }

  if (url.pathname === '/api/shopping' || url.pathname.startsWith('/api/shopping/')) {
    return handleShopping(req, res, url);
  }

  if (url.pathname === '/api/ingredients/import') {
    if (req.method !== 'POST') throw methodNotAllowed();
    const result = await withLock(async () => {
      const [recipes, ingredients] = await Promise.all([load('recipes'), load('ingredients')]);
      const r = importFromRecipes(recipes, ingredients);
      if (r.linked) {
        await save('ingredients', ingredients);
        await save('recipes', recipes);
      }
      return r;
    });
    return sendJson(res, 200, result);
  }

  const match = url.pathname.match(/^\/api\/(recipes|ingredients|tags)(?:\/([\w-]+))?\/?$/);
  if (!match) throw new HttpError(404, 'NOT_FOUND', 'Not Found');
  const [, name, id] = match;
  const resource = RESOURCES[name];
  const notFound = () => new HttpError(404, resource.notFound, 'Not Found');

  if (!id) {
    if (req.method === 'GET') return sendJson(res, 200, await load(name));
    if (req.method !== 'POST') throw methodNotAllowed();
    const body = await readBody(req);
    const created = await withLock(async () => {
      const data = resource.sanitize(body, await loadContext());
      const items = await load(name);
      const now = new Date().toISOString();
      const item = { id: crypto.randomUUID(), ...data, createdAt: now, updatedAt: now };
      items.push(item);
      await save(name, items);
      return item;
    });
    return sendJson(res, 201, created);
  }

  switch (req.method) {
    case 'GET': {
      const item = (await load(name)).find((x) => x.id === id);
      if (!item) throw notFound();
      return sendJson(res, 200, item);
    }
    case 'PUT': {
      const body = await readBody(req);
      const updated = await withLock(async () => {
        const items = await load(name);
        const index = items.findIndex((x) => x.id === id);
        if (index === -1) throw notFound();
        const data = resource.sanitize(body, await loadContext(), items[index]);
        items[index] = { ...items[index], ...data, updatedAt: new Date().toISOString() };
        await save(name, items);
        return items[index];
      });
      return sendJson(res, 200, updated);
    }
    case 'DELETE':
      await withLock(async () => {
        const items = await load(name);
        const index = items.findIndex((x) => x.id === id);
        if (index === -1) throw notFound();
        items.splice(index, 1);
        await save(name, items);
        if (resource.onDelete) await resource.onDelete(id);
      });
      res.writeHead(204);
      return res.end();
    default:
      throw methodNotAllowed();
  }
}

// ---------- 静的ファイル ----------

async function serveStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') throw methodNotAllowed();
  const rel = decodePath(url.pathname === '/' ? '/index.html' : url.pathname);
  const filePath = path.join(PUBLIC_DIR, rel);
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) throw new HttpError(403, 'FORBIDDEN', 'Forbidden');

  let content;
  try {
    content = await fs.readFile(filePath);
  } catch {
    throw new HttpError(404, 'NOT_FOUND', 'Not Found');
  }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
  });
  res.end(req.method === 'HEAD' ? undefined : content);
}

// ---------- 起動 ----------

const server = http.createServer(async (req, res) => {
  try {
    checkRequest(req);
    // Host ヘッダーは URL の組み立てに使わない（不正な値で例外になりサーバーが落ちるため）
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      throw new HttpError(400, 'INVALID_REQUEST', 'URL の形式が不正です');
    }
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else await serveStatic(req, res, url);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500) console.error(err);
    if (!res.headersSent) {
      sendJson(res, status, status === 500
        ? { code: 'SERVER_ERROR', error: 'サーバーエラー' }
        : { code: err.code, error: err.message });
    } else res.end();
  }
});

function openBrowser(url) {
  if (NO_OPEN) return;
  const cmd =
    process.platform === 'win32' ? `start "" "${url}"` :
    process.platform === 'darwin' ? `open "${url}"` :
    `xdg-open "${url}"`;
  exec(cmd);
}

// すでに ReciPal が起動しているか確認する
function isReciPalRunning(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: HOST, port, path: '/api/health', timeout: 1000 }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(body).app === 'ReciPal');
        } catch {
          resolve(false);
        }
      });
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

function listen(port, attempts = 10) {
  server.once('error', async (err) => {
    if (err.code !== 'EADDRINUSE' || attempts <= 1) {
      console.error('サーバーを起動できませんでした:', err.message);
      process.exit(1);
    }
    if (await isReciPalRunning(port)) {
      const url = `http://localhost:${port}`;
      console.log(`ReciPal はすでに起動しています: ${url}`);
      openBrowser(url);
      setTimeout(() => process.exit(0), 500);
      return;
    }
    listen(port + 1, attempts - 1);
  });
  server.listen(port, HOST, () => {
    const url = `http://localhost:${port}`;
    console.log(`ReciPal を起動しました: ${url}`);
    console.log(`データフォルダ: ${DATA_DIR}`);
    console.log('終了するにはこのウィンドウを閉じるか Ctrl+C を押してください。');
    openBrowser(url);
  });
}

ensureDataFiles()
  .then(() => listen(BASE_PORT))
  .catch((err) => {
    console.error('データファイルの準備に失敗しました:', err.message);
    process.exit(1);
  });
