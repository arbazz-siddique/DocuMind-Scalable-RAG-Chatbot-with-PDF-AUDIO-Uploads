// utils/session.ts
export function getSessionId(): string {
  if (typeof window === 'undefined') return 'default';

  let s = localStorage.getItem('pdfrag_session_id');
  if (!s) {
    s =
      (typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `sess-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
    localStorage.setItem('pdfrag_session_id', s);
  }
  return s;
}
