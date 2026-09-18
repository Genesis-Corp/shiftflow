import { describe, it, expect } from 'vitest';
import { normalizeDeptColor, deptTextColor, autoDeptColor, PRESET_DEPARTMENT_COLORS } from '../deptColors';

describe('normalizeDeptColor', () => {
  it('passes through a valid hex color', () => {
    expect(normalizeDeptColor('#3b82f6')).toBe('#3b82f6');
  });

  it('maps a legacy preset name to its hex equivalent', () => {
    expect(normalizeDeptColor('teal')).toBe('#14b8a6');
  });

  it('falls back to the default for missing or invalid values', () => {
    expect(normalizeDeptColor(null)).toBe('#64748b');
    expect(normalizeDeptColor(undefined)).toBe('#64748b');
    expect(normalizeDeptColor('not-a-color')).toBe('#64748b');
    expect(normalizeDeptColor('#fff')).toBe('#64748b'); // 3-digit hex not supported
  });
});

describe('deptTextColor', () => {
  it('picks dark text on a light background', () => {
    expect(deptTextColor('#fde047')).toBe('#0f172a'); // bright yellow
  });

  it('picks white text on a dark background', () => {
    expect(deptTextColor('#1e3a8a')).toBe('#ffffff'); // dark navy
  });
});

describe('autoDeptColor', () => {
  it('cycles through the preset list', () => {
    expect(autoDeptColor(0)).toBe(PRESET_DEPARTMENT_COLORS[0]);
    expect(autoDeptColor(PRESET_DEPARTMENT_COLORS.length)).toBe(PRESET_DEPARTMENT_COLORS[0]);
  });
});
