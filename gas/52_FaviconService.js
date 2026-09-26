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
