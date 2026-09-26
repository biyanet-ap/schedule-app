// 스케줄관리 서버 코드 (자동 생성: npm run release). 직접 고치지 말고 gas/*.js를 수정하세요.

// ===== 00_Config.js =====
/**
 * 앱 전역 상수.
 * Apps Script는 모든 .js 파일을 하나의 전역 스코프에 올린다.
 * 파일 로드 순서에 기대지 않도록, 최상위에는 선언만 두고 실행 코드는 두지 않는다.
 */

// 표시용 앱 이름은 언어별 사전(app.name) — 05_I18n.js appName_()
const DB_NAME = '스케줄관리 DB';
const TZ = 'Asia/Tokyo';
const TZ_OFFSET = '+09:00';

const SHEETS = Object.freeze({
  SCHEDULES: Object.freeze({
    name: 'schedules',
    columns: Object.freeze([
      'id', 'type', 'title', 'description', 'start_at', 'end_at', 'all_day',
      'priority', 'project_id', 'location', 'status', 'created_at', 'updated_at', 'deleted',
      // v1.3 추가 열은 항상 맨 끝에 붙인다 (setup이 기존 시트 머리글을 자동 보강)
      'tags',
    ]),
  }),
  WORKLOGS: Object.freeze({
    name: 'worklogs',
    columns: Object.freeze([
      'id', 'work_date', 'title', 'content', 'project_id', 'schedule_id', 'tags',
      'created_at', 'updated_at', 'deleted',
      // v1.5 추가 열 (맨 끝에만 추가)
      'status',
      // v1.6: 기간 기록의 종료일 (비어 있으면 하루 기록, work_date는 시작일)
      'end_date',
    ]),
  }),
  // v1.7: 다이어리 (날짜당 최대 1편, 삭제되지 않은 것 기준)
  DIARIES: Object.freeze({
    name: 'diaries',
    columns: Object.freeze(['id', 'diary_date', 'title', 'content', 'created_at', 'updated_at', 'deleted']),
  }),
  PROJECTS: Object.freeze({
    name: 'projects',
    columns: Object.freeze(['id', 'name', 'color', 'sort_order', 'active', 'created_at', 'updated_at']),
  }),
  SETTINGS: Object.freeze({
    name: 'settings',
    columns: Object.freeze(['key', 'value']),
  }),
  NOTIFY_LOG: Object.freeze({
    name: 'notify_log',
    columns: Object.freeze(['logged_at', 'kind', 'target_date', 'result', 'detail']),
  }),
});

const ENUMS = Object.freeze({
  SCHEDULE_TYPE: Object.freeze(['TASK', 'MEETING']),
  PRIORITY: Object.freeze(['HIGH', 'MEDIUM', 'LOW']),
  STATUS: Object.freeze(['PLANNED', 'DONE', 'CANCELLED']),
  WORKLOG_STATUS: Object.freeze(['IN_PROGRESS', 'DONE']),
});

const LIMITS = Object.freeze({
  TITLE: 200,
  DESCRIPTION: 5000,
  CONTENT: 20000,
  LOCATION: 500,
  TAG_COUNT: 10,
  TAG_LENGTH: 30,
  PROJECT_NAME: 50,
  KEYWORD: 100,
  RANGE_DAYS: 62,
  WORKLOG_PERIOD_DAYS: 92,
  SEARCH_RESULTS: 100,
  OVERDUE_IN_DIGEST: 10,
  IN_PROGRESS_IN_DIGEST: 10,
  // v1.11 휴지통: 최근 N일 안에 지운 것만, 최대 N건
  TRASH_DAYS: 30,
  TRASH_ITEMS: 300,
  // v1.12 설정 화면
  BACKUP_KEEP_MAX: 100,
  TEST_MAIL_PER_DAY: 5,
  RECENT_LOG: 10,
  SORT_ORDER_MAX: 9999,
  LOCK_WAIT_MS: 10000,
  ROW_GROW_STEP: 200,
});

/** 아침 메일 기본 발송 시각과 설정 화면에서 고를 수 있는 시각 (v1.12). 트리거는 그 시각 ~ 1시간 사이에 실행된다 */
const DEFAULT_DIGEST_HOUR = 7;
const DIGEST_HOURS = Object.freeze([5, 6, 7, 8, 9, 10]);

const DEFAULT_SETTINGS = Object.freeze({
  notify_enabled: 'TRUE',
  notify_when_empty: 'TRUE',
  skip_holidays: 'TRUE',
  backup_keep: '8',
  // v1.12 (없으면 이 기본값을 쓰므로 setup을 다시 실행하지 않아도 된다)
  digest_hour: String(DEFAULT_DIGEST_HOUR),
  today_popup: 'TRUE',
  // v1.13 화면 언어: auto(브라우저 언어) | ko | ja
  language: 'auto',
});

const TRIGGERS = Object.freeze({
  // 아침 메일 시각은 설정 시트의 digest_hour (기본 DEFAULT_DIGEST_HOUR) — 47_SettingsService.js digestHourOf_
  DIGEST: Object.freeze({ handler: 'sendMorningDigest' }),
  BACKUP: Object.freeze({ handler: 'weeklyBackup', hour: 3 }),
});

const HOLIDAY_CALENDAR_ID = 'ja.japanese#holiday@group.v.calendar.google.com';
/** 공휴일 캘린더 중 이 문자열이 설명에 들어간 이벤트는 쉬는 날이 아닌 기념일로 본다. */
const NON_HOLIDAY_MARKER = '祭日';

const PROP_KEYS = Object.freeze({
  SPREADSHEET_ID: 'SPREADSHEET_ID',
  OWNER_EMAIL: 'OWNER_EMAIL',
  BACKUP_FOLDER_ID: 'BACKUP_FOLDER_ID',
  // v1.13 마지막으로 앱을 연 화면의 언어 (ko | ja). 메일(언어 '자동'일 때)과 탭 제목에 쓴다
  LAST_UI_LANG: 'LAST_UI_LANG',
  // v1.14 브라우저 탭 아이콘: setupFavicon이 드라이브에 올린 로고 파일 ID, 직접 지정 주소(선택 — 있으면 먼저 씀)
  FAVICON_FILE_ID: 'FAVICON_FILE_ID',
  FAVICON_URL: 'FAVICON_URL',
});

const BACKUP_FOLDER_NAME = '스케줄관리_backup';
const BACKUP_PREFIX = 'schedule-db_backup_';
/** v1.14 탭 아이콘용 로고 파일 (드라이브 파일·폴더 이름은 언어와 무관하게 고정) */
const FAVICON_FILE_NAME = '스케줄관리_favicon.png';

const ERROR_CODES = Object.freeze({
  VALIDATION: 'VALIDATION',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  FORBIDDEN: 'FORBIDDEN',
  BUSY: 'BUSY',
  NOT_INITIALIZED: 'NOT_INITIALIZED',
  INTERNAL: 'INTERNAL',
});

// ===== 05_I18n.js =====
/**
 * 다국어 (v1.13). 설계: docs/design/i18n.md
 * - 지원 언어: 한국어(ko), 일본어(ja). 사전은 06_Messages.js
 * - 요청 언어: 화면이 API를 부를 때 두 번째 인자로 보낸 언어. apiCall_이 맨 먼저 정한다.
 *   Apps Script는 실행마다 전역을 새로 올리므로 요청 사이에 값이 섞이지 않는다.
 * - 요청 언어가 없으면(예약 작업·편집기 실행·옛 화면): 마지막 화면 언어(LAST_UI_LANG) → Google 계정 언어 → 일본어
 */

const LANGS = Object.freeze(['ko', 'ja']);
const LANG_SETTINGS = Object.freeze(['auto', 'ko', 'ja']);
const DEFAULT_LANG = 'ja';

/** 지금 실행의 요청 언어 ('ko' | 'ja' | null) */
let REQUEST_LANG_ = null;
/**
 * 요청 언어가 없을 때 쓰는 언어 (한 실행 안에서 한 번만 계산): 마지막 화면 언어 → 계정 언어 → 일본어.
 * 지정 언어(설정 시트)는 따로 읽지 않는다 — 앱에서 지정 언어를 저장하거나 앱을 열 때 LAST_UI_LANG도 같은 값으로 쓰므로
 * 시트를 손으로 고친 경우가 아니면 결과가 같고, 시트를 읽지 않아야 setup 전에도 오류 문구를 만들 수 있다.
 */
let FALLBACK_LANG_ = null;

/** 'ko' | 'ja'만 통과, 나머지는 null */
function normalizeLang_(v) {
  return typeof v === 'string' && LANGS.indexOf(v) >= 0 ? v : null;
}

/** 'ko-KR'·'ja_JP' 같은 로케일 → 'ko' | 'ja' | null (주 언어 코드 단위로 본다: 'kok'·'jam'은 아님) */
function langFromLocale_(locale) {
  const m = /^([a-z]{2,3})(?:[-_]|$)/.exec(String(locale || '').toLowerCase());
  return m ? normalizeLang_(m[1]) : null;
}

/** Google 계정의 언어 설정. 한국어·일본어가 아니면 기본 언어 */
function accountLang_() {
  try {
    return langFromLocale_(Session.getActiveUserLocale()) || DEFAULT_LANG;
  } catch (e) {
    return DEFAULT_LANG;
  }
}

/** 마지막으로 앱을 연 화면의 언어 (없으면 null) */
function lastUiLang_() {
  try {
    return normalizeLang_(PropertiesService.getScriptProperties().getProperty(PROP_KEYS.LAST_UI_LANG));
  } catch (e) {
    return null;
  }
}

/** 화면 언어가 바뀌었을 때만 기록한다 (스크립트 속성 쓰기 최소화) */
function rememberUiLang_(lang) {
  const l = normalizeLang_(lang);
  if (!l || l === lastUiLang_()) return;
  try {
    PropertiesService.getScriptProperties().setProperty(PROP_KEYS.LAST_UI_LANG, l);
    FALLBACK_LANG_ = null;
  } catch (e) {
    console.warn(JSON.stringify({ where: 'rememberUiLang_', message: e && e.message }));
  }
}

function fallbackLang_() {
  if (!FALLBACK_LANG_) FALLBACK_LANG_ = lastUiLang_() || accountLang_();
  return FALLBACK_LANG_;
}

function setRequestLang_(lang) {
  REQUEST_LANG_ = normalizeLang_(lang);
}

/** 실행 입구(API·예약 작업·편집기 실행·doGet)에서 부른다: 요청 언어를 정하고 대체 언어 계산을 새로 한다 */
function beginExecution_(lang) {
  REQUEST_LANG_ = normalizeLang_(lang);
  FALLBACK_LANG_ = null;
}

/** 지금 문구에 쓸 언어 */
function lang_() {
  return REQUEST_LANG_ || fallbackLang_();
}

/** 잠깐 다른 언어로 문구를 만든다 (예: 화면은 한국어, 메일은 일본어) */
function withLang_(lang, fn) {
  const saved = REQUEST_LANG_;
  REQUEST_LANG_ = normalizeLang_(lang) || saved;
  try {
    return fn();
  } finally {
    REQUEST_LANG_ = saved;
  }
}

/** 설정 시트 값 → 'auto' | 'ko' | 'ja' (이상한 값이면 auto) */
function languageSettingOf_(settings) {
  const v = String((settings && settings.language) || '');
  return LANG_SETTINGS.indexOf(v) >= 0 ? v : 'auto';
}

/** 메일 언어: 지정 언어 → 마지막 화면 언어 → 계정 언어 → 일본어 */
function mailLang_(settings) {
  const s = languageSettingOf_(settings);
  return s === 'auto' ? fallbackLang_() : s;
}

function messagesOf_(lang) {
  return lang === 'ko' ? MSG_KO_ : MSG_JA_;
}

/** 정해진 언어의 문구. 사전 값이 함수면 인자를 넘겨 부른다. 없는 키는 한국어 사전 → 키 그대로 */
function tIn_(lang, key) {
  const args = Array.prototype.slice.call(arguments, 2);
  let v = messagesOf_(lang)[key];
  if (v === undefined) v = MSG_KO_[key];
  if (v === undefined) {
    console.warn(JSON.stringify({ where: 'tIn_', missingKey: key }));
    return key;
  }
  return typeof v === 'function' ? v.apply(null, args) : v;
}

/** 지금 언어의 문구 */
function t_(key) {
  const args = Array.prototype.slice.call(arguments, 1);
  return tIn_.apply(null, [lang_(), key].concat(args));
}

/** 표시용 앱 이름 */
function appName_(lang) {
  return tIn_(lang || lang_(), 'app.name');
}

/** 0=일 … 6=토 → 요일 한 글자 */
function weekdayName_(ymd, lang) {
  return tIn_(lang || lang_(), 'weekdays')[dayOfWeek_(ymd)];
}

/** 받침 유무에 따라 조사를 고른다. (예: 제목을 / 내용을 / 태그를) */
function josa_(word, withBatchim, withoutBatchim) {
  const s = String(word);
  const code = s.charCodeAt(s.length - 1);
  if (code >= 0xac00 && code <= 0xd7a3) {
    return s + ((code - 0xac00) % 28 !== 0 ? withBatchim : withoutBatchim);
  }
  return s + withBatchim;
}

// ===== 06_Messages.js =====
/**
 * 서버 사전 (v1.13). 키는 두 사전이 같아야 한다 (tests/gas/i18n.test.ts가 키·인자 개수를 비교).
 * 값은 문자열, 또는 인자를 받아 문장을 만드는 함수.
 * 화면 문구는 src/i18n/ko.ts·ja.ts. 여기에는 서버가 만드는 문구(오류, 메일, 오늘 요약 라벨, 다이어리 기본 제목, setup 로그)만 둔다.
 */

