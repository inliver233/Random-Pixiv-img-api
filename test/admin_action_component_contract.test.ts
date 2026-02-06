import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { imageResourceOptions } from '../src/admin/resources/images';
import { pixivTokenResourceOptions } from '../src/admin/resources/pixivTokens';

function hasComponentFalseForAction(source: string, actionName: string): boolean {
  const escaped = actionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`${escaped}:\\s*\\{[\\s\\S]{0,120}?component:\\s*false`, 'm');
  return pattern.test(source);
}

describe('admin action component contract', () => {
  it('keeps resource-module actions as non-component actions', () => {
    const imageActions = (imageResourceOptions as any).actions;
    expect(imageActions.delete.component).toBe(false);
    expect(imageActions.enable.component).toBe(false);
    expect(imageActions.disable.component).toBe(false);
    expect(imageActions.statusCounts.component).toBe(false);
    expect(imageActions.hydrateMetadata.component).toBe(false);

    const tokenActions = (pixivTokenResourceOptions as any).actions;
    expect(tokenActions.testRefresh.component).toBe(false);
  });

  it('marks inline adminJs custom actions as component:false to avoid missing-component deep links', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/admin/adminJs.ts'), 'utf8');
    const criticalActions = [
      'rebindPrimary',
      'setOverride',
      'clearOverride',
      'setProxyEnabled',
      'importProxyUris',
      'easyProxiesConfigSave',
      'easyProxiesImport',
      'easyProxiesRollback',
      'probe',
      'pause',
      'resume',
      'cancel',
    ];

    for (const actionName of criticalActions) {
      expect(hasComponentFalseForAction(source, actionName)).toBe(true);
    }
  });
});

