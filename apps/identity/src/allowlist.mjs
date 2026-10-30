export function parseAllowedEmails(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('ALLOWED_EMAILS_JSON is required and must be a non-empty JSON array');
  let parsed;
  try { parsed = JSON.parse(value); } catch { throw new Error('ALLOWED_EMAILS_JSON must be a JSON array'); }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.some((email) => typeof email !== 'string' || !email.trim() || email !== email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    throw new Error('ALLOWED_EMAILS_JSON must be a non-empty array of exact email addresses');
  }
  const normalized = parsed.map((email) => email.toLowerCase());
  if (new Set(normalized).size !== normalized.length) throw new Error('ALLOWED_EMAILS_JSON must not contain duplicates');
  return new Set(normalized);
}

export function allowedEmail(value, allowlist = new Set()) {
  return typeof value === 'string' && allowlist instanceof Set && allowlist.has(value.trim().toLowerCase());
}
