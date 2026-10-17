// ReciPal 翻訳辞書と言語切り替え
// 言語を追加するときは LANGUAGES と MESSAGES に同じキーで追加する
(() => {
  'use strict';

  const STORAGE_KEY = 'recipal.lang';

  // code: 内部キー / htmlLang: <html lang> の値 / label: セレクトに表示する名前
  const LANGUAGES = [
    { code: 'ja', htmlLang: 'ja', label: '日本語' },
    { code: 'zh', htmlLang: 'zh-CN', label: '简体中文' },
  ];

  // 既定カテゴリはこのキーでデータに保存し、表示時に翻訳する
  const CATEGORY_KEYS = ['main', 'side', 'soup', 'staple', 'dessert', 'other'];

  const MESSAGES = {
    ja: {
      'app.newRecipe': '＋ 新しいレシピ',

      'nav.recipes': 'レシピ',
      'nav.ingredients': '材料',
      'nav.tags': 'タグ',
      'nav.shopping': '買い物',

      'shopping.title': '買い物リスト',
      'shopping.open': '買い物リストを開く',
      'shopping.addToList': '🛒 買い物リストに追加',
      'shopping.added': '買い物リストに追加しました',
      'shopping.addedButton': '✓ 追加しました',
      'shopping.recipes': '対象レシピ',
      'shopping.removeRecipe': 'このレシピの材料をリストから外す',
      'shopping.confirmRemoveRecipe': '「{name}」の材料をリストから外しますか？',
      'shopping.itemPlaceholder': '品目（例：牛乳）',
      'shopping.amountPlaceholder': '数量',
      'shopping.addItem': '＋ 追加',
      'shopping.other': 'その他',
      'shopping.skipped': '買わないもの',
      'shopping.manual': '手入力',
      'shopping.removeItem': 'この品目を削除',
      'shopping.hint': 'チェックを外すと「買わないもの」に移ります。常備品は最初から「買わないもの」に入ります。',
      'shopping.clearAll': 'すべて削除',
      'shopping.confirmClearAll': '買い物リストをすべて削除しますか？',
      'shopping.copy': 'テキストでコピー',
      'shopping.copied': 'コピーしました',
      'shopping.copyFailed': 'コピーできませんでした',
      'shopping.copyTitle': '買い物リスト（{date}）',
      'shopping.empty': '買い物リストは空です。レシピの詳細画面の「🛒 買い物リストに追加」や、上の入力欄から追加できます。',
      'shopping.times': '×{n}',
      'shopping.deletedRecipe': '（削除されたレシピ）',
      'shopping.count': '買うもの {n} 品',
      'filter.recipeTagsAll': '特徴：すべて',
      'filter.ingredientTagsAll': '材料：すべて',
      'filter.recipeTags': 'レシピの特徴で絞り込み',
      'filter.ingredientTags': '使っている材料の分類で絞り込み',
      'filter.ingredientTagsAllShort': 'すべての分類',
      'form.noTags': 'タグがありません（「タグ」画面で追加できます）',
      'form.recipeTags': '特徴（タグ）',
      'form.ingredientTags': '分類（タグ）',
      'form.linked': '材料マスタに登録済み',
      'form.incompleteName': '名前が未入力',
      'common.delete': '削除',

      'ingredient.new': '＋ 新しい材料',
      'ingredient.newTitle': '新しい材料',
      'ingredient.editTitle': '材料を編集',
      'ingredient.name': '材料名',
      'ingredient.aliases': '別名（検索用）',
      'ingredient.aliasesPlaceholder': 'カンマ区切り（例：とりもも, 鶏モモ）',
      'ingredient.pantry': '常備品',
      'ingredient.pantryHint': 'レシピから買い物リストに追加したとき、最初から「買わないもの」に入ります（水・塩など）',
      'ingredient.searchPlaceholder': '材料を検索（名前・別名）',
      'ingredient.usage': '{n}件のレシピで使用',
      'ingredient.unused': '未使用',
      'ingredient.import': 'レシピから取り込む',
      'ingredient.importHint': 'レシピで使われていて、まだ登録されていない材料をまとめて登録します',
      'ingredient.importDone': '材料を{created}件登録し、{linked}か所を紐付けました',
      'ingredient.importNone': '取り込む材料はありませんでした',
      'ingredient.confirmDelete': '「{name}」を削除しますか？',
      'ingredient.confirmDeleteUsed': '「{name}」を削除しますか？\n{n}件のレシピで使用中です（レシピ上の名前は残ります）。',
      'ingredient.empty': '材料が見つかりません。',

      'tag.newTitle': '新しいタグ',
      'tag.editTitle': 'タグを編集',
      'tag.name': 'タグ名',
      'tag.recipeSection': 'レシピのタグ',
      'tag.recipeSectionHint': '料理の特徴を表します（例：時短、ベジタリアン）。レシピに付けて、レシピ一覧の「特徴」欄で絞り込めます。',
      'tag.ingredientSection': '材料のタグ',
      'tag.ingredientSectionHint': '材料の分類を表します（例：肉類、野菜）。材料に付けて、レシピ一覧の「材料」欄で、その分類の材料を使うレシピを絞り込めます。',
      'tag.newRecipe': '＋ レシピのタグを追加',
      'tag.newIngredient': '＋ 材料のタグを追加',
      'tag.typeRecipe': '種類：レシピのタグ',
      'tag.typeIngredient': '種類：材料のタグ',
      'tag.usageRecipe': '{n}件のレシピ',
      'tag.usageIngredient': '{n}件の材料',
      'tag.empty': 'タグがありません。',
      'tag.confirmDeleteRecipe': '「{name}」を削除しますか？\n{n}件のレシピから外れます。',
      'tag.confirmDeleteIngredient': '「{name}」を削除しますか？\n{n}件の材料から外れます。',
      'app.language': '言語',
      'search.placeholder': 'キーワード検索（レシピ名・材料・手順）',
      'filter.allCategories': 'すべてのカテゴリ',
      'list.count': '{shown} 件 / 全 {total} 件',
      'list.empty': 'レシピが見つかりません。',
      'meta.servings': '{n}人分',
      'meta.time': '{n}分',
      'meta.ingredients': '材料{n}品',
      'meta.separator': ' ・ ',
      'meta.servingsList': '{list}人分',
      'meta.variantCount': '{n}パターン',

      'detail.ingredients': '材料',
      'detail.steps': '手順',
      'detail.none': '登録されていません',
      'detail.edit': '編集',
      'detail.delete': '削除',
      'detail.confirmDelete': '「{title}」を削除しますか？',

      'form.newTitle': '新しいレシピ',
      'form.editTitle': 'レシピを編集',
      'form.title': 'レシピ名',
      'form.category': 'カテゴリ',
      'form.categoryPlaceholder': '例：主菜',
      'form.servings': '人数',
      'form.time': '調理時間（分）',
      'form.description': '説明',
      'form.ingredients': '材料',
      'form.ingredientName': '材料名',
      'form.ingredientAmount': '分量',
      'form.addIngredient': '＋ 材料を追加',
      'form.steps': '手順',
      'form.stepPlaceholder': '手順を入力',
      'form.addStep': '＋ 手順を追加',
      'form.moveUp': '上へ',
      'form.moveDown': '下へ',
      'form.remove': '削除',
      'form.cancel': 'キャンセル',
      'form.save': '保存',
      'form.titleRequired': 'レシピ名をいずれかの言語で入力してください。',
      'form.confirmDiscard': '編集中の内容は保存されていません。破棄して閉じますか？',
      'form.editLanguage': '入力言語',
      'form.editLanguageHint': '空欄に薄く表示される文字は、他の言語で入力した内容です。',
      'form.incomplete': 'レシピ名が未入力',

      'translation.missing': '未翻訳',
      'translation.fallbackNotice': 'この言語の翻訳がない項目は、{lang}で表示しています。',

      'variant.section': 'バリエーション',
      'variant.hint': '人数や作り方ごとに、人数・時間・材料・手順を別々に登録できます。',
      'variant.label': '名前（任意）',
      'variant.labelPlaceholder': '例：圧力鍋版',
      'variant.untitled': 'パターン{n}',
      'variant.nameWithServings': '{label}（{servings}）',
      'variant.add': '＋ 追加',
      'variant.copy': 'このバリエーションをコピー',
      'variant.remove': 'このバリエーションを削除',
      'variant.confirmRemove': '「{name}」を削除しますか？',

      'common.close': '閉じる',

      'toast.saved': '保存しました',
      'toast.deleted': '削除しました',
      'toast.loadFailed': '読み込みに失敗しました: {message}',

      'category.main': '主菜',
      'category.side': '副菜',
      'category.soup': '汁物',
      'category.staple': '主食',
      'category.dessert': 'デザート',
      'category.other': 'その他',

      'error.INVALID_REQUEST': 'リクエストの形式が不正です。',
      'error.INVALID_JSON': 'データの形式が不正です。',
      'error.TITLE_REQUIRED': 'レシピ名は必須です。',
      'error.NAME_REQUIRED': '名前をいずれかの言語で入力してください。',
      'error.INGREDIENT_NOT_FOUND': '材料が見つかりません。削除された可能性があります。',
      'error.TAG_NOT_FOUND': 'タグが見つかりません。削除された可能性があります。',
      'error.VARIANT_NOT_FOUND': 'バリエーションが見つかりません。レシピが編集された可能性があります。',
      'error.SHOPPING_ITEM_NOT_FOUND': '品目が見つかりません。すでに削除された可能性があります。',
      'error.NO_INGREDIENTS': 'このレシピには材料が登録されていません。',
      'error.ITEM_NOT_DELETABLE': 'レシピの材料は個別に削除できません。上の対象レシピの ✕ で外してください。',
      'error.TOO_LARGE': 'データが大きすぎます。',
      'error.RECIPE_NOT_FOUND': 'レシピが見つかりません。削除された可能性があります。',
      'error.NOT_FOUND': '見つかりません。',
      'error.METHOD_NOT_ALLOWED': 'この操作は許可されていません。',
      'error.FORBIDDEN': 'アクセスできません。',
      'error.SERVER_ERROR': 'サーバーでエラーが発生しました。',
      'error.NETWORK': 'サーバーに接続できません。ReciPal が起動しているか確認してください。',
      'error.UNKNOWN': 'エラーが発生しました（{status}）。',
    },

    zh: {
      'app.newRecipe': '＋ 新建食谱',

      'nav.recipes': '食谱',
      'nav.ingredients': '食材',
      'nav.tags': '标签',
      'nav.shopping': '购物',

      'shopping.title': '购物清单',
      'shopping.open': '打开购物清单',
      'shopping.addToList': '🛒 加入购物清单',
      'shopping.added': '已加入购物清单',
      'shopping.addedButton': '✓ 已添加',
      'shopping.recipes': '相关食谱',
      'shopping.removeRecipe': '从清单中移除此食谱的食材',
      'shopping.confirmRemoveRecipe': '确定要从清单中移除“{name}”的食材吗？',
      'shopping.itemPlaceholder': '物品（例：牛奶）',
      'shopping.amountPlaceholder': '数量',
      'shopping.addItem': '＋ 添加',
      'shopping.other': '其他',
      'shopping.skipped': '不用买',
      'shopping.manual': '手动添加',
      'shopping.removeItem': '删除此物品',
      'shopping.hint': '取消勾选后会移到“不用买”。常备品默认放在“不用买”中。',
      'shopping.clearAll': '全部删除',
      'shopping.confirmClearAll': '确定要清空购物清单吗？',
      'shopping.copy': '复制为文本',
      'shopping.copied': '已复制',
      'shopping.copyFailed': '复制失败',
      'shopping.copyTitle': '购物清单（{date}）',
      'shopping.empty': '购物清单为空。可在食谱详情页点击“🛒 加入购物清单”，或在上方输入框中添加。',
      'shopping.times': '×{n}',
      'shopping.deletedRecipe': '（已删除的食谱）',
      'shopping.count': '要买 {n} 项',
      'filter.recipeTagsAll': '特点：全部',
      'filter.ingredientTagsAll': '食材：全部',
      'filter.recipeTags': '按食谱特点筛选',
      'filter.ingredientTags': '按所用食材的分类筛选',
      'filter.ingredientTagsAllShort': '全部分类',
      'form.noTags': '暂无标签（可在“标签”页面添加）',
      'form.recipeTags': '特点（标签）',
      'form.ingredientTags': '分类（标签）',
      'form.linked': '已关联食材库',
      'form.incompleteName': '未填写名称',
      'common.delete': '删除',

      'ingredient.new': '＋ 新建食材',
      'ingredient.newTitle': '新建食材',
      'ingredient.editTitle': '编辑食材',
      'ingredient.name': '食材名称',
      'ingredient.aliases': '别名（用于搜索）',
      'ingredient.aliasesPlaceholder': '用逗号分隔（例：鸡腿, 琵琶腿）',
      'ingredient.pantry': '常备品',
      'ingredient.pantryHint': '从食谱加入购物清单时，默认放入“不用买”（如水、盐）',
      'ingredient.searchPlaceholder': '搜索食材（名称、别名）',
      'ingredient.usage': '用于{n}个食谱',
      'ingredient.unused': '未使用',
      'ingredient.import': '从食谱导入',
      'ingredient.importHint': '将食谱中使用但尚未登记的食材批量登记到食材库',
      'ingredient.importDone': '已登记{created}种食材，关联{linked}处',
      'ingredient.importNone': '没有可导入的食材',
      'ingredient.confirmDelete': '确定要删除“{name}”吗？',
      'ingredient.confirmDeleteUsed': '确定要删除“{name}”吗？\n有{n}个食谱正在使用（食谱中的名称会保留）。',
      'ingredient.empty': '未找到食材。',

      'tag.newTitle': '新建标签',
      'tag.editTitle': '编辑标签',
      'tag.name': '标签名称',
      'tag.recipeSection': '食谱标签',
      'tag.recipeSectionHint': '表示菜品的特点（例：快手、素食）。可添加到食谱上，并在食谱列表的“特点”栏中筛选。',
      'tag.ingredientSection': '食材标签',
      'tag.ingredientSectionHint': '表示食材的分类（例：肉类、蔬菜）。可添加到食材上，并在食谱列表的“食材”栏中筛选使用该类食材的食谱。',
      'tag.newRecipe': '＋ 添加食谱标签',
      'tag.newIngredient': '＋ 添加食材标签',
      'tag.typeRecipe': '类型：食谱标签',
      'tag.typeIngredient': '类型：食材标签',
      'tag.usageRecipe': '{n}个食谱',
      'tag.usageIngredient': '{n}种食材',
      'tag.empty': '暂无标签。',
      'tag.confirmDeleteRecipe': '确定要删除“{name}”吗？\n将从{n}个食谱中移除。',
      'tag.confirmDeleteIngredient': '确定要删除“{name}”吗？\n将从{n}种食材中移除。',
      'app.language': '语言',
      'search.placeholder': '关键词搜索（食谱名称、食材、步骤）',
      'filter.allCategories': '全部分类',
      'list.count': '显示 {shown} 条 / 共 {total} 条',
      'list.empty': '未找到食谱。',
      'meta.servings': '{n}人份',
      'meta.time': '{n}分钟',
      'meta.ingredients': '{n}种食材',
      'meta.separator': ' · ',
      'meta.servingsList': '{list}人份',
      'meta.variantCount': '{n}个版本',

      'detail.ingredients': '食材',
      'detail.steps': '步骤',
      'detail.none': '暂无内容',
      'detail.edit': '编辑',
      'detail.delete': '删除',
      'detail.confirmDelete': '确定要删除“{title}”吗？',

      'form.newTitle': '新建食谱',
      'form.editTitle': '编辑食谱',
      'form.title': '食谱名称',
      'form.category': '分类',
      'form.categoryPlaceholder': '例：主菜',
      'form.servings': '份数',
      'form.time': '烹饪时间（分钟）',
      'form.description': '简介',
      'form.ingredients': '食材',
      'form.ingredientName': '食材名称',
      'form.ingredientAmount': '用量',
      'form.addIngredient': '＋ 添加食材',
      'form.steps': '步骤',
      'form.stepPlaceholder': '输入步骤',
      'form.addStep': '＋ 添加步骤',
      'form.moveUp': '上移',
      'form.moveDown': '下移',
      'form.remove': '删除',
      'form.cancel': '取消',
      'form.save': '保存',
      'form.titleRequired': '请至少用一种语言输入食谱名称。',
      'form.confirmDiscard': '正在编辑的内容尚未保存。确定要放弃并关闭吗？',
      'form.editLanguage': '输入语言',
      'form.editLanguageHint': '空白输入框中的浅色文字为其他语言的内容。',
      'form.incomplete': '未填写食谱名称',

      'translation.missing': '未翻译',
      'translation.fallbackNotice': '暂无该语言翻译的内容以{lang}显示。',

      'variant.section': '版本',
      'variant.hint': '可按份数或做法分别登记份数、时间、食材和步骤。',
      'variant.label': '名称（可选）',
      'variant.labelPlaceholder': '例：高压锅版',
      'variant.untitled': '版本{n}',
      'variant.nameWithServings': '{label}（{servings}）',
      'variant.add': '＋ 添加',
      'variant.copy': '复制此版本',
      'variant.remove': '删除此版本',
      'variant.confirmRemove': '确定要删除“{name}”吗？',

      'common.close': '关闭',

      'toast.saved': '已保存',
      'toast.deleted': '已删除',
      'toast.loadFailed': '加载失败：{message}',

      'category.main': '主菜',
      'category.side': '配菜',
      'category.soup': '汤品',
      'category.staple': '主食',
      'category.dessert': '甜点',
      'category.other': '其他',

      'error.INVALID_REQUEST': '请求格式不正确。',
      'error.INVALID_JSON': '数据格式不正确。',
      'error.TITLE_REQUIRED': '食谱名称为必填项。',
      'error.NAME_REQUIRED': '请至少用一种语言输入名称。',
      'error.INGREDIENT_NOT_FOUND': '未找到该食材，可能已被删除。',
      'error.TAG_NOT_FOUND': '未找到该标签，可能已被删除。',
      'error.VARIANT_NOT_FOUND': '未找到该版本，食谱可能已被编辑。',
      'error.SHOPPING_ITEM_NOT_FOUND': '未找到该物品，可能已被删除。',
      'error.NO_INGREDIENTS': '该食谱没有登记食材。',
      'error.ITEM_NOT_DELETABLE': '食谱中的食材不能单独删除。请点击上方相关食谱的 ✕ 移除。',
      'error.TOO_LARGE': '数据过大。',
      'error.RECIPE_NOT_FOUND': '未找到该食谱，可能已被删除。',
      'error.NOT_FOUND': '未找到。',
      'error.METHOD_NOT_ALLOWED': '不允许此操作。',
      'error.FORBIDDEN': '无法访问。',
      'error.SERVER_ERROR': '服务器发生错误。',
      'error.NETWORK': '无法连接服务器，请确认 ReciPal 是否已启动。',
      'error.UNKNOWN': '发生错误（{status}）。',
    },
  };

  const DEFAULT_LANG = 'ja';
  const listeners = [];
  let current = detectLanguage();

  function readStored() {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  }

  function detectLanguage() {
    const stored = readStored();
    if (stored && MESSAGES[stored]) return stored;
    const prefs = navigator.languages || [navigator.language || ''];
    for (const pref of prefs) {
      const base = String(pref).toLowerCase().split('-')[0];
      if (MESSAGES[base]) return base;
    }
    return DEFAULT_LANG;
  }

  // t('list.count', { shown: 1, total: 3 })
  function t(key, params = {}) {
    const text = (MESSAGES[current] && MESSAGES[current][key]) ?? MESSAGES[DEFAULT_LANG][key] ?? key;
    return text.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m));
  }

  function has(key) {
    return key in MESSAGES[current] || key in MESSAGES[DEFAULT_LANG];
  }

  // data-i18n / data-i18n-placeholder / data-i18n-aria-label / data-i18n-title を一括反映
  function apply(root = document) {
    const lang = LANGUAGES.find((l) => l.code === current);
    document.documentElement.lang = lang ? lang.htmlLang : current;
    root.querySelectorAll('[data-i18n]').forEach((n) => (n.textContent = t(n.dataset.i18n)));
    root.querySelectorAll('[data-i18n-placeholder]').forEach((n) => (n.placeholder = t(n.dataset.i18nPlaceholder)));
    root.querySelectorAll('[data-i18n-aria-label]').forEach((n) => n.setAttribute('aria-label', t(n.dataset.i18nAriaLabel)));
    root.querySelectorAll('[data-i18n-title]').forEach((n) => (n.title = t(n.dataset.i18nTitle)));
  }

  function setLanguage(code) {
    if (!MESSAGES[code] || code === current) return;
    current = code;
    try {
      localStorage.setItem(STORAGE_KEY, code);
    } catch {
      // 保存できなくても切り替え自体は続行する
    }
    apply();
    listeners.forEach((fn) => fn(code));
  }

  // ---------- カテゴリ ----------

  // 表示名（どの言語でも）→ キー。既定カテゴリでなければ入力値のまま返す
  function categoryKey(value) {
    const v = String(value || '').trim();
    if (!v) return '';
    if (CATEGORY_KEYS.includes(v)) return v;
    for (const key of CATEGORY_KEYS) {
      for (const msgs of Object.values(MESSAGES)) {
        if (msgs[`category.${key}`] === v) return key;
      }
    }
    return v;
  }

  // キー → 現在の言語の表示名。独自カテゴリはそのまま
  function categoryLabel(value) {
    return CATEGORY_KEYS.includes(value) ? t(`category.${value}`) : value;
  }

  // ---------- 多言語テキスト（レシピの中身） ----------
  // 形式は { ja: '...', zh: '...' }。旧形式の文字列は既定言語のテキストとして扱う

  function toLoc(value) {
    if (typeof value === 'string') return value ? { [DEFAULT_LANG]: value } : {};
    return value && typeof value === 'object' ? value : {};
  }

  // 現在の言語のテキストを返す。なければ他の言語で代用し fallback: true を返す
  function pick(value) {
    const loc = toLoc(value);
    if (loc[current]) return { text: loc[current], lang: current, fallback: false };
    const order = [...LANGUAGES.map((l) => l.code), ...Object.keys(loc)];
    for (const code of order) {
      if (loc[code]) return { text: loc[code], lang: code, fallback: true };
    }
    return { text: '', lang: null, fallback: false };
  }

  const text = (value) => pick(value).text;
  const allTexts = (value) => Object.values(toLoc(value)).filter(Boolean);

  function langLabel(code) {
    const lang = LANGUAGES.find((l) => l.code === code);
    return lang ? lang.label : code;
  }

  function htmlLang(code) {
    const lang = LANGUAGES.find((l) => l.code === code);
    return lang ? lang.htmlLang : code;
  }

  window.I18N = {
    LANGUAGES,
    CATEGORY_KEYS,
    t,
    has,
    toLoc,
    pick,
    text,
    allTexts,
    langLabel,
    htmlLang,
    apply,
    setLanguage,
    get language() {
      return current;
    },
    onChange: (fn) => listeners.push(fn),
    categoryKey,
    categoryLabel,
  };
})();
