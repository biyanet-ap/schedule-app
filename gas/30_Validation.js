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
