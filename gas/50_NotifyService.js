/**
 * 아침 요약 메일과 접속 팝업용 "오늘 요약".
 * 트리거는 매일 설정한 시각(기본 07~08시, 설정 화면에서 05~10시)에 실행되고, 주말·공휴일·중복 발송은 여기서 걸러낸다.
 * 문구 언어 (v1.13): 팝업은 요청 언어, 메일은 mailLang_() (지정 언어 → 마지막 화면 언어 → 계정 언어 → 일본어)
 */

const PRIORITY_RANK_ = { HIGH: 0, MEDIUM: 1, LOW: 2 };

function compareForDay_(a, b) {
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
  if (a.startAt !== b.startAt) return a.startAt < b.startAt ? -1 : 1;
  return (PRIORITY_RANK_[a.priority] ?? 1) - (PRIORITY_RANK_[b.priority] ?? 1); // HIGH=0이므로 || 쓰면 안 됨
}

function timeLabel_(item) {
  const sep = t_('time.sep');
  if (item.allDay) {
    const s = item.startAt.slice(0, 10);
    const e = item.endAt.slice(0, 10);
    return s === e ? t_('time.allDay') : t_('time.allDay') + ' ' + s.slice(5).replace('-', '/') + sep + e.slice(5).replace('-', '/');
  }
  const sd = item.startAt.slice(0, 10);
  const ed = item.endAt.slice(0, 10);
  if (sd === ed) return item.startAt.slice(11) + sep + item.endAt.slice(11);
  return sd.slice(5).replace('-', '/') + ' ' + item.startAt.slice(11) + sep + ed.slice(5).replace('-', '/') + ' ' + item.endAt.slice(11);
}

/** '2026-09-24' → '9/24' (날짜 형식이 아니면 그대로: 손으로 고친 시트 대비) */
function shortMd_(ymd) {
  const s = String(ymd);
  return isValidYmd_(s) ? Number(s.slice(5, 7)) + '/' + Number(s.slice(8, 10)) : s;
}

/** 작업기록 날짜 문구: 하루 기록 '9/24', 기간 기록 '9/21~9/25' (일본어 '9/21〜9/25') */
function worklogDateLabel_(w) {
  return w.endDate ? shortMd_(w.workDate) + t_('time.sep') + shortMd_(w.endDate) : shortMd_(w.workDate);
}

/** 진행 중 작업기록 전부 (날짜 무관), 작업일(기간 기록은 시작일)이 오래된 순, 같으면 만든 순 */
function listInProgressWorklogs_() {
  return listActiveWorklogs_()
    .filter(function (w) { return w.status === 'IN_PROGRESS'; })
    .sort(function (a, b) {
      if (a.workDate !== b.workDate) return a.workDate < b.workDate ? -1 : 1;
      return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
    });
}

/** 오늘 요약 데이터. 팝업과 메일이 같이 쓴다. */
function buildDigest_(today) {
  const projects = {};
  listProjects_().forEach(function (p) { projects[p.id] = p.name; });
  const withProject = function (s) {
    return Object.assign({}, s, { projectName: s.projectId ? (projects[s.projectId] || '') : '', timeLabel: timeLabel_(s) });
  };

  const schedules = listActiveSchedules_();
  const todays = schedules
    .filter(function (s) { return s.status !== 'CANCELLED' && overlapsRange_(scheduleDateSpan_(s), today, today); })
    .sort(compareForDay_)
    .map(withProject);

  const overdueAll = schedules
    .filter(function (s) { return s.type === 'TASK' && s.status === 'PLANNED' && scheduleDateSpan_(s).end < today; })
    .sort(function (a, b) { return a.endAt < b.endAt ? -1 : a.endAt > b.endAt ? 1 : 0; });

  const inProgressAll = listInProgressWorklogs_();

  const cal = getCalendarEvents_(today, today);
  const meetings = cal.events.sort(compareForDay_).map(function (m) {
    return Object.assign({}, m, { timeLabel: timeLabel_(m) });
  });

  return {
    date: today,
    weekday: weekdayName_(today),
    schedules: todays,
    meetings: meetings,
    calendarError: cal.error,
    overdue: overdueAll.slice(0, LIMITS.OVERDUE_IN_DIGEST).map(withProject),
    overdueTotal: overdueAll.length,
    // v1.10: 진행 중 작업기록 (오래된 순 최대 LIMITS.IN_PROGRESS_IN_DIGEST건)
    inProgress: inProgressAll.slice(0, LIMITS.IN_PROGRESS_IN_DIGEST).map(function (w) {
      return Object.assign({}, w, { projectName: w.projectId ? (projects[w.projectId] || '') : '', dateLabel: worklogDateLabel_(w) });
    }),
    inProgressTotal: inProgressAll.length,
  };
}

/** 보낼 내용이 없는지. 일정이 없어도 진행 중 작업이 있으면 비어 있지 않다 */
function isDigestEmpty_(d) {
  return d.schedules.length === 0 && d.meetings.length === 0 && d.overdueTotal === 0 && d.inProgressTotal === 0;
}

