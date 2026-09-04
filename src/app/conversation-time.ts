/**
 * Sidebar row timestamps (§36-39): compact relative times that hand over to
 * short dates. Formatting uses date-fns primitives + the active i18n language
 * (zh-CN: 刚刚/3 分/昨天/09-03; en: now/3m/yesterday/Sep 3); full local
 * timestamps for tooltips come from formatFullTimestamp.
 */
import {
  differenceInCalendarDays,
  differenceInHours,
  differenceInMinutes,
  format,
  getYear,
} from "date-fns";
import { enUS, zhCN } from "date-fns/locale";

function isChinese(language: string): boolean {
  return language.toLowerCase().startsWith("zh");
}

export function formatSidebarTime(timestamp: number, language: string, now = Date.now()): string {
  const zh = isChinese(language);
  const date = new Date(timestamp);
  const minutes = differenceInMinutes(now, timestamp);
  if (minutes < 1) return zh ? "刚刚" : "now";
  if (minutes < 60) return zh ? `${minutes} 分` : `${minutes}m`;
  const hours = differenceInHours(now, timestamp);
  if (hours < 24) return zh ? `${hours} 小时` : `${hours}h`;
  if (differenceInCalendarDays(now, timestamp) === 1) return zh ? "昨天" : "yesterday";
  const sameYear = getYear(date) === getYear(now);
  if (sameYear) return format(date, zh ? "MM-dd" : "MMM d", { locale: zh ? zhCN : enUS });
  return format(date, zh ? "yyyy-MM-dd" : "MMM d, yyyy", { locale: zh ? zhCN : enUS });
}

/** Full local timestamp for tooltips, e.g. 2026-09-04 14:20. */
export function formatFullTimestamp(timestamp: number): string {
  return format(new Date(timestamp), "yyyy-MM-dd HH:mm");
}
