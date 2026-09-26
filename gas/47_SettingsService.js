/**
 * 설정 화면 (v1.12). 설계: docs/design/settings.md
 * - settings 시트(key, value). 없는 키는 DEFAULT_SETTINGS를 쓴다.
 * - 앱에서 저장할 때 settings_updated_at을 잠금 값으로 쓴다 (다른 탭·기기에서 먼저 저장했는지 감지).
 *   시트를 손으로 고친 것은 감지하지 않는다.
 * - 발송 시각(digest_hour)을 바꾸면 아침 메일 트리거를 다시 건다. 새 트리거를 먼저 만들고 옛 것을 지운다.
 *   Apps Script는 시계 트리거의 시각을 읽는 방법이 없어서, 시각은 설정 시트에 함께 저장해 보여 준다.
 */

const SETTINGS_VERSION_KEY_ = 'settings_updated_at';

/** 시트 값 → 발송 시각. 없거나 DIGEST_HOURS 밖이면 기본값 */
function digestHourOf_(settings) {
  const n = Number(settings.digest_hour);
  return DIGEST_HOURS.indexOf(n) >= 0 ? n : DEFAULT_DIGEST_HOUR;
}

/** 시트 값 → 백업 보관 개수. 정수 1~LIMITS.BACKUP_KEEP_MAX가 아니면 기본값 */
function backupKeepOf_(settings) {
  const n = Number(settings.backup_keep);
  return Number.isInteger(n) && n >= 1 && n <= LIMITS.BACKUP_KEEP_MAX ? n : Number(DEFAULT_SETTINGS.backup_keep);
}

function toSettingsDto_(s) {
  return {
    notifyEnabled: isTrue_(s.notify_enabled),
    skipHolidays: isTrue_(s.skip_holidays),
    notifyWhenEmpty: isTrue_(s.notify_when_empty),
    todayPopup: isTrue_(s.today_popup),
    digestHour: digestHourOf_(s),
    backupKeep: backupKeepOf_(s),
    language: languageSettingOf_(s),
  };
}

/** 걸려 있는 트리거 개수 (정상 = 각각 1) */
function countTriggers_() {
  const c = { digest: 0, backup: 0 };
  ScriptApp.getProjectTriggers().forEach(function (t) {
    const h = t.getHandlerFunction();
    if (h === TRIGGERS.DIGEST.handler) c.digest++;
    else if (h === TRIGGERS.BACKUP.handler) c.backup++;
  });
  return c;
}

/**
 * notify_log 최근 기록 (최신 순). 시트는 추가 순서라 맨 뒤가 최신이다.
 * detail은 공휴일 이름·오류 문구만 보여 준다 (백업 파일 ID 같은 내부 값은 숨김).
 */
function recentNotifyLog_() {
  return readAll_(SHEETS.NOTIFY_LOG).slice(-LIMITS.RECENT_LOG).reverse().map(function (r) {
    const showDetail = r.result === 'FAILED' || r.result === 'SKIPPED_HOLIDAY';
    return {
      loggedAt: r.logged_at,
      kind: r.kind,
      targetDate: r.target_date,
      result: r.result,
      detail: showDetail ? String(r.detail).slice(0, 200) : '',
    };
  });
}

function settingsView_(settings) {
  return {
    settings: toSettingsDto_(settings),
    updatedAt: settings[SETTINGS_VERSION_KEY_] || '',
    digestHours: DIGEST_HOURS.slice(),
    limits: { backupKeepMax: LIMITS.BACKUP_KEEP_MAX, testMailPerDay: LIMITS.TEST_MAIL_PER_DAY },
    triggers: countTriggers_(),
    recentLog: recentNotifyLog_(),
  };
}

function getSettingsView_() {
  return settingsView_(getSettings_());
}

function validateSettingsInput_(input) {
  requireObject_(input);
  // 설정 잠금 값: 앱에서 한 번도 저장하지 않았으면 ''
  if (typeof input.updatedAt !== 'string' || input.updatedAt.length > 40) invalid_(t_('v.noUpdatedAt'));
  return {
    notifyEnabled: vStrictBool_(input.notifyEnabled, 'notifyEnabled'),
    skipHolidays: vStrictBool_(input.skipHolidays, 'skipHolidays'),
    notifyWhenEmpty: vStrictBool_(input.notifyWhenEmpty, 'notifyWhenEmpty'),
    todayPopup: vStrictBool_(input.todayPopup, 'todayPopup'),
    digestHour: vRequiredInt_(input.digestHour, 'digestHour', DIGEST_HOURS[0], DIGEST_HOURS[DIGEST_HOURS.length - 1]),
    backupKeep: vRequiredInt_(input.backupKeep, 'backupKeep', 1, LIMITS.BACKUP_KEEP_MAX),
    // v1.13 화면 언어 (auto | ko | ja). 없으면(배포 전부터 열려 있던 v1.12 화면) 지금 값을 유지한다 — 잠금 안에서 채움
    language: input.language === undefined ? null : vEnum_(input.language, 'language', LANG_SETTINGS),
    // 화면의 브라우저 언어: 언어가 '자동'일 때 메일 언어를 정하는 데 쓴다
    browserLang: normalizeLang_(input.browserLang),
    updatedAt: input.updatedAt,
  };
}

