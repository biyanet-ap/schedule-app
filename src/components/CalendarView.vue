<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import FullCalendar from '@fullcalendar/vue3';
import type { CalendarOptions, DatesSetInfo, EventClickInfo, EventInput } from '@fullcalendar/vue3';
import classicThemePlugin from '@fullcalendar/vue3/themes/classic';
import dayGridPlugin from '@fullcalendar/vue3/daygrid';
import listPlugin from '@fullcalendar/vue3/list';
import interactionPlugin from '@fullcalendar/vue3/interaction';
import koLocale from '@fullcalendar/vue3/locales/ko';
import jaLocale from '@fullcalendar/vue3/locales/ja';
import '@fullcalendar/vue3/skeleton.css';
import '@fullcalendar/vue3/themes/classic/theme.css';
import '@fullcalendar/vue3/themes/classic/palette.css';
import { addDays } from '../utils/date';
import type { EventMeta } from '../utils/events';
import { lang, tr } from '../i18n';

const props = defineProps<{
  events: EventInput[];
  holidays: Set<string>;
  selectedDate: string;
  initialDate: string;
  mobile: boolean;
  dark: boolean;
}>();

const emit = defineEmits<{
  dateClick: [date: string];
  eventClick: [meta: EventMeta];
  rangeChange: [range: { from: string; to: string }];
}>();

const calendar = ref<InstanceType<typeof FullCalendar> | null>(null);

/**
 * FullCalendar v7은 날짜 칸의 Date를 "그 날 JST 0시의 실제 시각"으로 넘겨준다.
 * (예: 9/29 칸 = 2026-09-28T15:00Z) 그래서 반드시 JST 기준으로 날짜를 읽는다.
 */
const JST_YMD = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' });
function markerToYmd(d: Date): string {
  return JST_YMD.format(d);
}

const options = computed<CalendarOptions>(() => {
  // 콜백 안에서만 읽으면 Vue가 의존성을 추적하지 못한다 → 여기서 읽어서 값이 바뀌면 옵션이 새로 만들어지게 한다.
  const holidays = props.holidays;
  const selectedDate = props.selectedDate;
  const locale = lang.value === 'ja' ? jaLocale : koLocale;
  const noEventsText = tr.value.calendar.noEvents;
  const timeSep = tr.value.date.timeSep;
  /** 토·일·공휴일은 날짜 숫자를 빨간색으로 (일정 글자색은 건드리지 않도록 숫자 영역에만 클래스) */
  const redDay = (info: { date: Date; dow: number }) => (info.dow === 0 || info.dow === 6 || holidays.has(markerToYmd(info.date)) ? 'day-red' : '');
  return {
  plugins: [classicThemePlugin, dayGridPlugin, listPlugin, interactionPlugin],
  initialView: props.mobile ? 'listMonth' : 'dayGridMonth',
  initialDate: props.initialDate,
  locale,
  timeZone: 'Asia/Tokyo',
  colorScheme: props.dark ? 'dark' : 'light',
  headerToolbar: false,
  height: 'auto',
  fixedWeekCount: false,
  dayCellFormat: (info) => String(info.date.day), // '24일'·'24日' 대신 '24'
  dayMaxEvents: 4,
  navLinks: true,
  eventOrder: 'order,start,-duration,title',
  // 'HH:mm' / 'HH:mm~HH:mm'을 직접 만든다. Intl 범위 표기는 일본어에서 '9時00分～10時00分'이 되어 목록 보기가 넘친다 (v1.13)
  eventTimeFormat: (arg: { start: { hour: number; minute: number }; end?: { hour: number; minute: number } | null }) => {
    const hm = (t: { hour: number; minute: number }) => `${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`;
    return arg.end ? `${hm(arg.start)}${timeSep}${hm(arg.end)}` : hm(arg.start);
  },
  noEventsText,
  events: props.events,
  dayCellClass: (info) => {
    const ymd = markerToYmd(info.date);
    return [holidays.has(ymd) ? 'is-holiday' : '', ymd === selectedDate ? 'is-selected' : ''].filter(Boolean).join(' ');
  },
  dayCellTopClass: redDay,
  listDayHeaderInnerClass: redDay,
  dateClick: (info) => emit('dateClick', info.dateStr.slice(0, 10)),
  navLinkDayClick: (date: Date) => emit('dateClick', markerToYmd(date)),
  eventClick: (info: EventClickInfo) => {
    info.jsEvent.preventDefault();
    const meta = info.event.extendedProps as EventMeta;
    if (meta.kind !== 'holiday') emit('eventClick', meta);
  },
  datesSet: (info: DatesSetInfo) => {
    emit('rangeChange', {
      from: info.startStr.slice(0, 10),
      to: addDays(info.endStr.slice(0, 10), -1),
    });
  },
  };
});

watch(() => props.mobile, (mobile) => {
  calendar.value?.getApi().changeView(mobile ? 'listMonth' : 'dayGridMonth');
});

defineExpose({
  prev: () => calendar.value?.getApi().prev(),
  next: () => calendar.value?.getApi().next(),
  today: () => calendar.value?.getApi().today(),
  gotoDate: (ymd: string) => calendar.value?.getApi().gotoDate(ymd),
});
</script>

<template>
  <div class="calendar-wrap">
    <FullCalendar ref="calendar" :options="options" />
  </div>
</template>

<style scoped>
.calendar-wrap { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 8px; }
.calendar-wrap :deep(a) { cursor: pointer; }
</style>