const MSG_KO_ = {
  'app.name': '스케줄관리',
  weekdays: ['일', '월', '화', '수', '목', '금', '토'],

  // 공통 오류
  'err.internal': '서버에서 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
  'err.notInitialized': '초기 설정이 필요합니다. Apps Script 편집기에서 setup을 실행해 주세요.',
  'err.forbidden': '이 앱을 사용할 권한이 없습니다.',
  'err.cannotOpen': '앱을 열 수 없습니다.',
  'err.sheetMissing': function (name) { return name + ' 시트가 없습니다. setup을 다시 실행해 주세요.'; },
  'err.badRow': '잘못된 행 번호입니다.',
  'err.notFound': function (label) { return label + ' 항목을 찾을 수 없습니다. 이미 삭제됐을 수 있습니다.'; },
  'err.conflictUpdate': function (label) { return '다른 곳에서 먼저 수정된 ' + label + ' 항목입니다. 새로고침 후 다시 시도해 주세요.'; },
  'err.restoreNotFound': function (label) { return '이미 복구됐거나 찾을 수 없는 ' + label + ' 항목입니다.'; },
  'err.conflictRestore': function (label) { return '다른 곳에서 먼저 바뀐 ' + label + ' 항목입니다. 새로고침 후 다시 시도해 주세요.'; },
  'err.busy': '다른 작업을 처리하는 중입니다. 잠시 후 다시 시도해 주세요.',
  'err.ownerMissing': '소유자 정보가 없습니다. setup을 실행해 주세요.',

  // 항목 이름 (오류 문구 안에 들어감)
  'entity.schedule': '일정',
  'entity.worklog': '작업기록',
  'entity.project': '프로젝트',
  'entity.diary': '다이어리',

  // 입력 칸 이름
  'f.projectId': '프로젝트 ID',
  'f.projectName': '프로젝트명',
  'f.sortOrder': '정렬 순서',
  'f.startDate': '시작일',
  'f.endDate': '종료일',
  'f.startAt': '시작 일시',
  'f.endAt': '종료 일시',
  'f.scheduleId': '일정 ID',
  'f.type': '구분',
  'f.title': '제목',
  'f.heading': '타이틀',
  'f.description': '내용',
  'f.priority': '우선순위',
  'f.project': '프로젝트',
  'f.status': '상태',
  'f.worklogId': '작업기록 ID',
  'f.workDate': '작업일',
  'f.linkedSchedule': '연결 일정',
  'f.location': '장소',
  'f.keyword': '검색어',
  'f.searchFrom': '검색 시작일',
  'f.searchTo': '검색 종료일',
  'f.diaryId': '다이어리 ID',
  'f.date': '날짜',
  'f.notifyEnabled': '아침 메일 보내기',
  'f.skipHolidays': '공휴일에는 쉬기',
  'f.notifyWhenEmpty': '내용이 없는 날에도 보내기',
  'f.todayPopup': '오늘 요약 자동 표시',
  'f.digestHour': '발송 시각',
  'f.backupKeep': '백업 보관 개수',
  'f.language': '화면 언어',

  // 입력 검증
  'v.badRequest': '요청 형식이 올바르지 않습니다.',
  'v.badFormat': function (l) { return l + ' 형식이 올바르지 않습니다.'; },
  'v.required': function (l) { return josa_(l, '을', '를') + ' 입력해 주세요.'; },
  'v.maxLength': function (l, max) { return josa_(l, '은', '는') + ' ' + max + '자 이내로 입력해 주세요.'; },
  'v.select': function (l) { return josa_(l, '을', '를') + ' 선택해 주세요.'; },
  'v.invalid': function (l) { return josa_(l, '이', '가') + ' 올바르지 않습니다.'; },
  'v.badDate': function (l) { return josa_(l, '이', '가') + ' 올바른 날짜가 아닙니다. (YYYY-MM-DD)'; },
  'v.badDateTime': function (l) { return josa_(l, '이', '가') + ' 올바른 일시가 아닙니다. (YYYY-MM-DD HH:mm)'; },
  'v.missing': function (l) { return josa_(l, '이', '가') + ' 없습니다.'; },
  'v.noUpdatedAt': '수정 기준 시각이 없습니다. 새로고침 후 다시 시도해 주세요.',
  'v.linkScheme': '링크는 http:// 또는 https://로 시작하는 주소만 쓸 수 있습니다.',
  'v.tagFormat': '태그 형식이 올바르지 않습니다.',
  'v.tagLength': function (max) { return '태그는 하나당 ' + max + '자 이내로 입력해 주세요.'; },
  'v.tagCount': function (max) { return '태그는 최대 ' + max + '개까지 쓸 수 있습니다.'; },
  'v.color': '색상은 #RRGGBB 형식이어야 합니다.',
  'v.intRange': function (l, min, max) { return josa_(l, '은', '는') + ' ' + min + '~' + max + ' 사이의 정수여야 합니다.'; },
  'v.rangeOrder': '종료일이 시작일보다 앞설 수 없습니다.',
  'v.rangeMax': function (days) { return '한 번에 조회할 수 있는 기간은 ' + days + '일까지입니다.'; },
  'v.boolValue': function (l) { return l + ' 값이 올바르지 않습니다.'; },

  // 업무 규칙
  'schedule.endBeforeStart': '종료가 시작보다 앞설 수 없습니다.',
  'project.duplicate': '같은 이름의 프로젝트가 이미 있습니다.',
  'project.notFound': '프로젝트 항목을 찾을 수 없습니다.',
  'project.selectedMissing': '선택한 프로젝트가 없습니다.',
  'project.inactive': '사용 중지된 프로젝트는 선택할 수 없습니다.',
  'worklog.periodOrder': "종료일은 시작일보다 뒤여야 합니다. 하루만 기록하려면 '하루 기록' 탭을 쓰세요.",
  'worklog.periodMax': function (days) { return '기간 기록은 최대 ' + days + '일까지 쓸 수 있습니다.'; },
  'worklog.scheduleMissing': '연결할 일정을 찾을 수 없습니다.',
  'calendar.untitled': '(제목 없음)',
  'calendar.error': '구글 캘린더 일정을 불러오지 못했습니다.',
  'search.rangeOrder': '검색 종료일이 시작일보다 앞설 수 없습니다.',
  'diary.defaultTitle': function (y, m, d, wd) { return y + '년 ' + m + '월 ' + d + '일 (' + wd + ')'; },
  'diary.exists': function (date) { return date + '에는 이미 다이어리가 있습니다. 화면을 새로 불러온 뒤 기존 다이어리를 수정해 주세요.'; },
  'diary.restoreBadDate': '날짜가 올바르지 않은 다이어리라서 복구할 수 없습니다. 시트에서 diary_date를 고쳐 주세요.',
  'diary.restoreExists': function (title) { return title + '에는 이미 다이어리가 있습니다. 그 다이어리를 먼저 삭제한 뒤 복구해 주세요.'; },
  'settings.conflict': '다른 곳에서 먼저 바뀐 설정입니다. 새로고침 후 다시 시도해 주세요.',
  'settings.saveFailedRollback': "설정을 저장하지 못했고 아침 메일 예약도 되돌리지 못했습니다. 설정 창에서 '다시 걸기'를 눌러 주세요.",
  'settings.saveFailed': '설정을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.',

  // 오늘 요약·아침 메일
  'time.allDay': '종일',
  'time.sep': '~',
  'type.TASK': '작업',
  'type.MEETING': '회의',
  'mail.subject': function (app, md, wd, schedules, meetings, overdue, inProgress) {
    return '[' + app + '] ' + md + '(' + wd + ') 일정 ' + schedules + '건 · 회의 ' + meetings + '건'
      + (overdue ? ' · 밀린 작업 ' + overdue + '건' : '')
      + (inProgress ? ' · 진행 중 ' + inProgress + '건' : '');
  },
  'mail.heading': function (date, wd) { return date + ' (' + wd + ') 오늘 요약'; },
  'mail.today': '오늘 일정',
  'mail.meetings': '구글 캘린더 회의',
  'mail.none': '없음',
  'mail.sep': ' · ',
  'mail.metaOpen': ' (',
  'mail.metaClose': ')',
  'mail.high': '[중요]',
  'mail.done': '[완료]',
  'mail.due': function (ymd) { return '마감 ' + ymd; },
  'mail.overdue': function (total, shown) { return '기한 지난 미완료 작업 (' + total + '건' + (total > shown ? ', 오래된 순 ' + shown + '건 표시' : '') + ')'; },
  'mail.inProgress': function (total, shown) { return '진행 중인 작업 (' + total + '건' + (total > shown ? ', 오래된 순 ' + shown + '건 표시' : '') + ')'; },
  'mail.openApp': function (url) { return '앱 열기: ' + url; },
  'mail.openAppLink': function (app) { return app + ' 앱 열기 →'; },
  'mail.fontFamily': "-apple-system,'Segoe UI','Malgun Gothic','Apple SD Gothic Neo','Hiragino Sans',sans-serif",
  'mail.testPrefix': '[테스트] ',
  'mail.testLimit': function (n) { return '테스트 메일은 하루 ' + n + '번까지 보낼 수 있습니다.'; },
  'mail.testFailed': function (msg) { return '테스트 메일을 보내지 못했습니다: ' + msg; },

  // setup·runSelfTest 로그 (편집기)
  'setup.sheetCreated': function (name) { return '[OK] 시트 생성: ' + name; },
  'setup.headerMismatch': function (name, header) { return name + ' 시트의 머리글이 예상과 다릅니다: ' + header; },
  'setup.columnsAdded': function (name, cols) { return '[OK] 열 추가: ' + name + ' → ' + cols; },
  'setup.emptySheetRemoved': function (name) { return '[OK] 빈 기본 시트 삭제: ' + name; },
  'setup.settingAdded': function (key, value) { return '[OK] 기본 설정 추가: ' + key + '=' + value; },
  'setup.triggers': function (h, bh) { return '[OK] 트리거 설치: 아침 요약 매일 ' + h + '~' + (h + 1) + '시, 백업 매주 월 ' + bh + '~' + (bh + 1) + '시'; },
  'setup.noOwnerEmail': '실행 계정의 이메일을 확인할 수 없습니다.',
  'setup.owner': function (masked) { return '[OK] 소유자: ' + masked; },
  'setup.cannotOpenDb': function (id, cause) { return '저장된 스프레드시트(' + id + ')를 열 수 없습니다. 삭제됐다면 스크립트 속성 SPREADSHEET_ID를 지우고 다시 실행하세요. 원인: ' + cause; },
  'setup.dbExisting': function (url) { return '[OK] 기존 스프레드시트 사용: ' + url; },
  'setup.dbCreated': function (url) { return '[OK] 스프레드시트 생성: ' + url; },
  'setup.holidayOk': '[OK] 일본 공휴일 캘린더 확인됨',
  'setup.holidayWarn': '[WARN] 일본 공휴일 캘린더를 읽을 수 없습니다. 구글 캘린더에서 "日本の祝日"(일본 공휴일) 캘린더를 추가하면 공휴일에는 메일을 보내지 않습니다.',
  'selftest.cellChanged': function (list) { return '[FAIL] 셀 저장 왕복: 값이 바뀜 → ' + list; },
  'selftest.cellOk': function (n) { return '[OK] 셀 저장 왕복 (' + n + '개 값 그대로 유지)'; },
  'selftest.check.owner': '소유자 확인',
  'selftest.check.headers': '시트 머리글',
  'selftest.check.cell': '셀 저장 왕복',
  'selftest.check.calendar': '기본 캘린더 조회',
  'selftest.check.holiday': '공휴일 캘린더',
  'selftest.check.quota': '메일 할당량',
  'selftest.check.backup': '백업 폴더',
  'selftest.check.triggers': '트리거',
  'selftest.sheetMissing': function (name) { return name + ' 시트 없음'; },
  'selftest.headerMismatch': function (name, header) { return name + ' 머리글 불일치: ' + header + ' (setup을 다시 실행하면 새 열이 추가됩니다)'; },
  'selftest.calendarOk': function (n) { return '[OK] 기본 캘린더 조회 (오늘 ' + n + '건)'; },
  'selftest.holidayOk': '[OK] 일본 공휴일 캘린더 구독됨',
  'selftest.holidayWarn': '[WARN] 일본 공휴일 캘린더 미구독 (공휴일에도 메일 발송됨)',
  'selftest.quota': function (n) { return '[OK] 오늘 남은 메일 발송 가능 수: ' + n; },
  'selftest.backupFolder': function (name) { return '[OK] 백업 폴더: ' + name; },
  'selftest.triggersMissing': function (list) { return '없음 → ' + list + ' (setup 재실행 필요)'; },
  'selftest.triggersOk': function (list) { return '[OK] 트리거: ' + list; },
  'selftest.check.favicon': '파비콘',
  'favicon.created': function (name) { return '[OK] 파비콘 파일 만듦: ' + name; },
  'favicon.shared': '[OK] 링크 공유: 링크가 있는 모든 사용자 — 뷰어 (이 파일 하나만)',
  'favicon.shareFailed': function (cause) { return '[WARN] 링크 공유를 켜지 못했습니다 (회사·조직 계정의 공유 제한일 수 있습니다). 원인: ' + cause; },
  'favicon.keptPrevious': '[WARN] 새 파일은 공유가 안 돼서 휴지통으로 옮기고, 지금 쓰고 있는 이전 파일을 그대로 씁니다',
  'favicon.oldTrashed': '[OK] 이전 파비콘 파일을 휴지통으로 옮김',
  'favicon.oldNotOurs': function (id) { return '[WARN] 이전에 저장된 파일(' + id + ')은 이 앱이 만든 로고 파일이 아니라서 그대로 둡니다'; },
  'favicon.oldTrashFailed': function (id) { return '[WARN] 이전 파비콘 파일(' + id + ')을 휴지통으로 옮기지 못했습니다. 드라이브에서 직접 지워 주세요'; },
  'favicon.url': function (url) { return '[OK] 탭 아이콘 주소: ' + url; },
  'favicon.manualOverride': function (url) { return '[OK] 스크립트 속성 FAVICON_URL이 있어 그 주소를 먼저 씁니다: ' + url; },
  'favicon.done': '웹앱을 새로 고치면 탭 아이콘이 바뀝니다 (새 배포는 필요 없음). 안 보이면 위 주소와 함께 알려 주세요.',
  'favicon.doneUnshared': '링크 공유가 안 돼서 탭 아이콘이 안 보일 수 있습니다. 웹앱을 새로 고쳐 보고, 안 보이면 드라이브 공유 정책을 확인하거나 스크립트 속성 FAVICON_URL에 다른 곳의 이미지 주소를 넣어 주세요.',
  'favicon.check.ok': function (name) { return '[OK] 파비콘: ' + name + ' (링크 공유)'; },
  'favicon.check.notShared': '[WARN] 파비콘: 링크 공유가 꺼져 있어 탭 아이콘이 안 보일 수 있습니다',
  'favicon.check.missing': '[WARN] 파비콘 파일을 찾을 수 없습니다. setupFavicon을 다시 실행하세요',
  'favicon.check.none': '[OK] 파비콘: 설정 안 함 (선택 — setupFavicon을 실행하면 탭 아이콘이 생깁니다)',
  'favicon.check.manual': '[OK] 파비콘: 직접 지정한 주소(FAVICON_URL) 사용',
  'favicon.check.manualBad': '[WARN] 파비콘: FAVICON_URL 값이 올바르지 않아 쓰지 않습니다 (https로 시작하고 .png 또는 .ico로 끝나는 2000자 이하 주소, 공백·따옴표 없이)',
};

