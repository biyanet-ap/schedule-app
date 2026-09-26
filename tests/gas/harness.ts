/**
 * Apps Script 서버 코드 테스트 하네스.
 * gas/*.js 파일을 번들 없이 그대로 Node vm 컨텍스트에 올리고(= 실제 배포 코드),
 * SpreadsheetApp·CalendarApp 등 Google 서비스는 메모리 목으로 대체한다.
 *
 * 시트 목은 실제 스프레드시트의 까다로운 동작을 보수적으로 흉내 낸다.
 *  - '='로 시작하는 문자열은 서식과 관계없이 수식으로 처리 (값이 깨짐)
 *  - "'"로 시작하는 문자열은 따옴표가 떨어짐
 *  - 일반 텍스트(@) 서식이 아니면 날짜·숫자·TRUE/FALSE로 자동 변환
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';

const GAS_DIR = fileURLToPath(new URL('../../gas', import.meta.url));
export const OWNER = 'owner@example.com';
export const HOLIDAY_ID = 'ja.japanese#holiday@group.v.calendar.google.com';

type Cell = string | number | boolean | Date | { formula: string };

// ---------- Utilities.formatDate ----------
function formatDate(date: Date, tz: string, pattern: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(date.getTime()));
  const p: Record<string, string> = {};
  parts.forEach((x) => { p[x.type] = x.value; });
  let out = '';
  for (let i = 0; i < pattern.length;) {
    if (pattern[i] === "'") {
      const end = pattern.indexOf("'", i + 1);
      out += pattern.slice(i + 1, end);
      i = end + 1;
      continue;
    }
    const tokens: Record<string, string> = { yyyy: p.year, MM: p.month, dd: p.day, HH: p.hour, mm: p.minute, ss: p.second };
    const tok = ['yyyy', 'MM', 'dd', 'HH', 'mm', 'ss'].find((t) => pattern.startsWith(t, i));
    if (!tok) {
      if (/[A-Za-z]/.test(pattern[i])) throw new Error('unsupported pattern: ' + pattern);
      out += pattern[i];
      i += 1;
      continue;
    }
    out += tokens[tok];
    i += tok.length;
  }
  return out;
}

// ---------- Spreadsheet ----------
export class MockSheet {
  cells = new Map<string, Cell>();
  formats = new Map<string, string>();
  maxRows = 1000;
  maxCols = 26;
  frozenRows = 0;
  constructor(public name: string) {}
  private key(r: number, c: number) { return r + ':' + c; }
  getName() { return this.name; }
  getMaxRows() { return this.maxRows; }
  getMaxColumns() { return this.maxCols; }
  insertRowsAfter(after: number, n: number) {
    if (after !== this.maxRows) throw new Error('mock only supports appending rows');
    this.maxRows += n;
  }
  insertColumnsAfter(after: number, n: number) {
    if (after !== this.maxCols) throw new Error('mock only supports appending columns');
    this.maxCols += n;
  }
  setFrozenRows(n: number) { this.frozenRows = n; }
  getLastRow() {
    let last = 0;
    this.cells.forEach((v, k) => { if (v !== '') last = Math.max(last, Number(k.split(':')[0])); });
    return last;
  }
  getLastColumn() {
    let last = 0;
    this.cells.forEach((v, k) => { if (v !== '') last = Math.max(last, Number(k.split(':')[1])); });
    return last;
  }
  getRange(row: number, col: number, numRows = 1, numCols = 1) {
    if (row < 1 || col < 1 || row + numRows - 1 > this.maxRows || col + numCols - 1 > this.maxCols) {
      throw new Error('The coordinates of the range are outside the dimensions of the sheet.');
    }
    return new MockRange(this, row, col, numRows, numCols);
  }
  read(r: number, c: number): Cell { return this.cells.get(this.key(r, c)) ?? ''; }
  write(r: number, c: number, v: unknown) {
    const fmt = this.formats.get(this.key(r, c));
    let stored: Cell;
    if (typeof v === 'string') {
      if (v.startsWith('=')) stored = { formula: v };
      else if (v.startsWith("'")) stored = v.slice(1);
      else if (fmt !== '@' && /^\d{4}-\d{2}-\d{2}/.test(v)) stored = new Date(v.length === 10 ? v + 'T00:00:00+09:00' : v + ':00+09:00');
      else if (fmt !== '@' && v.trim() !== '' && !Number.isNaN(Number(v))) stored = Number(v);
      else if (fmt !== '@' && /^(TRUE|FALSE)$/i.test(v)) stored = v.toUpperCase() === 'TRUE';
      else stored = v;
    } else {
      stored = v as Cell;
    }
    this.cells.set(this.key(r, c), stored);
  }
  setFormat(r: number, c: number, f: string) { this.formats.set(this.key(r, c), f); }
  /** 테스트용: 행 전체를 원시 값으로 읽기 */
  rawRow(r: number) {
    const out: Cell[] = [];
    for (let c = 1; c <= this.getLastColumn(); c++) out.push(this.read(r, c));
    return out;
  }
}

