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
