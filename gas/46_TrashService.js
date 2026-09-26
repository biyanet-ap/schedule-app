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
