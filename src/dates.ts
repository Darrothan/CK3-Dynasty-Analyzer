export type DateQuality = 'valid' | 'missing' | 'invalid' | 'placeholder';
export interface ParsedDate {
  quality: DateQuality;
  key: number | null;
  year: number | null;
  month: number | null;
  day: number | null;
}

export function parseDate(value: string | null): ParsedDate {
  const empty = (quality: DateQuality): ParsedDate => ({ quality, key: null, year: null, month: null, day: null });
  if (value === null || !value.trim()) return empty('missing');
  const match = /^(-?\d{1,4})\.(\d{1,2})\.(\d{1,2})$/.exec(value);
  if (!match) return empty('invalid');
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1]) return empty('invalid');
  if ((year === 9999 || year === 1 || year === 0) && month === 1 && day === 1) return empty('placeholder');
  return { quality: 'valid', key: year * 10000 + month * 100 + day, year, month, day };
}

export function ageAt(birth: string | null, end: string | null): number | null {
  const a = parseDate(birth), b = parseDate(end);
  if (a.key === null || b.key === null || a.year === null || b.year === null || a.month === null || b.month === null || a.day === null || b.day === null || a.key > b.key) return null;
  return b.year - a.year - (b.month < a.month || (b.month === a.month && b.day < a.day) ? 1 : 0);
}

export interface CharacterLifetime {
  birth: string | null;
  death: string | null;
  status: 'Living' | 'Deceased';
  snapshotDate: string | null;
}

export function ageAtHistoricalDate(lifetime: CharacterLifetime, date: string): number | null {
  const birth = parseDate(lifetime.birth), death = parseDate(lifetime.death);
  const snapshot = parseDate(lifetime.snapshotDate), target = parseDate(date);
  if (birth.key === null || snapshot.key === null || target.key === null || birth.key > snapshot.key || target.key > snapshot.key) return null;
  if (lifetime.status === 'Living' && lifetime.death !== null) return null;
  if (lifetime.status === 'Deceased' && (death.key === null || death.key > snapshot.key || death.key < birth.key || target.key > death.key)) return null;
  return ageAt(lifetime.birth, date);
}

export function ageAtDeath(lifetime: CharacterLifetime): number | null {
  if (lifetime.status !== 'Deceased' || lifetime.death === null) return null;
  return ageAtHistoricalDate(lifetime, lifetime.death);
}
