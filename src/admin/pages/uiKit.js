export const adminUiTokens = {
  fontFamily: "'Manrope', 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif",
  text: '#0f172a',
  muted: '#475569',
  border: '#d8e0ee',
  cardBg: '#ffffff',
  cardBgAlt: '#f8fbff',
  accent: '#0f5cde',
  accentSoft: '#dce9ff',
  success: '#166534',
  danger: '#b42318',
  warning: '#92400e',
  radius: 14,
  shadowSoft: '0 14px 36px rgba(15, 23, 42, 0.08)',
  shadowTiny: '0 2px 8px rgba(15, 23, 42, 0.05)',
};

export const pageRootStyle = {
  padding: 20,
  fontFamily: adminUiTokens.fontFamily,
  color: adminUiTokens.text,
  background: 'radial-gradient(1200px 420px at -15% -20%, #dce9ff 0%, transparent 55%), linear-gradient(180deg, #f2f6fc 0%, #ffffff 58%)',
};

export const pageCardStyle = {
  border: `1px solid ${adminUiTokens.border}`,
  borderRadius: adminUiTokens.radius,
  background: adminUiTokens.cardBg,
  boxShadow: adminUiTokens.shadowTiny,
  padding: 14,
};

export const mutedTextStyle = {
  color: adminUiTokens.muted,
};

export const pageTitleStyle = {
  marginTop: 0,
  marginBottom: 4,
  fontSize: 28,
  letterSpacing: -0.4,
};

export function createCardStyle({ alt = false, padded = true } = {}) {
  return {
    border: `1px solid ${adminUiTokens.border}`,
    borderRadius: adminUiTokens.radius,
    background: alt ? adminUiTokens.cardBgAlt : adminUiTokens.cardBg,
    boxShadow: adminUiTokens.shadowTiny,
    padding: padded ? 14 : 0,
  };
}

export function createCalloutStyle(type = 'info') {
  if (type === 'danger') {
    return {
      border: '1px solid #fecaca',
      background: '#fef2f2',
      color: adminUiTokens.danger,
      borderRadius: 12,
      padding: 12,
    };
  }
  if (type === 'success') {
    return {
      border: '1px solid #bbf7d0',
      background: '#f0fdf4',
      color: adminUiTokens.success,
      borderRadius: 12,
      padding: 12,
    };
  }
  if (type === 'warning') {
    return {
      border: '1px solid #fde68a',
      background: '#fffbeb',
      color: adminUiTokens.warning,
      borderRadius: 12,
      padding: 12,
    };
  }
  return {
    border: `1px solid ${adminUiTokens.accentSoft}`,
    background: '#f6f9ff',
    color: '#1e3a8a',
    borderRadius: 12,
    padding: 12,
  };
}

export function createInputStyle({ disabled = false } = {}) {
  return {
    width: '100%',
    marginTop: 6,
    padding: 9,
    borderRadius: 10,
    border: `1px solid ${adminUiTokens.border}`,
    background: disabled ? '#f8fafc' : '#fff',
    color: adminUiTokens.text,
  };
}

export function createTextareaStyle({ disabled = false, minHeight = 160 } = {}) {
  return {
    width: '100%',
    minHeight,
    marginTop: 6,
    padding: 10,
    borderRadius: 10,
    border: `1px solid ${adminUiTokens.border}`,
    background: disabled ? '#f8fafc' : '#fff',
    color: adminUiTokens.text,
    lineHeight: 1.5,
    resize: 'vertical',
  };
}

export function createButtonStyle({
  tone = 'secondary',
  danger = false,
  primary = false,
  disabled = false,
} = {}) {
  const resolvedTone = danger ? 'danger' : primary ? 'primary' : tone;

  const base = {
    padding: '7px 11px',
    borderRadius: 10,
    border: `1px solid ${adminUiTokens.border}`,
    background: '#fff',
    color: adminUiTokens.text,
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontWeight: 600,
    boxShadow: disabled ? 'none' : adminUiTokens.shadowTiny,
  };

  if (resolvedTone === 'primary') {
    base.border = `1px solid ${adminUiTokens.accent}`;
    base.background = adminUiTokens.accent;
    base.color = '#fff';
  }

  if (resolvedTone === 'danger') {
    base.border = '1px solid #fecaca';
    base.background = '#fff5f5';
    base.color = adminUiTokens.danger;
  }

  if (resolvedTone === 'ghost') {
    base.border = '1px solid transparent';
    base.background = 'transparent';
  }

  if (disabled) {
    base.opacity = 0.6;
    base.boxShadow = 'none';
  }

  return base;
}
