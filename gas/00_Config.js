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
