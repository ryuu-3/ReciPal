// 自動バックアップのテスト
// その日に初めて保存する直前に、data の JSON を backup/recipal-YYYY-MM-DD にコピーする
const { describe, test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startServer, localDate } = require('./helpers/server');

const TODAY = `recipal-${localDate()}`;
const DATA = {
  'recipes.json': [],
  'ingredients.json': [],
  'tags.json': [{ id: 't1', type: 'recipe', name: { ja: '最初のタグ' } }],
};
const addTag = (app, name) => app.post('/api/tags', { type: 'recipe', name: { ja: name } });
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const tempDirs = [];
const tempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recipal-backup-'));
  tempDirs.push(dir);
  return dir;
};
after(() => tempDirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

describe('自動バックアップ', () => {
  test('その日の最初の保存の直前の状態を残し、同じ日の 2 回目以降はコピーしない', async () => {
    const app = await startServer({ data: DATA });
    try {
      assert.equal((await addTag(app, '1回目')).status, 201);
      const backupDir = path.join(app.dir, 'backup', TODAY);
      assert.deepEqual(fs.readdirSync(backupDir).sort(), ['ingredients.json', 'recipes.json', 'tags.json']);
      // バックアップは保存前の状態（タグ 1 件）、data は保存後（2 件）
      assert.equal(readJson(path.join(backupDir, 'tags.json')).length, 1);
      assert.equal(app.readData('tags.json').length, 2);

      await addTag(app, '2回目');
      assert.equal(readJson(path.join(backupDir, 'tags.json')).length, 1);
      assert.deepEqual(fs.readdirSync(path.join(app.dir, 'backup')), [TODAY]);

      const status = (await app.get('/api/backup')).body;
      assert.equal(status.dir, path.join(app.dir, 'backup'));
      assert.equal(status.custom, false);
      assert.equal(status.error, null);
      assert.ok(status.lastBackupAt);
    } finally {
      await app.stop();
    }
  });

  test('今日の分がすでにあれば（同じ日に起動し直したときなど）上書きしない', async () => {
    const app = await startServer({
      data: DATA,
      setup: (dir) => {
        fs.mkdirSync(path.join(dir, 'backup', TODAY), { recursive: true });
        fs.writeFileSync(path.join(dir, 'backup', TODAY, 'tags.json'), '"朝のバックアップ"');
      },
    });
    try {
      await addTag(app, 'x');
      assert.equal(readJson(path.join(app.dir, 'backup', TODAY, 'tags.json')), '朝のバックアップ');
    } finally {
      await app.stop();
    }
  });

  test('新しいものから 7 日分を残し、ReciPal が作ったフォルダ以外には触れない', async () => {
    const old = Array.from({ length: 10 }, (_, i) => `recipal-2000-01-${String(i + 1).padStart(2, '0')}`);
    const others = ['notes.txt', 'photos', 'recipal-old'];
    const app = await startServer({
      data: DATA,
      setup: (dir) => {
        const backup = path.join(dir, 'backup');
        for (const name of old) fs.mkdirSync(path.join(backup, name), { recursive: true });
        fs.mkdirSync(path.join(backup, 'photos'));
        fs.mkdirSync(path.join(backup, 'recipal-old'));
        fs.writeFileSync(path.join(backup, 'notes.txt'), 'memo');
      },
    });
    try {
      await addTag(app, 'x');
      const left = fs.readdirSync(path.join(app.dir, 'backup')).sort();
      assert.deepEqual(left, [...others, ...old.slice(-6), TODAY].sort());
    } finally {
      await app.stop();
    }
  });

  test('まだデータがないとき（初回起動）は取らない', async () => {
    const app = await startServer();
    try {
      await addTag(app, 'x');
      assert.equal(fs.existsSync(path.join(app.dir, 'backup')), false);
    } finally {
      await app.stop();
    }
  });
});

describe('バックアップ先（環境変数 RECIPAL_BACKUP_DIR）', () => {
  test('ReciPal の外のフォルダを指定できる（なければ作る。日本語・スペースを含むパスも可）', async () => {
    const target = path.join(tempDir(), 'バックアップ ReciPal');
    const app = await startServer({ data: DATA, env: { RECIPAL_BACKUP_DIR: target } });
    try {
      await addTag(app, 'x');
      assert.deepEqual(fs.readdirSync(target), [TODAY]);
      assert.equal(fs.existsSync(path.join(app.dir, 'backup')), false);
      const status = (await app.get('/api/backup')).body;
      assert.equal(status.custom, true);
      assert.equal(status.dir, target);
    } finally {
      await app.stop();
    }
  });

  // テスト用の ReciPal のフォルダは起動するまで場所が決まらないので、相対パスで渡す
  // （相対パスは、起動したときの作業フォルダ＝テスト用の ReciPal のフォルダを基準に解決される）
  test('既定の backup の中のフォルダは使える', async () => {
    const app = await startServer({ data: DATA, env: { RECIPAL_BACKUP_DIR: 'backup/sub' } });
    try {
      await addTag(app, 'x');
      assert.deepEqual(fs.readdirSync(path.join(app.dir, 'backup', 'sub')), [TODAY]);
      assert.equal((await app.get('/api/backup')).body.error, null);
    } finally {
      await app.stop();
    }
  });

  for (const [label, rel] of [['data の中', 'data/bk'], ['public の中', 'public/bk'], ['ReciPal のフォルダそのもの', '.'], ['backup 以外の ReciPal のフォルダの中', 'mybackup']]) {
    test(`${label}は使えず、バックアップを取らないが、保存は成功する`, async () => {
      const app = await startServer({ data: DATA, env: { RECIPAL_BACKUP_DIR: rel } });
      try {
        await app.waitForOutput(/バックアップ先に使えない/);
        assert.equal((await addTag(app, 'x')).status, 201);
        assert.equal(app.readData('tags.json').length, 2);
        assert.equal((await app.get('/api/backup')).body.error.code, 'BACKUP_DIR_NOT_ALLOWED');
        if (rel !== '.') assert.equal(fs.existsSync(path.join(app.dir, rel)), false);
        assert.equal(fs.existsSync(path.join(app.dir, 'backup')), false);
      } finally {
        await app.stop();
      }
    });
  }

  test('書き込めないとき（同じ名前のファイルがある）も、保存は成功し、エラーを返す', async () => {
    const file = path.join(tempDir(), 'not-a-folder');
    fs.writeFileSync(file, 'x');
    const app = await startServer({ data: DATA, env: { RECIPAL_BACKUP_DIR: file } });
    try {
      assert.equal((await addTag(app, 'x')).status, 201);
      assert.equal(app.readData('tags.json').length, 2);
      assert.equal((await app.get('/api/backup')).body.error.code, 'BACKUP_FAILED');
      await app.waitForOutput(/バックアップに失敗しました/);
    } finally {
      await app.stop();
    }
  });
});