const MSG_JA_ = {
  'app.name': 'スケジュール管理',
  weekdays: ['日', '月', '火', '水', '木', '金', '土'],

  'err.internal': 'サーバーでエラーが発生しました。しばらくしてからもう一度お試しください。',
  'err.notInitialized': '初期設定が必要です。Apps Script エディタで setup を実行してください。',
  'err.forbidden': 'このアプリを使用する権限がありません。',
  'err.cannotOpen': 'アプリを開けません。',
  'err.sheetMissing': function (name) { return 'シート「' + name + '」がありません。setup をもう一度実行してください。'; },
  'err.badRow': '行番号が正しくありません。',
  'err.notFound': function (label) { return label + 'が見つかりません。すでに削除された可能性があります。'; },
  'err.conflictUpdate': function (label) { return 'この' + label + 'は別のタブまたは端末で更新されています。再読み込みしてからもう一度お試しください。'; },
  'err.restoreNotFound': function (label) { return 'この' + label + 'はすでに復元されたか、見つかりません。'; },
  'err.conflictRestore': function (label) { return 'この' + label + 'は別のタブまたは端末で変更されています。再読み込みしてからもう一度お試しください。'; },
  'err.busy': '他の処理を実行中です。しばらくしてからもう一度お試しください。',
  'err.ownerMissing': '所有者の情報がありません。setup を実行してください。',

  'entity.schedule': '予定',
  'entity.worklog': '作業記録',
  'entity.project': 'プロジェクト',
  'entity.diary': '日記',

  'f.projectId': 'プロジェクトID',
  'f.projectName': 'プロジェクト名',
  'f.sortOrder': '並び順',
  'f.startDate': '開始日',
  'f.endDate': '終了日',
  'f.startAt': '開始日時',
  'f.endAt': '終了日時',
  'f.scheduleId': '予定ID',
  'f.type': '区分',
  'f.title': 'タイトル',
  'f.heading': 'タイトル',
  'f.description': '内容',
  'f.priority': '優先度',
  'f.project': 'プロジェクト',
  'f.status': '状態',
  'f.worklogId': '作業記録ID',
  'f.workDate': '作業日',
  'f.linkedSchedule': '関連する予定',
  'f.location': '場所',
  'f.keyword': '検索キーワード',
  'f.searchFrom': '検索開始日',
  'f.searchTo': '検索終了日',
  'f.diaryId': '日記ID',
  'f.date': '日付',
  'f.notifyEnabled': '朝のメールを送る',
  'f.skipHolidays': '日本の祝日は送信しない',
  'f.notifyWhenEmpty': '送る内容がない日も送る',
  'f.todayPopup': '今日のまとめの自動表示',
  'f.digestHour': '送信時刻',
  'f.backupKeep': 'バックアップの保存数',
  'f.language': '表示言語',

  'v.badRequest': 'リクエストの形式が正しくありません。',
  'v.badFormat': function (l) { return l + 'の形式が正しくありません。'; },
  'v.required': function (l) { return l + 'を入力してください。'; },
  'v.maxLength': function (l, max) { return l + 'は' + max + '文字以内で入力してください。'; },
  'v.select': function (l) { return l + 'を選択してください。'; },
  'v.invalid': function (l) { return l + 'が正しくありません。'; },
  'v.badDate': function (l) { return l + 'の形式が正しくありません(YYYY-MM-DD)。'; },
  'v.badDateTime': function (l) { return l + 'の形式が正しくありません(YYYY-MM-DD HH:mm)。'; },
  'v.missing': function (l) { return l + 'がありません。'; },
  'v.noUpdatedAt': '更新日時の情報がありません。再読み込みしてからもう一度お試しください。',
  'v.linkScheme': 'リンクには http:// または https:// で始まるアドレスのみ使用できます。',
  'v.tagFormat': 'タグの形式が正しくありません。',
  'v.tagLength': function (max) { return 'タグは1つあたり' + max + '文字以内で入力してください。'; },
  'v.tagCount': function (max) { return 'タグは最大' + max + '個まで使用できます。'; },
  'v.color': '色は #RRGGBB 形式で指定してください。',
  'v.intRange': function (l, min, max) { return l + 'は' + min + '〜' + max + 'の整数で指定してください。'; },
  'v.rangeOrder': '終了日は開始日以降にしてください。',
  'v.rangeMax': function (days) { return '一度に取得できる期間は' + days + '日までです。'; },
  'v.boolValue': function (l) { return '「' + l + '」の値が正しくありません。'; },

  'schedule.endBeforeStart': '終了日時は開始日時以降にしてください。',
  'project.duplicate': '同じ名前のプロジェクトがすでにあります。',
  'project.notFound': 'プロジェクトが見つかりません。',
  'project.selectedMissing': '選択したプロジェクトが見つかりません。',
  'project.inactive': '使用停止中のプロジェクトは選択できません。',
  'worklog.periodOrder': '終了日は開始日より後にしてください。1日だけ記録する場合は「1日の記録」タブを使ってください。',
  'worklog.periodMax': function (days) { return '期間の記録は最大' + days + '日までです。'; },
  'worklog.scheduleMissing': '関連付ける予定が見つかりません。',
  'calendar.untitled': '(タイトルなし)',
  'calendar.error': 'Googleカレンダーの予定を読み込めませんでした。',
  'search.rangeOrder': '検索終了日は検索開始日以降にしてください。',
  'diary.defaultTitle': function (y, m, d, wd) { return y + '年' + m + '月' + d + '日(' + wd + ')'; },
  'diary.exists': function (date) { return date + 'にはすでに日記があります。画面を再読み込みしてから、既存の日記を編集してください。'; },
  'diary.restoreBadDate': '日付が正しくない日記のため復元できません。シートで diary_date を修正してください。',
  'diary.restoreExists': function (title) { return title + 'にはすでに日記があります。その日記を先に削除してから復元してください。'; },
  'settings.conflict': '設定は別のタブまたは端末で変更されています。再読み込みしてからもう一度お試しください。',
  'settings.saveFailedRollback': '設定を保存できず、朝のメールの定期実行も元に戻せませんでした。設定画面で「再設定」を押してください。',
  'settings.saveFailed': '設定を保存できませんでした。しばらくしてからもう一度お試しください。',

  'time.allDay': '終日',
  'time.sep': '〜',
  'type.TASK': '作業',
  'type.MEETING': '会議',
  'mail.subject': function (app, md, wd, schedules, meetings, overdue, inProgress) {
    return '[' + app + '] ' + md + '(' + wd + ') 予定' + schedules + '件・会議' + meetings + '件'
      + (overdue ? '・期限切れ' + overdue + '件' : '')
      + (inProgress ? '・進行中' + inProgress + '件' : '');
  },
  'mail.heading': function (date, wd) { return date + '(' + wd + ') 今日のまとめ'; },
  'mail.today': '今日の予定',
  'mail.meetings': 'Googleカレンダーの会議',
  'mail.none': 'なし',
  'mail.sep': '・',
  'mail.metaOpen': '（',
  'mail.metaClose': '）',
  'mail.high': '[重要]',
  'mail.done': '[完了]',
  'mail.due': function (ymd) { return '期限 ' + ymd; },
  'mail.overdue': function (total, shown) { return '期限切れの未完了作業(' + total + '件' + (total > shown ? '、古い順に' + shown + '件を表示' : '') + ')'; },
  'mail.inProgress': function (total, shown) { return '進行中の作業(' + total + '件' + (total > shown ? '、古い順に' + shown + '件を表示' : '') + ')'; },
  'mail.openApp': function (url) { return 'アプリを開く: ' + url; },
  'mail.openAppLink': function (app) { return app + 'を開く →'; },
  'mail.fontFamily': "-apple-system,'Segoe UI','Hiragino Sans','Hiragino Kaku Gothic ProN','Yu Gothic UI','Meiryo',sans-serif",
  'mail.testPrefix': '[テスト] ',
  'mail.testLimit': function (n) { return 'テストメールは1日' + n + '回まで送信できます。'; },
  'mail.testFailed': function (msg) { return 'テストメールを送信できませんでした: ' + msg; },

  'setup.sheetCreated': function (name) { return '[OK] シート作成: ' + name; },
  'setup.headerMismatch': function (name, header) { return 'シート「' + name + '」の見出しが想定と異なります: ' + header; },
  'setup.columnsAdded': function (name, cols) { return '[OK] 列追加: ' + name + ' → ' + cols; },
  'setup.emptySheetRemoved': function (name) { return '[OK] 空の既定シートを削除: ' + name; },
  'setup.settingAdded': function (key, value) { return '[OK] 既定の設定を追加: ' + key + '=' + value; },
  'setup.triggers': function (h, bh) { return '[OK] トリガー設定: 朝のメール 毎日' + h + '〜' + (h + 1) + '時、バックアップ 毎週月曜' + bh + '〜' + (bh + 1) + '時'; },
  'setup.noOwnerEmail': '実行アカウントのメールアドレスを確認できません。',
  'setup.owner': function (masked) { return '[OK] 所有者: ' + masked; },
  'setup.cannotOpenDb': function (id, cause) { return '保存されたスプレッドシート(' + id + ')を開けません。削除した場合は、スクリプト プロパティ SPREADSHEET_ID を削除してから再実行してください。原因: ' + cause; },
  'setup.dbExisting': function (url) { return '[OK] 既存のスプレッドシートを使用: ' + url; },
  'setup.dbCreated': function (url) { return '[OK] スプレッドシート作成: ' + url; },
  'setup.holidayOk': '[OK] 日本の祝日カレンダーを確認しました',
  'setup.holidayWarn': '[WARN] 日本の祝日カレンダーを読み込めません。Googleカレンダーに「日本の祝日」カレンダーを追加すると、祝日にはメールを送りません。',
  'selftest.cellChanged': function (list) { return '[FAIL] セル保存の往復: 値が変わりました → ' + list; },
  'selftest.cellOk': function (n) { return '[OK] セル保存の往復(' + n + '個の値をそのまま保持)'; },
  'selftest.check.owner': '所有者の確認',
  'selftest.check.headers': 'シートの見出し',
  'selftest.check.cell': 'セル保存の往復',
  'selftest.check.calendar': '既定のカレンダーの取得',
  'selftest.check.holiday': '祝日カレンダー',
  'selftest.check.quota': 'メール送信枠',
  'selftest.check.backup': 'バックアップフォルダ',
  'selftest.check.triggers': 'トリガー',
  'selftest.sheetMissing': function (name) { return 'シート「' + name + '」なし'; },
  'selftest.headerMismatch': function (name, header) { return 'シート「' + name + '」の見出しが一致しません: ' + header + '(setup を再実行すると新しい列が追加されます)'; },
  'selftest.calendarOk': function (n) { return '[OK] 既定のカレンダーの取得(今日 ' + n + '件)'; },
  'selftest.holidayOk': '[OK] 日本の祝日カレンダーを登録済み',
  'selftest.holidayWarn': '[WARN] 日本の祝日カレンダーが未登録です(祝日にもメールが送信されます)',
  'selftest.quota': function (n) { return '[OK] 今日送信できる残りのメール数: ' + n; },
  'selftest.backupFolder': function (name) { return '[OK] バックアップフォルダ: ' + name; },
  'selftest.triggersMissing': function (list) { return 'なし → ' + list + '(setup の再実行が必要)'; },
  'selftest.triggersOk': function (list) { return '[OK] トリガー: ' + list; },
  'selftest.check.favicon': 'ファビコン',
  'favicon.created': function (name) { return '[OK] ファビコンのファイルを作成: ' + name; },
  'favicon.shared': '[OK] リンク共有: リンクを知っている全員 — 閲覧者(このファイルのみ)',
  'favicon.shareFailed': function (cause) { return '[WARN] リンク共有をオンにできませんでした(組織のアカウントの共有制限の可能性があります)。原因: ' + cause; },
  'favicon.keptPrevious': '[WARN] 新しいファイルは共有できなかったためゴミ箱に移動し、現在使っている以前のファイルをそのまま使います',
  'favicon.oldTrashed': '[OK] 以前のファビコンのファイルをゴミ箱に移動',
  'favicon.oldNotOurs': function (id) { return '[WARN] 以前に保存されていたファイル(' + id + ')はこのアプリが作ったロゴのファイルではないため、そのままにします'; },
  'favicon.oldTrashFailed': function (id) { return '[WARN] 以前のファビコンのファイル(' + id + ')をゴミ箱に移動できませんでした。ドライブで直接削除してください'; },
  'favicon.url': function (url) { return '[OK] タブアイコンのURL: ' + url; },
  'favicon.manualOverride': function (url) { return '[OK] スクリプト プロパティ FAVICON_URL があるため、そのURLを優先して使います: ' + url; },
  'favicon.done': 'ウェブアプリを再読み込みすると、タブアイコンが変わります(新しいデプロイは不要)。表示されない場合は、上のURLを添えてお知らせください。',
  'favicon.doneUnshared': 'リンク共有ができなかったため、タブアイコンが表示されない場合があります。ウェブアプリを再読み込みしてみて、表示されない場合はドライブの共有ポリシーを確認するか、スクリプト プロパティ FAVICON_URL に別の場所の画像URLを設定してください。',
  'favicon.check.ok': function (name) { return '[OK] ファビコン: ' + name + '(リンク共有)'; },
  'favicon.check.notShared': '[WARN] ファビコン: リンク共有がオフのため、タブアイコンが表示されない場合があります',
  'favicon.check.missing': '[WARN] ファビコンのファイルが見つかりません。setupFavicon をもう一度実行してください',
  'favicon.check.none': '[OK] ファビコン: 未設定(任意 — setupFavicon を実行するとタブアイコンが付きます)',
  'favicon.check.manual': '[OK] ファビコン: 指定したURL(FAVICON_URL)を使用',
  'favicon.check.manualBad': '[WARN] ファビコン: FAVICON_URL の値が正しくないため使いません(https で始まり .png または .ico で終わる、2000文字以内、空白・引用符なしのURL)',
};

// ===== 09_FaviconData.js =====
/**
 * 파비콘 PNG (192×192) — 자동 생성 파일: node scripts/make-icons.mjs. 직접 고치지 말고 assets/logo.svg를 수정하세요.
 * setupFavicon()이 이 이미지를 드라이브에 올려 브라우저 탭 아이콘으로 쓴다. 설계: docs/design/favicon.md
 */
