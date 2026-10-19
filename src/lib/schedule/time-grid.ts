import { addDaysToKey, hospitalInstant, hospitalMinutesOfDay } from "@/lib/timezone";

/**
 * Pure placement math for the 24-hour schedule time grid
 * (`src/features/schedule/time-grid.tsx`). Columns are hospital calendar days
 * (day keys, see `src/lib/timezone.ts`); anything with a start and an end - a
 * shift, an availability row - is cut into one segment per day it touches, so
 * a 19:00-07:00 night shift draws as 19:00-24:00 on its first day and
 * 00:00-07:00 on the next. Minutes are hospital-clock minutes (0-1440).
 */

export const MINUTES_PER_DAY = 1440;

export interface TimedItem {
  startsAt: Date;
  endsAt: Date;
}

export interface DaySegment<T extends TimedItem> {
  item: T;
  dayKey: string;
  /** 0-1440, hospital clock. */
  startMinute: number;
  /** 0-1440, hospital clock; 1440 = runs to midnight. */
  endMinute: number;
  /** The item started on an earlier day (this segment begins at 00:00). */
  continuesFromPreviousDay: boolean;
  /** The item ends on a later day (this segment runs to 24:00). */
  continuesToNextDay: boolean;
}

interface DayBounds {
  dayKey: string;
  start: Date;
  end: Date;
}

function boundsFor(dayKeys: string[]): DayBounds[] {
  return dayKeys.map((dayKey) => ({
    dayKey,
    start: hospitalInstant(dayKey, 0),
    end: hospitalInstant(addDaysToKey(dayKey, 1), 0),
  }));
}

function segmentFor<T extends TimedItem>(item: T, day: DayBounds): DaySegment<T> | null {
  if (!(item.startsAt < day.end && item.endsAt > day.start)) return null;
  const continuesFromPreviousDay = item.startsAt < day.start;
  const continuesToNextDay = item.endsAt > day.end;
  const startMinute = continuesFromPreviousDay ? 0 : hospitalMinutesOfDay(item.startsAt);
  let endMinute = item.endsAt >= day.end ? MINUTES_PER_DAY : hospitalMinutesOfDay(item.endsAt);
  // A DST fall-back hour can make the wall-clock end read earlier than the
  // start; keep the block visible rather than inverted.
  if (endMinute <= startMinute) endMinute = Math.min(MINUTES_PER_DAY, startMinute + 15);
  return { item, dayKey: day.dayKey, startMinute, endMinute, continuesFromPreviousDay, continuesToNextDay };
}

/** One segment per listed day the item overlaps (half-open: touching midnight is not overlapping). */
export function splitIntoDaySegments<T extends TimedItem>(item: T, dayKeys: string[]): DaySegment<T>[] {
  return boundsFor(dayKeys)
    .map((day) => segmentFor(item, day))
    .filter((s): s is DaySegment<T> => s !== null);
}

/** Every item's segments, bucketed by day key and sorted by start. */
export function segmentsByDay<T extends TimedItem>(items: T[], dayKeys: string[]): Map<string, DaySegment<T>[]> {
  const days = boundsFor(dayKeys);
  const byDay = new Map<string, DaySegment<T>[]>(dayKeys.map((k) => [k, []]));
  for (const item of items) {
    for (const day of days) {
      const segment = segmentFor(item, day);
      if (segment) byDay.get(day.dayKey)!.push(segment);
    }
  }
  for (const list of Array.from(byDay.values())) {
    list.sort((a, b) => a.startMinute - b.startMinute || b.endMinute - a.endMinute);
  }
  return byDay;
}

export interface LaidOutSegment<T extends TimedItem> extends DaySegment<T> {
  /** 0-based column inside its overlap cluster. */
  lane: number;
  /** How many columns its overlap cluster needs. */
  laneCount: number;
}

/**
 * Side-by-side columns for overlapping segments in one day (a double booking
 * must show both shifts, not stack one invisibly on the other). Segments that
 * merely touch (one ends 19:00, the next starts 19:00) share a lane.
 */
export function layoutLanes<T extends TimedItem>(segments: DaySegment<T>[]): LaidOutSegment<T>[] {
  const sorted = [...segments].sort((a, b) => a.startMinute - b.startMinute || b.endMinute - a.endMinute);
  const result: LaidOutSegment<T>[] = [];
  let cluster: LaidOutSegment<T>[] = [];
  let clusterEnd = -1;
  let laneEnds: number[] = [];

  function closeCluster() {
    for (const s of cluster) s.laneCount = laneEnds.length;
    result.push(...cluster);
    cluster = [];
    laneEnds = [];
  }

  for (const segment of sorted) {
    if (cluster.length > 0 && segment.startMinute >= clusterEnd) closeCluster();
    let lane = laneEnds.findIndex((end) => end <= segment.startMinute);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(segment.endMinute);
    } else {
      laneEnds[lane] = segment.endMinute;
    }
    cluster.push({ ...segment, lane, laneCount: 0 });
    clusterEnd = Math.max(cluster.length === 1 ? 0 : clusterEnd, segment.endMinute);
  }
  if (cluster.length > 0) closeCluster();
  return result;
}

/** `07:00`; 1440 renders as `24:00`. */
export function minuteLabel(minute: number): string {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
