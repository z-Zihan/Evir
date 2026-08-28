// Local-timezone YYYY-MM-DD bucket key. Log files are named with this stamp
// and the diagnostics export/usage analytics group by it — they must agree or
// day-scoped exports miss files. Not UTC on purpose: it buckets by the user's
// calendar day.
export function localDateStamp(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
