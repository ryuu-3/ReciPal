// 編集フォーム：材料・手順の行、材料マスタとの紐付け、材料名の入力候補
import { h, translated, store, langInput, findIngredient, findIngredientByName } from '../common.js';
import { el, langEditor } from './shared.js';

// 材料名欄の候補（言語ごと）。別名も候補に出し、選ぶと正式名で紐付く
export function renderIngredientDatalists() {
  el.ingredientDatalists.replaceChildren(
    ...I18N.DATA_LANGUAGES.map((l) => h('datalist', { id: `ingredient-options-${l.code}` },
      ...store.ingredients.flatMap((ing) => {
        const name = ing.name[l.code];
        const aliases = (ing.aliases && ing.aliases[l.code]) || [];
        return [
          name && h('option', { value: name }),
          ...aliases.map((a) => h('option', { value: a, label: name || I18N.text(ing.name) })),
        ];
      }),
    )),
  );
}

function rowControls(row, container) {
  const btn = (key, label, extraClass, onclick) =>
    h('button', {
      type: 'button',
      class: `btn icon small ${extraClass}`.trim(),
      'data-i18n-title': key,
      'data-i18n-aria-label': key,
      onclick,
    }, label);

  return h('div', { class: 'row-controls' },
    btn('form.moveUp', '↑', '', () =>
      row.previousElementSibling && container.insertBefore(row, row.previousElementSibling)),
    btn('form.moveDown', '↓', '', () =>
      row.nextElementSibling && container.insertBefore(row.nextElementSibling, row)),
    btn('form.remove', '✕', 'danger-text', () => row.remove()),
  );
}

// 材料名が材料マスタの名前・別名と一致したら紐付け、他の言語の名前を自動で入れる。
// 自動で入れた欄には data-autofilled を付け、紐付けが外れたら消す
function linkIngredientRow(row, source) {
  const ing = findIngredientByName(source.value);
  const nameInputs = [...row.querySelectorAll('[data-field="name"]')];
  if (ing) {
    row.dataset.ingredientId = ing.id;
    for (const input of nameInputs) {
      if (input === source) continue;
      const name = ing.name[input.closest('.lang-pane').dataset.lang];
      if (name && (!input.value.trim() || input.dataset.autofilled)) {
        input.value = name;
        input.dataset.autofilled = '1';
      }
    }
  } else if (row.dataset.ingredientId) {
    delete row.dataset.ingredientId;
    for (const input of nameInputs) {
      if (input.dataset.autofilled) {
        input.value = '';
        delete input.dataset.autofilled;
      }
    }
  }
  row.classList.toggle('linked', Boolean(row.dataset.ingredientId));
  langEditor.refreshPlaceholders();
}

export function addIngredientRow(container, item = {}, focus = false) {
  const master = findIngredient(item.ingredientId);
  // 紐付いていればマスタの名前（最新の翻訳）を表示する
  const name = master ? { ...I18N.toLoc(item.name), ...master.name } : I18N.toLoc(item.name);
  const amount = I18N.toLoc(item.amount);
  const row = h('div', { class: `dyn-row${master ? ' linked' : ''}`, 'data-lang-group': '' });
  if (master) row.dataset.ingredientId = master.id;

  row.append(
    h('span', { class: 'link-badge', 'data-i18n-title': 'form.linked', 'data-i18n-aria-label': 'form.linked' }, '✓'),
    ...langEditor.panes((lang) => {
      const nameInput = langInput('name', lang, name[lang], { max: 100, ph: 'form.ingredientName' });
      nameInput.setAttribute('list', `ingredient-options-${lang}`);
      if (master && master.name[lang] === name[lang]) nameInput.dataset.autofilled = '1';
      return [nameInput, langInput('amount', lang, amount[lang], { max: 50, ph: 'form.ingredientAmount' })];
    }),
    rowControls(row, container),
  );
  row.addEventListener('input', (e) => {
    if (e.target.dataset.field !== 'name') return;
    delete e.target.dataset.autofilled;
    linkIngredientRow(row, e.target);
  });
  // 別名で選んだ場合は、入力欄を正式名に置き換える
  row.addEventListener('change', (e) => {
    if (e.target.dataset.field !== 'name') return;
    const ing = findIngredient(row.dataset.ingredientId);
    const official = ing && ing.name[e.target.closest('.lang-pane').dataset.lang];
    if (official) e.target.value = official;
  });

  container.append(row);
  translated(row);
  langEditor.refreshPlaceholders();
  if (focus) langEditor.focusIn(row);
}

export function addStepRow(container, step = {}, focus = false) {
  const text = I18N.toLoc(step);
  const row = h('div', { class: 'dyn-row', 'data-lang-group': '' });
  row.append(
    h('span', { class: 'step-num' }),
    ...langEditor.panes((lang) => langInput('step', lang, text[lang], { max: 1000, multiline: true, ph: 'form.stepPlaceholder' })),
    rowControls(row, container),
  );
  container.append(row);
  translated(row);
  langEditor.refreshPlaceholders();
  if (focus) langEditor.focusIn(row);
}

export function renumberSteps(container) {
  container.querySelectorAll('.step-num').forEach((n, i) => (n.textContent = `${i + 1}.`));
}
