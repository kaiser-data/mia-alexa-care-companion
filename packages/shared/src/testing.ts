/** Local New York time in October 2026 (EDT, UTC-4) → Date. Test helper only. */
export const at = (local: string): Date => new Date(`${local}-04:00`);