class MockRange {
  constructor(private sheet: MockSheet, private row: number, private col: number, private numRows: number, private numCols: number) {}
  getValues() {
    const out: unknown[][] = [];
    for (let r = 0; r < this.numRows; r++) {
      const line: unknown[] = [];
      for (let c = 0; c < this.numCols; c++) {
        const v = this.sheet.read(this.row + r, this.col + c);
        line.push(typeof v === 'object' && v !== null && 'formula' in v ? '#ERROR!' : v);
      }
      out.push(line);
    }
    return out;
  }
  setValues(values: unknown[][]) {
    if (values.length !== this.numRows || values.some((l) => l.length !== this.numCols)) {
      throw new Error('The number of rows/columns in the data does not match the range.');
    }
    values.forEach((line, r) => line.forEach((v, c) => this.sheet.write(this.row + r, this.col + c, v)));
    return this;
  }
  setNumberFormat(f: string) {
    for (let r = 0; r < this.numRows; r++) for (let c = 0; c < this.numCols; c++) this.sheet.setFormat(this.row + r, this.col + c, f);
    return this;
  }
  setFontWeight() { return this; }
}

class MockSpreadsheet {
  sheets: MockSheet[] = [new MockSheet('シート1')];
  constructor(public id: string, public name: string) {}
  getId() { return this.id; }
  getName() { return this.name; }
  getUrl() { return 'https://docs.google.com/spreadsheets/d/' + this.id; }
  getSheets() { return this.sheets.slice(); }
  getSheetByName(n: string) { return this.sheets.find((s) => s.name === n) ?? null; }
  insertSheet(n: string) {
    if (this.getSheetByName(n)) throw new Error('A sheet with the name "' + n + '" already exists.');
    const s = new MockSheet(n);
    this.sheets.push(s);
    return s;
  }
  deleteSheet(s: MockSheet) { this.sheets = this.sheets.filter((x) => x !== s); }
}

// ---------- Calendar ----------
export interface MockEventSpec {
  title: string;
  start: string; // 'YYYY-MM-DD' (종일) 또는 'YYYY-MM-DDTHH:mm' (JST)
  end: string; // 종일: 마지막 날 포함 'YYYY-MM-DD', 시각: 'YYYY-MM-DDTHH:mm'
  allDay?: boolean;
  location?: string;
  description?: string;
  myStatus?: string;
  id?: string;
}

function jst(s: string) {
  return new Date((s.length === 10 ? s + 'T00:00' : s) + ':00+09:00');
}

function makeEvent(spec: MockEventSpec) {
  const allDay = !!spec.allDay;
  const start = jst(spec.start);
  const end = allDay ? new Date(jst(spec.end).getTime() + 86400000) : jst(spec.end);
  return {
    spec, start, end,
    api: {
      getId: () => spec.id ?? 'ev-' + spec.title,
      getTitle: () => spec.title,
      isAllDayEvent: () => allDay,
      getAllDayStartDate: () => start,
      getAllDayEndDate: () => end,
      getStartTime: () => start,
      getEndTime: () => end,
      getLocation: () => spec.location ?? '',
      getDescription: () => spec.description ?? '',
      getMyStatus: () => spec.myStatus ?? 'OWNER',
    },
  };
}

function makeCalendar(list: () => MockEventSpec[], shouldThrow: () => boolean) {
  return {
    getEvents(from: Date, to: Date) {
      if (shouldThrow()) throw new Error('Calendar service error');
      return list().map(makeEvent).filter((e) => e.start < to && e.end > from).map((e) => e.api);
    },
  };
}

