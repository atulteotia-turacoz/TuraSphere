// "Dr. Rekha Mittal" — the honorific lives in its own `title` field.
export const TITLES = ['Dr.', 'Prof.', 'Mr.', 'Mrs.', 'Ms.'];

export const kolName = (k, fallback = '') =>
  [k?.title, k?.first_name, k?.last_name].filter(Boolean).join(' ').trim() || fallback;
