// 入力検証
const crypto = require('crypto');
const { HttpError } = require('./http-utils');
const { load } = require('./storage');

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

module.exports = {
  LANG_KEY, MAX_LANGS, ID_PATTERN, TAG_TYPES,
  str, locText, isBlank, requireObject,
  sanitizeTag, sanitizeIngredient, sanitizeRecipe, loadContext,
};
