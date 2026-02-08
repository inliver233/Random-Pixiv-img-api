import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { imageResourceOptions } from '../src/admin/resources/images';
import { pixivTokenResourceOptions } from '../src/admin/resources/pixivTokens';

function hasComponentSettingForAction(source: string, actionName: string, componentValue: string | false): boolean {
  const escaped = actionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const value = componentValue === false ? 'false' : componentValue;
  const pattern = new RegExp(`${escaped}:\\s*\\{[\\s\\S]{0,600}?component:\\s*${value}`, 'm');
  return pattern.test(source);
}

describe('admin action component contract', () => {
  it('keeps resource-module actions explicitly configured (view vs no-view)', () => {
    const imageActions = (imageResourceOptions as any).actions;
    expect(imageActions.delete.component).toBe(false);
    expect(imageActions.enable.component).toBe(false);
    expect(imageActions.disable.component).toBe(false);
    expect(imageActions.statusCounts.component).toBe(false);
    expect(imageActions.hydrateMetadata.component).toBe('RecordActionRunner');

    const tokenActions = (pixivTokenResourceOptions as any).actions;
    expect(tokenActions.testRefresh.component).toBe('RecordActionRunner');
  });

  it('keeps inline adminJs custom actions using correct view contracts', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/admin/adminJs.ts'), 'utf8');
    const noViewActions = [
      'rebindPrimary',
      'setOverride',
      'clearOverride',
    ];

    for (const actionName of noViewActions) {
      expect(hasComponentSettingForAction(source, actionName, false)).toBe(true);
    }

    const deepLinkableActions = ['pause', 'resume', 'cancel'];
    for (const actionName of deepLinkableActions) {
      expect(hasComponentSettingForAction(source, actionName, 'RecordActionRunner')).toBe(true);
    }
  });
});