// ---------- Drive ----------
const ACCESS = { ANYONE: 'ANYONE', ANYONE_WITH_LINK: 'ANYONE_WITH_LINK', DOMAIN: 'DOMAIN', DOMAIN_WITH_LINK: 'DOMAIN_WITH_LINK', PRIVATE: 'PRIVATE' };
const PERMISSION = { VIEW: 'VIEW', EDIT: 'EDIT', COMMENT: 'COMMENT', OWNER: 'OWNER', ORGANIZER: 'ORGANIZER', FILE_ORGANIZER: 'FILE_ORGANIZER', NONE: 'NONE' };
class MockFile {
  trashed = false;
  /** 공유 범위·권한 (DriveApp.Access / DriveApp.Permission 값) — v1.14 파비콘 */
  sharing = 'PRIVATE';
  permission = 'EDIT';
  /** 파일 내용 (DriveApp.createFile로 만든 파일만) */
  content: { bytes: Uint8Array; type: string } | null = null;
  owner: MockDrive | null = null;
  constructor(public id: string, public name: string, public created: Date, public folderId: string | null) {}
  getId() { return this.id; }
  getName() { return this.name; }
  getDateCreated() { return this.created; }
  isTrashed() { return this.trashed; }
  setTrashed(v: boolean) {
    if (this.owner?.trashThrowsIds.has(this.id)) throw new Error('Access denied: DriveApp.');
    this.trashed = v;
    return this;
  }
  getMimeType() { return this.content ? this.content.type : 'application/vnd.google-apps.spreadsheet'; }
  setSharing(access: string, permission: string) {
    if (!(access in ACCESS)) throw new Error('Invalid argument: accessType ' + access);
    if (!(permission in PERMISSION)) throw new Error('Invalid argument: permissionType ' + permission);
    if (this.owner?.sharingThrows) throw new Error('Sharing is restricted by your administrator.');
    this.sharing = access;
    this.permission = permission;
    return this;
  }
  getSharingAccess() {
    if (this.owner?.sharingReadThrows) throw new Error('Drive getSharingAccess failed');
    return this.sharing;
  }
}
class MockFolder {
  trashed = false;
  constructor(public id: string, public name: string, private drive: MockDrive) {}
  getId() { return this.id; }
  getName() { return this.name; }
  isTrashed() { return this.trashed; }
  getFiles() {
    const files = this.drive.files.filter((f) => f.folderId === this.id);
    let i = 0;
    return { hasNext: () => i < files.length, next: () => files[i++] };
  }
}
class MockDrive {
  files: MockFile[] = [];
  folders: MockFolder[] = [];
  /** true면 setSharing이 오류 (회사 계정 공유 제한 흉내) */
  sharingThrows = false;
  /** true면 createFile이 오류 */
  createFileThrows = false;
  /** true면 getSharingAccess가 오류 */
  sharingReadThrows = false;
  /** 이 ID의 파일은 setTrashed가 오류 */
  trashThrowsIds = new Set<string>();
  private seq = 0;
  constructor(private clock: () => number) {}
  nextId(prefix: string) { return prefix + '-' + (++this.seq); }
  addFile(id: string, name: string, folderId: string | null, created = new Date(this.clock())) {
    const f = new MockFile(id, name, created, folderId);
    f.owner = this;
    this.files.push(f);
    return f;
  }
  api() {
    return {
      getFileById: (id: string) => {
        const f = this.files.find((x) => x.id === id);
        if (!f) throw new Error('No item with the given ID could be found.');
        return Object.assign(f, {
          makeCopy: (name: string, folder: MockFolder) => this.addFile(this.nextId('copy'), name, folder.getId(), new Date(this.clock() + this.seq)),
        });
      },
      getFolderById: (id: string) => {
        const f = this.folders.find((x) => x.id === id);
        if (!f) throw new Error('No item with the given ID could be found.');
        return f;
      },
      createFolder: (name: string) => {
        const f = new MockFolder(this.nextId('folder'), name, this);
        this.folders.push(f);
        return f;
      },
      createFile: (blob: { bytes: Uint8Array; type: string; name: string }) => {
        if (this.createFileThrows) throw new Error('Drive createFile failed');
        const f = this.addFile(this.nextId('file'), blob.name, null);
        f.content = { bytes: blob.bytes, type: blob.type };
        return f;
      },
      Access: ACCESS,
      Permission: PERMISSION,
    };
  }
}

// ---------- 하네스 ----------
export interface HarnessState {
  nowMs: number;
  activeEmail: string;
  effectiveEmail: string;
  /** Session.getActiveUserLocale() — Google 계정 언어 (v1.13). 기본 'ko'라서 기존 테스트는 한국어 문구 그대로 */
  activeLocale: string;
  lockAvailable: boolean;
  calendarEvents: MockEventSpec[];
  calendarThrows: boolean;
  holidaySubscribed: boolean;
  holidays: MockEventSpec[];
  sentMails: Array<Record<string, string>>;
  mailThrows: boolean;
  triggers: Array<{ handler: string; config: Record<string, unknown> }>;
  logs: string[];
  consoleErrors: string[];
  webAppUrl: string;
  spreadsheets: Map<string, MockSpreadsheet>;
  openByIdThrows: boolean;
  /** true면 HtmlOutput.setFaviconUrl이 오류 (v1.14) */
  faviconThrows: boolean;
}

