/**
 * Shared helpers for the Turn Manager experience.
 * Exposes ES module exports and attaches to window.TurnManagerEngineHelpers
 * for legacy scripts.
 */

const ADMIN_VERIFY_ENDPOINT = '/api/admin/verify';
const SETTINGS_KEY_PREFIX = 'salon_settings_v1';
const BOARD_KEY_PREFIX = 'salon_turn_manager_v2_board_state';

const TURN_THEME_DEFAULTS = {
  buttonColor: '#E6C57D',
  serviceAccentColor: '#c6a15b',
  techNameColor: '#b88618',
  skipColor: '#b88618',
};

const DEFAULT_STYLE_PALETTE = {
  apptHighlightColor: '#c5a662',
};
const DEFAULT_APPT_HOUR_LINE_COLOR = '#6b7280';

const WHITE_RGB = { r: 255, g: 255, b: 255 };
const BLACK_RGB = { r: 0, g: 0, b: 0 };

function tr(key, fallback, vars) {
  const lib = (typeof window !== 'undefined' && window.AuraI18n);
  if (lib && typeof lib.t === 'function') return lib.t(key, fallback, vars);
  return fallback || '';
}

function normalizeUsername(value) {
  if (!value) return 'guest';
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : 'guest';
}

function withClientUserHeader(headers = {}) {
  const next = { ...(headers || {}) };
  if (typeof window === 'undefined') return next;
  const guard = window.SessionClientGuard;
  if (guard && typeof guard.withClientUserHeader === 'function') {
    try { return guard.withClientUserHeader(next); } catch (_) {}
  }
  const userId = Number(window.CURRENT_USER_ID);
  if (Number.isFinite(userId) && userId > 0) next['x-client-user-id'] = String(Math.trunc(userId));
  return next;
}

function handleAdminSessionMismatch(payload) {
  const reason = String(payload?.reason || '').trim();
  if (!['session_mismatch', 'session_rotated', 'missing_client_identity'].includes(reason)) return false;
  const guard = typeof window !== 'undefined' ? window.SessionClientGuard : null;
  guard?.blockWritesForSessionMismatch?.({ reason, message: 'Session changed. Reloadingâ€¦', reload: true });
  return true;
}

export async function verifyAdminPasswordOnServer(password, scope = null, fetchImpl = (url, opts) => fetch(url, opts)) {
  const value = (password || '').trim();
  if (!value) {
    return { ok: false, message: tr('tm.passwordRequired', 'Password required') };
  }
  try {
    const resp = await fetchImpl(ADMIN_VERIFY_ENDPOINT, {
      method: 'POST',
      headers: withClientUserHeader({ 'Content-Type': 'application/json' }),
      credentials: 'include',
      body: JSON.stringify(scope ? { password: value, scope } : { password: value }),
    });
    const headers = resp?.headers;
    const contentType = typeof headers?.get === 'function' ? headers.get('content-type') || '' : '';
    if (resp.status === 401 || resp.redirected || !contentType.includes('application/json')) {
      return { ok: false, message: tr('tm.sessionExpiredLoginAgain', 'Session expired. Please log in again.') };
    }
    const data = await resp.json().catch(() => ({}));
    if (handleAdminSessionMismatch(data)) {
      return { ok: false, message: 'Session changed. Reloadingâ€¦', reason: data.reason };
    }
    if (resp.ok && data && data.ok) {
      return { ok: true, expiresIn: data.expires_in ?? null };
    }
    const message = (data && data.error) ? data.error : tr('tm.incorrectPassword', 'Incorrect password');
    return { ok: false, message };
  } catch (err) {
    console.error('admin verification failed', err);
    return { ok: false, message: tr('tm.unableVerifyPassword', 'Unable to verify password') };
  }
}

export function normalizeHexColorValue(value) {
  if (typeof value !== 'string') return '';
  let normalized = value.trim();
  if (!normalized) return '';
  if (normalized[0] !== '#') normalized = `#${normalized}`;
  if (/^#([0-9a-f]{3})$/i.test(normalized)) {
    normalized = `#${normalized.slice(1).split('').map(ch => ch + ch).join('')}`;
  }
  return /^#([0-9a-f]{6})$/i.test(normalized) ? normalized.toLowerCase() : '';
}

export function hexToRgb(hex) {
  const normalized = normalizeHexColorValue(hex);
  if (!normalized) return null;
  const intVal = parseInt(normalized.slice(1), 16);
  return {
    r: (intVal >> 16) & 255,
    g: (intVal >> 8) & 255,
    b: intVal & 255,
  };
}

export function rgbToHex(rgb) {
  if (!rgb) return '';
  const toHex = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
}

function mixHexColors(baseHex, mixHex, ratio) {
  const base = hexToRgb(baseHex) || hexToRgb(mixHex) || WHITE_RGB;
  const mix = hexToRgb(mixHex) || base;
  const w = Math.min(Math.max(ratio, 0), 1);
  const rgb = {
    r: base.r * (1 - w) + mix.r * w,
    g: base.g * (1 - w) + mix.g * w,
    b: base.b * (1 - w) + mix.b * w,
  };
  return rgbToHex(rgb);
}

export function lightenHexColor(hex, ratio = 0.2) {
  return mixHexColors(hex, '#ffffff', ratio);
}

