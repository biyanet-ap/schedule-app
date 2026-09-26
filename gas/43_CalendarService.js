/**
 * 구글 캘린더 읽기 전용 연동.
 * - 기본 캘린더: 회의 일정 표시용. 내가 '거절'한 일정은 뺀다.
 * - 일본 공휴일 캘린더: 본인 캘린더에 구독돼 있어야 getCalendarById가 값을 돌려준다.
 * 캘린더 조회가 실패해도 앱 전체가 멈추지 않도록 에러를 결과에 담아 돌려준다.
 */

function calendarEventToDto_(ev) {
  const allDay = ev.isAllDayEvent();
  let startAt;
  let endAt;
  if (allDay) {
    // getAllDayEndDate()는 종료 다음날(미포함)을 돌려주므로 하루 뺀다.
    const startYmd = formatYmd_(ev.getAllDayStartDate());
    let endYmd = addDaysYmd_(formatYmd_(ev.getAllDayEndDate()), -1);
    if (endYmd < startYmd) endYmd = startYmd;
    startAt = startYmd + 'T00:00';
    endAt = endYmd + 'T00:00';
  } else {
    startAt = formatYmdHm_(ev.getStartTime());
    endAt = formatYmdHm_(ev.getEndTime());
  }
  return {
    // 반복 일정은 모든 회차가 같은 ID를 쓰므로 시작 시각을 붙여 구분한다.
    id: ev.getId() + '@' + startAt,
    title: ev.getTitle() || t_('calendar.untitled'),
    startAt: startAt,
    endAt: endAt,
    allDay: allDay,
    location: ev.getLocation() || '',
  };
}

function isDeclined_(ev) {
  try {
    return ev.getMyStatus() === CalendarApp.GuestStatus.NO;
  } catch (e) {
    return false;
  }
}

/** @return {{events: Array, error: string|null}} */
function getCalendarEvents_(from, to) {
  try {
    const cal = CalendarApp.getDefaultCalendar();
    const events = cal.getEvents(jstToDate_(from), jstToDate_(addDaysYmd_(to, 1)));
    const list = [];
    for (let i = 0; i < events.length; i++) {
      if (isDeclined_(events[i])) continue;
      list.push(calendarEventToDto_(events[i]));
    }
    return { events: list, error: null };
  } catch (e) {
    console.error(JSON.stringify({ where: 'getCalendarEvents_', message: e && e.message }));
    return { events: [], error: t_('calendar.error') };
  }
}

/** @return {{available: boolean, holidays: Array<{date: string, name: string}>}} */
function getHolidays_(from, to) {
  try {
    const cal = CalendarApp.getCalendarById(HOLIDAY_CALENDAR_ID);
    if (!cal) return { available: false, holidays: [] };

    const events = cal.getEvents(jstToDate_(from), jstToDate_(addDaysYmd_(to, 1)));
    const holidays = [];
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (String(ev.getDescription() || '').indexOf(NON_HOLIDAY_MARKER) >= 0) continue;
      const date = ev.isAllDayEvent() ? formatYmd_(ev.getAllDayStartDate()) : formatYmd_(ev.getStartTime());
      if (date < from || date > to) continue;
      holidays.push({ date: date, name: ev.getTitle() });
    }
    return { available: true, holidays: holidays };
  } catch (e) {
    console.warn(JSON.stringify({ where: 'getHolidays_', message: e && e.message }));
    return { available: false, holidays: [] };
  }
}

/** @return {string|null} 공휴일 이름. 공휴일이 아니거나 판정할 수 없으면 null */
function holidayNameOf_(ymd) {
  const result = getHolidays_(ymd, ymd);
  const hit = result.holidays.filter(function (h) { return h.date === ymd; })[0];
  return hit ? hit.name : null;
}
