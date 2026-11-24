const fs = require('fs/promises');
const path = require('path');
const { ROOT, DATA_DIR } = require('./config');
const { exists, isInside } = require('./files');

// バックアップ
// その日に最初にデータを保存する直前に、data フォルダの JSON をまとめてコピーする（変更前の状態を残す）。
// 保存先は ReciPal/backup。環境変数 RECIPAL_BACKUP_DIR で変えられる（API からは変えられない）。
// recipal-YYYY-MM-DD という名前のフォルダを作り、新しいものから BACKUP_KEEP 日分を残す。
// 古いものを消すときは、この名前のフォルダだけを対象にする（保存先にあるほかのファイルには触れない）。
// バックアップに失敗しても、データの保存は止めない

const DEFAULT_BACKUP_DIR = path.join(ROOT, 'backup');
const BACKUP_DIR = process.env.RECIPAL_BACKUP_DIR ? path.resolve(process.env.RECIPAL_BACKUP_DIR) : DEFAULT_BACKUP_DIR;
const BACKUP_KEEP = 7;
const BACKUP_NAME = /^recipal-\d{4}-\d{2}-\d{2}$/;

// 使えない保存先：data・public の中（入れ子になる・ブラウザから見える）と、
// 既定の backup 以外の ReciPal のフォルダの中（.gitignore の対象外で、Git に出てきてしまう）
function checkBackupDir() {
  const allowed = isInside(BACKUP_DIR, DEFAULT_BACKUP_DIR) || !isInside(BACKUP_DIR, ROOT);
  return allowed ? null : { code: 'BACKUP_DIR_NOT_ALLOWED', message: BACKUP_DIR };
}

const backupState = {
  error: checkBackupDir(), // { code, message }。null なら問題なし
  doneDate: null, // バックアップが済んだ日付（同じ日に何度もコピーしない）
  running: null,
};

// 今日の日付（PC のタイムゾーン）を YYYY-MM-DD で返す
function localDate(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function listBackups() {
  const entries = await fs.readdir(BACKUP_DIR, { withFileTypes: true }).catch(() => []);
  return entries.filter((e) => e.isDirectory() && BACKUP_NAME.test(e.name)).map((e) => e.name).sort();
}

async function backupData() {
  if (backupState.error && backupState.error.code === 'BACKUP_DIR_NOT_ALLOWED') return;
  const today = localDate();
  if (backupState.doneDate === today) return;
  // 同時に複数の保存が来ても、コピーは 1 回だけ行う
  if (!backupState.running) {
    backupState.running = runBackup(today).finally(() => {
      backupState.running = null;
    });
  }
  await backupState.running;
}

async function runBackup(today) {
  try {
    const files = (await fs.readdir(DATA_DIR).catch(() => [])).filter((f) => f.endsWith('.json'));
    const dest = path.join(BACKUP_DIR, `recipal-${today}`);
    // 初回起動でまだデータがないときは取らない。今日の分がすでにあれば（再起動したときなど）そのまま残す
    if (files.length && !(await exists(dest))) {
      // 一時フォルダにコピーしてから名前を変え、途中で止まっても中途半端なバックアップが残らないようにする
      const tmp = path.join(BACKUP_DIR, `.recipal-${today}.tmp`);
      await fs.rm(tmp, { recursive: true, force: true });
      await fs.mkdir(tmp, { recursive: true });
      for (const f of files) await fs.copyFile(path.join(DATA_DIR, f), path.join(tmp, f));
      await fs.rename(tmp, dest);
      console.log(`バックアップしました: ${dest}`);
    }
    for (const name of (await listBackups()).slice(0, -BACKUP_KEEP)) {
      await fs.rm(path.join(BACKUP_DIR, name), { recursive: true, force: true });
    }
    backupState.doneDate = today;
    backupState.error = null;
  } catch (err) {
    backupState.error = { code: 'BACKUP_FAILED', message: err.message };
    console.error('バックアップに失敗しました（データの保存は続けます）:', err.message);
  }
}

// 設定画面に出すバックアップの状態
async function backupStatus() {
  const names = await listBackups();
  const latest = names[names.length - 1];
  const stat = latest ? await fs.stat(path.join(BACKUP_DIR, latest)).catch(() => null) : null;
  return {
    dir: BACKUP_DIR,
    custom: Boolean(process.env.RECIPAL_BACKUP_DIR),
    lastBackupAt: stat ? stat.mtime.toISOString() : null,
    error: backupState.error,
  };
}

module.exports = { BACKUP_DIR, backupState, backupData, backupStatus };