export function darkenHexColor(hex, ratio = 0.2) {
  return mixHexColors(hex, '#000000', ratio);
}

export function getReadableTextColor(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return '#1f1f1f';
  const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
  return luminance > 0.6 ? '#1f2739' : '#ffffff';
}

export function hexToRgbaString(hex, alpha = 1) {
  const rgb = hexToRgb(hex);
  if (!rgb) return '';
  const a = Math.min(Math.max(alpha, 0), 1);
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${a})`;
}

// Push theme colors into CSS variables for the board + turn UI.
export function applyTurnThemeStyle(style) {
  if (typeof document === 'undefined') return;
  const theme = {
    buttonColor: normalizeHexColorValue(style?.turnButtonColor) || TURN_THEME_DEFAULTS.buttonColor,
    serviceAccentColor: normalizeHexColorValue(style?.turnServiceAccentColor) || TURN_THEME_DEFAULTS.serviceAccentColor,
    techNameColor: normalizeHexColorValue(style?.turnTechNameColor) || TURN_THEME_DEFAULTS.techNameColor,
    skipColor: normalizeHexColorValue(style?.turnSkipColor) || TURN_THEME_DEFAULTS.skipColor,
  };

  const rootStyle = document.documentElement?.style;
  if (!rootStyle) return;

  const buttonHover = darkenHexColor(theme.buttonColor, 0.25);
  rootStyle.setProperty('--tm-button-color', theme.buttonColor);
  rootStyle.setProperty('--tm-button-hover', buttonHover);
  rootStyle.setProperty('--tm-button-shadow', hexToRgbaString(theme.buttonColor, 0.25));

  const accent = theme.serviceAccentColor;
  const freeColor = lightenHexColor(accent, 0.55);
  const freeText = getReadableTextColor(freeColor);
  rootStyle.setProperty('--tm-service-accent-color', accent);
  rootStyle.setProperty('--tm-service-free-color', freeColor);
  rootStyle.setProperty('--tm-service-free-text-color', freeText);
  rootStyle.setProperty('--tm-service-text-color', '#ffffff');

  rootStyle.setProperty('--tm-tech-name-color', theme.techNameColor);

  const skipBg = lightenHexColor(theme.skipColor, 0.6);
  const skipBoxBg = lightenHexColor(theme.skipColor, 0.78);
  const skipText = getReadableTextColor(skipBg);
  rootStyle.setProperty('--tm-skip-border-color', theme.skipColor);
  rootStyle.setProperty('--tm-skip-bg', skipBg);
  rootStyle.setProperty('--tm-skip-text-color', skipText);
  rootStyle.setProperty('--tm-skip-box-bg', skipBoxBg);

  const highlight = normalizeHexColorValue(style?.apptHighlightColor) || DEFAULT_STYLE_PALETTE.apptHighlightColor;
  const highlightStrong = darkenHexColor(highlight, 0.25);
  const highlightSoft = lightenHexColor(highlight, 0.4);
  rootStyle.setProperty('--appt-highlight-color', highlight);
  rootStyle.setProperty('--appt-highlight-strong', highlightStrong);
  rootStyle.setProperty('--appt-highlight-soft', highlightSoft);
  rootStyle.setProperty('--hover-blue', highlight);

  const hourBase = DEFAULT_APPT_HOUR_LINE_COLOR;
  const hourBorder = hexToRgbaString(hourBase, 0.4);
  const hourDash = hexToRgbaString(hourBase, 0.6);
  const quarterDash = hexToRgbaString(hourBase, 0.35);
  if (hourBorder) rootStyle.setProperty('--hour-border-color', hourBorder);
  if (hourDash) rootStyle.setProperty('--grid-dash-hour-color', hourDash);
  if (quarterDash) rootStyle.setProperty('--grid-dash-color', quarterDash);
}

export function makeSettingsStorageKey(username) {
  return `${SETTINGS_KEY_PREFIX}:${normalizeUsername(username)}`;
}

export function makeShowAllStorageKey(boardStorageKey) {
  return `${boardStorageKey}:showAllAvailable`;
}

export function makeSidebarCollapsedStorageKey(boardStorageKey) {
  return `${boardStorageKey}:sidebarCollapsed`;
}

export {
  ADMIN_VERIFY_ENDPOINT,
  SETTINGS_KEY_PREFIX,
  BOARD_KEY_PREFIX,
  TURN_THEME_DEFAULTS,
  DEFAULT_STYLE_PALETTE,
  DEFAULT_APPT_HOUR_LINE_COLOR,
  WHITE_RGB,
  BLACK_RGB,
};

const TurnManagerEngineHelpers = {
  ADMIN_VERIFY_ENDPOINT,
  SETTINGS_KEY_PREFIX,
  BOARD_KEY_PREFIX,
  TURN_THEME_DEFAULTS,
  DEFAULT_STYLE_PALETTE,
  DEFAULT_APPT_HOUR_LINE_COLOR,
  WHITE_RGB,
  BLACK_RGB,
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
};

if (typeof window !== 'undefined') {
  window.TurnManagerEngineHelpers = Object.freeze({
    ...(window.TurnManagerEngineHelpers || {}),
    ...TurnManagerEngineHelpers,
  });
}

export default TurnManagerEngineHelpers;
