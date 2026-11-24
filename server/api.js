const crypto = require('crypto');
const { HttpError, sendJson, readBody, methodNotAllowed } = require('./http-utils');
const { load, writeJson, save, withLock, forEachIngredientRow } = require('./storage');
const { requireObject, sanitizeTag, sanitizeIngredient, sanitizeRecipe, loadContext } = require('./validate');
const { backupStatus } = require('./backup');
const { SETTINGS_FILE, loadSettings, sanitizeSettings } = require('./settings');
const { importFromRecipes } = require('./ingredient-import');
const { loadShopping, saveShopping, handleShopping } = require('./shopping');

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

const RESOURCES = {
  recipes: { sanitize: sanitizeRecipe, notFound: 'RECIPE_NOT_FOUND' },
  ingredients: { sanitize: sanitizeIngredient, notFound: 'INGREDIENT_NOT_FOUND', onDelete: unlinkIngredient },
  tags: { sanitize: sanitizeTag, notFound: 'TAG_NOT_FOUND', onDelete: detachTag },
};

// API
// /api/recipes, /api/ingredients, /api/tags は同じ形の CRUD
// GET /api/ingredients/import で取り込み内容を確認し、POST で選んだものだけを材料マスタに取り込む

async function handleApi(req, res, url) {
  if (url.pathname === '/api/health') {
    return sendJson(res, 200, { app: 'ReciPal' });
  }

  if (url.pathname === '/api/backup') {
    if (req.method !== 'GET') throw methodNotAllowed();
    return sendJson(res, 200, await backupStatus());
  }

  if (url.pathname === '/api/settings') {
    if (req.method === 'GET') return sendJson(res, 200, await loadSettings());
    if (req.method !== 'PUT') throw methodNotAllowed();
    const settings = sanitizeSettings(await readBody(req));
    await withLock(() => writeJson(SETTINGS_FILE, settings));
    return sendJson(res, 200, settings);
  }

  if (url.pathname === '/api/shopping' || url.pathname.startsWith('/api/shopping/')) {
    return handleShopping(req, res, url);
  }

  if (url.pathname === '/api/ingredients/import') {
    // GET：取り込み内容のプレビュー（データは変更しない）
    if (req.method === 'GET') {
      const [recipes, ingredients] = await Promise.all([load('recipes'), load('ingredients')]);
      return sendJson(res, 200, importFromRecipes(recipes, ingredients));
    }
    // POST：{ keys: [...] } で選んだグループだけを取り込む。keys がなければすべて取り込む
    if (req.method !== 'POST') throw methodNotAllowed();
    const body = await readBody(req);
    requireObject(body);
    let accept;
    if (body.keys !== undefined) {
      if (!Array.isArray(body.keys)) throw new HttpError(400, 'INVALID_REQUEST', 'keys の形式が不正です');
      const keys = new Set(body.keys.filter((k) => typeof k === 'string'));
      accept = (key) => keys.has(key);
    }
    const result = await withLock(async () => {
      const [recipes, ingredients] = await Promise.all([load('recipes'), load('ingredients')]);
      const r = importFromRecipes(recipes, ingredients, accept);
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

module.exports = { handleApi };