export interface CreateGasOptions {
  /** 기본은 gas/*.js를 파일별로 올린다. 전달용 Code.gs(한 파일로 합친 것) 검증 시 직접 넘긴다. */
  sources?: Array<{ name: string; code: string }>;
}

export function createGas(options: CreateGasOptions = {}) {
  const state: HarnessState = {
    nowMs: Date.parse('2026-09-24T07:30:00+09:00'), // 목요일
    activeEmail: OWNER,
    effectiveEmail: OWNER,
    activeLocale: 'ko',
    lockAvailable: true,
    calendarEvents: [],
    calendarThrows: false,
    holidaySubscribed: true,
    holidays: [],
    sentMails: [],
    mailThrows: false,
    triggers: [],
    logs: [],
    consoleErrors: [],
    webAppUrl: 'https://script.google.com/macros/s/TEST/exec',
    spreadsheets: new Map(),
    openByIdThrows: false,
    faviconThrows: false,
  };
  const props = new Map<string, string>();
  const drive = new MockDrive(() => state.nowMs);
  let ssSeq = 0;

  const quietConsole = {
    log: (...a: unknown[]) => state.logs.push(a.join(' ')),
    info: (...a: unknown[]) => state.logs.push(a.join(' ')),
    warn: (...a: unknown[]) => state.logs.push(a.join(' ')),
    error: (...a: unknown[]) => state.consoleErrors.push(a.join(' ')),
  };

  const globals = {
    console: quietConsole,
    Logger: { log: (s: unknown) => state.logs.push(String(s)) },
    Utilities: {
      getUuid: () => randomUUID(),
      formatDate,
      base64Decode: (s: string) => new Uint8Array(Buffer.from(s, 'base64')),
      newBlob: (bytes: Uint8Array, type: string, name: string) => ({ bytes, type, name, getName: () => name }),
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k: string) => props.get(k) ?? null,
        getProperties: () => Object.fromEntries(props),
        setProperty: (k: string, v: string) => { props.set(k, v); },
        deleteProperty: (k: string) => { props.delete(k); },
      }),
    },
    LockService: {
      getScriptLock: () => ({ tryLock: () => state.lockAvailable, releaseLock: () => undefined }),
    },
    Session: {
      getActiveUser: () => ({ getEmail: () => state.activeEmail }),
      getEffectiveUser: () => ({ getEmail: () => state.effectiveEmail }),
      getActiveUserLocale: () => state.activeLocale,
    },
    SpreadsheetApp: {
      openById: (id: string) => {
        if (state.openByIdThrows) throw new Error('Unexpected error while getting the method or property openById');
        const ss = state.spreadsheets.get(id);
        if (!ss) throw new Error('Requested entity was not found.');
        return ss;
      },
      create: (name: string) => {
        const ss = new MockSpreadsheet('ss-' + (++ssSeq), name);
        state.spreadsheets.set(ss.id, ss);
        drive.addFile(ss.id, name, null);
        return ss;
      },
      flush: () => undefined,
    },
    CalendarApp: {
      GuestStatus: { NO: 'NO', YES: 'YES', MAYBE: 'MAYBE', INVITED: 'INVITED', OWNER: 'OWNER' },
      getDefaultCalendar: () => makeCalendar(() => state.calendarEvents, () => state.calendarThrows),
      getCalendarById: (id: string) => (id === HOLIDAY_ID && state.holidaySubscribed
        ? makeCalendar(() => state.holidays, () => false)
        : null),
    },
    MailApp: {
      sendEmail: (m: Record<string, string>) => {
        if (state.mailThrows) throw new Error('Service invoked too many times for one day: email.');
        state.sentMails.push(m);
      },
      getRemainingDailyQuota: () => 100,
    },
    DriveApp: drive.api(),
    ScriptApp: {
      WeekDay: { MONDAY: 'MONDAY' },
      getService: () => ({ getUrl: () => state.webAppUrl }),
      getProjectTriggers: () => state.triggers.map((t) => ({ getHandlerFunction: () => t.handler, _t: t })),
      deleteTrigger: (t: { _t: unknown }) => { state.triggers = state.triggers.filter((x) => x !== t._t); },
      newTrigger: (handler: string) => {
        const config: Record<string, unknown> = {};
        const clock = {
          atHour: (h: number) => { config.atHour = h; return clock; },
          everyDays: (n: number) => { config.everyDays = n; return clock; },
          onWeekDay: (d: string) => { config.onWeekDay = d; return clock; },
          inTimezone: (tz: string) => { config.timezone = tz; return clock; },
          create: () => { state.triggers.push({ handler, config }); return {}; },
        };
        return { timeBased: () => clock };
      },
    },
    HtmlService: {
      createHtmlOutputFromFile: (name: string) => htmlOutput({ file: name }),
      createHtmlOutput: (html: string) => htmlOutput({ html }),
    },
    __nowMs: 0,
  };

  function htmlOutput(base: Record<string, unknown>) {
    const out: Record<string, unknown> = { ...base, meta: {} as Record<string, string> };
    out.setTitle = (t: string) => { out.title = t; return out; };
    out.addMetaTag = (k: string, v: string) => { (out.meta as Record<string, string>)[k] = v; return out; };
    out.setFaviconUrl = (u: string) => {
      if (state.faviconThrows) throw new Error('Invalid argument: iconUrl');
      out.faviconUrl = u;
      return out;
    };
    return out;
  }

  const ctx = vm.createContext(globals);
  const sources = options.sources ?? readdirSync(GAS_DIR).filter((f) => f.endsWith('.js')).sort()
    .map((f) => ({ name: f, code: readFileSync(join(GAS_DIR, f), 'utf8') }));
  sources.forEach(({ name, code }) => {
    vm.runInContext(code, ctx, { filename: name });
  });
  // 시계 교체
  vm.runInContext('now_ = function () { return new Date(__nowMs); };', ctx);
  const syncClock = () => { (ctx as { __nowMs: number }).__nowMs = state.nowMs; };
  syncClock();

  const g = ctx as unknown as Record<string, (...a: unknown[]) => unknown>;
  /** 실제 Apps Script는 호출(실행)마다 전역을 새로 올린다 → 요청 언어·대체 언어 캐시를 처음 값으로 (v1.13) */
  const freshExecution = () => vm.runInContext('if (typeof REQUEST_LANG_ !== "undefined") { REQUEST_LANG_ = null; FALLBACK_LANG_ = null; }', ctx);

  return {
    ctx,
    state,
    props,
    drive,
    /** 문자열 코드를 컨텍스트 안에서 실행 (const 상수 조회 등) */
    eval: (code: string) => vm.runInContext(code, ctx),
    setNow(iso: string) {
      state.nowMs = Date.parse(iso);
      syncClock();
    },
    /** google.script.run처럼 인자와 결과를 JSON으로 직렬화해서 호출 */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    call<T = ApiResult<any>>(fn: string, ...args: unknown[]): T {
      syncClock();
      freshExecution();
      if (typeof g[fn] !== 'function') throw new Error('no such function: ' + fn);
      const cloned = args.map((a) => (a === undefined ? undefined : JSON.parse(JSON.stringify(a))));
      const result = g[fn](...cloned);
      return result === undefined ? (undefined as T) : JSON.parse(JSON.stringify(result));
    },
    /** 직렬화 없이 그대로 호출 (내부 함수·예외 확인용) */
    raw(fn: string, ...args: unknown[]) {
      syncClock();
      freshExecution();
      return g[fn](...args);
    },
    spreadsheet(): MockSpreadsheet {
      const id = props.get('SPREADSHEET_ID');
      if (!id) throw new Error('not set up');
      return state.spreadsheets.get(id)!;
    },
    sheet(name: string): MockSheet {
      const s = this.spreadsheet().getSheetByName(name);
      if (!s) throw new Error('no sheet ' + name);
      return s;
    },
  };
}

export type Gas = ReturnType<typeof createGas>;

export interface ApiOk<T> { ok: true; data: T }
export interface ApiErr { ok: false; error: { code: string; message: string } }
export type ApiResult<T> = ApiOk<T> | ApiErr;

export function ok<T>(r: ApiResult<T>): T {
  if (!r.ok) throw new Error('API failed: ' + r.error.code + ' ' + r.error.message);
  return r.data;
}

export function err(r: ApiResult<unknown>) {
  if (r.ok) throw new Error('expected API error but got ok');
  return r.error;
}

/** setup까지 끝낸 하네스 */
export function createReadyGas() {
  const gas = createGas();
  gas.call('setup');
  return gas;
}
