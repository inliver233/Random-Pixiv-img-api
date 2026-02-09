import { auditAdminModelChange } from '../../audit/adminAudit';
import {
  ensureEasyProxiesAutoRefreshStarted,
  importProxyEndpointsFromEasyProxies,
  loadEasyProxiesRuntimeConfig,
} from '../../proxy/easyProxiesImporter';
import { importProxyUriLines, parseProxyUriTextLines, type ProxyUriImportConflictPolicy } from '../../proxy/proxyUriImporter';
import { enqueueAdminProxyEndpointProbe } from '../../jobs/adminActions';
import { runWithTimeout } from '../utils/runWithTimeout';

function safeParseNumber(value: any): any {
  if (value === undefined || value === null) return value;
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return value;
  const normalized = value.replace(/,/g, '.');
  if (!normalized.trim()) return value;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : value;
}

function stripSensitiveFields(recordParams: any): void {
  if (!recordParams || typeof recordParams !== 'object') return;
  delete recordParams.password;
}

function sanitizeRecordJson(recordJson: any): void {
  if (!recordJson || typeof recordJson !== 'object') return;
  if (recordJson.params) stripSensitiveFields(recordJson.params);
}

function sanitizeActionResponse(response: any): any {
  if (!response || typeof response !== 'object') return response;

  if (response.record?.params) stripSensitiveFields(response.record.params);
  if (Array.isArray(response.records)) {
    for (const rec of response.records) {
      if (rec?.params) stripSensitiveFields(rec.params);
    }
  }
  return response;
}

function normalizeOptionalSecret(value: any): string | undefined {
  if (value === undefined || value === null) return undefined;
  const s = String(value).trim();
  return s ? s : '';
}

