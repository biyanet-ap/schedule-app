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
