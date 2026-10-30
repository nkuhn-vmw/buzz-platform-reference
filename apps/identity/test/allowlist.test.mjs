import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedEmail, parseAllowedEmails } from '../src/allowlist.mjs';

test('allowlist configuration fails closed on missing, malformed, empty, duplicate, or invalid entries', () => {
  for (const value of [undefined, '', 'not-json', '{}', '[]', '[" "]', '["a@example.org",2]', '["a@example.org","A@EXAMPLE.ORG"]']) {
    assert.throws(() => parseAllowedEmails(value), undefined, String(value));
  }
});

test('allowlist matches exact addresses after case and outer whitespace normalization', () => {
  const allowlist = parseAllowedEmails('["pilot@example.org"]');
  assert.equal(allowedEmail(' Pilot@Example.org ', allowlist), true);
  assert.equal(allowedEmail('pilot+tag@example.org', allowlist), false);
  assert.equal(allowedEmail('pilot@evil-example.org', allowlist), false);
  assert.equal(allowedEmail('pilot@example.org'), false);
});
