/**
 * 작업기록 관리. 하루 여러 건을 허용한다.
 * tags는 시트에 쉼표 구분 문자열로 저장하고, 화면에는 배열로 준다.
 * status: IN_PROGRESS(진행 중, 기본) / DONE(완료). v1.5 이전 행은 빈 값이라 진행 중으로 읽는다.
 * end_date(v1.6): 비어 있으면 하루 기록, 날짜면 기간 기록(work_date = 시작일).
 *   불변식: end_date는 '' 이거나 work_date보다 뒤이고, 기간(양끝 포함)은 LIMITS.WORKLOG_PERIOD_DAYS 이하.
 */

const WORKLOG_DEFAULT_STATUS_ = 'IN_PROGRESS';

/** 작업기록의 마지막 날 (하루 기록이면 작업일) */
function worklogEndOf_(w) {
  return w.endDate || w.workDate;
}

/**
 * 시트 값 → DTO의 endDate. 형식 오류, 시작일 이하, 최대 일수 초과이면 ''(하루 기록)로 읽는다.
 * 손으로 고친 시트나 롤백 중 수정된 행이 있어도 화면에는 항상 불변식을 지키는 값만 나간다.
 */
function normalizeWorklogEndDate_(workDate, endDate) {
  const v = endDate == null ? '' : String(endDate);
  if (!isValidYmd_(v) || !isValidYmd_(String(workDate)) || v <= workDate) return '';
  return daysBetween_(workDate, v) + 1 <= LIMITS.WORKLOG_PERIOD_DAYS ? v : '';
}

/**
 * 저장할 end_date를 정한다. 불변식은 여기서만 검사한다.
 * @param {string} workDate 저장할 작업일(기간 기록이면 시작일)
 * @param {?string} endDate 요청 값. null = 보내지 않음(새 기록은 하루, 수정은 기존 값 유지), '' = 하루 기록
 * @param {string} baseEndDate 수정 전 기록의 종료일 (normalizeWorklogEndDate_로 읽은 값, 새 기록이면 '')
 * @return {string} '' 또는 'YYYY-MM-DD'
 */
function resolveWorklogEndDate_(workDate, endDate, baseEndDate) {
  const end = endDate === null ? baseEndDate : endDate;
  if (end === '') return '';
  // 유지하는 종료일도 검사한다: 시작일만 옮겨서 종료일보다 뒤가 되면 조용히 하루 기록으로 바꾸지 않고 알린다
  if (end <= workDate) invalid_(t_('worklog.periodOrder'));
  if (daysBetween_(workDate, end) + 1 > LIMITS.WORKLOG_PERIOD_DAYS) {
    invalid_(t_('worklog.periodMax', LIMITS.WORKLOG_PERIOD_DAYS));
  }
  return end;
}