const FAVICON_PNG_BASE64_ = [
  'iVBORw0KGgoAAAANSUhEUgAAAMAAAADACAYAAABS3GwHAAAACXBIWXMAAEJwAABCcAFu8l9tAAAMiUlEQVR42u1de3BU1R2+M22t',
  'fYzT6T9tLbsbmhAtHbGKTA3JiCh2UCQJj00YkEJ2QxhRTCvio53WjAUxjwEKdqRQW1vouwTCtNDaTpW+MCjlNW1JSLLhmWR3835n',
  's3t6fonG2EGz2b333HPO/b6Zb2LCrrvnnu+795zf+Z3fMQwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAF4Zld9mV3Rtlm9+yy',
  'aldG6VXX7NIh+km/uzNKN6VkbrkVbQe0w41ZFem8kw/yzmYTkQuj8vNfKZ2GtgNaYMqdZfNds8s64hHAmBAyyrq4GLLRdkBpuDPK',
  'F/C73/BkBDBG/j5PZvn9aDug7KOf38k6ExLA2JCgrIMzFW0HFLwDllUlI4BxQ4L9aDugVsQjo+I2MwQwytKYShESJ7cdePcOuNk8',
  'EYxER55D2wF1DECxbTNFkFF2DG0HlAGfvDWbKQJ+V72CtgMKDYESDP99QFgQbQdUGgIxs4m2AzAA2g5ABGg7ABGg7QBEgLYDEAHa',
  'DkAEaDsgCl52XcqyC6s8SwOveLwN1e7F55tcubX9nEOunJqYK/scs0IE9P9VgZa1na4tXWN+remae7z1b1AfpOQ3rqQ+gTAtxNQV',
  'F2elLG044F5S1+zKORezTQRONsAHM+ZeXNec4m2oTPVemAnFmoAp3ouf9ngbd7kXnW9VRARONsB7v8PiurA7r+ElT07gU1DyZO/2',
  '/vrP0J3ElVM7rLIInGyAse+SUxPlQ6XXU1dfdkHZE2Bm0ZWP8zH97+hxqpMInGyA8UMk3reHqI+h9Gvd9ZddfMS1iE9k9RaBkw0w',
  '+t1yawdT8hqfhOLfBo0RPUvrzzpJBE42wDvk0aNTaStqb3C0+L/grc/iE9xup4rAyQYYnSif73Xn193rSPHTYzCecCYMoH3bY1Pz',
  'AhucNezJu/ACFz9EgLaPcWpe43aH3Pkb9ooRQbnJIihXyABqtt2TF/ip3uL3Nm4RJoKs75krgqwd6hhA4bbz9Z9teoY5+TjP6mHP',
  'e0QwZ4+5Q4C79qhjAMXbzp8Ez2glfpe3/j4rJ7zX5LyD5opgXpUyBtCg7THP8ktztRA/xXop3CX8LvhAtbkieOC4Ok8ADdrOw+O9',
  'WqwTWLHIFTfn7jVHBHP3qXP316jttFimfnqDnSJYcIJP4LYlJ4DMbcz14An1DKBJ23ng5DE17/yrAtebmduT8KN0/tEkwoI8/Df/',
  'r+qJX6e2cw0pmUD3dlanHGLgHUl3s0mNezO38vcdVVb8OrXd4w0cVC6f3y066hPHkMB19974x70qDns0bTtpiTSl0oLXYWmHBQuq',
  'R8KEFNumBR53ZsXoQg/FuunvCkV7nNR22kugTHoz3zwd1VVEoE3kmqItsgqs+F74AToMtOQpkB94UXoDJLKBHQTjMsDiupDU4qdy',
  'GOgo0EpKXXKF6vagk0CLQ6K/lnf4Q0Wr0EmglQZYUndF2nKFLtli/6CG0aBzMSnLMFKtTnQQKIJTlzU+JF/8Pz/wE3QOKCRBLr/h',
  'ZRlzf6rROaCQFe0ldfKdW8yLoTahc0DHToRlSH0GHWKA3No+GQ0QQeeAQphbG5HPANkIgYKi0qNrojIaAJ0DiloLYDAA6GjCACAM',
  'AAOAMAAMAMIAMAAIA8AAIAxgF6b5QwwERREGAGEAGACEAWAAEAaAAUAYAAYAYQAYAIQBYAAQBoABQBgABgBhABgAhAFgABAGgAHA',
  'dznj4TB7+kfd7I8nBtml0DAbjrIR0n/T3+jf6DUwAAygFW8qDLGSfd2svTvGJgK9hl5L74EBYADledujYfba6UE2WdB76L0wAAyg',
  '7pBnXZi9WTvEEsXxmiF2iyRDIhgAnBS/WBRiR88MsmSx7y/9MAAMoN6Yv+rYADMDMT5tWLKpHQaAAdThj1/tY2biT/8ahAFgADVY',
  'sb+HmY2hCGN3rA/DADCA3Nz4w66RIYsV8G/rhAFgAHn58M7OkUUtq/Ddn/fAADCAnFxe2sH6B2PMSmyt7IUBYAD5+OCz7ayz11rx',
  '4wkAA0jJuU+1sWBHlImAbyvmADCARLzz660s0DwsRPyIAsEA0uX3nG2MMFHAOgAMIA2/tDbMjv13SJj4sRIMA0iV4nD4zQEmEsgF',
  'ggGk4c9e6xcq/pP1EWSDwgBycOehXqHipwk2TbSxHwAGsJ3f2dstVPzNbVE258lWhh1hMID9KQ4vWpvicK0tkfd/uw17gmEA+7my',
  'vIMNRmLCxN/H0ynyt3RgUzwMYD8XlohJcXgHEb6m5t/eyVAWBQawnfc+3cZCnVGhsf6neEkU1AWCAWxn5obWkTo9IvH8r3oYCmPB',
  'ALbzdp7i8J+LEaHi3/X7PlSGgwHsJy04JVPCJBEc+OcASy8MwQC6GYAmkLuP9LEzgcjYRJJ+0u/0d/p3mb7vzWtC7M8nB4WKnz6P',
  'Phe1QTUywLxn2tjrcdbCodfR6+3+znQH/s3fxKY40JPmFklrgMIASeyJ7emfXNiQXk8LTXZ+712H+4SK/9ylCJu5PsxQHVojAySz',
  'IZze98SeLlu+9/O/7BEqfoouUZQJ5dE1MsA9PGbe3ZfcghGZYOPLYk3w+O4uFhW3zsXauqPsq99qYzgfQDMDJFL52O4nAa24RgSG',
  '+mmot+i5doYDMjQzQDaP5pgJESbwbm5nfQPibv2US/S1ig6GE2I0NMCeI+ZPIK00AWVZxnNIhVmgIdZjL3UxHJGkqQFON1izamrF',
  'nCDriVZ2ORwVOund9IsehjPCNDZAh4XZkmY+CWYVh1ndVbH5PTuqerURPwzwPrR6o4gZJqBTWmhvrUjQ3uFpOCUSTwC7TTBySstZ',
  'sSkOVDVCpRQHGCAJnhJ0Z01kTkApDvv/LjbFgeoFUd2gaTgnGFEgu58EZp/SMhGoUpxMpzrCAAquA5hlAitOaVGphAkMoOBKsFkm',
  '+OYr3Zad0nItUHVoqhKt+34JGMDCXCCz5gRrd4gtYULtzi5p1178MIDNxwPF8yQQcUrLeNBn0Wc6ZcccDDABSYx2mUDUKS3jP5dM',
  '76QtozCAxCYQmd9D8wuaZzhtzzQMECeLd4k3gUhU/LbHceKHAWACJlOtfhhAgbIoupng0BsDIwdkwAAwgONM8I9/D7Hpa51dNwkG',
  'cKgJaM/DrevCjhY/DOBQEzghxQEGgAmYKqe0wADjkOYPDqp2Ee1YJ2AandJiG32hAfkM4Au2qngxZX8SyHxKi11M84VCMj4BGlW9',
  'oLKaQPZTWmw0QIOET4DQaZUvqmwmUOGUFhsNcFLCSXCwSvULK5MJVDilxTYD+IOVMg6BynS4uDKYQJVTWuybBAe3yGeAgqBflwts',
  'pwlUOqXFPgO0rJbOAOlrQrN0ush2hEhVO6XFLqauDt4unQEML/sQnwe063ShRT4JqFjWDKQ4xMFgO2nNkBF8bHZItwsuwgQ1l4fZ',
  'HeshfmUnwOMWw4p1vOhWmuBqa5TdtREpDpMoMPaItAa4yRe6kT+ihmEC5ohTWmwY/gx7VrV81pAZfBj0qq4dYKYJdDilxYYcoCOG',
  '7Ej1hVbq3AlmmGCIlzAt2Ir8nsmP/0PLpTeAZ1Xgej5RuaJzRyQTIqX3rfs+8nsSYNMU78WPGSqAP6o26t4hdJ5wQucQ74T4E5r8',
  '+oKPG6pgxkNNn6CUVd07RcWT6BUNfYanr2v5pKES+Bff4JQOWsjrce7mpdnPBCJjFeHoJ/1Of19YgsluctmfwWJDNcx5ln2YT1pO',
  'oQPBJEOfZ2cWsY8YKiK9oCWLNyCGTgQTFH+MJ1nOMVQGfwrsQEeCCXK7oTrS1td+lEeF3kJngpMc9x+f7mXXGTograglla8Qd6Bj',
  'wXgzPtMLm6YaOiHVH7qbN64fnQtOEPIcTPOH7zN0RGphKEfXZDnQlK2OUW4Ar6EzeCPXUEPR4eD/Z3qm+4OFhhOQ7gvlYjgEjq/0',
  'lloQzDOcBL6x4R5MjEGa8NL80HAiUnxtHm6CYxCBY+/8b1GE0HAyaJ1gdLEMK8ZOWuGlRS5t4vxmpU2oXl4RjKus4el0f0smFP++',
  'CXTBbzghldqJFZ0pq5P6GEqPaz9BsJib4TLEo/w4v4X/LElbEb4ByjYS2F7pC63gF/EPWEBTK6ZPG9hpDy/1IZRsAm4uCn5umj/8',
  'KH8qHOCRozaITLpV3DbqG6rbI33pEuXBS+NRfUg+TPLxu80LVC2MasbzO049nVSj4nFNSuTojFxbusZ0rYOVo9e+pWCkVqes5QoB',
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAATfA/JnEB2hmMvLsAAAAASUVORK5CYII=',
].join('');

// ===== 10_Util.js =====
/**
 * 공통 유틸: 에러, 날짜(JST 고정), 문자열.
 * 날짜는 모두 문자열로 다룬다. 일본은 서머타임이 없으므로 +09:00 고정 오프셋을 쓴다.
 */

/** 화면까지 전달해도 되는 업무 에러. code는 ERROR_CODES 중 하나. */
class AppError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AppError';
    this.code = code;
  }
}

function fail_(code, message) {
  throw new AppError(code, message);
}

/** 현재 시각. 테스트에서 교체할 수 있도록 함수로 둔다. */
function now_() {
  return new Date();
}

function todayYmd_() {
  return Utilities.formatDate(now_(), TZ, 'yyyy-MM-dd');
}

/** 이력·낙관적 잠금용 시각. 같은 초 안의 연속 수정도 구분되도록 밀리초까지 남긴다. */
function nowStamp_() {
  const d = now_();
  return Utilities.formatDate(d, TZ, "yyyy-MM-dd'T'HH:mm:ss") + '.' + String(d.getMilliseconds()).padStart(3, '0') + TZ_OFFSET;
}

function isDateObject_(v) {
  // 다른 realm(테스트 목 등)에서 만든 Date도 판별되도록 instanceof를 쓰지 않는다.
  return Object.prototype.toString.call(v) === '[object Date]';
}

const YMD_RE_ = /^(\d{4})-(\d{2})-(\d{2})$/;
const YMD_HM_RE_ = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

function isValidYmd_(s) {
  if (typeof s !== 'string') return false;
  const m = YMD_RE_.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 1900 || y > 2999) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

function isValidYmdHm_(s) {
  if (typeof s !== 'string') return false;
  const m = YMD_HM_RE_.exec(s);
  if (!m) return false;
  if (!isValidYmd_(s.slice(0, 10))) return false;
  const hh = Number(m[4]);
  const mm = Number(m[5]);
  return hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59;
}

