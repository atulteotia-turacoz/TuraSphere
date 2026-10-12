// One place to turn an axios error into something a person can read.
//
// FastAPI answers a validation failure with 422 and a `detail` that is an ARRAY
// of objects, not a string:
//   [{ loc: ["body","kol_ids",0], msg: "Input should be a valid integer", ... }]
// Passing that to alert() or into JSX prints "[object Object]" and hides the
// actual problem — which is exactly how the board's KOL assignment failed
// silently for as long as it did.
export function errorMessage(e, fallback = 'Something went wrong.') {
  const detail = e?.response?.data?.detail;

  if (typeof detail === 'string' && detail.trim()) return detail;

  if (Array.isArray(detail)) {
    const parts = detail.map(d => {
      if (typeof d === 'string') return d;
      // Drop the leading "body" so the field name leads: "kol_ids.0: …".
      const field = Array.isArray(d?.loc)
        ? d.loc.filter(x => x !== 'body').join('.')
        : '';
      const msg = d?.msg || d?.message || JSON.stringify(d);
      return field ? `${field}: ${msg}` : msg;
    });
    if (parts.length) return parts.join('; ');
  }

  if (detail && typeof detail === 'object') {
    return detail.msg || detail.message || JSON.stringify(detail);
  }

  return e?.message || fallback;
}
