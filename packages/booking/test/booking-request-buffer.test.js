import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clampBookingRequestBufferMinutes,
  readBookingRequestBufferMinutes,
  bufferAppointmentIntervals,
} from '../src/booking-request-buffer.js';

function hasOverlap(intervals, next) {
  return intervals.some((i) => i.start < next.end && next.start < i.end);
}

test('clampBookingRequestBufferMinutes clamps to 0..1435', () => {
  assert.equal(clampBookingRequestBufferMinutes(undefined), 0);
  assert.equal(clampBookingRequestBufferMinutes(-5), 0);
  assert.equal(clampBookingRequestBufferMinutes(NaN), 0);
  assert.equal(clampBookingRequestBufferMinutes('abc'), 0);
  assert.equal(clampBookingRequestBufferMinutes(0), 0);
  assert.equal(clampBookingRequestBufferMinutes(45), 45);
  assert.equal(clampBookingRequestBufferMinutes(1435), 1435);
  assert.equal(clampBookingRequestBufferMinutes(99999), 1435);
});

test('readBookingRequestBufferMinutes pulls from payload', () => {
  assert.equal(readBookingRequestBufferMinutes(null), 0);
  assert.equal(readBookingRequestBufferMinutes({}), 0);
  assert.equal(readBookingRequestBufferMinutes({ bookingRequestBufferMinutes: 30 }), 30);
  assert.equal(readBookingRequestBufferMinutes({ bookingRequestBufferMinutes: -10 }), 0);
});

test('bufferAppointmentIntervals with buffer 0 returns intervals unchanged', () => {
  const intervals = [{ start: 600, end: 660 }];
  assert.deepEqual(bufferAppointmentIntervals(intervals, 0), [{ start: 600, end: 660 }]);
});

test('bufferAppointmentIntervals with buffer 60 inflates by 60 on each side', () => {
  const intervals = [{ start: 240, end: 300 }]; // 4:00-5:00
  assert.deepEqual(bufferAppointmentIntervals(intervals, 60), [{ start: 180, end: 360 }]);
});

test('bufferAppointmentIntervals clamps to 0..1440', () => {
  const intervals = [{ start: 30, end: 60 }, { start: 1400, end: 1420 }];
  assert.deepEqual(bufferAppointmentIntervals(intervals, 60), [
    { start: 0, end: 120 },
    { start: 1340, end: 1440 },
  ]);
});

test('buffer 60: existing 4:00-5:00 still allows appointment ending exactly at 3:00', () => {
  const existing = bufferAppointmentIntervals([{ start: 240, end: 300 }], 60);
  const newAppt = { start: 120, end: 180 }; // 2:00-3:00
  assert.equal(hasOverlap(existing, newAppt), false);
});

test('buffer 60: existing 4:00-5:00 still allows appointment starting exactly at 6:00', () => {
  const existing = bufferAppointmentIntervals([{ start: 240, end: 300 }], 60);
  const newAppt = { start: 360, end: 420 }; // 6:00-7:00
  assert.equal(hasOverlap(existing, newAppt), false);
});

test('buffer 60: blocks overlapping new appointment inside the buffer window', () => {
  const existing = bufferAppointmentIntervals([{ start: 240, end: 300 }], 60);
  const newAppt = { start: 210, end: 240 }; // 3:30-4:00 overlaps buffered [3:00-6:00]
  assert.equal(hasOverlap(existing, newAppt), true);
});

test('buffer 60: short duration just before buffer boundary is allowed (edge math)', () => {
  const existing = bufferAppointmentIntervals([{ start: 240, end: 300 }], 60);
  const newAppt = { start: 150, end: 180 }; // 2:30-3:00, touching buffer start
  assert.equal(hasOverlap(existing, newAppt), false);
});

test('buffer 60: 30-minute appointment at 6:30 (after buffer end) is allowed', () => {
  const existing = bufferAppointmentIntervals([{ start: 240, end: 300 }], 60);
  const newAppt = { start: 390, end: 420 }; // 6:30-7:00
  assert.equal(hasOverlap(existing, newAppt), false);
});

test('buffer 0 preserves strict adjacency (end==start not overlapping)', () => {
  const existing = bufferAppointmentIntervals([{ start: 240, end: 300 }], 0);
  const newAppt = { start: 300, end: 330 };
  assert.equal(hasOverlap(existing, newAppt), false);
});
