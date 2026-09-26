/**
 * 주간 백업: 스프레드시트를 백업 폴더에 복사하고, 오래된 사본은 휴지통으로 옮긴다(영구 삭제 아님).
 */

function getBackupFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty(PROP_KEYS.BACKUP_FOLDER_ID);
  if (id) {
    try {
      const folder = DriveApp.getFolderById(id);
      if (!folder.isTrashed()) return folder;
    } catch (e) {
      console.warn(JSON.stringify({ where: 'getBackupFolder_', message: 'saved folder not accessible, recreating' }));
    }
  }
  const created = DriveApp.createFolder(BACKUP_FOLDER_NAME);
  props.setProperty(PROP_KEYS.BACKUP_FOLDER_ID, created.getId());
  return created;
}

/** @return {number} 휴지통으로 옮긴 파일 수 */
function rotateBackups_(folder, keep) {
  const files = [];
  const it = folder.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if (!f.isTrashed() && String(f.getName()).indexOf(BACKUP_PREFIX) === 0) files.push(f);
  }
  files.sort(function (a, b) { return b.getDateCreated().getTime() - a.getDateCreated().getTime(); });
  let trashed = 0;
  for (let i = keep; i < files.length; i++) {
    files[i].setTrashed(true);
    trashed++;
  }
  return trashed;
}

/** 트리거 핸들러 (매주 월 03~04시). 편집기에서 직접 실행해도 된다. */
function weeklyBackup() {
  beginExecution_(null);
  const today = todayYmd_();
  try {
    // 설정 시트를 손으로 잘못 고쳐도 백업 자체는 멈추지 않도록 기본값으로 대체한다.
    const keep = backupKeepOf_(getSettings_());
    const ssId = getSpreadsheet_().getId();
    const folder = getBackupFolder_();
    const copy = DriveApp.getFileById(ssId).makeCopy(BACKUP_PREFIX + today, folder);
    const trashed = rotateBackups_(folder, keep);
    const detail = 'copy=' + copy.getId() + ', trashed=' + trashed + ', keep=' + keep;
    withLock_(function () { appendNotifyLog_('BACKUP', today, 'OK', detail); });
    console.log(JSON.stringify({ where: 'weeklyBackup', date: today, detail: detail }));
    return detail;
  } catch (e) {
    console.error(JSON.stringify({ where: 'weeklyBackup', date: today, message: e && e.message, stack: e && e.stack }));
    try {
      withLock_(function () { appendNotifyLog_('BACKUP', today, 'FAILED', e && e.message); });
    } catch (logError) {
      console.error(JSON.stringify({ where: 'weeklyBackup.log', message: logError && logError.message }));
    }
    throw e;
  }
}
