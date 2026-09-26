/**
 * 일정(작업·회의) 관리.
 * 저장 형식: start_at / end_at = 'YYYY-MM-DDTHH:mm' (JST).
 * 종일 일정은 시각을 00:00으로 두고, end_at의 날짜는 "포함되는 마지막 날"이다.
 */

function normalizeDateTime_(s) {
  return s && s.length === 10 ? s + 'T00:00' : s;
}

function toScheduleDto_(r) {
  return {
    id: r.id,
    type: r.type || 'TASK',
    title: r.title,
    description: r.description,
    startAt: normalizeDateTime_(r.start_at),
    endAt: normalizeDateTime_(r.end_at),
    allDay: isTrue_(r.all_day),
    priority: r.priority || 'MEDIUM',
    projectId: r.project_id,
    location: r.location,
    status: r.status || 'PLANNED',
    tags: r.tags ? String(r.tags).split(',').filter(function (t) { return t; }) : [],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** 일정이 걸쳐 있는 날짜 범위(양끝 포함). 시각 일정이 다음날 00:00에 끝나면 전날까지로 본다. */
function scheduleDateSpan_(dto) {
  const startDate = String(dto.startAt || '').slice(0, 10);
  let endDate = String(dto.endAt || dto.startAt || '').slice(0, 10);
  if (!dto.allDay && /T00:00$/.test(dto.endAt || '') && endDate > startDate) {
    endDate = addDaysYmd_(endDate, -1);
  }
  if (endDate < startDate) endDate = startDate;
  return { start: startDate, end: endDate };
}

function overlapsRange_(span, from, to) {
  return span.start <= to && span.end >= from;
}

function listActiveSchedules_() {
  return readAll_(SHEETS.SCHEDULES)
    .filter(function (r) { return !isTrue_(r.deleted); })
    .map(toScheduleDto_);
}

function listSchedulesInRange_(from, to) {
  return listActiveSchedules_().filter(function (s) {
    return overlapsRange_(scheduleDateSpan_(s), from, to);
  });
}

function validateScheduleInput_(input) {
  requireObject_(input);
  const allDay = vBool_(input.allDay);
  let startAt;
  let endAt;
  if (allDay) {
    startAt = vYmd_(input.startAt, 'startDate') + 'T00:00';
    endAt = vYmd_(input.endAt || input.startAt, 'endDate') + 'T00:00';
  } else {
    startAt = vYmdHm_(input.startAt, 'startAt');
    endAt = vYmdHm_(input.endAt || input.startAt, 'endAt');
  }
  if (endAt < startAt) invalid_(t_('schedule.endBeforeStart'));

  return {
    id: vOptionalId_(input.id, 'scheduleId'),
    type: vEnum_(input.type, 'type', ENUMS.SCHEDULE_TYPE, 'TASK'),
    title: vText_(input.title, 'title', { required: true, max: LIMITS.TITLE }),
    description: vText_(input.description, 'description', { max: LIMITS.DESCRIPTION, multiline: true }),
    allDay: allDay,
    startAt: startAt,
    endAt: endAt,
    priority: vEnum_(input.priority, 'priority', ENUMS.PRIORITY, 'MEDIUM'),
    projectId: vOptionalId_(input.projectId, 'project'),
    location: vLocation_(input.location),
    status: vEnum_(input.status, 'status', ENUMS.STATUS, 'PLANNED'),
    tags: vTags_(input.tags),
  };
}

function scheduleDtoToRow_(v, base) {
  return Object.assign({}, base, {
    type: v.type,
    title: v.title,
    description: v.description,
    start_at: v.startAt,
    end_at: v.endAt,
    all_day: toBoolString_(v.allDay),
    priority: v.priority,
    project_id: v.projectId,
    location: v.location,
    status: v.status,
    tags: v.tags.join(','),
  });
}

function saveSchedule_(input) {
  const v = validateScheduleInput_(input);
  const expectedUpdatedAt = v.id ? vUpdatedAt_(input.updatedAt) : undefined;

  return withLock_(function () {
    const stamp = nowStamp_();
    if (!v.id) {
      assertProjectAssignable_(v.projectId, '');
      const created = scheduleDtoToRow_(v, { id: uuid_(), created_at: stamp, updated_at: stamp, deleted: 'FALSE' });
      insertRow_(SHEETS.SCHEDULES, created);
      return toScheduleDto_(created);
    }
    const row = findActiveForUpdate_(readAll_(SHEETS.SCHEDULES), v.id, expectedUpdatedAt, 'schedule');
    assertProjectAssignable_(v.projectId, row.project_id);
    const updated = scheduleDtoToRow_(v, Object.assign({}, row, { updated_at: stamp }));
    updateRow_(SHEETS.SCHEDULES, row._row, updated);
    return toScheduleDto_(updated);
  });
}

function deleteSchedule_(input) {
  requireObject_(input);
  const id = vRequiredId_(input.id, 'scheduleId');
  const expectedUpdatedAt = vUpdatedAt_(input.updatedAt);
  return withLock_(function () {
    const row = findActiveForUpdate_(readAll_(SHEETS.SCHEDULES), id, expectedUpdatedAt, 'schedule');
    return softDeleteRow_(SHEETS.SCHEDULES, row);
  });
}

/** 휴지통·되돌리기 (v1.11). updatedAt = 삭제 시각 */
function restoreSchedule_(input) {
  requireObject_(input);
  const id = vRequiredId_(input.id, 'scheduleId');
  const expectedUpdatedAt = vUpdatedAt_(input.updatedAt);
  return withLock_(function () {
    const row = findDeletedForRestore_(readAll_(SHEETS.SCHEDULES), id, expectedUpdatedAt, 'schedule');
    return toScheduleDto_(restoreRow_(SHEETS.SCHEDULES, row));
  });
}

function setScheduleStatus_(input) {
  requireObject_(input);
  const id = vRequiredId_(input.id, 'scheduleId');
  const status = vEnum_(input.status, 'status', ENUMS.STATUS);
  const expectedUpdatedAt = vUpdatedAt_(input.updatedAt);
  return withLock_(function () {
    const row = findActiveForUpdate_(readAll_(SHEETS.SCHEDULES), id, expectedUpdatedAt, 'schedule');
    const updated = Object.assign({}, row, { status: status, updated_at: nowStamp_() });
    updateRow_(SHEETS.SCHEDULES, row._row, updated);
    return toScheduleDto_(updated);
  });
}
