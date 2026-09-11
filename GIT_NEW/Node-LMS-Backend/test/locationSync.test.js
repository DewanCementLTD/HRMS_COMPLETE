import test from 'node:test';
import assert from 'node:assert/strict';

import {
  validatePoint,
  parseRecordedAt,
  isShiftOver,
  toMinutes,
} from '../src/services/locationSync.service.js';
import {
  issueEmployeeToken,
  verifyEmployeeToken,
  sessionOwnsCard,
} from '../src/services/employeeSession.service.js';

// These cover the decisions the offline sync gets wrong silently — a bad point
// accepted, a capture time rewritten, a checkout misread as final. The database
// paths are exercised separately against Oracle (see the sync integration run),
// because they need real rows and a real unique index.

const point = (over = {}) => ({
  client_event_id: 'e1',
  latitude: 24.8607,
  longitude: 67.0011,
  accuracy: 7.25,
  recorded_at: '2026-09-04T10:00:00+05:00',
  ...over,
});

// ── Point validation ────────────────────────────────────────────────

test('a well-formed point passes', () => {
  assert.equal(validatePoint(point()), null);
});

test('coordinates outside the globe are rejected', () => {
  assert.equal(validatePoint(point({ latitude: 91 })), 'LATITUDE_OUT_OF_RANGE');
  assert.equal(validatePoint(point({ latitude: -90.1 })), 'LATITUDE_OUT_OF_RANGE');
  assert.equal(validatePoint(point({ longitude: 180.5 })), 'LONGITUDE_OUT_OF_RANGE');
  assert.equal(validatePoint(point({ longitude: -181 })), 'LONGITUDE_OUT_OF_RANGE');
});

test('the exact edges of the globe are accepted', () => {
  assert.equal(validatePoint(point({ latitude: 90, longitude: 180 })), null);
  assert.equal(validatePoint(point({ latitude: -90, longitude: -180 })), null);
});

test('0,0 is rejected as a fabricated fix', () => {
  // A phone with no fix reports Null Island rather than failing; accepting it
  // would drop the employee in the Gulf of Guinea on the HR map.
  assert.equal(validatePoint(point({ latitude: 0, longitude: 0 })), 'FABRICATED_COORDINATES');
  assert.equal(
    validatePoint(point({ latitude: 0.00001, longitude: -0.00002 })),
    'FABRICATED_COORDINATES',
  );
});

test('a genuine coordinate near a zero axis is still accepted', () => {
  // Only the origin is suspect — the equator and the prime meridian are real.
  assert.equal(validatePoint(point({ latitude: 0, longitude: 32.5 })), null);
  assert.equal(validatePoint(point({ latitude: 51.47, longitude: 0 })), null);
});

test('non-numeric coordinates are rejected', () => {
  assert.equal(validatePoint(point({ latitude: 'north' })), 'INVALID_COORDINATES');
  assert.equal(validatePoint(point({ longitude: null })), 'INVALID_COORDINATES');
});

test('accuracy is optional but must be sane when present', () => {
  assert.equal(validatePoint(point({ accuracy: null })), null);
  assert.equal(validatePoint(point({ accuracy: undefined })), null);
  assert.equal(validatePoint(point({ accuracy: 0 })), null);
  assert.equal(validatePoint(point({ accuracy: -1 })), 'INVALID_ACCURACY');
  assert.equal(validatePoint(point({ accuracy: 999999 })), 'INVALID_ACCURACY');
});

// ── Capture timestamps ──────────────────────────────────────────────

test('an offset is stripped, not converted', () => {
  // The 16,000 rows already in LOCATION_TRACKS are local wall-clock. Converting
  // to UTC here would put new rows on a different clock from the old ones.
  assert.equal(parseRecordedAt('2026-09-04T10:00:00+05:00'), '2026-09-04 10:00:00.000000');
  assert.equal(parseRecordedAt('2026-09-04T10:00:00Z'), '2026-09-04 10:00:00.000000');
  assert.equal(parseRecordedAt('2026-09-04T10:00:00'), '2026-09-04 10:00:00.000000');
});

test('sub-second precision survives', () => {
  assert.equal(parseRecordedAt('2026-09-04T10:00:00.123456'), '2026-09-04 10:00:00.123456');
});

test('an unparseable time is rejected rather than replaced with now', () => {
  // The older endpoint substitutes the current time here. That silently files
  // the point at the wrong moment in the trail, which is worse than losing it.
  assert.equal(parseRecordedAt('yesterday'), null);
  assert.equal(parseRecordedAt(''), null);
  assert.equal(parseRecordedAt(null), null);
  assert.equal(parseRecordedAt('04-09-2026 10:00:00'), null);
});

