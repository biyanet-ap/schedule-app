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