export function createProxyEndpointResourceOptions(prisma: any) {
  return {
    navigation: { name: '代理', icon: 'Network' },
    label: '代理端点',
    actions: {
      list: {
        after: async (response: any) => sanitizeActionResponse(response),
      },
      show: {
        after: async (response: any) => sanitizeActionResponse(response),
      },
      setProxyEnabled: {
        actionType: 'resource',
        component: 'ResourceActionForm',
        icon: 'Switch',
        label: '代理总开关（直连回退）',
        guard: '关闭代理后将改为直连（真实 IP 暴露风险）。确认继续吗？',
        handler: async (request: any, _res: any, context: any) => {
          if (String(request?.method || '').toLowerCase() === 'get') {
            return {};
          }

          const rawEnabled = (request as any)?.payload?.enabled;
          let enabled: boolean | null = null;
          if (typeof rawEnabled === 'boolean') enabled = rawEnabled;
          else if (typeof rawEnabled === 'number') enabled = rawEnabled !== 0;
          else if (typeof rawEnabled === 'string') {
            const normalized = rawEnabled.trim().toLowerCase();
            if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) enabled = true;
            else if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) enabled = false;
          }

          if (enabled === null) {
            return {
              notice: { type: 'error', message: '参数无效：enabled 必须为布尔值。' },
              redirectUrl: context.h.resourceUrl({ resourceId: context.resource.id() }),
            };
          }

          try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { RUNTIME_SETTING_KEYS, upsertRuntimeSetting } = require('../../config/runtimeSettings') as typeof import('../../config/runtimeSettings');
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { invalidateRuntimeCaches } = require('../../config/runtimeConfig') as typeof import('../../config/runtimeConfig');

            const previous = await prisma.runtimeSetting.findUnique({
              where: { key: RUNTIME_SETTING_KEYS.proxyEnabled },
              select: { value: true },
            });

            await upsertRuntimeSetting(RUNTIME_SETTING_KEYS.proxyEnabled, enabled, {
              updatedBy: request?.session?.admin_user,
              updatedFromIp: request?.ip,
              updatedRequestId: request?.request_id || request?.headers?.['x-request-id'],
            }, prisma);

            invalidateRuntimeCaches({ settings: true });

            auditAdminModelChange({
              action: enabled ? 'proxy_enabled_set_true' : 'proxy_enabled_set_false',
              resource: 'RuntimeSetting',
              record_id: RUNTIME_SETTING_KEYS.proxyEnabled,
              req: request,
              detail: {
                previous_value: previous?.value ?? null,
                next_value: enabled,
              },
            });

            return {
              notice: { type: 'success', message: enabled ? '已启用代理（出站将优先走代理）' : '已关闭代理：将直连出站（真实 IP 暴露风险）' },
              redirectUrl: context.h.resourceUrl({ resourceId: context.resource.id() }),
            };
          } catch (err: unknown) {
            return {
              notice: { type: 'error', message: err instanceof Error ? err.message : String(err) },
              redirectUrl: context.h.resourceUrl({ resourceId: context.resource.id() }),
            };
          }
        },
      },
      importProxyUris: {
        actionType: 'resource',
        component: 'ResourceActionForm',
        icon: 'Upload',
        label: 'URI 批量导入',
        guard: '确认导入 URI 吗？URI 中密码会保存到数据库，但不会在后台明文展示。',
        handler: async (request: any, _res: any, context: any) => {
          if (String(request?.method || '').toLowerCase() === 'get') {
            return {};
          }

          const payload = request?.payload && typeof request.payload === 'object' ? request.payload : {};
          const uriTextRaw =
            (payload as any).proxy_uris
            ?? (payload as any).proxyUris
            ?? (payload as any).uris
            ?? '';
          const lines = parseProxyUriTextLines(String(uriTextRaw || ''));
          if (lines.length === 0) {
            return {
              notice: { type: 'error', message: '未检测到可导入的 URI，请至少粘贴 1 行。' },
              redirectUrl: context.h.resourceUrl({ resourceId: context.resource.id() }),
            };
          }
          if (lines.length > 10_000) {
            return {
              notice: { type: 'error', message: `导入行数过多：${lines.length}。单次最多 10000 行。` },
              redirectUrl: context.h.resourceUrl({ resourceId: context.resource.id() }),
            };
          }

          const sourceRaw = String((payload as any).source || 'manual').trim().toLowerCase();
          const source = sourceRaw || 'manual';

          const enabledRaw = (payload as any).enabled;
          const enabled = typeof enabledRaw === 'string'
            ? ['1', 'true', 'yes', 'y', 'on'].includes(enabledRaw.trim().toLowerCase())
            : enabledRaw === undefined || enabledRaw === null
              ? true
              : Boolean(enabledRaw);

          const conflictPolicyRaw = String((payload as any).conflict_policy || (payload as any).conflictPolicy || 'skip_non_source').trim();
          const conflictPolicy: ProxyUriImportConflictPolicy = (
            ['overwrite', 'skip_non_easy_proxies', 'skip_non_manual', 'skip_non_source'].includes(conflictPolicyRaw)
              ? conflictPolicyRaw
              : 'skip_non_source'
          ) as ProxyUriImportConflictPolicy;

          try {
            const summary = await importProxyUriLines({
              lines,
              source,
              sourceRef: source === 'manual' ? 'manual-uri-import' : source,
              enabled,
              conflictPolicy,
              prisma,
            });

            try {
              // eslint-disable-next-line @typescript-eslint/no-var-requires
              const { invalidateRuntimeCaches } = require('../../config/runtimeConfig') as typeof import('../../config/runtimeConfig');
              invalidateRuntimeCaches({ proxies: true });
            } catch {
              // best-effort
            }

            auditAdminModelChange({
              action: 'proxy_uri_import',
              resource: 'ProxyEndpoint',
              req: request,
              detail: {
                source,
                enabled,
                conflict_policy: conflictPolicy,
                total_lines: summary.total_lines,
                imported: summary.imported,
                invalid: summary.invalid,
                conflicts: summary.conflicts,
                invalid_lines: summary.errors.slice(0, 20).map((item) => ({ line: item.line, error: item.error })),
              },
            });

            return {
              notice: {
                type: summary.invalid > 0 ? 'warning' : 'success',
                message: summary.invalid > 0
                  ? `导入完成：成功 ${summary.imported}，无效 ${summary.invalid}，冲突跳过 ${summary.conflicts}（首个错误行：${summary.errors[0]?.line ?? '-'}）。`
                  : `导入完成：成功 ${summary.imported}，无效 ${summary.invalid}，冲突跳过 ${summary.conflicts}。`,
              },
              import_summary: {
                total_lines: summary.total_lines,
                imported: summary.imported,
                invalid: summary.invalid,
                conflicts: summary.conflicts,
                errors: summary.errors.slice(0, 50).map((item) => ({
                  line: item.line,
                  error: item.error,
                })),
              },
              redirectUrl: context.h.resourceUrl({ resourceId: context.resource.id() }),
            };
          } catch (err: unknown) {
            return {
              notice: { type: 'error', message: err instanceof Error ? err.message : String(err) },
              redirectUrl: context.h.resourceUrl({ resourceId: context.resource.id() }),
            };
          }
        },
      },
      easyProxiesConfigSave: {
        actionType: 'resource',
        component: 'ResourceActionForm',
        icon: 'Settings',
        label: 'easy_proxies 配置保存',
        guard: '确认保存 easy_proxies 配置吗？密码仅保存不会回显。',
        handler: async (request: any, _res: any, context: any) => {
          if (String(request?.method || '').toLowerCase() === 'get') {
            return {};
          }

          const normalizeOptionalText = (value: unknown): string | null => {
            if (value === undefined || value === null) return null;
            const s = String(value).trim();
            return s ? s : null;
          };

          const coerceBoolean = (value: unknown, defaultValue: boolean): boolean => {
            if (typeof value === 'boolean') return value;
            if (typeof value === 'number') return value !== 0;
            if (typeof value !== 'string') return defaultValue;
            const normalized = value.trim().toLowerCase();
            if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
            if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
            return defaultValue;
          };

          const payload = request?.payload && typeof request.payload === 'object' ? request.payload : {};

          const baseUrlRaw = normalizeOptionalText((payload as any).base_url ?? (payload as any).baseUrl);
          let baseUrl: string | null = null;
          try {
            baseUrl = baseUrlRaw ? new URL(baseUrlRaw).origin : null;
          } catch (err: unknown) {
            return {
              notice: { type: 'error', message: err instanceof Error ? err.message : String(err) },
              redirectUrl: context.h.resourceUrl({ resourceId: context.resource.id() }),
            };
          }

          const clearPassword = coerceBoolean((payload as any).clear_password ?? (payload as any).clearPassword, false);
          const passwordInput = normalizeOptionalText((payload as any).password);

          const autoRefreshEnabled = coerceBoolean(
            (payload as any).auto_refresh_enabled ?? (payload as any).autoRefreshEnabled,
            true,
          );

          const refreshIntervalRaw = (payload as any).refresh_interval_ms ?? (payload as any).refreshIntervalMs;
          const refreshIntervalParsed = safeParseNumber(refreshIntervalRaw);
          const refreshIntervalMs = Math.max(
            60_000,
            Number.isFinite(Number(refreshIntervalParsed))
              ? Math.trunc(Number(refreshIntervalParsed))
              : 30 * 60_000,
          );

          let previousValue: any = null;
          try {
            previousValue = await prisma.runtimeSetting.findUnique({
              where: { key: 'easy_proxies_config' },
              select: { value: true },
            });
          } catch {
            previousValue = null;
          }

          const previousObj = previousValue?.value && typeof previousValue.value === 'object'
            ? (previousValue.value as Record<string, unknown>)
            : null;
          const previousPassword =
            previousObj && typeof previousObj.password === 'string' && previousObj.password.trim()
              ? previousObj.password
              : undefined;
          const previousBaseUrl =
            previousObj && typeof (previousObj as any).baseUrl === 'string' && String((previousObj as any).baseUrl).trim()
              ? String((previousObj as any).baseUrl).trim()
              : previousObj && typeof (previousObj as any).base_url === 'string' && String((previousObj as any).base_url).trim()
                ? String((previousObj as any).base_url).trim()
                : null;

          const nextPassword = clearPassword ? undefined : (passwordInput || previousPassword);
          const passwordConfigured = Boolean(nextPassword);

          try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { upsertRuntimeSetting } = require('../../config/runtimeSettings') as typeof import('../../config/runtimeSettings');

            await upsertRuntimeSetting('easy_proxies_config', {
              baseUrl,
              password: nextPassword,
              autoRefreshEnabled,
              refreshIntervalMs,
            }, {
              updatedBy: request?.session?.admin_user,
              updatedFromIp: request?.ip,
              updatedRequestId: request?.request_id || request?.headers?.['x-request-id'],
            }, prisma);

            try {
              ensureEasyProxiesAutoRefreshStarted({ prisma });
            } catch {
              // best-effort
            }

            auditAdminModelChange({
              action: 'easy_proxies_config_save',
              resource: 'RuntimeSetting',
              record_id: 'easy_proxies_config',
              req: request,
              detail: {
                previous_base_url: previousBaseUrl,
                next_base_url: baseUrl,
                password_configured: passwordConfigured,
                auto_refresh_enabled: autoRefreshEnabled,
                refresh_interval_ms: refreshIntervalMs,
              },
            });

            return {
              notice: { type: 'success', message: 'easy_proxies 配置已保存。' },
              redirectUrl: context.h.resourceUrl({ resourceId: context.resource.id() }),
            };
          } catch (err: unknown) {
            return {
              notice: { type: 'error', message: err instanceof Error ? err.message : String(err) },
              redirectUrl: context.h.resourceUrl({ resourceId: context.resource.id() }),
            };
          }
        },
      },
      easyProxiesImport: {
        actionType: 'resource',
        component: 'RecordActionRunner',
        icon: 'Download',
        label: 'easy_proxies 导入',
        guard: '确认从 easy_proxies 的 /api/export 导入代理吗？',
        handler: async (request: any, _res: any, context: any) => {
          if (String(request?.method || '').toLowerCase() === 'get') {
            return {};
          }

          const config = await loadEasyProxiesRuntimeConfig({ prisma });
          if (!config.baseUrl) {
            return {
              notice: { type: 'error', message: '缺少 easy_proxies baseUrl，请先在 easy_proxies 导入页配置。' },
              redirectUrl: context.h.resourceUrl({ resourceId: context.resource.id() }),
            };
          }

          const conflictPolicy = 'skip_non_easy_proxies' as const;

          try {
            const result = await importProxyEndpointsFromEasyProxies({
              baseUrl: config.baseUrl,
              password: config.password,
              prisma,
              conflictPolicy,
              sourceRef: config.baseUrl,
              enabled: true,
            });
            if (!result.ok) {
              return {
                notice: { type: 'error', message: `easy_proxies 导入失败：${result.status}` },
                redirectUrl: context.h.resourceUrl({ resourceId: context.resource.id() }),
              };
            }

            try {
              // eslint-disable-next-line @typescript-eslint/no-var-requires
              const { invalidateRuntimeCaches } = require('../../config/runtimeConfig') as typeof import('../../config/runtimeConfig');
              invalidateRuntimeCaches({ proxies: true });
            } catch {
              // best-effort
            }

            auditAdminModelChange({
              action: 'easy_proxies_import',
              resource: 'ProxyEndpoint',
              req: request,
              detail: {
                baseUrl: result.baseUrl,
                total_lines: result.total_lines,
                imported: result.imported,
                invalid: result.invalid,
                conflicts: result.conflicts,
                token_used: result.token_used,
                conflict_policy: conflictPolicy,
              },
            });

            return {
              notice: {
                type: 'success',
                message: `导入完成：成功 ${result.imported}/${result.total_lines}（无效 ${result.invalid}，冲突 ${result.conflicts}）。`,
              },
              redirectUrl: context.h.resourceUrl({ resourceId: context.resource.id() }),
            };
          } catch (err: unknown) {
            return {
              notice: { type: 'error', message: err instanceof Error ? err.message : String(err) },
              redirectUrl: context.h.resourceUrl({ resourceId: context.resource.id() }),
            };
          }
        },
      },
      easyProxiesRollback: {
        actionType: 'resource',
        component: 'RecordActionRunner',
        icon: 'Undo',
        label: 'easy_proxies 回滚到手动代理列表',
        guard: '确认回滚 easy_proxies 代理并关闭自动刷新吗？',
        handler: async (request: any, _res: any, context: any) => {
          if (String(request?.method || '').toLowerCase() === 'get') {
            return {};
          }

          try {
            const disabled = await prisma.proxyEndpoint.updateMany({
              where: { source: 'easy_proxies' },
              data: { enabled: false },
            });

            const config = await loadEasyProxiesRuntimeConfig({ prisma });
            if (config.baseUrl) {
              try {
                // eslint-disable-next-line @typescript-eslint/no-var-requires
                const { upsertRuntimeSetting } = require('../../config/runtimeSettings') as typeof import('../../config/runtimeSettings');
                await upsertRuntimeSetting('easy_proxies_config', {
                  baseUrl: config.baseUrl,
                  password: config.password,
                  autoRefreshEnabled: false,
                  refreshIntervalMs: config.refreshIntervalMs,
                }, {
                  updatedBy: request?.session?.admin_user,
                  updatedFromIp: request?.ip,
                  updatedRequestId: request?.request_id || request?.headers?.['x-request-id'],
                }, prisma);
              } catch {
                // ignore
              }
            }

            try {
              // eslint-disable-next-line @typescript-eslint/no-var-requires
              const { invalidateRuntimeCaches } = require('../../config/runtimeConfig') as typeof import('../../config/runtimeConfig');
              invalidateRuntimeCaches({ proxies: true });
            } catch {
              // best-effort
            }

            auditAdminModelChange({
              action: 'easy_proxies_rollback',
              resource: 'ProxyEndpoint',
              req: request,
              detail: {
                disabled_count: disabled.count,
                auto_refresh_disabled: true,
                baseUrl: config.baseUrl,
              },
            });

            return {
              notice: { type: 'success', message: `回滚完成（disabled=${disabled.count} auto_refresh_enabled=false）。` },
              redirectUrl: context.h.resourceUrl({ resourceId: context.resource.id() }),
            };
          } catch (err: unknown) {
            return {
              notice: { type: 'error', message: err instanceof Error ? err.message : String(err) },
              redirectUrl: context.h.resourceUrl({ resourceId: context.resource.id() }),
            };
          }
        },
      },
      probe: {
        actionType: 'record',
        component: 'RecordActionRunner',
        icon: 'Activity',
        label: '立即探测',
        guard: '确认立即探测该代理吗？',
        handler: async (request: any, _res: any, context: any) => {
          const { record, currentAdmin, h, resource } = context;
          if (!record) throw new Error('Record is required');

          stripSensitiveFields(record.params);

          if (String(request?.method || '').toLowerCase() === 'get') {
            const jsonRecord = record.toJSON(currentAdmin);
            sanitizeRecordJson(jsonRecord);
            return { record: jsonRecord };
          }

          const idRaw = record.id?.() ?? record.params?.id;
          let id: bigint;
          try {
            id = typeof idRaw === 'bigint' ? idRaw : BigInt(String(idRaw));
          } catch {
            return {
              notice: { type: 'error', message: '记录 ID 非法。' },
              redirectUrl: h.resourceUrl({ resourceId: resource.id() }),
            };
          }

          try {
            const endpoint = await prisma.proxyEndpoint.findUnique({
              where: { id },
              select: { id: true, enabled: true },
            });

            if (!endpoint) {
              return {
                notice: { type: 'error', message: '记录不存在。' },
                redirectUrl: h.resourceUrl({ resourceId: resource.id() }),
              };
            }

            const requestIdRaw = request?.request_id || request?.headers?.['x-request-id'];
            const requestId = typeof requestIdRaw === 'string' && requestIdRaw.trim() ? requestIdRaw.trim() : undefined;
            const actor = typeof request?.session?.admin_user === 'string' ? request.session.admin_user : undefined;

            const enqueueResult = await runWithTimeout(
              enqueueAdminProxyEndpointProbe({ endpointId: endpoint.id, requestId, actor }),
              5_000,
            );

            if (enqueueResult.status === 'timeout') {
              auditAdminModelChange({
                action: 'proxy_endpoint_probe_enqueue_timeout',
                resource: 'ProxyEndpoint',
                record_id: endpoint.id.toString(),
                req: request,
                detail: { job_queue: 'admin_proxy_endpoint_probe', request_id: requestId ?? null },
              });

              const jsonRecord = record.toJSON(currentAdmin);
              sanitizeRecordJson(jsonRecord);
              return {
                record: jsonRecord,
                notice: { type: 'error', message: '入队超时（>5000ms），请稍后重试。' },
                redirectUrl: h.recordActionUrl({ resourceId: resource.id(), recordId: record.id(), actionName: 'show' }),
              };
            }

            if (enqueueResult.status === 'error') {
              auditAdminModelChange({
                action: 'proxy_endpoint_probe_enqueue_error',
                resource: 'ProxyEndpoint',
                record_id: endpoint.id.toString(),
                req: request,
                detail: { job_queue: 'admin_proxy_endpoint_probe', request_id: requestId ?? null, error: enqueueResult.error },
              });

              const jsonRecord = record.toJSON(currentAdmin);
              sanitizeRecordJson(jsonRecord);
              return {
                record: jsonRecord,
                notice: { type: 'error', message: `入队失败: ${enqueueResult.error}` },
                redirectUrl: h.recordActionUrl({ resourceId: resource.id(), recordId: record.id(), actionName: 'show' }),
              };
            }

            const jobId = enqueueResult.value;

            auditAdminModelChange({
              action: 'proxy_endpoint_probe_enqueued',
              resource: 'ProxyEndpoint',
              record_id: endpoint.id.toString(),
              req: request,
              detail: { job_id: jobId, request_id: requestId ?? null, enabled: endpoint.enabled },
            });

            const jsonRecord = record.toJSON(currentAdmin);
            sanitizeRecordJson(jsonRecord);

            return {
              record: jsonRecord,
              notice: { type: 'success', message: `已入队 probe: ${jobId}` },
              redirectUrl: h.recordActionUrl({ resourceId: resource.id(), recordId: record.id(), actionName: 'show' }),
            };
          } catch (err: unknown) {
            auditAdminModelChange({
              action: 'proxy_endpoint_probe_error',
              resource: 'ProxyEndpoint',
              record_id: idRaw === undefined || idRaw === null ? undefined : String(idRaw),
              req: request,
              detail: {
                error: err instanceof Error ? err.message : String(err),
              },
            });

            const jsonRecord = record.toJSON(currentAdmin);
            sanitizeRecordJson(jsonRecord);
            return {
              record: jsonRecord,
              notice: { type: 'error', message: err instanceof Error ? err.message : String(err) },
              redirectUrl: h.recordActionUrl({ resourceId: resource.id(), recordId: record.id(), actionName: 'show' }),
            };
          }
        },
      },
      new: {
        after: async (response: any, request: any, context: any) => {
          // write-only: never return stored password to client
          sanitizeActionResponse(response);

          if (String(request?.method || '').toLowerCase() === 'get') return response;

          const recordId = context?.record?.id?.() ?? context?.record?.params?.id;
          const payload = request?.payload && typeof request.payload === 'object' ? { ...request.payload } : undefined;
          if (payload && typeof payload === 'object') {
            delete (payload as any).password;
          }

          auditAdminModelChange({
            action: 'proxy_endpoint_create',
            resource: 'ProxyEndpoint',
            record_id: recordId === undefined || recordId === null ? undefined : String(recordId),
            req: request,
            detail: {
              payload,
              record: context?.record?.params
                ? {
                    scheme: context.record.params.scheme,
                    host: context.record.params.host,
                    port: context.record.params.port,
                    username: context.record.params.username,
                    enabled: context.record.params.enabled,
                    source: context.record.params.source,
                    sourceRef: context.record.params.sourceRef,
                  }
                : undefined,
            },
          });

          try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { invalidateRuntimeCaches } = require('../../config/runtimeConfig') as typeof import('../../config/runtimeConfig');
            invalidateRuntimeCaches({ proxies: true });
          } catch {
            // best-effort
          }

          return response;
        },
      },
      edit: {
        before: async (request: any) => {
          if (String(request?.method || '').toLowerCase() === 'get') return request;

          const payload = request?.payload && typeof request.payload === 'object'
            ? { ...request.payload }
            : {};

          const password = normalizeOptionalSecret((payload as any).password);
          if (password === '' || password === undefined || password === '***') {
            // Empty/placeholder means "keep existing".
            delete (payload as any).password;
          } else if (typeof password === 'string') {
            (payload as any).password = password;
          }

          return { ...request, payload };
        },
        after: async (response: any, request: any, context: any) => {
          // write-only for both GET(edit form) and POST(save)
          sanitizeActionResponse(response);

          if (String(request?.method || '').toLowerCase() === 'get') return response;

          const recordId = context?.record?.id?.() ?? context?.record?.params?.id;
          const payload = request?.payload && typeof request.payload === 'object' ? { ...request.payload } : undefined;
          if (payload && typeof payload === 'object') {
            delete (payload as any).password;
          }

          auditAdminModelChange({
            action: 'proxy_endpoint_update',
            resource: 'ProxyEndpoint',
            record_id: recordId === undefined || recordId === null ? undefined : String(recordId),
            req: request,
            detail: {
              payload,
              record: context?.record?.params
                ? {
                    scheme: context.record.params.scheme,
                    host: context.record.params.host,
                    port: context.record.params.port,
                    username: context.record.params.username,
                    enabled: context.record.params.enabled,
                    source: context.record.params.source,
                    sourceRef: context.record.params.sourceRef,
                  }
                : undefined,
            },
          });

          try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { invalidateRuntimeCaches } = require('../../config/runtimeConfig') as typeof import('../../config/runtimeConfig');
            invalidateRuntimeCaches({ proxies: true });
          } catch {
            // best-effort
          }

          return response;
        },
      },
      delete: {
        after: async (response: any, request: any, context: any) => {
          sanitizeActionResponse(response);
          if (String(request?.method || '').toLowerCase() === 'get') return response;

          const recordId =
            context?.record?.id?.()
            ?? context?.record?.params?.id
            ?? response?.record?.params?.id
            ?? request?.payload?.recordId;

          auditAdminModelChange({
            action: 'proxy_endpoint_delete',
            resource: 'ProxyEndpoint',
            record_id: recordId === undefined || recordId === null ? undefined : String(recordId),
            req: request,
            detail: {
              record: context?.record?.params
                ? {
                    scheme: context.record.params.scheme,
                    host: context.record.params.host,
                    port: context.record.params.port,
                    username: context.record.params.username,
                    enabled: context.record.params.enabled,
                    source: context.record.params.source,
                    sourceRef: context.record.params.sourceRef,
                  }
                : undefined,
            },
          });

          try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { invalidateRuntimeCaches } = require('../../config/runtimeConfig') as typeof import('../../config/runtimeConfig');
            invalidateRuntimeCaches({ proxies: true });
          } catch {
            // best-effort
          }

          return response;
        },
      },
    },
    properties: {
      password: {
        isVisible: { list: false, filter: false, show: false, edit: true },
        type: 'password',
        props: {
          placeholder: '******（留空表示不修改）',
          autoComplete: 'new-password',
        },
      },
    },
  } as const;
}
