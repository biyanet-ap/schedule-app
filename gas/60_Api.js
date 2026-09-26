/**
 * 화면에서 google.script.run으로 호출하는 공개 API.
 * 응답은 항상 { ok: true, data } 또는 { ok: false, error: { code, message } }.
 * google.script.run은 Date 객체를 주고받지 못하므로 모든 날짜는 문자열이다.
 * v1.13: 모든 API는 (input, lang) — lang은 화면 언어('ko' | 'ja'). 오류 문구를 그 언어로 만든다.
 *        입력이 없는 API도 첫 번째 자리는 비워 두고(null) 두 번째에 lang을 받는다.
 */

/** 웹앱 배포 설정(액세스: 나만)과 별개로, 서버에서도 소유자인지 다시 확인한다. */
function assertOwner_() {
  const owner = PropertiesService.getScriptProperties().getProperty(PROP_KEYS.OWNER_EMAIL);
  if (!owner) fail_(ERROR_CODES.NOT_INITIALIZED, t_('err.notInitialized'));
  const active = Session.getActiveUser().getEmail();
  if (!active || active.toLowerCase() !== owner.toLowerCase()) {
    console.warn(JSON.stringify({ where: 'assertOwner_', activeUser: maskEmail_(active) }));
    fail_(ERROR_CODES.FORBIDDEN, t_('err.forbidden'));
  }
}

function apiCall_(name, lang, fn) {
  beginExecution_(lang); // 소유자 확인보다 먼저: 권한 오류도 화면 언어로
  try {
    assertOwner_();
    return { ok: true, data: fn() };
  } catch (e) {
    if (e instanceof AppError) {
      return { ok: false, error: { code: e.code, message: e.message } };
    }
    console.error(JSON.stringify({ api: name, message: e && e.message, stack: e && e.stack }));
    return { ok: false, error: { code: ERROR_CODES.INTERNAL, message: t_('err.internal') } };
  }
}

/**
 * 첫 화면. input.browserLang = 화면이 브라우저 언어로 고른 언어 (설정 값을 받기 전이라 화면은 이 값으로 부른다).
 * 설정이 '자동'이면 그 언어, 아니면 지정 언어를 '마지막 화면 언어'로 기록한다 (메일·탭 제목용).
 */
function apiBootstrap(input, lang) {
  return apiCall_('apiBootstrap', lang, function () {
    const settings = getSettings_();
    const setting = languageSettingOf_(settings);
    const browserLang = normalizeLang_(input && typeof input === 'object' ? input.browserLang : null) || normalizeLang_(lang);
    const uiLang = setting === 'auto' ? browserLang : setting;
    if (uiLang) {
      setRequestLang_(uiLang);
      rememberUiLang_(uiLang);
    }
    return {
      today: todayYmd_(),
      projects: listProjects_(),
      settings: toSettingsDto_(settings),
      limits: {
        title: LIMITS.TITLE,
        description: LIMITS.DESCRIPTION,
        content: LIMITS.CONTENT,
        location: LIMITS.LOCATION,
        tagCount: LIMITS.TAG_COUNT,
        tagLength: LIMITS.TAG_LENGTH,
        projectName: LIMITS.PROJECT_NAME,
        keyword: LIMITS.KEYWORD,
        rangeDays: LIMITS.RANGE_DAYS,
        worklogPeriodDays: LIMITS.WORKLOG_PERIOD_DAYS,
      },
    };
  });
}

function apiGetRange(input, lang) {
  return apiCall_('apiGetRange', lang, function () {
    const r = vRange_(requireObject_(input));
    const cal = getCalendarEvents_(r.from, r.to);
    const holidays = getHolidays_(r.from, r.to);
    return {
      from: r.from,
      to: r.to,
      schedules: listSchedulesInRange_(r.from, r.to),
      worklogs: listWorklogsInRange_(r.from, r.to),
      diaries: listDiariesInRange_(r.from, r.to),
      calendarEvents: cal.events,
      calendarError: cal.error,
      holidays: holidays.holidays,
      holidayCalendarAvailable: holidays.available,
    };
  });
}

function apiGetToday(_input, lang) {
  return apiCall_('apiGetToday', lang, function () {
    const today = todayYmd_();
    return Object.assign(buildDigest_(today), { holidayName: holidayNameOf_(today) });
  });
}

function apiSaveSchedule(input, lang) {
  return apiCall_('apiSaveSchedule', lang, function () { return saveSchedule_(input); });
}

function apiDeleteSchedule(input, lang) {
  return apiCall_('apiDeleteSchedule', lang, function () { return deleteSchedule_(input); });
}

function apiSetScheduleStatus(input, lang) {
  return apiCall_('apiSetScheduleStatus', lang, function () { return setScheduleStatus_(input); });
}

function apiSaveWorklog(input, lang) {
  return apiCall_('apiSaveWorklog', lang, function () { return saveWorklog_(input); });
}

function apiDeleteWorklog(input, lang) {
  return apiCall_('apiDeleteWorklog', lang, function () { return deleteWorklog_(input); });
}

function apiSetWorklogStatus(input, lang) {
  return apiCall_('apiSetWorklogStatus', lang, function () { return setWorklogStatus_(input); });
}

function apiSearch(input, lang) {
  return apiCall_('apiSearch', lang, function () { return search_(input); });
}

function apiSaveProject(input, lang) {
  return apiCall_('apiSaveProject', lang, function () { return saveProject_(input); });
}

function apiGetDiaries(input, lang) {
  return apiCall_('apiGetDiaries', lang, function () { return getDiaries_(input); });
}

function apiSaveDiary(input, lang) {
  return apiCall_('apiSaveDiary', lang, function () { return saveDiary_(input); });
}

function apiDeleteDiary(input, lang) {
  return apiCall_('apiDeleteDiary', lang, function () { return deleteDiary_(input); });
}

function apiSearchDiaries(input, lang) {
  return apiCall_('apiSearchDiaries', lang, function () { return searchDiaries_(input); });
}

// v1.11 휴지통·되돌리기
function apiGetTrash(_input, lang) {
  return apiCall_('apiGetTrash', lang, function () { return listTrash_(); });
}

function apiRestoreSchedule(input, lang) {
  return apiCall_('apiRestoreSchedule', lang, function () { return restoreSchedule_(input); });
}

function apiRestoreWorklog(input, lang) {
  return apiCall_('apiRestoreWorklog', lang, function () { return restoreWorklog_(input); });
}

function apiRestoreDiary(input, lang) {
  return apiCall_('apiRestoreDiary', lang, function () { return restoreDiary_(input); });
}

// v1.12 설정 화면
function apiGetSettings(_input, lang) {
  return apiCall_('apiGetSettings', lang, function () { return getSettingsView_(); });
}

function apiSaveSettings(input, lang) {
  return apiCall_('apiSaveSettings', lang, function () { return saveSettings_(input); });
}

function apiRepairTriggers(_input, lang) {
  return apiCall_('apiRepairTriggers', lang, function () { return repairTriggers_(); });
}

function apiSendTestDigest(_input, lang) {
  return apiCall_('apiSendTestDigest', lang, function () { return sendTestDigest_(); });
}
