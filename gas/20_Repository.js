/**
 * 스프레드시트 공통 저장소.
 * - 모든 값은 일반 텍스트(@) 서식의 문자열로 저장한다.
 * - '= + - @'로 시작하는 값은 앞에 U+2060(보이지 않는 문자)을 붙여 수식으로 해석되지 않게 한다.
 *   작은따옴표(')로 시작하는 값도 시트가 따옴표를 떼어 버리므로 같은 방식으로 보호한다.
 * - 쓰기는 반드시 withLock_ 안에서 호출한다.
 */

const FORMULA_GUARD_ = '⁠';
const FORMULA_TRIGGER_RE_ = /^[=+\-@']/;
const TEXT_FORMAT_ = '@';

let spreadsheetCache_ = null;

function getSpreadsheet_() {
  if (spreadsheetCache_) return spreadsheetCache_;
  const id = PropertiesService.getScriptProperties().getProperty(PROP_KEYS.SPREADSHEET_ID);
  if (!id) fail_(ERROR_CODES.NOT_INITIALIZED, t_('err.notInitialized'));
  spreadsheetCache_ = SpreadsheetApp.openById(id);
  return spreadsheetCache_;
}

function resetSpreadsheetCache_() {
  spreadsheetCache_ = null;
}

function getSheet_(def) {
  const sheet = getSpreadsheet_().getSheetByName(def.name);
  if (!sheet) fail_(ERROR_CODES.NOT_INITIALIZED, t_('err.sheetMissing', def.name));
  return sheet;
}

function encodeCell_(v) {
  const s = v == null ? '' : String(v);
  return FORMULA_TRIGGER_RE_.test(s) ? FORMULA_GUARD_ + s : s;
}

function decodeCell_(v) {
  if (v == null) return '';
  if (isDateObject_(v)) {
    // 시트를 손으로 고쳐 날짜로 변환된 셀 방어
    const hm = Utilities.formatDate(v, TZ, 'HH:mm');
    return hm === '00:00' ? formatYmd_(v) : formatYmdHm_(v);
  }
  if (typeof v === 'boolean') return toBoolString_(v);
  const s = String(v);
  return s.charAt(0) === FORMULA_GUARD_ ? s.slice(1) : s;
}

/** 시트의 모든 데이터 행을 객체 배열로 읽는다. 각 객체에는 시트 행 번호(_row)가 붙는다. */
function readAll_(def) {
  const sheet = getSheet_(def);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const width = def.columns.length;
  const values = sheet.getRange(2, 1, lastRow - 1, width).getValues();
  const rows = [];
  for (let i = 0; i < values.length; i++) {
    const raw = values[i];
    const obj = { _row: i + 2 };
    let empty = true;
    for (let c = 0; c < width; c++) {
      const val = decodeCell_(raw[c]);
      if (val !== '') empty = false;
      obj[def.columns[c]] = val;
    }
    if (!empty) rows.push(obj);
  }
  return rows;
}

function writeRow_(sheet, def, rowIndex, obj) {
  const values = def.columns.map(function (col) {
    return encodeCell_(obj[col]);
  });
  const range = sheet.getRange(rowIndex, 1, 1, def.columns.length);
  range.setNumberFormat(TEXT_FORMAT_);
  range.setValues([values]);
}

function insertRow_(def, obj) {
  const sheet = getSheet_(def);
  const rowIndex = Math.max(sheet.getLastRow(), 1) + 1;
  const maxRows = sheet.getMaxRows();
  if (rowIndex > maxRows) sheet.insertRowsAfter(maxRows, LIMITS.ROW_GROW_STEP);
  writeRow_(sheet, def, rowIndex, obj);
  return rowIndex;
}

function updateRow_(def, rowIndex, obj) {
  if (!(rowIndex >= 2)) fail_(ERROR_CODES.INTERNAL, t_('err.badRow'));
  writeRow_(getSheet_(def), def, rowIndex, obj);
}

function findById_(rows, id) {
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].id === id) return rows[i];
  }
  return null;
}

/**
 * 삭제되지 않은 행만 찾고, 화면이 들고 있던 updated_at과 다르면 CONFLICT.
 * @param {string} entity 'schedule' | 'worklog' | 'diary' (오류 문구의 항목 이름, 사전 키 entity.*)
 */
function findActiveForUpdate_(rows, id, expectedUpdatedAt, entity) {
  const row = findById_(rows, id);
  if (!row || isTrue_(row.deleted)) fail_(ERROR_CODES.NOT_FOUND, t_('err.notFound', t_('entity.' + entity)));
  if (expectedUpdatedAt !== undefined && expectedUpdatedAt !== row.updated_at) {
    fail_(ERROR_CODES.CONFLICT, t_('err.conflictUpdate', t_('entity.' + entity)));
  }
  return row;
}

/**
 * 논리 삭제. 삭제 시각을 updated_at에 남긴다 (휴지통 목록·되돌리기 잠금 값으로 쓴다).
 * 반드시 withLock_ 안에서 호출한다.
 * @return {{id: string, updatedAt: string}} updatedAt = 삭제 시각
 */
function softDeleteRow_(def, row) {
  const stamp = nowStamp_();
  updateRow_(def, row._row, Object.assign({}, row, { deleted: 'TRUE', updated_at: stamp }));
  return { id: row.id, updatedAt: stamp };
}

/** 복구용: 삭제된 행만 찾는다. 없거나 이미 살아 있으면 NOT_FOUND, 삭제 시각(updated_at)이 다르면 CONFLICT. */
function findDeletedForRestore_(rows, id, expectedUpdatedAt, entity) {
  const row = findById_(rows, id);
  if (!row || !isTrue_(row.deleted)) {
    fail_(ERROR_CODES.NOT_FOUND, t_('err.restoreNotFound', t_('entity.' + entity)));
  }
  if (expectedUpdatedAt !== row.updated_at) {
    fail_(ERROR_CODES.CONFLICT, t_('err.conflictRestore', t_('entity.' + entity)));
  }
  return row;
}

/**
 * 논리 삭제를 되돌린다. 나머지 값(상태·프로젝트·연결 일정·기간)은 지울 때 그대로 둔다.
 * 반드시 withLock_ 안에서 호출한다.
 */
function restoreRow_(def, row) {
  const restored = Object.assign({}, row, { deleted: 'FALSE', updated_at: nowStamp_() });
  updateRow_(def, row._row, restored);
  return restored;
}

/** 쓰기 작업 직렬화. 락 안에서 flush까지 끝내야 다음 실행이 최신 값을 읽는다. */
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(LIMITS.LOCK_WAIT_MS)) {
    fail_(ERROR_CODES.BUSY, t_('err.busy'));
  }
  try {
    const result = fn();
    SpreadsheetApp.flush();
    return result;
  } finally {
    lock.releaseLock();
  }
}

function getSettings_() {
  const settings = Object.assign({}, DEFAULT_SETTINGS);
  readAll_(SHEETS.SETTINGS).forEach(function (r) {
    if (r.key) settings[r.key] = r.value;
  });
  return settings;
}

function appendNotifyLog_(kind, targetDate, result, detail) {
  insertRow_(SHEETS.NOTIFY_LOG, {
    logged_at: nowStamp_(),
    kind: kind,
    target_date: targetDate,
    result: result,
    detail: String(detail || '').slice(0, 1000),
  });
}
