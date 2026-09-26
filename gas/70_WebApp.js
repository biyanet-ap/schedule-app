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
