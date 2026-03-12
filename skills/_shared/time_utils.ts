/** Compact timestamp "260311-1430" */
export function getTs(): string {
  const now = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" });
  return now.replace(/^20(\d{2})-(\d{2})-(\d{2}) (\d{2}):(\d{2}).*/, "$1$2$3-$4$5");
}

/** Display format "2026-03-11 14:30" */
export function getDisplay(): string {
  const now = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" });
  return now.slice(0, 16);
}

/** Hours:minutes only "14:30" */
export function getHhmm(): string {
  const now = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" });
  return now.slice(11, 16);
}

/** ISO format "2026-03-11T14:30:00+08:00" */
export function getTsIso(): string {
  const now = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" });
  const [date, time] = now.slice(0, 16).split(" ");
  return `${date}T${time}:00+08:00`;
}