function getWebAppUrl_() {
  try {
    return ScriptApp.getService().getUrl() || '';
  } catch (e) {
    return '';
  }
}

/** 메일 제목·본문. 지금 언어(lang_())로 만든다 — 부르는 쪽이 withLang_으로 메일 언어를 정한다 */
function composeDigestMail_(d) {
  const lang = lang_();
  const md = shortMd_(d.date); // '9/5' (앞의 0 없이)
  const sep = t_('mail.sep');
  // '제목 (메타)' — 괄호 모양은 언어별 (한국어 ' (…)', 일본어 '（…）')
  const open = t_('mail.metaOpen');
  const close = t_('mail.metaClose');
  const withMeta = function (text, meta) { return text + open + meta + close; };
  const subject = t_('mail.subject', appName_(lang), md, d.weekday, d.schedules.length, d.meetings.length, d.overdueTotal, d.inProgressTotal);

  const text = [];
  const html = [];
  const section = function (title, items, render) {
    text.push('■ ' + title);
    html.push('<h3 style="margin:18px 0 6px;font-size:15px;color:#111827">' + escapeHtml_(title) + '</h3>');
    if (!items.length) {
      text.push('  - ' + t_('mail.none'));
      html.push('<p style="margin:0;color:#6b7280;font-size:13px">' + escapeHtml_(t_('mail.none')) + '</p>');
    } else {
      html.push('<ul style="margin:0;padding-left:18px;font-size:14px;line-height:1.7">');
      items.forEach(function (it) {
        const r = render(it);
        text.push('  - ' + r.text);
        html.push('<li>' + r.html + '</li>');
      });
      html.push('</ul>');
    }
    text.push('');
  };

  /** 메일 HTML: 메타 부분(괄호 포함)만 회색 */
  const metaHtml = function (title, meta) {
    return escapeHtml_(title) + '<span style="color:#6b7280">' + escapeHtml_(open + meta + close) + '</span>';
  };

  const renderSchedule = function (s) {
    const high = t_('mail.high');
    const done = t_('mail.done');
    const flags = (s.priority === 'HIGH' ? high + ' ' : '') + (s.status === 'DONE' ? done + ' ' : '');
    const meta = [s.timeLabel, t_(s.type === 'MEETING' ? 'type.MEETING' : 'type.TASK'), s.projectName].filter(function (x) { return x; }).join(sep);
    return {
      text: withMeta(flags + s.title, meta),
      html: (s.priority === 'HIGH' ? '<b style="color:#dc2626">' + escapeHtml_(high) + '</b> ' : '')
        + (s.status === 'DONE' ? '<span style="color:#16a34a">' + escapeHtml_(done) + '</span> ' : '')
        + metaHtml(s.title, meta),
    };
  };

  section(t_('mail.today'), d.schedules, renderSchedule);
  section(t_('mail.meetings'), d.meetings, function (m) {
    const meta = [m.timeLabel, m.location].filter(function (x) { return x; }).join(sep);
    return {
      text: withMeta(m.title, meta),
      html: metaHtml(m.title, meta),
    };
  });
  if (d.calendarError) {
    text.push('※ ' + d.calendarError, '');
    html.push('<p style="color:#b45309;font-size:13px">※ ' + escapeHtml_(d.calendarError) + '</p>');
  }
  if (d.overdueTotal) {
    section(t_('mail.overdue', d.overdueTotal, d.overdue.length), d.overdue, function (s) {
      const meta = [t_('mail.due', s.endAt.slice(0, 10)), s.projectName].filter(function (x) { return x; }).join(sep);
      return {
        text: withMeta(s.title, meta),
        html: metaHtml(s.title, meta),
      };
    });
  }

  if (d.inProgressTotal) {
    section(t_('mail.inProgress', d.inProgressTotal, d.inProgress.length), d.inProgress, function (w) {
      const meta = [w.dateLabel, w.projectName].filter(function (x) { return x; }).join(sep);
      return {
        text: withMeta(w.title, meta),
        html: metaHtml(w.title, meta),
      };
    });
  }

  const url = getWebAppUrl_();
  if (url) {
    text.push(t_('mail.openApp', url));
    html.push('<p style="margin-top:20px"><a href="' + escapeHtml_(url) + '" style="color:#2563eb">' + escapeHtml_(t_('mail.openAppLink', appName_(lang))) + '</a></p>');
  }

  return {
    subject: subject,
    text: text.join('\n'),
    html: '<div lang="' + lang + '" style="font-family:' + escapeHtml_(t_('mail.fontFamily')) + ';max-width:640px">'
      + '<h2 style="margin:0 0 4px;font-size:18px">' + escapeHtml_(t_('mail.heading', d.date, d.weekday)) + '</h2>'
      + html.join('') + '</div>',
  };
}

function getOwnerEmail_() {
  const owner = PropertiesService.getScriptProperties().getProperty(PROP_KEYS.OWNER_EMAIL);
  if (!owner) fail_(ERROR_CODES.NOT_INITIALIZED, t_('err.ownerMissing'));
  return owner;
}

