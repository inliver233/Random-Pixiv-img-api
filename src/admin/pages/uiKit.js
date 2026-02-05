export const adminUiTokens = {
  fontFamily: "'IBM Plex Sans', 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif",
  text: '#111827',
  muted: '#6b7280',
  border: '#e5e7eb',
  cardBg: '#ffffff',
  radius: 12,
};

export const pageRootStyle = {
  padding: 16,
  fontFamily: adminUiTokens.fontFamily,
  color: adminUiTokens.text,
  background: 'linear-gradient(180deg, #f8fafc 0%, #ffffff 60%)',
};

export const pageCardStyle = {
  border: `1px solid ${adminUiTokens.border}`,
  borderRadius: adminUiTokens.radius,
  background: adminUiTokens.cardBg,
  padding: 12,
};

export const mutedTextStyle = {
  color: adminUiTokens.muted,
};

export function createButtonStyle({
  danger = false,
  primary = false,
  disabled = false,
} = {}) {
  const base = {
    padding: '6px 10px',
    borderRadius: 8,
    border: `1px solid ${adminUiTokens.border}`,
    background: '#fff',
    color: adminUiTokens.text,
    cursor: disabled ? 'not-allowed' : 'pointer',
  };

  if (primary) {
    base.border = '1px solid #111827';
    base.background = '#111827';
    base.color = '#fff';
  }

  if (danger) {
    base.border = '1px solid #fecaca';
    base.color = '#991b1b';
  }

  if (disabled) {
    base.opacity = 0.6;
  }

  return base;
}
