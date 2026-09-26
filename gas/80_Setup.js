/**
 * 최초 설정과 자가 점검. Apps Script 편집기에서 직접 실행한다.
 * setup()은 여러 번 실행해도 안전하다(시트·설정은 없는 것만 만들고, 트리거는 지우고 다시 만든다).
 * 로그 언어 (v1.13): Google 계정 언어가 한국어면 한국어, 그 밖에는 일본어.
 */

function ensureSheet_(ss, def, report) {
  let sheet = ss.getSheetByName(def.name);
  if (!sheet) {
    sheet = ss.insertSheet(def.name);
    report.push(t_('setup.sheetCreated', def.name));
  }
  const width = def.columns.length;
  if (sheet.getMaxColumns() < width) sheet.insertColumnsAfter(sheet.getMaxColumns(), width - sheet.getMaxColumns());

  const header = sheet.getRange(1, 1, 1, width);
  const current = header.getValues()[0].map(function (v) { return String(v); });
  // 채워진 머리글 개수 (앞에서부터 연속)
  let filled = 0;
  while (filled < width && current[filled] !== '') filled++;
  const prefixMatches = current.slice(0, filled).join(',') === def.columns.slice(0, filled).join(',')
    && current.slice(filled).every(function (v) { return v === ''; });
  if (!prefixMatches) {
    throw new Error(t_('setup.headerMismatch', def.name, current.join(',')));
  }
  if (filled < width) {
    // 새 버전에서 맨 끝에 추가된 열: 기존 데이터는 그대로 두고 머리글만 채운다
    sheet.getRange(1, filled + 1, 1, width - filled)
      .setNumberFormat(TEXT_FORMAT_)
      .setValues([def.columns.slice(filled)]);
    if (filled > 0) report.push(t_('setup.columnsAdded', def.name, def.columns.slice(filled).join(', ')));
  }
  header.setFontWeight('bold');
  sheet.setFrozenRows(1);
  // 날짜·숫자 자동 변환을 막기 위해 데이터 열 전체를 일반 텍스트 서식으로
  sheet.getRange(1, 1, sheet.getMaxRows(), width).setNumberFormat(TEXT_FORMAT_);
}

function removeEmptyDefaultSheets_(ss, report) {
  const ours = Object.keys(SHEETS).map(function (k) { return SHEETS[k].name; });
  ss.getSheets().forEach(function (s) {
    if (ours.indexOf(s.getName()) < 0 && s.getLastRow() === 0 && s.getLastColumn() === 0 && ss.getSheets().length > 1) {
      report.push(t_('setup.emptySheetRemoved', s.getName()));
      ss.deleteSheet(s);
    }
  });
}

function ensureDefaultSettings_(report) {
  withLock_(function () {
    const existing = {};
    readAll_(SHEETS.SETTINGS).forEach(function (r) { existing[r.key] = true; });
    Object.keys(DEFAULT_SETTINGS).forEach(function (key) {
      if (!existing[key]) {
        insertRow_(SHEETS.SETTINGS, { key: key, value: DEFAULT_SETTINGS[key] });
        report.push(t_('setup.settingAdded', key, DEFAULT_SETTINGS[key]));
      }
    });
  });
}

/**
 * 아침 메일·주간 백업 트리거를 다시 건다. 아침 메일 시각은 설정 시트의 digest_hour를 따른다 (v1.12).
 * 새 트리거를 먼저 만들고 옛 트리거를 지운다 — 도중에 실패해도 예약이 비는 순간이 없다.
 */
function installTriggers_(report) {
  const hour = digestHourOf_(getSettings_());
  const handlers = [TRIGGERS.DIGEST.handler, TRIGGERS.BACKUP.handler];
  const olds = ScriptApp.getProjectTriggers().filter(function (t) { return handlers.indexOf(t.getHandlerFunction()) >= 0; });
  createDigestTrigger_(hour);
  ScriptApp.newTrigger(TRIGGERS.BACKUP.handler)
    .timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(TRIGGERS.BACKUP.hour).inTimezone(TZ).create();
  olds.forEach(function (t) { ScriptApp.deleteTrigger(t); });
  report.push(t_('setup.triggers', hour, TRIGGERS.BACKUP.hour));
}

