import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { imageResourceOptions } from '../src/admin/resources/images';
import { pixivTokenResourceOptions } from '../src/admin/resources/pixivTokens';
import { createProxyEndpointResourceOptions } from '../src/admin/resources/proxyEndpoints';

function hasComponentSettingForAction(source: string, actionName: string, componentValue: string | false): boolean {
  const escaped = actionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const value = componentValue === false ? 'false' : componentValue;
  const pattern = new RegExp(`${escaped}:\\s*\\{[\\s\\S]{0,600}?component:\\s*${value}`, 'm');
  return pattern.test(source);
}

describe('admin action component contract', () => {
  it('keeps resource-module actions explicitly configured (view vs no-view)', () => {
    const imageActions = (imageResourceOptions as any).actions;
    expect(imageActions.delete.component).toBe('RecordActionRunner');
    expect(imageActions.enable.component).toBe('RecordActionRunner');
    expect(imageActions.disable.component).toBe('RecordActionRunner');
    expect(imageActions.statusCounts.component).toBe('RecordActionRunner');
    expect(imageActions.hydrateMetadata.component).toBe('RecordActionRunner');

    const tokenActions = (pixivTokenResourceOptions as any).actions;
    expect(tokenActions.testRefresh.component).toBe('RecordActionRunner');

    const proxyActions = (createProxyEndpointResourceOptions({}) as any).actions;
    expect(proxyActions.setProxyEnabled.component).toBe('ResourceActionForm');
    expect(proxyActions.importProxyUris.component).toBe('ResourceActionForm');
    expect(proxyActions.easyProxiesConfigSave.component).toBe('ResourceActionForm');
    expect(proxyActions.easyProxiesImport.component).toBe('RecordActionRunner');
    expect(proxyActions.easyProxiesRollback.component).toBe('RecordActionRunner');
    expect(proxyActions.probe.component).toBe('RecordActionRunner');
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