function ymdToUtcDate_(ymd) {
  const m = YMD_RE_.exec(ymd);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function utcDateToYmd_(d) {
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const da = String(d.getUTCDate()).padStart(2, '0');
  return y + '-' + mo + '-' + da;
}

function addDaysYmd_(ymd, days) {
  const d = ymdToUtcDate_(ymd);
  d.setUTCDate(d.getUTCDate() + days);
  return utcDateToYmd_(d);
}

/** 0=일 … 6=토 */
function dayOfWeek_(ymd) {
  return ymdToUtcDate_(ymd).getUTCDay();
}

function daysBetween_(fromYmd, toYmd) {
  return Math.round((ymdToUtcDate_(toYmd).getTime() - ymdToUtcDate_(fromYmd).getTime()) / 86400000);
}

/** JST 기준 'YYYY-MM-DD' 또는 'YYYY-MM-DDTHH:mm'을 실제 시각(Date)으로 바꾼다. */
function jstToDate_(s) {
  const base = s.length === 10 ? s + 'T00:00' : s;
  return new Date(base + ':00' + TZ_OFFSET);
}

function formatYmdHm_(date) {
  return Utilities.formatDate(date, TZ, "yyyy-MM-dd'T'HH:mm");
}

function formatYmd_(date) {
  return Utilities.formatDate(date, TZ, 'yyyy-MM-dd');
}

function escapeHtml_(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 내림차순 비교 (코드 포인트 기준). 검색·다이어리·휴지통 정렬 공용 */
function compareDesc_(a, b) {
  return a < b ? 1 : a > b ? -1 : 0;
}

function uuid_() {
  return Utilities.getUuid();
}

function toBoolString_(b) {
  return b ? 'TRUE' : 'FALSE';
}

function isTrue_(s) {
  return String(s).toUpperCase() === 'TRUE';
}

/** 로그에 이메일을 그대로 남기지 않기 위한 마스킹 (a***@example.com). */
function maskEmail_(email) {
  const s = String(email || '');
  const at = s.indexOf('@');
  if (at <= 0) return s ? '***' : '(없음)';
  return s.charAt(0) + '***' + s.slice(at);
}

// ===== 20_Repository.js =====
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

// ===== 30_Validation.js =====
/**
 * 입력 검증. 화면에서 온 값은 모두 신뢰하지 않고 여기서 다시 확인한다.
 * 실패하면 VALIDATION 에러(화면에 그대로 보여줄 메시지, 요청 언어)를 던진다.
 * field 인자는 입력 칸 이름의 사전 키 (f.title → 'title'). 06_Messages.js
 */

const CONTROL_CHARS_RE_ = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const ID_RE_ = /^[A-Za-z0-9-]{1,64}$/;
const COLOR_RE_ = /^#[0-9a-fA-F]{6}$/;
const HTTP_URL_RE_ = /^https?:\/\/[^\s]+$/i;
const DEFAULT_PROJECT_COLOR = '#3b82f6';

/** 입력 칸 이름 (요청 언어) */
function fieldName_(field) {
  return t_('f.' + field);
}

function invalid_(message) {
  fail_(ERROR_CODES.VALIDATION, message);
}

function requireObject_(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid_(t_('v.badRequest'));
  return input;
}

/**
 * @param {*} v
 * @param {string} field 입력 칸 이름의 사전 키
 * @param {{required?: boolean, max: number, multiline?: boolean}} opts
 */
function vText_(v, field, opts) {
  if (v == null) v = '';
  if (typeof v !== 'string') invalid_(t_('v.badFormat', fieldName_(field)));
  let s = v.replace(CONTROL_CHARS_RE_, '');
  if (opts.multiline) {
    s = s.replace(/\r\n?/g, '\n').trim();
  } else {
    s = s.replace(/[\r\n\t]+/g, ' ').trim();
  }
  if (opts.required && !s) invalid_(t_('v.required', fieldName_(field)));
  if (s.length > opts.max) invalid_(t_('v.maxLength', fieldName_(field), opts.max));
  return s;
}

function vEnum_(v, field, allowed, defaultValue) {
  if (v == null || v === '') {
    if (defaultValue !== undefined) return defaultValue;
    invalid_(t_('v.select', fieldName_(field)));
  }
  if (typeof v !== 'string' || allowed.indexOf(v) < 0) invalid_(t_('v.invalid', fieldName_(field)));
  return v;
}

function vYmd_(v, field) {
  if (!isValidYmd_(v)) invalid_(t_('v.badDate', fieldName_(field)));
  return v;
}

function vYmdHm_(v, field) {
  if (!isValidYmdHm_(v)) invalid_(t_('v.badDateTime', fieldName_(field)));
  return v;
}

function vBool_(v) {
  return v === true || v === 'TRUE';
}

/** 비어 있으면 ''을 돌려준다. */
function vOptionalId_(v, field) {
  if (v == null || v === '') return '';
  if (typeof v !== 'string' || !ID_RE_.test(v)) invalid_(t_('v.invalid', fieldName_(field)));
  return v;
}

function vRequiredId_(v, field) {
  const id = vOptionalId_(v, field);
  if (!id) invalid_(t_('v.missing', fieldName_(field)));
  return id;
}

/** 수정·삭제 요청에는 화면이 읽었던 updatedAt이 반드시 있어야 한다(낙관적 잠금). */
function vUpdatedAt_(v) {
  if (typeof v !== 'string' || !v || v.length > 40) invalid_(t_('v.noUpdatedAt'));
  return v;
}

function vLocation_(v) {
  const s = vText_(v, 'location', { max: LIMITS.LOCATION });
  if (s.indexOf('://') >= 0 && !HTTP_URL_RE_.test(s)) invalid_(t_('v.linkScheme'));
  return s;
}

/** 배열 또는 쉼표 구분 문자열 → 중복 없는 태그 배열 */
function vTags_(v) {
  let list;
  if (v == null || v === '') list = [];
  else if (Array.isArray(v)) list = v;
  else if (typeof v === 'string') list = v.split(',');
  else invalid_(t_('v.tagFormat'));

  const seen = {};
  const tags = [];
  list.forEach(function (t) {
    if (typeof t !== 'string') invalid_(t_('v.tagFormat'));
    const tag = t.replace(CONTROL_CHARS_RE_, '').replace(/,/g, ' ').replace(/^#+/, '').trim();
    if (!tag) return;
    if (tag.length > LIMITS.TAG_LENGTH) invalid_(t_('v.tagLength', LIMITS.TAG_LENGTH));
    const key = tag.toLowerCase();
    if (seen[key]) return;
    seen[key] = true;
    tags.push(tag);
  });
  if (tags.length > LIMITS.TAG_COUNT) invalid_(t_('v.tagCount', LIMITS.TAG_COUNT));
  return tags;
}

function vColor_(v) {
  if (v == null || v === '') return DEFAULT_PROJECT_COLOR;
  if (typeof v !== 'string' || !COLOR_RE_.test(v)) invalid_(t_('v.color'));
  return v.toLowerCase();
}

function vInt_(v, field, min, max, defaultValue) {
  if (v == null || v === '') return defaultValue;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isInteger(n) || n < min || n > max) invalid_(t_('v.intRange', fieldName_(field), min, max));
  return n;
}

function vRange_(input) {
  const from = vYmd_(input.from, 'startDate');
  const to = vYmd_(input.to, 'endDate');
  if (to < from) invalid_(t_('v.rangeOrder'));
  if (daysBetween_(from, to) > LIMITS.RANGE_DAYS) invalid_(t_('v.rangeMax', LIMITS.RANGE_DAYS));
  return { from: from, to: to };
}

/** 설정 화면 (v1.12): 켜기/끄기는 true/false만 받는다 ('TRUE' 같은 문자열도 거절) */
function vStrictBool_(v, field) {
  if (typeof v !== 'boolean') invalid_(t_('v.boolValue', fieldName_(field)));
  return v;
}

/** 필수 정수: 숫자 자료형만 받는다 (true·'8'·[8] 같은 값이 숫자로 바뀌어 저장되지 않게) */
function vRequiredInt_(v, field, min, max) {
  if (v == null || v === '') invalid_(t_('v.required', fieldName_(field)));
  if (typeof v !== 'number') invalid_(t_('v.intRange', fieldName_(field), min, max));
  return vInt_(v, field, min, max);
}

// ===== 40_ProjectService.js =====
/**
 * 프로젝트(분류) 관리. 삭제 대신 사용 중지(active=FALSE)만 제공한다.
 * 이미 일정·작업기록에 연결된 프로젝트가 사라지는 것을 막기 위해서다.
 */

function toProjectDto_(r) {
  return {
    id: r.id,
    name: r.name,
    color: r.color || DEFAULT_PROJECT_COLOR,
    sortOrder: Number(r.sort_order) || 0,
    active: isTrue_(r.active),
    updatedAt: r.updated_at,
  };
}

function compareProjects_(a, b) {
  return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
}

function listProjects_() {
  return readAll_(SHEETS.PROJECTS).map(toProjectDto_).sort(compareProjects_);
}

function saveProject_(input) {
  requireObject_(input);
  const id = vOptionalId_(input.id, 'projectId');
  const name = vText_(input.name, 'projectName', { required: true, max: LIMITS.PROJECT_NAME });
  const color = vColor_(input.color);
  const sortOrder = vInt_(input.sortOrder, 'sortOrder', 0, LIMITS.SORT_ORDER_MAX, 0);
  const active = input.active === undefined ? true : vBool_(input.active);
  const expectedUpdatedAt = id ? vUpdatedAt_(input.updatedAt) : undefined;

  return withLock_(function () {
    const rows = readAll_(SHEETS.PROJECTS);
    const duplicate = rows.some(function (r) {
      return r.id !== id && String(r.name).toLowerCase() === name.toLowerCase();
    });
    if (duplicate) invalid_(t_('project.duplicate'));

    const stamp = nowStamp_();
    if (!id) {
      const created = {
        id: uuid_(), name: name, color: color, sort_order: String(sortOrder),
        active: toBoolString_(active), created_at: stamp, updated_at: stamp,
      };
      insertRow_(SHEETS.PROJECTS, created);
      return toProjectDto_(created);
    }

    const row = findById_(rows, id);
    if (!row) fail_(ERROR_CODES.NOT_FOUND, t_('project.notFound'));
    if (row.updated_at !== expectedUpdatedAt) {
      fail_(ERROR_CODES.CONFLICT, t_('err.conflictUpdate', t_('entity.project')));
    }
    const updated = Object.assign({}, row, {
      name: name, color: color, sort_order: String(sortOrder),
      active: toBoolString_(active), updated_at: stamp,
    });
    updateRow_(SHEETS.PROJECTS, row._row, updated);
    return toProjectDto_(updated);
  });
}

/**
 * 일정·작업기록에 지정할 프로젝트 확인.
 * 사용 중지된 프로젝트는 새로 지정할 수 없지만, 기존 값을 그대로 두는 수정은 허용한다.
 */
function assertProjectAssignable_(projectId, previousProjectId) {
  if (!projectId) return;
  const project = findById_(readAll_(SHEETS.PROJECTS), projectId);
  if (!project) invalid_(t_('project.selectedMissing'));
  if (!isTrue_(project.active) && projectId !== previousProjectId) invalid_(t_('project.inactive'));
}

// ===== 41_ScheduleService.js =====
/**
 * 일정(작업·회의) 관리.
 * 저장 형식: start_at / end_at = 'YYYY-MM-DDTHH:mm' (JST).
 * 종일 일정은 시각을 00:00으로 두고, end_at의 날짜는 "포함되는 마지막 날"이다.
 */

function normalizeDateTime_(s) {
  return s && s.length === 10 ? s + 'T00:00' : s;
}

function toScheduleDto_(r) {
  return {
    id: r.id,
    type: r.type || 'TASK',
    title: r.title,
    description: r.description,
    startAt: normalizeDateTime_(r.start_at),
    endAt: normalizeDateTime_(r.end_at),
    allDay: isTrue_(r.all_day),
    priority: r.priority || 'MEDIUM',
    projectId: r.project_id,
    location: r.location,
    status: r.status || 'PLANNED',
    tags: r.tags ? String(r.tags).split(',').filter(function (t) { return t; }) : [],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** 일정이 걸쳐 있는 날짜 범위(양끝 포함). 시각 일정이 다음날 00:00에 끝나면 전날까지로 본다. */
function scheduleDateSpan_(dto) {
  const startDate = String(dto.startAt || '').slice(0, 10);
  let endDate = String(dto.endAt || dto.startAt || '').slice(0, 10);
  if (!dto.allDay && /T00:00$/.test(dto.endAt || '') && endDate > startDate) {
    endDate = addDaysYmd_(endDate, -1);
  }
  if (endDate < startDate) endDate = startDate;
  return { start: startDate, end: endDate };
}

function overlapsRange_(span, from, to) {
  return span.start <= to && span.end >= from;
}

function listActiveSchedules_() {
  return readAll_(SHEETS.SCHEDULES)
    .filter(function (r) { return !isTrue_(r.deleted); })
    .map(toScheduleDto_);
}

function listSchedulesInRange_(from, to) {
  return listActiveSchedules_().filter(function (s) {
    return overlapsRange_(scheduleDateSpan_(s), from, to);
  });
}

function validateScheduleInput_(input) {
  requireObject_(input);
  const allDay = vBool_(input.allDay);
  let startAt;
  let endAt;
  if (allDay) {
    startAt = vYmd_(input.startAt, 'startDate') + 'T00:00';
    endAt = vYmd_(input.endAt || input.startAt, 'endDate') + 'T00:00';
  } else {
    startAt = vYmdHm_(input.startAt, 'startAt');
    endAt = vYmdHm_(input.endAt || input.startAt, 'endAt');
  }
  if (endAt < startAt) invalid_(t_('schedule.endBeforeStart'));

  return {
    id: vOptionalId_(input.id, 'scheduleId'),
    type: vEnum_(input.type, 'type', ENUMS.SCHEDULE_TYPE, 'TASK'),
    title: vText_(input.title, 'title', { required: true, max: LIMITS.TITLE }),
    description: vText_(input.description, 'description', { max: LIMITS.DESCRIPTION, multiline: true }),
    allDay: allDay,
    startAt: startAt,
    endAt: endAt,
    priority: vEnum_(input.priority, 'priority', ENUMS.PRIORITY, 'MEDIUM'),
    projectId: vOptionalId_(input.projectId, 'project'),
    location: vLocation_(input.location),
    status: vEnum_(input.status, 'status', ENUMS.STATUS, 'PLANNED'),
    tags: vTags_(input.tags),
  };
}

function scheduleDtoToRow_(v, base) {
  return Object.assign({}, base, {
    type: v.type,
    title: v.title,
    description: v.description,
    start_at: v.startAt,
    end_at: v.endAt,
    all_day: toBoolString_(v.allDay),
    priority: v.priority,
    project_id: v.projectId,
    location: v.location,
    status: v.status,
    tags: v.tags.join(','),
  });
}

function saveSchedule_(input) {
  const v = validateScheduleInput_(input);
  const expectedUpdatedAt = v.id ? vUpdatedAt_(input.updatedAt) : undefined;

  return withLock_(function () {
    const stamp = nowStamp_();
    if (!v.id) {
      assertProjectAssignable_(v.projectId, '');
      const created = scheduleDtoToRow_(v, { id: uuid_(), created_at: stamp, updated_at: stamp, deleted: 'FALSE' });
      insertRow_(SHEETS.SCHEDULES, created);
      return toScheduleDto_(created);
    }
    const row = findActiveForUpdate_(readAll_(SHEETS.SCHEDULES), v.id, expectedUpdatedAt, 'schedule');
    assertProjectAssignable_(v.projectId, row.project_id);
    const updated = scheduleDtoToRow_(v, Object.assign({}, row, { updated_at: stamp }));
    updateRow_(SHEETS.SCHEDULES, row._row, updated);
    return toScheduleDto_(updated);
  });
}

function deleteSchedule_(input) {
  requireObject_(input);
  const id = vRequiredId_(input.id, 'scheduleId');
  const expectedUpdatedAt = vUpdatedAt_(input.updatedAt);
  return withLock_(function () {
    const row = findActiveForUpdate_(readAll_(SHEETS.SCHEDULES), id, expectedUpdatedAt, 'schedule');
    return softDeleteRow_(SHEETS.SCHEDULES, row);
  });
}

/** 휴지통·되돌리기 (v1.11). updatedAt = 삭제 시각 */
function restoreSchedule_(input) {
  requireObject_(input);
  const id = vRequiredId_(input.id, 'scheduleId');
  const expectedUpdatedAt = vUpdatedAt_(input.updatedAt);
  return withLock_(function () {
    const row = findDeletedForRestore_(readAll_(SHEETS.SCHEDULES), id, expectedUpdatedAt, 'schedule');
    return toScheduleDto_(restoreRow_(SHEETS.SCHEDULES, row));
  });
}

function setScheduleStatus_(input) {
  requireObject_(input);
  const id = vRequiredId_(input.id, 'scheduleId');
  const status = vEnum_(input.status, 'status', ENUMS.STATUS);
  const expectedUpdatedAt = vUpdatedAt_(input.updatedAt);
  return withLock_(function () {
    const row = findActiveForUpdate_(readAll_(SHEETS.SCHEDULES), id, expectedUpdatedAt, 'schedule');
    const updated = Object.assign({}, row, { status: status, updated_at: nowStamp_() });
    updateRow_(SHEETS.SCHEDULES, row._row, updated);
    return toScheduleDto_(updated);
  });
}

// ===== 42_WorklogService.js =====
/**
 * 작업기록 관리. 하루 여러 건을 허용한다.
 * tags는 시트에 쉼표 구분 문자열로 저장하고, 화면에는 배열로 준다.
 * status: IN_PROGRESS(진행 중, 기본) / DONE(완료). v1.5 이전 행은 빈 값이라 진행 중으로 읽는다.
 * end_date(v1.6): 비어 있으면 하루 기록, 날짜면 기간 기록(work_date = 시작일).
 *   불변식: end_date는 '' 이거나 work_date보다 뒤이고, 기간(양끝 포함)은 LIMITS.WORKLOG_PERIOD_DAYS 이하.
 */

const WORKLOG_DEFAULT_STATUS_ = 'IN_PROGRESS';

/** 작업기록의 마지막 날 (하루 기록이면 작업일) */
function worklogEndOf_(w) {
  return w.endDate || w.workDate;
}

/**
 * 시트 값 → DTO의 endDate. 형식 오류, 시작일 이하, 최대 일수 초과이면 ''(하루 기록)로 읽는다.
 * 손으로 고친 시트나 롤백 중 수정된 행이 있어도 화면에는 항상 불변식을 지키는 값만 나간다.
 */
function normalizeWorklogEndDate_(workDate, endDate) {
  const v = endDate == null ? '' : String(endDate);
  if (!isValidYmd_(v) || !isValidYmd_(String(workDate)) || v <= workDate) return '';
  return daysBetween_(workDate, v) + 1 <= LIMITS.WORKLOG_PERIOD_DAYS ? v : '';
}

/**
 * 저장할 end_date를 정한다. 불변식은 여기서만 검사한다.
 * @param {string} workDate 저장할 작업일(기간 기록이면 시작일)
 * @param {?string} endDate 요청 값. null = 보내지 않음(새 기록은 하루, 수정은 기존 값 유지), '' = 하루 기록
 * @param {string} baseEndDate 수정 전 기록의 종료일 (normalizeWorklogEndDate_로 읽은 값, 새 기록이면 '')
 * @return {string} '' 또는 'YYYY-MM-DD'
 */
function resolveWorklogEndDate_(workDate, endDate, baseEndDate) {
  const end = endDate === null ? baseEndDate : endDate;
  if (end === '') return '';
  // 유지하는 종료일도 검사한다: 시작일만 옮겨서 종료일보다 뒤가 되면 조용히 하루 기록으로 바꾸지 않고 알린다
  if (end <= workDate) invalid_(t_('worklog.periodOrder'));
  if (daysBetween_(workDate, end) + 1 > LIMITS.WORKLOG_PERIOD_DAYS) {
    invalid_(t_('worklog.periodMax', LIMITS.WORKLOG_PERIOD_DAYS));
  }
  return end;
}

function toWorklogDto_(r) {
  return {
    id: r.id,
    workDate: r.work_date,
    endDate: normalizeWorklogEndDate_(r.work_date, r.end_date),
    title: r.title,
    content: r.content,
    projectId: r.project_id,
    scheduleId: r.schedule_id,
    tags: r.tags ? String(r.tags).split(',').filter(function (t) { return t; }) : [],
    status: ENUMS.WORKLOG_STATUS.indexOf(r.status) >= 0 ? r.status : WORKLOG_DEFAULT_STATUS_,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function listActiveWorklogs_() {
  return readAll_(SHEETS.WORKLOGS)
    .filter(function (r) { return !isTrue_(r.deleted); })
    .map(toWorklogDto_);
}

/** from~to와 하루라도 겹치는 작업기록 (기간 기록은 시작일이 범위 앞이어도 포함) */
function listWorklogsInRange_(from, to) {
  return listActiveWorklogs_().filter(function (w) {
    return overlapsRange_({ start: w.workDate, end: worklogEndOf_(w) }, from, to);
  });
}

function validateWorklogInput_(input) {
  requireObject_(input);
  return {
    id: vOptionalId_(input.id, 'worklogId'),
    workDate: vYmd_(input.workDate, 'workDate'),
    // null = 보내지 않음 (새 기록은 하루 기록, 수정은 기존 값 유지), '' = 하루 기록
    endDate: input.endDate == null ? null : input.endDate === '' ? '' : vYmd_(input.endDate, 'endDate'),
    title: vText_(input.title, 'heading', { required: true, max: LIMITS.TITLE }),
    content: vText_(input.content, 'description', { max: LIMITS.CONTENT, multiline: true }),
    projectId: vOptionalId_(input.projectId, 'project'),
    scheduleId: vOptionalId_(input.scheduleId, 'linkedSchedule'),
    tags: vTags_(input.tags),
    // 비어 있으면 null: 새 기록은 진행 중, 수정은 기존 상태 유지
    status: input.status == null || input.status === '' ? null : vEnum_(input.status, 'status', ENUMS.WORKLOG_STATUS),
    completeSchedule: vBool_(input.completeSchedule),
  };
}

/** @param endDate resolveWorklogEndDate_로 확정한 값 */
function worklogDtoToRow_(v, base, endDate) {
  return Object.assign({}, base, {
    work_date: v.workDate,
    end_date: endDate,
    title: v.title,
    content: v.content,
    project_id: v.projectId,
    schedule_id: v.scheduleId,
    tags: v.tags.join(','),
    status: v.status || (base && ENUMS.WORKLOG_STATUS.indexOf(base.status) >= 0 ? base.status : WORKLOG_DEFAULT_STATUS_),
  });
}

/**
 * 연결 일정 확인. 새로 연결하는 일정은 삭제되지 않은 것이어야 한다.
 * 이미 연결돼 있던 일정이 나중에 삭제된 경우, 연결을 그대로 두는 수정은 허용한다.
 * @return 연결 일정 행(없으면 null)
 */
function resolveLinkedSchedule_(scheduleId, previousScheduleId) {
  if (!scheduleId) return null;
  const row = findById_(readAll_(SHEETS.SCHEDULES), scheduleId);
  const alive = row && !isTrue_(row.deleted);
  if (!alive && scheduleId !== previousScheduleId) invalid_(t_('worklog.scheduleMissing'));
  return alive ? row : null;
}

function saveWorklog_(input) {
  const v = validateWorklogInput_(input);
  const expectedUpdatedAt = v.id ? vUpdatedAt_(input.updatedAt) : undefined;

  return withLock_(function () {
    const stamp = nowStamp_();
    let saved;
    let previousScheduleId = '';

    if (!v.id) {
      assertProjectAssignable_(v.projectId, '');
      const endDate = resolveWorklogEndDate_(v.workDate, v.endDate, '');
      saved = worklogDtoToRow_(v, { id: uuid_(), created_at: stamp, updated_at: stamp, deleted: 'FALSE' }, endDate);
    } else {
      const row = findActiveForUpdate_(readAll_(SHEETS.WORKLOGS), v.id, expectedUpdatedAt, 'worklog');
      assertProjectAssignable_(v.projectId, row.project_id);
      previousScheduleId = row.schedule_id;
      const endDate = resolveWorklogEndDate_(v.workDate, v.endDate, normalizeWorklogEndDate_(row.work_date, row.end_date));
      saved = worklogDtoToRow_(v, Object.assign({}, row, { updated_at: stamp }), endDate);
    }
    // 검증을 모두 마친 뒤에 쓴다 (중간 실패로 절반만 저장되는 것 방지)
    const linked = resolveLinkedSchedule_(v.scheduleId, previousScheduleId);

    if (v.id) updateRow_(SHEETS.WORKLOGS, saved._row, saved);
    else insertRow_(SHEETS.WORKLOGS, saved);

    let completedSchedule = null;
    if (v.completeSchedule && linked && linked.status !== 'DONE') {
      const done = Object.assign({}, linked, { status: 'DONE', updated_at: stamp });
      updateRow_(SHEETS.SCHEDULES, linked._row, done);
      completedSchedule = toScheduleDto_(done);
    }
    return { worklog: toWorklogDto_(saved), completedSchedule: completedSchedule };
  });
}

/** 패널의 완료 버튼용: 상태만 바꾼다 (낙관적 잠금 적용) */
function setWorklogStatus_(input) {
  requireObject_(input);
  const id = vRequiredId_(input.id, 'worklogId');
  const status = vEnum_(input.status, 'status', ENUMS.WORKLOG_STATUS);
  const expectedUpdatedAt = vUpdatedAt_(input.updatedAt);
  return withLock_(function () {
    const row = findActiveForUpdate_(readAll_(SHEETS.WORKLOGS), id, expectedUpdatedAt, 'worklog');
    const updated = Object.assign({}, row, { status: status, updated_at: nowStamp_() });
    updateRow_(SHEETS.WORKLOGS, row._row, updated);
    return toWorklogDto_(updated);
  });
}

function deleteWorklog_(input) {
  requireObject_(input);
  const id = vRequiredId_(input.id, 'worklogId');
  const expectedUpdatedAt = vUpdatedAt_(input.updatedAt);
  return withLock_(function () {
    const row = findActiveForUpdate_(readAll_(SHEETS.WORKLOGS), id, expectedUpdatedAt, 'worklog');
    return softDeleteRow_(SHEETS.WORKLOGS, row);
  });
}

/**
 * 휴지통·되돌리기 (v1.11). updatedAt = 삭제 시각.
 * 연결 일정이 그 사이 지워졌어도 연결은 그대로 둔다 (resolveLinkedSchedule_의 '이미 연결돼 있던 일정' 규칙과 같음).
 */
function restoreWorklog_(input) {
  requireObject_(input);
  const id = vRequiredId_(input.id, 'worklogId');
  const expectedUpdatedAt = vUpdatedAt_(input.updatedAt);
  return withLock_(function () {
    const row = findDeletedForRestore_(readAll_(SHEETS.WORKLOGS), id, expectedUpdatedAt, 'worklog');
    return toWorklogDto_(restoreRow_(SHEETS.WORKLOGS, row));
  });
}

// ===== 43_CalendarService.js =====
/**
 * 구글 캘린더 읽기 전용 연동.
 * - 기본 캘린더: 회의 일정 표시용. 내가 '거절'한 일정은 뺀다.
 * - 일본 공휴일 캘린더: 본인 캘린더에 구독돼 있어야 getCalendarById가 값을 돌려준다.
 * 캘린더 조회가 실패해도 앱 전체가 멈추지 않도록 에러를 결과에 담아 돌려준다.
 */

function calendarEventToDto_(ev) {
  const allDay = ev.isAllDayEvent();
  let startAt;
  let endAt;
  if (allDay) {
    // getAllDayEndDate()는 종료 다음날(미포함)을 돌려주므로 하루 뺀다.
    const startYmd = formatYmd_(ev.getAllDayStartDate());
    let endYmd = addDaysYmd_(formatYmd_(ev.getAllDayEndDate()), -1);
    if (endYmd < startYmd) endYmd = startYmd;
    startAt = startYmd + 'T00:00';
    endAt = endYmd + 'T00:00';
  } else {
    startAt = formatYmdHm_(ev.getStartTime());
    endAt = formatYmdHm_(ev.getEndTime());
  }
  return {
    // 반복 일정은 모든 회차가 같은 ID를 쓰므로 시작 시각을 붙여 구분한다.
    id: ev.getId() + '@' + startAt,
    title: ev.getTitle() || t_('calendar.untitled'),
    startAt: startAt,
    endAt: endAt,
    allDay: allDay,
    location: ev.getLocation() || '',
  };
}

function isDeclined_(ev) {
  try {
    return ev.getMyStatus() === CalendarApp.GuestStatus.NO;
  } catch (e) {
    return false;
  }
}

/** @return {{events: Array, error: string|null}} */
function getCalendarEvents_(from, to) {
  try {
    const cal = CalendarApp.getDefaultCalendar();
    const events = cal.getEvents(jstToDate_(from), jstToDate_(addDaysYmd_(to, 1)));
    const list = [];
    for (let i = 0; i < events.length; i++) {
      if (isDeclined_(events[i])) continue;
      list.push(calendarEventToDto_(events[i]));
    }
    return { events: list, error: null };
  } catch (e) {
    console.error(JSON.stringify({ where: 'getCalendarEvents_', message: e && e.message }));
    return { events: [], error: t_('calendar.error') };
  }
}

/** @return {{available: boolean, holidays: Array<{date: string, name: string}>}} */
function getHolidays_(from, to) {
  try {
    const cal = CalendarApp.getCalendarById(HOLIDAY_CALENDAR_ID);
    if (!cal) return { available: false, holidays: [] };

    const events = cal.getEvents(jstToDate_(from), jstToDate_(addDaysYmd_(to, 1)));
    const holidays = [];
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (String(ev.getDescription() || '').indexOf(NON_HOLIDAY_MARKER) >= 0) continue;
      const date = ev.isAllDayEvent() ? formatYmd_(ev.getAllDayStartDate()) : formatYmd_(ev.getStartTime());
      if (date < from || date > to) continue;
      holidays.push({ date: date, name: ev.getTitle() });
    }
    return { available: true, holidays: holidays };
  } catch (e) {
    console.warn(JSON.stringify({ where: 'getHolidays_', message: e && e.message }));
    return { available: false, holidays: [] };
  }
}

/** @return {string|null} 공휴일 이름. 공휴일이 아니거나 판정할 수 없으면 null */
function holidayNameOf_(ymd) {
  const result = getHolidays_(ymd, ymd);
  const hit = result.holidays.filter(function (h) { return h.date === ymd; })[0];
  return hit ? hit.name : null;
}

// ===== 44_SearchService.js =====
/**
 * 키워드 검색. 대소문자를 구분하지 않고 부분 일치로 찾는다.
 * - 작업기록: 타이틀·내용·태그 (기간 기록은 기간이 검색 기간과 겹치면 포함)
 * - 일정: 제목·내용·장소·태그 (여러 날 일정은 기간이 검색 기간과 겹치면 포함)
 * 결과는 최신 날짜순, 종류별 최대 LIMITS.SEARCH_RESULTS건.
 */

function validateSearchInput_(input) {
  requireObject_(input);
  const keyword = vText_(input.keyword, 'keyword', { required: true, max: LIMITS.KEYWORD });
  const from = input.from ? vYmd_(input.from, 'searchFrom') : '';
  const to = input.to ? vYmd_(input.to, 'searchTo') : '';
  if (from && to && to < from) invalid_(t_('search.rangeOrder'));
  return { keyword: keyword, from: from, to: to, projectId: vOptionalId_(input.projectId, 'project') };
}

function includesKeyword_(fields, keyword) {
  for (let i = 0; i < fields.length; i++) {
    if (String(fields[i] || '').toLowerCase().indexOf(keyword) >= 0) return true;
  }
  return false;
}

/** start~end 기간이 검색 기간(from~to, 빈 값은 제한 없음)과 하루라도 겹치는지 */
function overlapsDateRange_(start, end, from, to) {
  return (!from || end >= from) && (!to || start <= to);
}

function limitResults_(list) {
  return { items: list.slice(0, LIMITS.SEARCH_RESULTS), truncated: list.length > LIMITS.SEARCH_RESULTS };
}

function search_(input) {
  const q = validateSearchInput_(input);
  const keyword = q.keyword.toLowerCase();

  const worklogs = listActiveWorklogs_()
    .filter(function (w) {
      return overlapsDateRange_(w.workDate, worklogEndOf_(w), q.from, q.to)
        && (!q.projectId || w.projectId === q.projectId)
        && includesKeyword_([w.title, w.content, w.tags.join(' ')], keyword);
    })
    .sort(function (a, b) {
      return compareDesc_(a.workDate, b.workDate) || compareDesc_(a.createdAt, b.createdAt);
    });

  const schedules = listActiveSchedules_()
    .filter(function (s) {
      // 여러 날 일정은 검색 기간과 하루라도 겹치면 포함 (기간 작업기록과 같은 기준)
      const span = scheduleDateSpan_(s);
      return overlapsDateRange_(span.start, span.end, q.from, q.to)
        && (!q.projectId || s.projectId === q.projectId)
        && includesKeyword_([s.title, s.description, s.location, s.tags.join(' ')], keyword);
    })
    .sort(function (a, b) { return compareDesc_(a.startAt, b.startAt); });

  const w = limitResults_(worklogs);
  const s = limitResults_(schedules);
  return {
    worklogs: w.items,
    schedules: s.items,
    truncated: w.truncated || s.truncated,
  };
}

// ===== 45_DiaryService.js =====
/**
 * 다이어리 관리 (v1.7). 설계: docs/design/diary.md
 * 불변식
 *  1. 삭제되지 않은 다이어리는 날짜당 최대 1편 — 잠금 안에서 시트를 다시 읽어 검사한다.
 *  2. 타이틀은 비어 있지 않다 — 비어 있으면 'YYYY년 M월 D일 (요일)'로 채운다 (읽을 때도 같은 규칙).
 *  3. 내용은 비어 있지 않다.
 *  4. diaries 시트가 아직 없어도(업데이트 후 setup 전) 읽기는 빈 목록을 돌려준다. 저장은 NOT_INITIALIZED.
 */

/** '2026-09-25' → '2026년 9월 25일 (금)' */
function diaryDefaultTitle_(ymd) {
  const p = String(ymd).split('-');
  return t_('diary.defaultTitle', p[0], Number(p[1]), Number(p[2]), weekdayName_(ymd));
}

function toDiaryDto_(r) {
  return {
    id: r.id,
    diaryDate: r.diary_date,
    title: r.title || diaryDefaultTitle_(r.diary_date),
    content: r.content,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** setup 전(시트 없음)이면 false */
function diarySheetExists_() {
  return getSpreadsheet_().getSheetByName(SHEETS.DIARIES.name) !== null;
}

/** 삭제되지 않은 다이어리. 시트가 없으면 빈 목록 (불변식 4) */
function listActiveDiaries_() {
  if (!diarySheetExists_()) return [];
  return readAll_(SHEETS.DIARIES)
    .filter(function (r) { return !isTrue_(r.deleted) && isValidYmd_(r.diary_date); })
    .map(toDiaryDto_);
}

/** from~to(양끝 포함) 날짜의 다이어리, 날짜순 */
function listDiariesInRange_(from, to) {
  return listActiveDiaries_()
    .filter(function (d) { return d.diaryDate >= from && d.diaryDate <= to; })
    .sort(function (a, b) { return a.diaryDate < b.diaryDate ? -1 : a.diaryDate > b.diaryDate ? 1 : 0; });
}

function getDiaries_(input) {
  const r = vRange_(requireObject_(input));
  return listDiariesInRange_(r.from, r.to);
}

function validateDiaryInput_(input) {
  requireObject_(input);
  return {
    id: vOptionalId_(input.id, 'diaryId'),
    diaryDate: vYmd_(input.diaryDate, 'date'),
    // 비어 있으면 저장할 때 날짜 문구로 채운다
    title: vText_(input.title, 'heading', { max: LIMITS.TITLE }),
    content: vText_(input.content, 'description', { required: true, max: LIMITS.CONTENT, multiline: true }),
  };
}

/**
 * 불변식 1: 같은 날짜에 다른 다이어리가 있으면 CONFLICT
 * @param {string=} message 오류 문구 (생략하면 저장용 문구)
 */
function assertDiaryDateFree_(rows, diaryDate, selfId, message) {
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!isTrue_(r.deleted) && r.diary_date === diaryDate && r.id !== selfId) {
      fail_(ERROR_CODES.CONFLICT, message || t_('diary.exists', diaryDate));
    }
  }
}

function saveDiary_(input) {
  const v = validateDiaryInput_(input);
  const expectedUpdatedAt = v.id ? vUpdatedAt_(input.updatedAt) : undefined;

  return withLock_(function () {
    const rows = readAll_(SHEETS.DIARIES); // 시트가 없으면 NOT_INITIALIZED (setup 안내)
    const stamp = nowStamp_();
    const base = v.id ? findActiveForUpdate_(rows, v.id, expectedUpdatedAt, 'diary') : null;
    assertDiaryDateFree_(rows, v.diaryDate, v.id);

    // 검증을 모두 마친 뒤에 쓴다
    const saved = Object.assign({}, base || { id: uuid_(), created_at: stamp, deleted: 'FALSE' }, {
      diary_date: v.diaryDate,
      title: v.title || diaryDefaultTitle_(v.diaryDate),
      content: v.content,
      updated_at: stamp,
    });
    if (base) updateRow_(SHEETS.DIARIES, base._row, saved);
    else insertRow_(SHEETS.DIARIES, saved);
    return toDiaryDto_(saved);
  });
}

function deleteDiary_(input) {
  requireObject_(input);
  const id = vRequiredId_(input.id, 'diaryId');
  const expectedUpdatedAt = vUpdatedAt_(input.updatedAt);
  return withLock_(function () {
    const row = findActiveForUpdate_(readAll_(SHEETS.DIARIES), id, expectedUpdatedAt, 'diary');
    return softDeleteRow_(SHEETS.DIARIES, row);
  });
}

/**
 * 휴지통·되돌리기 (v1.11). updatedAt = 삭제 시각.
 * 불변식 1: 그 날짜에 이미 다른 다이어리가 있으면 CONFLICT — 잠금 안에서 다시 읽어 검사한다.
 */
function restoreDiary_(input) {
  requireObject_(input);
  const id = vRequiredId_(input.id, 'diaryId');
  const expectedUpdatedAt = vUpdatedAt_(input.updatedAt);
  return withLock_(function () {
    const rows = readAll_(SHEETS.DIARIES); // 시트가 없으면 NOT_INITIALIZED (setup 안내)
    const row = findDeletedForRestore_(rows, id, expectedUpdatedAt, 'diary');
    if (!isValidYmd_(row.diary_date)) {
      invalid_(t_('diary.restoreBadDate'));
    }
    assertDiaryDateFree_(rows, row.diary_date, row.id,
      t_('diary.restoreExists', diaryDefaultTitle_(row.diary_date)));
    return toDiaryDto_(restoreRow_(SHEETS.DIARIES, row));
  });
}

/** 타이틀·내용에서 대소문자 무시 부분 일치. 최신 날짜순, 최대 LIMITS.SEARCH_RESULTS건 */
function searchDiaries_(input) {
  requireObject_(input);
  const keyword = vText_(input.keyword, 'keyword', { required: true, max: LIMITS.KEYWORD }).toLowerCase();
  const hits = listActiveDiaries_()
    .filter(function (d) { return includesKeyword_([d.title, d.content], keyword); })
    .sort(function (a, b) { return compareDesc_(a.diaryDate, b.diaryDate); });
  const r = limitResults_(hits);
  return { diaries: r.items, truncated: r.truncated };
}

// ===== 46_TrashService.js =====
/**
 * 휴지통 (v1.11). 설계: docs/design/trash-restore.md
 * - 일정·작업기록·다이어리는 지워도 행이 남고(deleted = TRUE), 지울 때 updated_at이 삭제 시각이 된다.
 * - 목록은 최근 LIMITS.TRASH_DAYS일(오늘 포함) 안에 지운 것, 최근 삭제 순, 최대 LIMITS.TRASH_ITEMS건.
 * - 삭제 시각이나 날짜를 알 수 없는 행(시트를 손으로 고친 경우)은 넣지 않는다 — 화면에 날짜를 보여 주고 그 날짜로 이동하기 때문.
 * - 목록 응답은 가볍게 하려고 본문(일정 description, 작업기록·다이어리 content)을 비워서 보낸다. 복구 응답은 전체 DTO.
 * - 복구는 각 서비스의 restoreXxx_가 맡는다.
 */

const TRASH_STAMP_RE_ = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** updated_at → 지운 날짜('YYYY-MM-DD'). 시각 형식이 아니면 '' */
function trashDeletedDate_(stamp) {
  const s = String(stamp == null ? '' : stamp);
  if (!TRASH_STAMP_RE_.test(s)) return '';
  const ymd = s.slice(0, 10);
  return isValidYmd_(ymd) ? ymd : '';
}

/** from(포함) 이후에 지웠고, 항목 날짜(dateOf)가 올바른 행 */
function deletedRowsSince_(def, from, dateOf) {
  return readAll_(def).filter(function (r) {
    if (!isTrue_(r.deleted) || !isValidYmd_(String(dateOf(r)))) return false;
    const d = trashDeletedDate_(r.updated_at);
    return d !== '' && d >= from;
  });
}

function listTrash_() {
  const from = addDaysYmd_(todayYmd_(), -(LIMITS.TRASH_DAYS - 1));
  const items = [];
  deletedRowsSince_(SHEETS.SCHEDULES, from, function (r) { return String(r.start_at).slice(0, 10); }).forEach(function (r) {
    items.push({ kind: 'SCHEDULE', at: r.updated_at, dto: Object.assign(toScheduleDto_(r), { description: '' }) });
  });
  deletedRowsSince_(SHEETS.WORKLOGS, from, function (r) { return r.work_date; }).forEach(function (r) {
    items.push({ kind: 'WORKLOG', at: r.updated_at, dto: Object.assign(toWorklogDto_(r), { content: '' }) });
  });
  // 다이어리 시트는 setup 전이면 없다
  if (diarySheetExists_()) {
    deletedRowsSince_(SHEETS.DIARIES, from, function (r) { return r.diary_date; }).forEach(function (r) {
      items.push({ kind: 'DIARY', at: r.updated_at, dto: Object.assign(toDiaryDto_(r), { content: '' }) });
    });
  }
  // 최근 삭제 순 (종류를 섞어서 정렬한 뒤 자른다)
  items.sort(function (a, b) { return compareDesc_(a.at, b.at); });
  const kept = items.slice(0, LIMITS.TRASH_ITEMS);
  const pick = function (kind) {
    return kept.filter(function (i) { return i.kind === kind; }).map(function (i) { return i.dto; });
  };
  return {
    days: LIMITS.TRASH_DAYS,
    schedules: pick('SCHEDULE'),
    worklogs: pick('WORKLOG'),
    diaries: pick('DIARY'),
    total: items.length,
    truncated: items.length > kept.length,
  };
}

// ===== 47_SettingsService.js =====
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

// ===== 50_NotifyService.js =====
/**
 * 아침 요약 메일과 접속 팝업용 "오늘 요약".
 * 트리거는 매일 설정한 시각(기본 07~08시, 설정 화면에서 05~10시)에 실행되고, 주말·공휴일·중복 발송은 여기서 걸러낸다.
 * 문구 언어 (v1.13): 팝업은 요청 언어, 메일은 mailLang_() (지정 언어 → 마지막 화면 언어 → 계정 언어 → 일본어)
 */

const PRIORITY_RANK_ = { HIGH: 0, MEDIUM: 1, LOW: 2 };

function compareForDay_(a, b) {
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
  if (a.startAt !== b.startAt) return a.startAt < b.startAt ? -1 : 1;
  return (PRIORITY_RANK_[a.priority] ?? 1) - (PRIORITY_RANK_[b.priority] ?? 1); // HIGH=0이므로 || 쓰면 안 됨
}

function timeLabel_(item) {
  const sep = t_('time.sep');
  if (item.allDay) {
    const s = item.startAt.slice(0, 10);
    const e = item.endAt.slice(0, 10);
    return s === e ? t_('time.allDay') : t_('time.allDay') + ' ' + s.slice(5).replace('-', '/') + sep + e.slice(5).replace('-', '/');
  }
  const sd = item.startAt.slice(0, 10);
  const ed = item.endAt.slice(0, 10);
  if (sd === ed) return item.startAt.slice(11) + sep + item.endAt.slice(11);
  return sd.slice(5).replace('-', '/') + ' ' + item.startAt.slice(11) + sep + ed.slice(5).replace('-', '/') + ' ' + item.endAt.slice(11);
}

/** '2026-09-24' → '9/24' (날짜 형식이 아니면 그대로: 손으로 고친 시트 대비) */
function shortMd_(ymd) {
  const s = String(ymd);
  return isValidYmd_(s) ? Number(s.slice(5, 7)) + '/' + Number(s.slice(8, 10)) : s;
}

/** 작업기록 날짜 문구: 하루 기록 '9/24', 기간 기록 '9/21~9/25' (일본어 '9/21〜9/25') */
function worklogDateLabel_(w) {
  return w.endDate ? shortMd_(w.workDate) + t_('time.sep') + shortMd_(w.endDate) : shortMd_(w.workDate);
}

/** 진행 중 작업기록 전부 (날짜 무관), 작업일(기간 기록은 시작일)이 오래된 순, 같으면 만든 순 */
function listInProgressWorklogs_() {
  return listActiveWorklogs_()
    .filter(function (w) { return w.status === 'IN_PROGRESS'; })
    .sort(function (a, b) {
      if (a.workDate !== b.workDate) return a.workDate < b.workDate ? -1 : 1;
      return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
    });
}

/** 오늘 요약 데이터. 팝업과 메일이 같이 쓴다. */
function buildDigest_(today) {
  const projects = {};
  listProjects_().forEach(function (p) { projects[p.id] = p.name; });
  const withProject = function (s) {
    return Object.assign({}, s, { projectName: s.projectId ? (projects[s.projectId] || '') : '', timeLabel: timeLabel_(s) });
  };

  const schedules = listActiveSchedules_();
  const todays = schedules
    .filter(function (s) { return s.status !== 'CANCELLED' && overlapsRange_(scheduleDateSpan_(s), today, today); })
    .sort(compareForDay_)
    .map(withProject);

  const overdueAll = schedules
    .filter(function (s) { return s.type === 'TASK' && s.status === 'PLANNED' && scheduleDateSpan_(s).end < today; })
    .sort(function (a, b) { return a.endAt < b.endAt ? -1 : a.endAt > b.endAt ? 1 : 0; });

  const inProgressAll = listInProgressWorklogs_();

  const cal = getCalendarEvents_(today, today);
  const meetings = cal.events.sort(compareForDay_).map(function (m) {
    return Object.assign({}, m, { timeLabel: timeLabel_(m) });
  });

  return {
    date: today,
    weekday: weekdayName_(today),
    schedules: todays,
    meetings: meetings,
    calendarError: cal.error,
    overdue: overdueAll.slice(0, LIMITS.OVERDUE_IN_DIGEST).map(withProject),
    overdueTotal: overdueAll.length,
    // v1.10: 진행 중 작업기록 (오래된 순 최대 LIMITS.IN_PROGRESS_IN_DIGEST건)
    inProgress: inProgressAll.slice(0, LIMITS.IN_PROGRESS_IN_DIGEST).map(function (w) {
      return Object.assign({}, w, { projectName: w.projectId ? (projects[w.projectId] || '') : '', dateLabel: worklogDateLabel_(w) });
    }),
    inProgressTotal: inProgressAll.length,
  };
}

/** 보낼 내용이 없는지. 일정이 없어도 진행 중 작업이 있으면 비어 있지 않다 */
function isDigestEmpty_(d) {
  return d.schedules.length === 0 && d.meetings.length === 0 && d.overdueTotal === 0 && d.inProgressTotal === 0;
}

function getWebAppUrl_() {
  try {
    return ScriptApp.getService().getUrl() || '';
  } catch (e) {
    return '';
  }
}

/** 메일 제목·본문. 지금 언어(lang_())로 만든다 — 부르는 쪽이 withLang_으로 메일 언어를 정한다 */
function composeDigestMail_(d) {
  const lang = lang_();
  const md = shortMd_(d.date); // '9/5' (앞의 0 없이)
  const sep = t_('mail.sep');
  // '제목 (메타)' — 괄호 모양은 언어별 (한국어 ' (…)', 일본어 '（…）')
  const open = t_('mail.metaOpen');
  const close = t_('mail.metaClose');
  const withMeta = function (text, meta) { return text + open + meta + close; };
  const subject = t_('mail.subject', appName_(lang), md, d.weekday, d.schedules.length, d.meetings.length, d.overdueTotal, d.inProgressTotal);

  const text = [];
  const html = [];
  const section = function (title, items, render) {
    text.push('■ ' + title);
    html.push('<h3 style="margin:18px 0 6px;font-size:15px;color:#111827">' + escapeHtml_(title) + '</h3>');
    if (!items.length) {
      text.push('  - ' + t_('mail.none'));
      html.push('<p style="margin:0;color:#6b7280;font-size:13px">' + escapeHtml_(t_('mail.none')) + '</p>');
    } else {
      html.push('<ul style="margin:0;padding-left:18px;font-size:14px;line-height:1.7">');
      items.forEach(function (it) {
        const r = render(it);
        text.push('  - ' + r.text);
        html.push('<li>' + r.html + '</li>');
      });
      html.push('</ul>');
    }
    text.push('');
  };

  /** 메일 HTML: 메타 부분(괄호 포함)만 회색 */
  const metaHtml = function (title, meta) {
    return escapeHtml_(title) + '<span style="color:#6b7280">' + escapeHtml_(open + meta + close) + '</span>';
  };

  const renderSchedule = function (s) {
    const high = t_('mail.high');
    const done = t_('mail.done');
    const flags = (s.priority === 'HIGH' ? high + ' ' : '') + (s.status === 'DONE' ? done + ' ' : '');
    const meta = [s.timeLabel, t_(s.type === 'MEETING' ? 'type.MEETING' : 'type.TASK'), s.projectName].filter(function (x) { return x; }).join(sep);
    return {
      text: withMeta(flags + s.title, meta),
      html: (s.priority === 'HIGH' ? '<b style="color:#dc2626">' + escapeHtml_(high) + '</b> ' : '')
        + (s.status === 'DONE' ? '<span style="color:#16a34a">' + escapeHtml_(done) + '</span> ' : '')
        + metaHtml(s.title, meta),
    };
  };

  section(t_('mail.today'), d.schedules, renderSchedule);
  section(t_('mail.meetings'), d.meetings, function (m) {
    const meta = [m.timeLabel, m.location].filter(function (x) { return x; }).join(sep);
    return {
      text: withMeta(m.title, meta),
      html: metaHtml(m.title, meta),
    };
  });
  if (d.calendarError) {
    text.push('※ ' + d.calendarError, '');
    html.push('<p style="color:#b45309;font-size:13px">※ ' + escapeHtml_(d.calendarError) + '</p>');
  }
  if (d.overdueTotal) {
    section(t_('mail.overdue', d.overdueTotal, d.overdue.length), d.overdue, function (s) {
      const meta = [t_('mail.due', s.endAt.slice(0, 10)), s.projectName].filter(function (x) { return x; }).join(sep);
      return {
        text: withMeta(s.title, meta),
        html: metaHtml(s.title, meta),
      };
    });
  }

  if (d.inProgressTotal) {
    section(t_('mail.inProgress', d.inProgressTotal, d.inProgress.length), d.inProgress, function (w) {
      const meta = [w.dateLabel, w.projectName].filter(function (x) { return x; }).join(sep);
      return {
        text: withMeta(w.title, meta),
        html: metaHtml(w.title, meta),
      };
    });
  }

  const url = getWebAppUrl_();
  if (url) {
    text.push(t_('mail.openApp', url));
    html.push('<p style="margin-top:20px"><a href="' + escapeHtml_(url) + '" style="color:#2563eb">' + escapeHtml_(t_('mail.openAppLink', appName_(lang))) + '</a></p>');
  }

  return {
    subject: subject,
    text: text.join('\n'),
    html: '<div lang="' + lang + '" style="font-family:' + escapeHtml_(t_('mail.fontFamily')) + ';max-width:640px">'
      + '<h2 style="margin:0 0 4px;font-size:18px">' + escapeHtml_(t_('mail.heading', d.date, d.weekday)) + '</h2>'
      + html.join('') + '</div>',
  };
}

function getOwnerEmail_() {
  const owner = PropertiesService.getScriptProperties().getProperty(PROP_KEYS.OWNER_EMAIL);
  if (!owner) fail_(ERROR_CODES.NOT_INITIALIZED, t_('err.ownerMissing'));
  return owner;
}

function hasDigestBeenSent_(today) {
  return readAll_(SHEETS.NOTIFY_LOG).some(function (r) {
    return r.kind === 'DIGEST' && r.target_date === today && r.result === 'SENT';
  });
}

function logDigest_(today, result, detail) {
  appendNotifyLog_('DIGEST', today, result, detail);
  return result;
}

/** 락 안에서 실행: 확인 → 발송 → 기록을 한 덩어리로 묶어 중복 발송을 막는다. */
function runDigest_(today) {
  const settings = getSettings_();
  if (!isTrue_(settings.notify_enabled)) return logDigest_(today, 'SKIPPED_DISABLED', '');

  const dow = dayOfWeek_(today);
  if (dow === 0 || dow === 6) return logDigest_(today, 'SKIPPED_WEEKEND', '');

  if (isTrue_(settings.skip_holidays)) {
    const holiday = holidayNameOf_(today);
    if (holiday) return logDigest_(today, 'SKIPPED_HOLIDAY', holiday);
  }

  if (hasDigestBeenSent_(today)) return logDigest_(today, 'SKIPPED_DUPLICATE', '');

  const lang = mailLang_(settings);
  const digest = withLang_(lang, function () { return buildDigest_(today); });
  if (isDigestEmpty_(digest) && !isTrue_(settings.notify_when_empty)) return logDigest_(today, 'SKIPPED_EMPTY', '');

  const mail = withLang_(lang, function () { return composeDigestMail_(digest); });
  MailApp.sendEmail({
    to: getOwnerEmail_(),
    subject: mail.subject,
    body: mail.text,
    htmlBody: mail.html,
    name: appName_(lang),
  });
  return logDigest_(today, 'SENT', 'schedules=' + digest.schedules.length + ', meetings=' + digest.meetings.length
    + ', overdue=' + digest.overdueTotal + ', inProgress=' + digest.inProgressTotal);
}

/**
 * 테스트 메일 (v1.12): 지금 내용으로 아침 메일을 소유자에게 한 통 보낸다.
 * 설정(켜기/끄기·주말·공휴일·빈 날)과 상관없이 보내고, 중복 발송 판단(kind = DIGEST)에는 넣지 않는다.
 * 메일 발송 한도를 지키고 최근 기록이 테스트로 채워지지 않게, 실패를 포함해 하루 LIMITS.TEST_MAIL_PER_DAY번까지.
 */
function sendTestDigest_() {
  return withLock_(function () {
    const today = todayYmd_();
    const sent = readAll_(SHEETS.NOTIFY_LOG).filter(function (r) {
      return r.kind === 'DIGEST_TEST' && r.target_date === today;
    }).length;
    if (sent >= LIMITS.TEST_MAIL_PER_DAY) invalid_(t_('mail.testLimit', LIMITS.TEST_MAIL_PER_DAY));
    // 메일은 내일 아침 메일과 같은 언어로, 오류 문구는 화면 언어로.
    // 메일 언어로 바꾸기 전에 읽을 시트를 먼저 확인해 둔다 (시트가 없을 때의 오류가 화면 언어로 나오게)
    [SHEETS.PROJECTS, SHEETS.SCHEDULES, SHEETS.WORKLOGS].forEach(getSheet_);
    const lang = mailLang_(getSettings_());
    const mail = withLang_(lang, function () {
      const m = composeDigestMail_(buildDigest_(today));
      m.subject = t_('mail.testPrefix') + m.subject;
      return m;
    });
    try {
      MailApp.sendEmail({
        to: getOwnerEmail_(),
        subject: mail.subject,
        body: mail.text,
        htmlBody: mail.html,
        name: appName_(lang),
      });
    } catch (e) {
      appendNotifyLog_('DIGEST_TEST', today, 'FAILED', e && e.message);
      fail_(ERROR_CODES.INTERNAL, t_('mail.testFailed', String(e && e.message).slice(0, 200)));
    }
    appendNotifyLog_('DIGEST_TEST', today, 'SENT', '');
    return { sentToday: sent + 1 };
  });
}

/** 트리거 핸들러 (매일, 설정한 시각 ~ 1시간 사이. 기본 07~08시). */
function sendMorningDigest() {
  beginExecution_(null); // 메일 언어는 runDigest_에서 mailLang_()으로
  const today = todayYmd_();
  let result;
  try {
    result = withLock_(function () { return runDigest_(today); });
  } catch (e) {
    console.error(JSON.stringify({ where: 'sendMorningDigest', date: today, message: e && e.message, stack: e && e.stack }));
    try {
      withLock_(function () { appendNotifyLog_('DIGEST', today, 'FAILED', e && e.message); });
    } catch (logError) {
      console.error(JSON.stringify({ where: 'sendMorningDigest.log', message: logError && logError.message }));
    }
    throw e; // Apps Script 실패 알림 메일로도 알 수 있게 다시 던진다
  }
  console.log(JSON.stringify({ where: 'sendMorningDigest', date: today, result: result }));
  return result;
}

// ===== 51_BackupService.js =====
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

// ===== 52_FaviconService.js =====
/**
 * 브라우저 탭 아이콘(파비콘) (v1.14). 설계: docs/design/favicon.md
 * - 웹앱 화면은 구글이 씌운 틀(iframe) 안에서 돌아서 index.html의 <link rel="icon">은 탭에 반영되지 않는다.
 *   doGet에서 HtmlOutput.setFaviconUrl(주소)로 붙인다.
 * - 주소는 인터넷에서 열리는 이미지여야 하고, 공식 문서대로 확장자(.png 등)로 이미지 형식을 알린다.
 * - 주소 순서: 스크립트 속성 FAVICON_URL(직접 지정) → setupFavicon이 올린 드라이브 파일 → 없음(구글 기본 아이콘)
 * - 탭 아이콘 때문에 앱이 안 열리는 일은 없어야 한다: 오류는 삼키고 기록만 남긴다.
 */

const FAVICON_URL_MAX_ = 2000;
const FAVICON_MIME_ = 'image/png';

/**
 * 탭 아이콘으로 쓸 수 있는 주소: https, URL에 쓰는 ASCII 문자만(공백·따옴표·꺾쇠·괄호·제어 문자 없음),
 * 호스트 앞에 사용자 정보(user@) 없음, .png/.ico로 끝남, 2000자 이하
 */
function isValidFaviconUrl_(url) {
  if (typeof url !== 'string' || url.length === 0 || url.length > FAVICON_URL_MAX_) return false;
  if (!/^https:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&*+,;=%]+$/.test(url)) return false;
  const authority = url.slice('https://'.length).split(/[/?#]/)[0];
  if (!authority || authority.indexOf('@') >= 0) return false;
  return /\.(png|ico)$/i.test(url);
}

/** 드라이브 파일 ID 모양 (영문·숫자·_·-) */
function isValidDriveId_(id) {
  return typeof id === 'string' && id.length > 0 && id.length <= 200 && /^[A-Za-z0-9_-]+$/.test(id);
}

/** 드라이브 파일 → 탭 아이콘 주소 (기본 형식). 끝의 '&.png'는 이미지 형식을 알리는 표시 */
function driveFaviconUrl_(fileId) {
  return 'https://drive.google.com/uc?export=view&id=' + fileId + '&.png';
}

/** 직접 지정 주소 (없거나 올바르지 않으면 null) */
function manualFaviconUrl_(raw) {
  if (!raw) return null;
  const url = String(raw).trim();
  return isValidFaviconUrl_(url) ? url : null;
}

/** 탭 아이콘 주소: 직접 지정 → 드라이브 파일 → null (스크립트 속성은 한 번에 읽는다) */
function faviconUrl_() {
  const all = PropertiesService.getScriptProperties().getProperties();
  const raw = all[PROP_KEYS.FAVICON_URL];
  const manual = manualFaviconUrl_(raw);
  if (manual) return manual;
  if (raw) console.warn(JSON.stringify({ where: 'faviconUrl_', message: 'FAVICON_URL is invalid, ignored' }));
  const id = all[PROP_KEYS.FAVICON_FILE_ID];
  return isValidDriveId_(id) ? driveFaviconUrl_(id) : null;
}

/** 정상 화면에 탭 아이콘을 붙인다. 무슨 오류가 나도 화면은 그대로 돌려준다 */
function applyFavicon_(output) {
  try {
    const url = faviconUrl_();
    if (url) output.setFaviconUrl(url);
  } catch (e) {
    console.warn(JSON.stringify({ where: 'applyFavicon_', message: e && e.message }));
  }
  return output;
}

/** 링크가 있으면 누구나 볼 수 있게 공유된 파일인지 (enum을 문자열로 비교해 실제 환경의 객체 비교 차이를 피한다) */
function isLinkShared_(file) {
  const a = String(file.getSharingAccess());
  return a === String(DriveApp.Access.ANYONE_WITH_LINK) || a === String(DriveApp.Access.ANYONE);
}

/** setupFavicon이 만든 로고 파일인지 (속성을 손으로 고쳐 다른 파일 ID가 들어간 경우 그 파일을 건드리지 않기 위해) */
function isOwnFaviconFile_(file) {
  return file.getName() === FAVICON_FILE_NAME && file.getMimeType() === FAVICON_MIME_;
}

/** 저장된 ID의 이전 파일: { file } | { missing: true } | null(없음) */
function previousFaviconFile_(id) {
  if (!id) return null;
  try {
    return { file: DriveApp.getFileById(id) };
  } catch (e) {
    return { missing: true };
  }
}

/**
 * 편집기에서 한 번 실행: 로고 PNG(09_FaviconData.js)를 내 드라이브에 올리고 「링크가 있는 모든 사용자 — 뷰어」로 공유한 뒤
 * 파일 ID를 저장한다. 순서는 새 파일 만들기 → 공유 → ID 저장 → 이전 파일 휴지통 (새 파일을 못 만들면 이전 것은 그대로).
 * - 공유가 막혀도(조직 정책 등) 처음 실행이면 파일과 ID는 저장하고 경고만 남긴다.
 * - 다시 실행했는데 공유만 실패하면, 잘 쓰이던 이전 파일(링크 공유 중)을 그대로 두고 새 파일을 휴지통으로 보낸다.
 * - 이전 ID가 이 앱이 만든 로고 파일이 아니면(이름·형식이 다르면) 그 파일은 건드리지 않는다.
 */
function setupFavicon() {
  beginExecution_(accountLang_());
  assertOwner_();
  const report = [];
  const props = PropertiesService.getScriptProperties();
  const oldId = props.getProperty(PROP_KEYS.FAVICON_FILE_ID);
  const prev = previousFaviconFile_(oldId);

  const blob = Utilities.newBlob(Utilities.base64Decode(FAVICON_PNG_BASE64_), FAVICON_MIME_, FAVICON_FILE_NAME);
  const file = DriveApp.createFile(blob);
  report.push(t_('favicon.created', FAVICON_FILE_NAME));
  let shared = false;
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    shared = true;
    report.push(t_('favicon.shared'));
  } catch (e) {
    report.push(t_('favicon.shareFailed', (e && e.message) || String(e)));
  }

  const prevFile = prev && prev.file && prev.file.getId() !== file.getId() ? prev.file : null;
  const prevUsable = !!prevFile && isOwnFaviconFile_(prevFile) && !prevFile.isTrashed() && isLinkShared_(prevFile);
  if (!shared && prevUsable) {
    // 잘 되던 이전 파일을 유지: 방금 만든(공유 안 된) 파일만 치운다
    file.setTrashed(true);
    report.push(t_('favicon.keptPrevious'));
    report.push(t_('favicon.url', driveFaviconUrl_(prevFile.getId())));
    return finishFaviconReport_(report, props, true);
  }

  props.setProperty(PROP_KEYS.FAVICON_FILE_ID, file.getId());
  if (prevFile) {
    if (!isOwnFaviconFile_(prevFile)) {
      report.push(t_('favicon.oldNotOurs', prevFile.getId()));
    } else if (!prevFile.isTrashed()) {
      try {
        prevFile.setTrashed(true);
        report.push(t_('favicon.oldTrashed'));
      } catch (e) {
        report.push(t_('favicon.oldTrashFailed', prevFile.getId()));
      }
    }
  }
  report.push(t_('favicon.url', driveFaviconUrl_(file.getId())));
  return finishFaviconReport_(report, props, shared);
}

/** setupFavicon 로그 마무리: 직접 지정 주소 안내 + 새로 고침 안내(공유 여부에 따라) */
function finishFaviconReport_(report, props, shared) {
  const raw = props.getProperty(PROP_KEYS.FAVICON_URL);
  const manual = manualFaviconUrl_(raw);
  if (manual) report.push(t_('favicon.manualOverride', manual));
  else if (raw) report.push(t_('favicon.check.manualBad'));
  report.push(t_(shared || manual ? 'favicon.done' : 'favicon.doneUnshared'));
  report.forEach(function (line) { Logger.log(line); });
  return report.join('\n');
}

/** runSelfTest 줄. FAVICON_URL이 잘못됐으면 경고에 이어서 실제로 쓰이는 드라이브 파일 상태도 알린다 */
function faviconSelfTestLine_() {
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty(PROP_KEYS.FAVICON_URL);
  if (raw && manualFaviconUrl_(raw)) return t_('favicon.check.manual');
  const lines = raw ? [t_('favicon.check.manualBad')] : [];
  const id = props.getProperty(PROP_KEYS.FAVICON_FILE_ID);
  if (!id) {
    if (!raw) lines.push(t_('favicon.check.none'));
    return lines.join('\n');
  }
  const prev = previousFaviconFile_(id);
  if (prev.missing || prev.file.isTrashed()) lines.push(t_('favicon.check.missing'));
  else lines.push(isLinkShared_(prev.file) ? t_('favicon.check.ok', prev.file.getName()) : t_('favicon.check.notShared'));
  return lines.join('\n');
}

// ===== 60_Api.js =====
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

// ===== 70_WebApp.js =====
/**
 * 웹앱 진입점.
 * index.html은 Vite가 만든 단일 파일 번들이다. 번들 안에 '<?' 같은 문자열이 들어 있을 수 있으므로
 * 템플릿(createTemplateFromFile)이 아니라 createHtmlOutputFromFile로 그대로 내보낸다.
 * v1.13: 탭 제목은 마지막 화면 언어의 앱 이름 (화면 쪽에서는 탭 제목을 바꿀 수 없다).
 *        권한·초기 설정 오류 페이지는 언어를 알 수 없는 상태라 한국어·일본어를 함께 보여 준다.
 * v1.14: 정상 화면에만 탭 아이콘(파비콘)을 붙인다 — 52_FaviconService.js
 */

/** 오류 코드 → 두 언어 문구 */
function doGetErrorKey_(e) {
  if (e instanceof AppError && e.code === ERROR_CODES.NOT_INITIALIZED) return 'err.notInitialized';
  if (e instanceof AppError && e.code === ERROR_CODES.FORBIDDEN) return 'err.forbidden';
  return 'err.cannotOpen';
}

function doGet() {
  beginExecution_(null);
  try {
    assertOwner_();
  } catch (e) {
    if (!(e instanceof AppError)) console.error(JSON.stringify({ where: 'doGet', message: e && e.message }));
    const key = doGetErrorKey_(e);
    const body = LANGS.map(function (l) {
      return '<p lang="' + l + '">' + escapeHtml_(tIn_(l, key)) + '</p>';
    }).join('');
    return HtmlService
      .createHtmlOutput('<div style="font-family:sans-serif;padding:24px">' + body + '</div>')
      .setTitle(LANGS.map(function (l) { return appName_(l); }).join(' / '));
  }
  return applyFavicon_(HtmlService
    .createHtmlOutputFromFile('index')
    .setTitle(appName_(fallbackLang_()))
    .addMetaTag('viewport', 'width=device-width, initial-scale=1'));
}

// ===== 80_Setup.js =====
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
    return t_(getHolidays_(todayYmd_(), todayYmd_()).available ? 'selftest.holidayOk' : 'selftest.holidayWarn');
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