/** 최초 설정. 편집기에서 실행 → 권한 승인 → 로그 확인. */
function setup() {
  beginExecution_(accountLang_());
  const report = [];
  const props = PropertiesService.getScriptProperties();

  const owner = Session.getEffectiveUser().getEmail();
  if (!owner) throw new Error(t_('setup.noOwnerEmail'));
  props.setProperty(PROP_KEYS.OWNER_EMAIL, owner);
  report.push(t_('setup.owner', maskEmail_(owner)));

  let ss;
  const existingId = props.getProperty(PROP_KEYS.SPREADSHEET_ID);
  if (existingId) {
    try {
      ss = SpreadsheetApp.openById(existingId);
    } catch (e) {
      // 새 DB를 조용히 만들면 기존 데이터가 사라진 것처럼 보이므로 멈추고 알린다.
      throw new Error(t_('setup.cannotOpenDb', existingId, e && e.message));
    }
    report.push(t_('setup.dbExisting', ss.getUrl()));
  } else {
    ss = SpreadsheetApp.create(DB_NAME);
    props.setProperty(PROP_KEYS.SPREADSHEET_ID, ss.getId());
    report.push(t_('setup.dbCreated', ss.getUrl()));
  }
  resetSpreadsheetCache_();

  Object.keys(SHEETS).forEach(function (k) { ensureSheet_(ss, SHEETS[k], report); });
  removeEmptyDefaultSheets_(ss, report);
  ensureDefaultSettings_(report);
  installTriggers_(report);

  const holidays = getHolidays_(todayYmd_(), todayYmd_());
  report.push(t_(holidays.available ? 'setup.holidayOk' : 'setup.holidayWarn'));

  report.forEach(function (line) { Logger.log(line); });
  return report.join('\n');
}

/** 셀 저장 왕복 점검용 샘플: 입력 그대로 돌아와야 한다. */
const SELF_TEST_SAMPLES_ = ['=1+1', '+81-90-0000-0000', '-항목', '@mention', '2026-09-24', '2026-09-24T09:00', '00123', 'TRUE', '1e5', "'quote", '줄1\n줄2'];

function selfTestCellRoundTrip_() {
  const ss = getSpreadsheet_();
  const name = '_selftest';
  const old = ss.getSheetByName(name);
  if (old) ss.deleteSheet(old);
  const def = { name: name, columns: SELF_TEST_SAMPLES_.map(function (_, i) { return 'c' + i; }) };
  const obj = {};
  SELF_TEST_SAMPLES_.forEach(function (v, i) { obj['c' + i] = v; });
  ss.insertSheet(name);
  try {
    insertRow_(def, obj);
    SpreadsheetApp.flush();
    const row = readAll_(def)[0] || {};
    const broken = SELF_TEST_SAMPLES_.filter(function (v, i) { return row['c' + i] !== v; });
    return broken.length
      ? t_('selftest.cellChanged', broken.map(function (v) { return JSON.stringify(v) + '→' + JSON.stringify(row['c' + SELF_TEST_SAMPLES_.indexOf(v)]); }).join(', '))
      : t_('selftest.cellOk', SELF_TEST_SAMPLES_.length);
  } finally {
    ss.deleteSheet(ss.getSheetByName(name));
  }
}

/** 배포 후 실제 Google 환경 점검. 편집기에서 실행하고 로그를 확인한다. */
function runSelfTest() {
  beginExecution_(accountLang_());
  const report = [];
  const check = function (label, fn) {
    try {
      const line = fn();
      report.push(line || '[OK] ' + label);
    } catch (e) {
      report.push('[FAIL] ' + label + ': ' + (e && e.message));
    }
  };

  check(t_('selftest.check.owner'), function () { assertOwner_(); });
  check(t_('selftest.check.headers'), function () {
    const ss = getSpreadsheet_();
    Object.keys(SHEETS).forEach(function (k) {
      const def = SHEETS[k];
      const sheet = ss.getSheetByName(def.name);
      if (!sheet) throw new Error(t_('selftest.sheetMissing', def.name));
      const header = sheet.getRange(1, 1, 1, def.columns.length).getValues()[0].map(String).join(',');
      if (header !== def.columns.join(',')) throw new Error(t_('selftest.headerMismatch', def.name, header));
    });
  });
  check(t_('selftest.check.cell'), selfTestCellRoundTrip_);
  check(t_('selftest.check.calendar'), function () {
    const r = getCalendarEvents_(todayYmd_(), todayYmd_());
    if (r.error) throw new Error(r.error);
    return t_('selftest.calendarOk', r.events.length);
  });
  check(t_('selftest.check.holiday'), function () {
    // v1.15: 실제로 찾은 캘린더 이름(日本の祝日 / 일본의 휴일 / Holidays in Japan)을 함께 보여 준다
    const cal = findHolidayCalendar_();
    if (!cal || !getHolidays_(todayYmd_(), todayYmd_(), cal).available) return t_('selftest.holidayWarn');
    return t_('selftest.holidayOk', holidayCalendarName_(cal));
  });
  check(t_('selftest.check.quota'), function () { return t_('selftest.quota', MailApp.getRemainingDailyQuota()); });
  check(t_('selftest.check.backup'), function () { return t_('selftest.backupFolder', getBackupFolder_().getName()); });
  check(t_('selftest.check.triggers'), function () {
    const names = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
    const missing = [TRIGGERS.DIGEST.handler, TRIGGERS.BACKUP.handler].filter(function (h) { return names.indexOf(h) < 0; });
    if (missing.length) throw new Error(t_('selftest.triggersMissing', missing.join(', ')));
    return t_('selftest.triggersOk', names.join(', '));
  });
  check(t_('selftest.check.favicon'), faviconSelfTestLine_);

  report.forEach(function (line) { Logger.log(line); });
  return report.join('\n');
}