function toWorklogDto_(r) {
  return {
    id: r.id,
    workDate: r.work_date,
    endDate: normalizeWorklogEndDate_(r.work_date, r.end_date),
    title: r.title,
    content: r.content,
    projectId: r.project_id,
    scheduleId: r.schedule_id,
    tags: r.tags ? String(r.tags).split(',').filter(function (t) { return t; }) : [],
    status: ENUMS.WORKLOG_STATUS.indexOf(r.status) >= 0 ? r.status : WORKLOG_DEFAULT_STATUS_,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function listActiveWorklogs_() {
  return readAll_(SHEETS.WORKLOGS)
    .filter(function (r) { return !isTrue_(r.deleted); })
    .map(toWorklogDto_);
}

/** from~to와 하루라도 겹치는 작업기록 (기간 기록은 시작일이 범위 앞이어도 포함) */
function listWorklogsInRange_(from, to) {
  return listActiveWorklogs_().filter(function (w) {
    return overlapsRange_({ start: w.workDate, end: worklogEndOf_(w) }, from, to);
  });
}

function validateWorklogInput_(input) {
  requireObject_(input);
  return {
    id: vOptionalId_(input.id, 'worklogId'),
    workDate: vYmd_(input.workDate, 'workDate'),
    // null = 보내지 않음 (새 기록은 하루 기록, 수정은 기존 값 유지), '' = 하루 기록
    endDate: input.endDate == null ? null : input.endDate === '' ? '' : vYmd_(input.endDate, 'endDate'),
    title: vText_(input.title, 'heading', { required: true, max: LIMITS.TITLE }),
    content: vText_(input.content, 'description', { max: LIMITS.CONTENT, multiline: true }),
    projectId: vOptionalId_(input.projectId, 'project'),
    scheduleId: vOptionalId_(input.scheduleId, 'linkedSchedule'),
    tags: vTags_(input.tags),
    // 비어 있으면 null: 새 기록은 진행 중, 수정은 기존 상태 유지
    status: input.status == null || input.status === '' ? null : vEnum_(input.status, 'status', ENUMS.WORKLOG_STATUS),
    completeSchedule: vBool_(input.completeSchedule),
  };
}

/** @param endDate resolveWorklogEndDate_로 확정한 값 */
function worklogDtoToRow_(v, base, endDate) {
  return Object.assign({}, base, {
    work_date: v.workDate,
    end_date: endDate,
    title: v.title,
    content: v.content,
    project_id: v.projectId,
    schedule_id: v.scheduleId,
    tags: v.tags.join(','),
    status: v.status || (base && ENUMS.WORKLOG_STATUS.indexOf(base.status) >= 0 ? base.status : WORKLOG_DEFAULT_STATUS_),
  });
}

/**
 * 연결 일정 확인. 새로 연결하는 일정은 삭제되지 않은 것이어야 한다.
 * 이미 연결돼 있던 일정이 나중에 삭제된 경우, 연결을 그대로 두는 수정은 허용한다.
 * @return 연결 일정 행(없으면 null)
 */
function resolveLinkedSchedule_(scheduleId, previousScheduleId) {
  if (!scheduleId) return null;
  const row = findById_(readAll_(SHEETS.SCHEDULES), scheduleId);
  const alive = row && !isTrue_(row.deleted);
  if (!alive && scheduleId !== previousScheduleId) invalid_(t_('worklog.scheduleMissing'));
  return alive ? row : null;
}

function saveWorklog_(input) {
  const v = validateWorklogInput_(input);
  const expectedUpdatedAt = v.id ? vUpdatedAt_(input.updatedAt) : undefined;

  return withLock_(function () {
    const stamp = nowStamp_();
    let saved;
    let previousScheduleId = '';

    if (!v.id) {
      assertProjectAssignable_(v.projectId, '');
      const endDate = resolveWorklogEndDate_(v.workDate, v.endDate, '');
      saved = worklogDtoToRow_(v, { id: uuid_(), created_at: stamp, updated_at: stamp, deleted: 'FALSE' }, endDate);
    } else {
      const row = findActiveForUpdate_(readAll_(SHEETS.WORKLOGS), v.id, expectedUpdatedAt, 'worklog');
      assertProjectAssignable_(v.projectId, row.project_id);
      previousScheduleId = row.schedule_id;
      const endDate = resolveWorklogEndDate_(v.workDate, v.endDate, normalizeWorklogEndDate_(row.work_date, row.end_date));
      saved = worklogDtoToRow_(v, Object.assign({}, row, { updated_at: stamp }), endDate);
    }
    // 검증을 모두 마친 뒤에 쓴다 (중간 실패로 절반만 저장되는 것 방지)
    const linked = resolveLinkedSchedule_(v.scheduleId, previousScheduleId);

    if (v.id) updateRow_(SHEETS.WORKLOGS, saved._row, saved);
    else insertRow_(SHEETS.WORKLOGS, saved);

    let completedSchedule = null;
    if (v.completeSchedule && linked && linked.status !== 'DONE') {
      const done = Object.assign({}, linked, { status: 'DONE', updated_at: stamp });
      updateRow_(SHEETS.SCHEDULES, linked._row, done);
      completedSchedule = toScheduleDto_(done);
    }
    return { worklog: toWorklogDto_(saved), completedSchedule: completedSchedule };
  });
}

/** 패널의 완료 버튼용: 상태만 바꾼다 (낙관적 잠금 적용) */
function setWorklogStatus_(input) {
  requireObject_(input);
  const id = vRequiredId_(input.id, 'worklogId');
  const status = vEnum_(input.status, 'status', ENUMS.WORKLOG_STATUS);
  const expectedUpdatedAt = vUpdatedAt_(input.updatedAt);
  return withLock_(function () {
    const row = findActiveForUpdate_(readAll_(SHEETS.WORKLOGS), id, expectedUpdatedAt, 'worklog');
    const updated = Object.assign({}, row, { status: status, updated_at: nowStamp_() });
    updateRow_(SHEETS.WORKLOGS, row._row, updated);
    return toWorklogDto_(updated);
  });
}

function deleteWorklog_(input) {
  requireObject_(input);
  const id = vRequiredId_(input.id, 'worklogId');
  const expectedUpdatedAt = vUpdatedAt_(input.updatedAt);
  return withLock_(function () {
    const row = findActiveForUpdate_(readAll_(SHEETS.WORKLOGS), id, expectedUpdatedAt, 'worklog');
    return softDeleteRow_(SHEETS.WORKLOGS, row);
  });
}

/**
 * 휴지통·되돌리기 (v1.11). updatedAt = 삭제 시각.
 * 연결 일정이 그 사이 지워졌어도 연결은 그대로 둔다 (resolveLinkedSchedule_의 '이미 연결돼 있던 일정' 규칙과 같음).
 */
function restoreWorklog_(input) {
  requireObject_(input);
  const id = vRequiredId_(input.id, 'worklogId');
  const expectedUpdatedAt = vUpdatedAt_(input.updatedAt);
  return withLock_(function () {
    const row = findDeletedForRestore_(readAll_(SHEETS.WORKLOGS), id, expectedUpdatedAt, 'worklog');
    return toWorklogDto_(restoreRow_(SHEETS.WORKLOGS, row));
  });
}
