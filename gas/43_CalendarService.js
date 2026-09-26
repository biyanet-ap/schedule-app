/**
 * 구글 캘린더 읽기 전용 연동.
 * - 기본 캘린더: 회의 일정 표시용. 내가 '거절'한 일정은 뺀다.
 * - 일본 공휴일 캘린더: 본인 캘린더에 구독돼 있어야 getCalendarById가 값을 돌려준다.
 *   구글 화면 언어에 따라 ja/ko/en 캘린더 중 하나가 추가되므로 셋 다 찾아본다 (v1.15, HOLIDAY_CALENDAR_IDS).
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

/**
 * 구독된 일본 공휴일 캘린더: HOLIDAY_CALENDAR_IDS 순서(ja → ko → en)로 먼저 찾은 것. 없으면 null.
 * 한 ID 조회가 실패해도 나머지는 계속 찾는다.
 */
function findHolidayCalendar_() {
  for (let i = 0; i < HOLIDAY_CALENDAR_IDS.length; i++) {
    try {
      const cal = CalendarApp.getCalendarById(HOLIDAY_CALENDAR_IDS[i]);
      if (cal) return cal;
    } catch (e) {
      console.warn(JSON.stringify({ where: 'findHolidayCalendar_', message: e && e.message }));
    }
  }
  return null;
}

/** 캘린더에 보이는 이름 (못 읽으면 빈 문자열) */
function holidayCalendarName_(cal) {
  try {
    return String(cal.getName() || '');
  } catch (e) {
    return '';
  }
}

/**
 * 쉬는 날이 아닌 기념일(節分·ひな祭り 등)인지: 설명의 첫 줄(빈 줄은 건너뜀, 앞뒤 공백 제거)이 祭日(ja) 또는 Observance(ko·en).
 * 둘째 줄 이후의 안내 문구(「祭日を非表示にするには…」)에는 걸리지 않게 첫 줄만 본다. 줄바꿈은 LF·CRLF·CR 모두 처리.
 */
function isObservance_(ev) {
  const lines = String(ev.getDescription() || '').split(/\r\n|\r|\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line) return NON_HOLIDAY_MARKERS.indexOf(line) >= 0;
  }
  return false;
}

/**
 * @param {Object=} knownCalendar 이미 찾은 공휴일 캘린더 (runSelfTest처럼 이름도 필요할 때 두 번 찾지 않게)
 * @return {{available: boolean, holidays: Array<{date: string, name: string}>}}
 */
function getHolidays_(from, to, knownCalendar) {
  try {
    const cal = knownCalendar || findHolidayCalendar_();
    if (!cal) return { available: false, holidays: [] };

    const events = cal.getEvents(jstToDate_(from), jstToDate_(addDaysYmd_(to, 1)));
    const holidays = [];
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (isObservance_(ev)) continue;
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