function hasDigestBeenSent_(today) {
  return readAll_(SHEETS.NOTIFY_LOG).some(function (r) {
    return r.kind === 'DIGEST' && r.target_date === today && r.result === 'SENT';
  });
}

function logDigest_(today, result, detail) {
  appendNotifyLog_('DIGEST', today, result, detail);
  return result;
}

/** 락 안에서 실행: 확인 → 발송 → 기록을 한 덩어리로 묶어 중복 발송을 막는다. */
function runDigest_(today) {
  const settings = getSettings_();
  if (!isTrue_(settings.notify_enabled)) return logDigest_(today, 'SKIPPED_DISABLED', '');

  const dow = dayOfWeek_(today);
  if (dow === 0 || dow === 6) return logDigest_(today, 'SKIPPED_WEEKEND', '');

  if (isTrue_(settings.skip_holidays)) {
    const holiday = holidayNameOf_(today);
    if (holiday) return logDigest_(today, 'SKIPPED_HOLIDAY', holiday);
  }

  if (hasDigestBeenSent_(today)) return logDigest_(today, 'SKIPPED_DUPLICATE', '');

  const lang = mailLang_(settings);
  const digest = withLang_(lang, function () { return buildDigest_(today); });
  if (isDigestEmpty_(digest) && !isTrue_(settings.notify_when_empty)) return logDigest_(today, 'SKIPPED_EMPTY', '');

  const mail = withLang_(lang, function () { return composeDigestMail_(digest); });
  MailApp.sendEmail({
    to: getOwnerEmail_(),
    subject: mail.subject,
    body: mail.text,
    htmlBody: mail.html,
    name: appName_(lang),
  });
  return logDigest_(today, 'SENT', 'schedules=' + digest.schedules.length + ', meetings=' + digest.meetings.length
    + ', overdue=' + digest.overdueTotal + ', inProgress=' + digest.inProgressTotal);
}

/**
 * 테스트 메일 (v1.12): 지금 내용으로 아침 메일을 소유자에게 한 통 보낸다.
 * 설정(켜기/끄기·주말·공휴일·빈 날)과 상관없이 보내고, 중복 발송 판단(kind = DIGEST)에는 넣지 않는다.
 * 메일 발송 한도를 지키고 최근 기록이 테스트로 채워지지 않게, 실패를 포함해 하루 LIMITS.TEST_MAIL_PER_DAY번까지.
 */
function sendTestDigest_() {
  return withLock_(function () {
    const today = todayYmd_();
    const sent = readAll_(SHEETS.NOTIFY_LOG).filter(function (r) {
      return r.kind === 'DIGEST_TEST' && r.target_date === today;
    }).length;
    if (sent >= LIMITS.TEST_MAIL_PER_DAY) invalid_(t_('mail.testLimit', LIMITS.TEST_MAIL_PER_DAY));
    // 메일은 내일 아침 메일과 같은 언어로, 오류 문구는 화면 언어로.
    // 메일 언어로 바꾸기 전에 읽을 시트를 먼저 확인해 둔다 (시트가 없을 때의 오류가 화면 언어로 나오게)
    [SHEETS.PROJECTS, SHEETS.SCHEDULES, SHEETS.WORKLOGS].forEach(getSheet_);
    const lang = mailLang_(getSettings_());
    const mail = withLang_(lang, function () {
      const m = composeDigestMail_(buildDigest_(today));
      m.subject = t_('mail.testPrefix') + m.subject;
      return m;
    });
    try {
      MailApp.sendEmail({
        to: getOwnerEmail_(),
        subject: mail.subject,
        body: mail.text,
        htmlBody: mail.html,
        name: appName_(lang),
      });
    } catch (e) {
      appendNotifyLog_('DIGEST_TEST', today, 'FAILED', e && e.message);
      fail_(ERROR_CODES.INTERNAL, t_('mail.testFailed', String(e && e.message).slice(0, 200)));
    }
    appendNotifyLog_('DIGEST_TEST', today, 'SENT', '');
    return { sentToday: sent + 1 };
  });
}

/** 트리거 핸들러 (매일, 설정한 시각 ~ 1시간 사이. 기본 07~08시). */
function sendMorningDigest() {
  beginExecution_(null); // 메일 언어는 runDigest_에서 mailLang_()으로
  const today = todayYmd_();
  let result;
  try {
    result = withLock_(function () { return runDigest_(today); });
  } catch (e) {
    console.error(JSON.stringify({ where: 'sendMorningDigest', date: today, message: e && e.message, stack: e && e.stack }));
    try {
      withLock_(function () { appendNotifyLog_('DIGEST', today, 'FAILED', e && e.message); });
    } catch (logError) {
      console.error(JSON.stringify({ where: 'sendMorningDigest.log', message: logError && logError.message }));
    }
    throw e; // Apps Script 실패 알림 메일로도 알 수 있게 다시 던진다
  }
  console.log(JSON.stringify({ where: 'sendMorningDigest', date: today, result: result }));
  return result;
}
