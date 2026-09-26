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