test('a date the calendar does not have is rejected', () => {
  assert.equal(parseRecordedAt('2026-02-31T10:00:00'), null);
  assert.equal(parseRecordedAt('2026-13-01T10:00:00'), null);
  assert.equal(parseRecordedAt('2026-09-04T25:00:00'), null);
  assert.equal(parseRecordedAt('2026-09-04T10:61:00'), null);
});

test('a leap day in a leap year is accepted', () => {
  assert.equal(parseRecordedAt('2028-02-29T10:00:00'), '2028-02-29 10:00:00.000000');
  assert.equal(parseRecordedAt('2026-02-29T10:00:00'), null);
});

// ── Shift window ────────────────────────────────────────────────────

test('minutes since midnight', () => {
  assert.equal(toMinutes('09:00'), 540);
  assert.equal(toMinutes('17:30'), 1050);
  assert.equal(toMinutes('00:00'), 0);
  assert.equal(toMinutes(''), null);
  assert.equal(toMinutes('99:99'), null);
});

test('a day shift ends when the clock passes its end time', () => {
  assert.equal(isShiftOver('17:00', '09:00', toMinutes('15:00')), false);
  assert.equal(isShiftOver('17:00', '09:00', toMinutes('16:59')), false);
  assert.equal(isShiftOver('17:00', '09:00', toMinutes('17:00')), true);
  assert.equal(isShiftOver('17:00', '09:00', toMinutes('17:05')), true);
});

test('an overnight shift runs from its start through to its end', () => {
  // Branch 17 runs 13:00–02:30. Comparing clock times naively would call 14:00
  // "past" a 02:30 end and stop tracking an hour into the shift.
  assert.equal(isShiftOver('02:30', '13:00', toMinutes('13:00')), false);
  assert.equal(isShiftOver('02:30', '13:00', toMinutes('14:00')), false);
  assert.equal(isShiftOver('02:30', '13:00', toMinutes('23:59')), false);
  assert.equal(isShiftOver('02:30', '13:00', toMinutes('00:30')), false);
  assert.equal(isShiftOver('02:30', '13:00', toMinutes('02:29')), false);
});

test('an overnight shift does end, in the gap before its next start', () => {
  // The other half: without this a night worker's checkout stays INTERMEDIATE
  // for ever and tracking never stops.
  assert.equal(isShiftOver('02:30', '13:00', toMinutes('02:30')), true);
  assert.equal(isShiftOver('02:30', '13:00', toMinutes('09:00')), true);
  assert.equal(isShiftOver('02:30', '13:00', toMinutes('12:59')), true);
});

test('an unknown shift end is unknowable, not "over"', () => {
  // REST days carry no times. Returning null lets the caller decide, rather
  // than silently claiming the shift has ended.
  assert.equal(isShiftOver(null, '09:00', 600), null);
  assert.equal(isShiftOver('', '', 600), null);
});

// ── Session tokens ──────────────────────────────────────────────────

test('a token round-trips to its own card', () => {
  const token = issueEmployeeToken('100002.1', 'device-abc');
  const session = verifyEmployeeToken(token);
  assert.equal(session.card_no, '100002.1');
  assert.equal(session.device_id, 'device-abc');
});

test('a tampered token is refused', () => {
  const token = issueEmployeeToken('100002.1');
  const [payload, sig] = token.split('.');

  // Re-signing someone else's card with the original signature must not work.
  const forged = Buffer.from(JSON.stringify({ c: '100999.1', exp: Date.now() + 1000 })).toString(
    'base64url',
  );
  assert.equal(verifyEmployeeToken(`${forged}.${sig}`), null);
  assert.equal(verifyEmployeeToken(`${payload}.${sig}x`), null);
  assert.equal(verifyEmployeeToken('rubbish'), null);
  assert.equal(verifyEmployeeToken(''), null);
});

test('an expired token is refused', () => {
  const past = Buffer.from(JSON.stringify({ c: '100002.1', exp: Date.now() - 1 })).toString(
    'base64url',
  );
  // Stale, so refused whether or not the signature checks out.
  assert.equal(verifyEmployeeToken(`${past}.anything`), null);
});

test('a session may only act for its own card', () => {
  const session = { card_no: '100002.1' };
  assert.equal(sessionOwnsCard(session, '100002.1'), true);
  // The same person reaches this API as both forms depending on the screen.
  assert.equal(sessionOwnsCard(session, '100002'), true);
  // A colleague's card is not this session's to submit for.
  assert.equal(sessionOwnsCard(session, '100003.1'), false);
  assert.equal(sessionOwnsCard(null, '100002.1'), false);
});
