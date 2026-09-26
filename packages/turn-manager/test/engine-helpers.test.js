import test from 'node:test';
import assert from 'node:assert/strict';

import {
  verifyAdminPasswordOnServer,
  normalizeHexColorValue,
  hexToRgb,
  rgbToHex,
  lightenHexColor,
  darkenHexColor,
  getReadableTextColor,
  hexToRgbaString,
  applyTurnThemeStyle,
  makeSettingsStorageKey,
  makeShowAllStorageKey,
  makeSidebarCollapsedStorageKey,
  TURN_THEME_DEFAULTS,
  DEFAULT_STYLE_PALETTE,
  DEFAULT_APPT_HOUR_LINE_COLOR,
} from '../src/engine/helpers.js';

test('verifyAdminPasswordOnServer validates input and returns server payload', async () => {
  const empty = await verifyAdminPasswordOnServer('');
  assert.equal(empty.ok, false);
  assert.ok(empty.message.includes('Password'));

  let called = false;
  const mockFetch = async (url, opts) => {
    called = true;
    assert.equal(url, '/api/admin/verify');
    assert.equal(opts.method, 'POST');
    return {
      ok: true,
      status: 200,
      redirected: false,
      headers: { get: () => 'application/json' },
      json: async () => ({ ok: true, expires_in: 120 }),
    };
  };
  const success = await verifyAdminPasswordOnServer('secret', null, mockFetch);
  assert.equal(success.ok, true);
  assert.equal(success.expiresIn, 120);
  assert.equal(called, true);
});

test('hex helpers normalize and convert colors', () => {
  assert.equal(normalizeHexColorValue('abc'), '#aabbcc');
  assert.equal(normalizeHexColorValue('#123456'), '#123456');
  assert.equal(rgbToHex({ r: 255, g: 0, b: 128 }), '#ff0080');
  assert.deepEqual(hexToRgb('#ff0080'), { r: 255, g: 0, b: 128 });
  assert.equal(lightenHexColor('#000000', 0.5), '#808080');
  assert.equal(darkenHexColor('#ffffff', 0.5), '#808080');
  const readable = getReadableTextColor('#ffffff');
  assert.ok(readable === '#1f2739' || readable === '#1f1f1f');
  assert.equal(hexToRgbaString('#336699', 0.5), 'rgba(51, 102, 153, 0.5)');
});

test('applyTurnThemeStyle sets CSS variables', () => {
  const assigned = {};
  const previous = global.document;
  global.document = {
    documentElement: {
      style: {
        setProperty: (key, value) => { assigned[key] = value; },
      },
    },
  };
  try {
    applyTurnThemeStyle({
      turnButtonColor: '#101010',
      turnServiceAccentColor: '#222222',
      turnTechNameColor: '#333333',
      turnSkipColor: '#444444',
      apptHighlightColor: '#555555',
      apptHourLineColor: '#666666',
    });
  } finally {
    if (previous === undefined) {
      delete global.document;
    } else {
      global.document = previous;
    }
  }
  assert.equal(assigned['--tm-button-color'], '#101010');
  assert.equal(assigned['--tm-service-accent-color'], '#222222');
  assert.equal(assigned['--tm-tech-name-color'], '#333333');
  assert.equal(assigned['--appt-highlight-color'], '#555555');
  assert.equal(DEFAULT_APPT_HOUR_LINE_COLOR, '#6b7280');
  assert.equal(assigned['--hour-border-color'], hexToRgbaString('#6b7280', 0.4));
});

test('storage key builders normalize usernames and board keys', () => {
  assert.equal(makeSettingsStorageKey(' Aster '), 'salon_settings_v1:Aster');
  assert.equal(makeSettingsStorageKey(''), `salon_settings_v1:guest`);
  assert.equal(makeShowAllStorageKey('boardKey'), 'boardKey:showAllAvailable');
  assert.equal(makeSidebarCollapsedStorageKey('boardKey'), 'boardKey:sidebarCollapsed');
  assert.ok(TURN_THEME_DEFAULTS.buttonColor);
  assert.ok(DEFAULT_STYLE_PALETTE.apptHighlightColor);
});