/** 아침 메일 트리거 하나를 만든다 */
function createDigestTrigger_(hour) {
  ScriptApp.newTrigger(TRIGGERS.DIGEST.handler)
    .timeBased().atHour(hour).everyDays(1).inTimezone(TZ).create();
}

/**
 * 아침 메일 트리거를 hour 시로 다시 건다. 새 트리거를 먼저 만들고 옛 트리거를 지운다.
 * 잠깐 두 개가 겹쳐도 같은 날 두 번 보내지 않는다 (runDigest_의 중복 발송 방지). 반드시 withLock_ 안에서.
 */
function replaceDigestTrigger_(hour) {
  const olds = ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === TRIGGERS.DIGEST.handler; });
  createDigestTrigger_(hour);
  olds.forEach(function (t) { ScriptApp.deleteTrigger(t); });
}

/** key → value 행을 쓴다. 같은 키가 여러 행이면 모두 같은 값으로, 없으면 추가. 반드시 withLock_ 안에서 */
function writeSettings_(values) {
  const rows = readAll_(SHEETS.SETTINGS);
  Object.keys(values).forEach(function (key) {
    const matches = rows.filter(function (r) { return r.key === key; });
    if (!matches.length) {
      insertRow_(SHEETS.SETTINGS, { key: key, value: values[key] });
      return;
    }
    matches.forEach(function (r) { updateRow_(SHEETS.SETTINGS, r._row, { key: key, value: values[key] }); });
  });
}

/**
 * 저장에 실패했을 때 발송 시각을 원래대로 맞춘다: 시트의 digest_hour와 예약을 모두 oldHour로.
 * (시트는 키마다 따로 쓰므로 도중에 실패하면 digest_hour만 새 값으로 남을 수 있다)
 * @return {boolean} 둘 다 되돌렸는지
 */
function rollbackDigestHour_(oldHour) {
  let ok = true;
  try {
    writeSettings_({ digest_hour: String(oldHour) });
    SpreadsheetApp.flush();
  } catch (e) {
    ok = false;
    console.error(JSON.stringify({ where: 'rollbackDigestHour_.sheet', message: e && e.message }));
  }
  try {
    replaceDigestTrigger_(oldHour);
  } catch (e) {
    ok = false;
    console.error(JSON.stringify({ where: 'rollbackDigestHour_.trigger', message: e && e.message }));
  }
  return ok;
}

function saveSettings_(input) {
  const v = validateSettingsInput_(input);
  return withLock_(function () {
    const current = getSettings_();
    if ((current[SETTINGS_VERSION_KEY_] || '') !== v.updatedAt) {
      fail_(ERROR_CODES.CONFLICT, t_('settings.conflict'));
    }
    const oldHour = digestHourOf_(current);
    const hourChanged = oldHour !== v.digestHour;
    const language = v.language || languageSettingOf_(current);
    try {
      if (hourChanged) replaceDigestTrigger_(v.digestHour);
      // 잠금 값은 맨 마지막에 쓴다 (도중에 실패하면 잠금 값이 그대로라 다시 저장할 수 있다)
      writeSettings_({
        notify_enabled: toBoolString_(v.notifyEnabled),
        skip_holidays: toBoolString_(v.skipHolidays),
        notify_when_empty: toBoolString_(v.notifyWhenEmpty),
        today_popup: toBoolString_(v.todayPopup),
        digest_hour: String(v.digestHour),
        backup_keep: String(v.backupKeep),
        language: language,
        settings_updated_at: nowStamp_(),
      });
      SpreadsheetApp.flush(); // 쓰기 오류가 늦게 나더라도 여기서 잡히게
    } catch (e) {
      console.error(JSON.stringify({ where: 'saveSettings_', message: e && e.message }));
      if (hourChanged && !rollbackDigestHour_(oldHour)) {
        fail_(ERROR_CODES.INTERNAL, t_('settings.saveFailedRollback'));
      }
      fail_(ERROR_CODES.INTERNAL, t_('settings.saveFailed'));
    }
    // 새 화면 언어를 기록해 둔다 (언어가 '자동'이면 메일은 이 언어로 나간다)
    rememberUiLang_(language === 'auto' ? v.browserLang : language);
    const view = settingsView_(getSettings_());
    view.digestTriggerReplaced = hourChanged;
    return view;
  });
}

/** 예약 작업 '다시 걸기': 아침 메일·주간 백업 트리거를 모두 다시 건다 (setup과 같은 동작) */
function repairTriggers_() {
  return withLock_(function () {
    installTriggers_([]);
    return settingsView_(getSettings_());
  });
}
