import type { Router } from 'express';
import path from 'node:path';

import { getPrismaClient } from '../db/prismaClient';
import { auditAdminModelChange } from '../audit/adminAudit';
import { getOutboundErrorsTotalCounter } from '../metrics/outboundMetrics';
import { extractFirstSampleValue, extractVectorSamples, queryPrometheusInstant } from '../metrics/prometheusQueryClient';
import {
  ensureEasyProxiesAutoRefreshStarted,
  getEasyProxiesAutoRefreshSnapshot,
  importProxyEndpointsFromEasyProxies,
  loadEasyProxiesRuntimeConfig,
} from '../proxy/easyProxiesImporter';
import { getProxyHealthOptions, getProxyHealthReport, runProxyHealthCheckOnce } from '../proxy/healthCheck';
import { importProxyUriLines, parseProxyUriTextLines, type ProxyUriImportConflictPolicy } from '../proxy/proxyUriImporter';
import { pickPrimaryProxyRendezvous, resolveEffectiveProxy } from '../proxy/tokenProxyBinding';
import * as PrismaModule from '@prisma/client';
import { Prisma } from '@prisma/client';

import { imageResourceOptions } from './resources/images';
import { importResourceOptions } from './resources/imports';
import { adminAuditResourceOptions } from './resources/adminAudits';
import { requestLogResourceOptions } from './resources/requestLogs';
import { pixivTokenResourceOptions } from './resources/pixivTokens';
import { hasEffectiveFilterValue } from './utils/filterValue';
import { runWithTimeout } from './utils/runWithTimeout';

let cachedRouter: Router | null = null;
let cachedPromise: Promise<Router> | null = null;

function parseBooleanEnv(value: unknown, defaultValue: boolean): boolean {
  if (typeof value !== 'string') return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return defaultValue;
}

export async function getAdminJsRouter(): Promise<Router> {
  if (cachedRouter) return cachedRouter;
  if (cachedPromise) return cachedPromise;

  cachedPromise = (async () => {
    const [adminJSImport, adminJSExpressImport, adminJSPrismaImport] = await Promise.all([
      import('adminjs'),
      import('@adminjs/express'),
      import('@adminjs/prisma'),
    ]);

    const AdminJS = (adminJSImport as any).default || adminJSImport;
    const AdminJSExpress = (adminJSExpressImport as any).default || adminJSExpressImport;
    const { Database, Resource: PrismaResource, getModelByName } = adminJSPrismaImport as any;

    const safeParseJSON = (json: any): any => {
      try {
        return JSON.parse(json);
      } catch {
        return null;
      }
    };

    const safeParseNumber = (value: any): any => {
      if (value === undefined || value === null) return value;
      if (typeof value === 'number') return value;
      if (typeof value !== 'string') return value;
      const normalized = value.replace(/,/g, '.');
      if (!normalized.trim()) return value;
      const parsed = Number(normalized);
      return Number.isFinite(parsed) ? parsed : value;
    };

    const convertParam = (property: any, fields: any[], value: any): any => {
      const type = property.type();
      if (type === 'mixed') return value;
      if (type === 'number') return safeParseNumber(value);

      if (type === 'reference') {
        const foreignColumnName = property.foreignColumnName?.();
        if (!foreignColumnName) return value;

        const foreignColumn = fields.find((field) => field.name === foreignColumnName);
        if (!foreignColumn) return value;
        if (value === undefined || value === null) return value;

        const foreignColumnType = foreignColumn.type;
        if (foreignColumnType === 'String') return String(value);
        if (foreignColumnType === 'BigInt') {
          try {
            return typeof value === 'bigint' ? value : BigInt(String(value));
          } catch {
            return value;
          }
        }

        return safeParseNumber(value);
      }

      return value;
    };

    const convertFilter = (modelFields: any[], filterObject?: any): Record<string, any> => {
      if (!filterObject) return {};

      const uuidRegex = /^[0-9A-F]{8}-[0-9A-F]{4}-[5|4|3|2|1][0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/i;
      const { filters = {} } = filterObject;

      return Object.entries(filters).reduce((where: Record<string, any>, [name, filter]: [string, any]) => {
        const property = filter?.property;
        if (!property) return where;
        if (!hasEffectiveFilterValue(filter?.value)) return where;

        const type = property.type?.();
        if (['boolean', 'number', 'float', 'object', 'array'].includes(type)) {
          where[name] = safeParseJSON(filter.value);
        } else if (['date', 'datetime'].includes(type)) {
          if (typeof filter.value !== 'string' && filter.value?.from && filter.value?.to) {
            where[name] = { gte: new Date(filter.value.from), lte: new Date(filter.value.to) };
          } else if (typeof filter.value !== 'string' && filter.value?.from) {
            where[name] = { gte: new Date(filter.value.from) };
          } else if (typeof filter.value !== 'string' && filter.value?.to) {
            where[name] = { lte: new Date(filter.value.to) };
          }
        } else if (property.isEnum?.()) {
          where[name] = { equals: filter.value };
        } else if (type === 'string' && uuidRegex.test(filter.value?.toString?.() ?? '')) {
          where[name] = { equals: filter.value };
        } else if (type === 'reference' && property.foreignColumnName?.()) {
          const converted = convertParam(property, modelFields, filter.value);
          if (hasEffectiveFilterValue(converted)) {
            where[property.foreignColumnName()] = converted;
          }
        } else {
          where[name] = { contains: filter.value?.toString?.() ?? '' };
        }

        return where;
      }, {});
    };

    const BaseRecord = (adminJSImport as any).BaseRecord as new (params: any, resource: any) => any;

    const CUSTOM_IMAGE_FILTER_KEYS = new Set(['minWidth', 'minHeight', 'tag']);

    const parseFiniteNumber = (value: unknown): number | null => {
      if (value === undefined || value === null) return null;
      if (typeof value === 'number') return Number.isFinite(value) ? value : null;
      if (typeof value !== 'string') return null;
      const trimmed = value.trim();
      if (!trimmed) return null;
      const num = Number(trimmed);
      return Number.isFinite(num) ? num : null;
    };

    const parseNonEmptyString = (value: unknown): string | null => {
      if (value === undefined || value === null) return null;
      if (typeof value !== 'string') return null;
      const trimmed = value.trim();
      return trimmed ? trimmed : null;
    };

    const toPlainObject = (value: unknown): Record<string, any> | null => {
      if (!value || typeof value !== 'object') return null;
      if (Array.isArray(value)) return null;
      if (Object.getPrototypeOf(value) !== Object.prototype) return null;
      return value as Record<string, any>;
    };

    const makeJsonSafe = (value: any): any => {
      if (typeof value === 'bigint') return value.toString();
      if (!value || typeof value !== 'object') return value;
      if (value instanceof Date) return value;
      if (Array.isArray(value)) return value.map(makeJsonSafe);

      const obj = toPlainObject(value);
      if (!obj) return value;

      const out: Record<string, any> = {};
      for (const [k, v] of Object.entries(obj)) {
        out[k] = makeJsonSafe(v);
      }
      return out;
    };

    const coerceBigIntValue = (value: any): any => {
      if (value === null || value === undefined) return value;
      if (typeof value === 'bigint') return value;
      if (typeof value === 'number' && Number.isFinite(value)) return BigInt(Math.trunc(value));
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed && /^-?\\d+$/.test(trimmed)) return BigInt(trimmed);
      }
      return value;
    };

    class PixivcatPrismaResource extends PrismaResource {
      private readonly bigIntFields: Set<string>;

      constructor(args: any) {
        super(args);
        this.bigIntFields = new Set(
          (this.model?.fields || [])
            .filter((field: any) => field?.kind === 'scalar' && field?.type === 'BigInt')
            .map((field: any) => field.name),
        );
      }

      private coerceBigIntWhere(where: any): any {
        if (!where || typeof where !== 'object') return where;
        if (Array.isArray(where)) {
          for (const item of where) this.coerceBigIntWhere(item);
          return where;
        }

        for (const [key, raw] of Object.entries(where)) {
          if (key === 'AND' || key === 'OR' || key === 'NOT') {
            this.coerceBigIntWhere(raw);
            continue;
          }

          if (this.bigIntFields.has(key)) {
            if (Array.isArray(raw)) {
              where[key] = raw.map(coerceBigIntValue);
              continue;
            }
            const obj = toPlainObject(raw);
            if (obj) {
              for (const [opKey, opVal] of Object.entries(obj)) {
                if (Array.isArray(opVal)) {
                  obj[opKey] = opVal.map(coerceBigIntValue);
                } else {
                  obj[opKey] = coerceBigIntValue(opVal);
                }
              }
              where[key] = obj;
              continue;
            }
            where[key] = coerceBigIntValue(raw);
            continue;
          }

          if (raw && typeof raw === 'object') {
            this.coerceBigIntWhere(raw);
          }
        }

        return where;
      }

      private buildWhere(filter: any): Record<string, any> {
        const all = (filter && (filter.filters as Record<string, any>)) || {};
        const baseFilters: Record<string, any> = {};

        for (const [key, entry] of Object.entries(all)) {
          if (this.model?.name === 'Image' && CUSTOM_IMAGE_FILTER_KEYS.has(key)) continue;
          if (!entry || typeof entry !== 'object') continue;
          if (!(entry as any).property) continue;
          baseFilters[key] = entry;
        }

        const where = convertFilter(this.model.fields, { filters: baseFilters });

        if (this.model?.name === 'Image') {
          const minWidth = parseFiniteNumber(filter?.get?.('minWidth')?.value);
          if (minWidth !== null) {
            const prev = toPlainObject(where.width) || {};
            where.width = { ...prev, gte: minWidth };
          }

          const minHeight = parseFiniteNumber(filter?.get?.('minHeight')?.value);
          if (minHeight !== null) {
            const prev = toPlainObject(where.height) || {};
            where.height = { ...prev, gte: minHeight };
          }

          const tag = parseNonEmptyString(filter?.get?.('tag')?.value);
          if (tag) {
            where.imageTags = {
              some: {
                tag: {
                  name: { contains: tag, mode: 'insensitive' },
                },
              },
            };
          }
        }

        this.coerceBigIntWhere(where);
        return where;
      }

      prepareReturnValues(params: any) {
        const prepared = super.prepareReturnValues(params);
        return makeJsonSafe(prepared);
      }

      async count(filter: any) {
        return this.manager.count({
          where: this.buildWhere(filter),
        });
      }

      async find(filter: any, params: any = {}) {
        const { limit = 10, offset = 0, sort = {} } = params;
        const orderBy = this.buildSortBy(sort);

        const results = await this.manager.findMany({
          where: this.buildWhere(filter),
          skip: offset,
          take: limit,
          orderBy,
        });

        return results.map((result: any) => new BaseRecord(this.prepareReturnValues(result), this));
      }
    }

    AdminJS.registerAdapter({ Database, Resource: PixivcatPrismaResource });

    const prismaClientModule = {
      Prisma: {
        // Avoid passing Prisma's strict-enum proxies into AdminJS options merging logic.
        // AdminJS Prisma adapter only needs access to DMMF (datamodel metadata).
        dmmf: (PrismaModule as any).Prisma?.dmmf,
      },
    };

    if (!prismaClientModule.Prisma.dmmf) {
      throw new Error('Prisma.dmmf is missing. Run `prisma generate` before starting the server.');
    }

    const prisma = getPrismaClient();
    const auditViewEnabled = parseBooleanEnv(process.env.ADMIN_AUDIT_VIEW_ENABLED, true);

    try {
      ensureEasyProxiesAutoRefreshStarted({ prisma });
    } catch {
      // best-effort
    }

    const ComponentLoader = (adminJSImport as any).ComponentLoader as new () => any;
    const componentLoader = new ComponentLoader();
    // AdminJS bundler parses JSX reliably from .jsx/.tsx but not from plain .js in some environments.
    const Dashboard = componentLoader.add('Dashboard', path.join(__dirname, 'pages', 'dashboard.jsx'));
    const OpsNavigator = componentLoader.add('OpsNavigator', path.join(__dirname, 'pages', 'opsNavigator.jsx'));
    const ImportUrls = componentLoader.add('ImportUrls', path.join(__dirname, 'pages', 'importUrls.jsx'));
    const HydrationOps = componentLoader.add('HydrationOps', path.join(__dirname, 'pages', 'hydrationOps.jsx'));
    const TokenProxyBindings = componentLoader.add('TokenProxyBindings', path.join(__dirname, 'pages', 'tokenProxyBindings.jsx'));
    const ProxyPoolOverview = componentLoader.add('ProxyPoolOverview', path.join(__dirname, 'pages', 'proxyPoolOverview.jsx'));
    const EasyProxiesImport = componentLoader.add('EasyProxiesImport', path.join(__dirname, 'pages', 'easyProxiesImport.jsx'));

    const admin = new AdminJS({
      rootPath: '/admin',
      locale: {
        language: 'zh-CN',
        availableLanguages: ['zh-CN', 'en'],
        translations: {
          labels: {
            navigation: '导航',
            pages: '页面',
            Dashboard: '仪表盘',
            OpsNavigator: '操作导航',
            'Ops Navigator': '操作导航',
            ImportUrls: '批量导入 URL',
            'Import Urls': '批量导入 URL',
            HydrationOps: '补全运行 / DLQ',
            'Hydration Ops': '补全运行 / DLQ',
            EasyProxiesImport: 'easy_proxies 导入',
            'Easy Proxies Import': 'easy_proxies 导入',
            TokenProxyBindings: '令牌代理绑定',
            'Token Proxy Bindings': '令牌代理绑定',
            ProxyPoolOverview: '代理池概览',
            'Proxy Pool Overview': '代理池概览',
          },
          pages: {
            opsNavigator: '操作导航',
            importUrls: '批量导入 URL',
            hydrationOps: '补全运行 / DLQ',
            easyProxiesImport: 'easy_proxies 导入',
            tokenProxyBindings: '令牌代理绑定',
            proxyPoolOverview: '代理池概览',
            Dashboard: '仪表盘',
            OpsNavigator: '操作导航',
            ImportUrls: '批量导入 URL',
            HydrationOps: '补全运行 / DLQ',
            EasyProxiesImport: 'easy_proxies 导入',
            TokenProxyBindings: '令牌代理绑定',
            ProxyPoolOverview: '代理池概览',
          },
          resources: {
            Image: '图片',
            Import: '导入记录',
            PixivToken: 'Pixiv 令牌',
            'Pixiv Token': 'Pixiv 令牌',
            ProxyEndpoint: '代理端点',
            'Proxy Endpoint': '代理端点',
            ProxyPool: '代理池',
            'Proxy Pool': '代理池',
            TokenProxyBinding: '令牌代理绑定',
            'Token Proxy Binding': '令牌代理绑定',
            HydrationRun: '补全运行',
            'Hydration Run': '补全运行',
            AdminAudit: '后台操作审计',
            'Admin Audit': '后台操作审计',
            RequestLog: '请求日志',
            'Request Log': '请求日志',
          },
          actions: {
            new: '新建',
            edit: '编辑',
            list: '列表',
            show: '详情',
            delete: '删除',
            search: '搜索',
            pause: '暂停',
            resume: '恢复',
            cancel: '取消',
            probe: '探测',
            setProxyEnabled: '切换代理开关',
            importProxyUris: 'URI 批量导入',
            easyProxiesConfigSave: '保存 easy_proxies 配置',
            easyProxiesImport: '导入 easy_proxies 代理',
            easyProxiesRollback: '回滚 easy_proxies 代理',
            rebindPrimary: '重绑主代理',
            setOverride: '设置临时覆盖',
            clearOverride: '清空临时覆盖',
          },
        },
      },
      componentLoader,
      pages: {
        opsNavigator: {
          label: '操作导航',
          component: OpsNavigator,
          handler: async () => ({ ok: true, generated_at: new Date().toISOString() }),
        },
        importUrls: {
          label: '批量导入 URL',
          component: ImportUrls,
          handler: async () => {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { getEnv } = require('../config/env') as typeof import('../config/env');
            const env = getEnv();
            return {
              ok: true,
              // Used by the frontend to build relative API URLs under reverse proxies.
              baseUrl: '',
              adminImportMaxFileBytes: env.ADMIN_IMPORT_MAX_FILE_BYTES,
              adminImportMaxLines: env.ADMIN_IMPORT_MAX_LINES,
              note: '实际导入接口：/admin/images/import。本页面用于预览、去重与分批提交（更适合 1Panel/Cloudflare 反代）。',
            };
          },
        },
        hydrationOps: {
          label: '补全运行 / DLQ',
          component: HydrationOps,
          handler: async (request: any) => {
            const method = String(request?.method || 'get').toLowerCase();

            const normalizeRuntimeError = (err: unknown): { code: string; message: string } => {
              const raw = err instanceof Error ? err.message : String(err ?? '');
              const normalized = raw.replace(/\s+/g, ' ').trim();
              const dbPattern = /(P1001|ECONNREFUSED|Can't reach database server|Database not reachable)/i;
              const queuePattern = /(start_failed|pgboss|queue)/i;

              if (!normalized) {
                return { code: 'runtime_error', message: '服务暂不可用，请稍后重试。' };
              }

              if (dbPattern.test(normalized)) {
                return { code: 'db_unreachable', message: '数据库暂不可用，请检查 DATABASE_URL 与 PostgreSQL 连接。' };
              }

              if (queuePattern.test(normalized)) {
                return { code: 'queue_unavailable', message: '队列服务暂不可用，请先恢复数据库连接后重试。' };
              }

              return {
                code: 'runtime_error',
                message: normalized.length > 180 ? `${normalized.slice(0, 180)}...` : normalized,
              };
            };

            let queue: { ok: boolean; message: string | null } = { ok: false, message: 'unknown' };
            try {
              // eslint-disable-next-line @typescript-eslint/no-var-requires
              const { getQueueHealth } = require('../queue/queue') as typeof import('../queue/queue');
              queue = await getQueueHealth();
            } catch (err: unknown) {
              const normalized = normalizeRuntimeError(err);
              queue = { ok: false, message: normalized.message };
            }

            const dlqEnabled = parseBooleanEnv(process.env.QUEUE_DEAD_LETTER_ENABLED, true);
            const baseQueues = ['hydrate_metadata', 'heal_url', 'hydration_backfill'];

            const dlqQueues = (() => {
              if (!dlqEnabled) return [];
              try {
                // eslint-disable-next-line @typescript-eslint/no-var-requires
                const { getDeadLetterQueueName } = require('../queue/queue') as typeof import('../queue/queue');
                return baseQueues
                  .map((name) => getDeadLetterQueueName(name))
                  .filter((name): name is string => typeof name === 'string' && name.trim().length > 0);
              } catch {
                return [];
              }
            })();

            const coerceInt = (value: unknown, fallback: number): number => {
              if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
              if (typeof value === 'string' && value.trim()) {
                const parsed = Number(value.trim());
                if (Number.isFinite(parsed)) return Math.trunc(parsed);
              }
              return fallback;
            };

            const normalizeUuid = (value: unknown): string | null => {
              if (typeof value !== 'string') return null;
              const v = value.trim();
              if (!v) return null;
              if (!/^[0-9a-fA-F-]{36}$/.test(v)) return null;
              return v;
            };

            const safeJobSummary = (data: any): Record<string, unknown> => {
              const out: Record<string, unknown> = {};
              if (!data || typeof data !== 'object') return out;
              const illust = data.illust_id ?? data.illustId ?? data.illustID ?? data.id;
              const run = data.run_id ?? data.runId ?? data.runID;
              const requestId = data.request_id ?? data.requestId;
              if (illust !== undefined && illust !== null && String(illust).trim()) out.illust_id = String(illust).trim();
              if (run !== undefined && run !== null && String(run).trim()) out.run_id = String(run).trim();
              if (requestId !== undefined && requestId !== null && String(requestId).trim()) out.request_id = String(requestId).trim();
              return out;
            };

            const extractOutputMessage = (output: any): { message: string | null; stack: string | null } => {
              if (!output || typeof output !== 'object') return { message: null, stack: null };
              const value = (output as any).value;
              if (!value || typeof value !== 'object') return { message: null, stack: null };
              const message = typeof (value as any).message === 'string' ? (value as any).message : null;
              const stack = typeof (value as any).stack === 'string' ? (value as any).stack : null;
              return { message, stack };
            };

            const queryDlqQueues = async () => {
              if (dlqQueues.length === 0) return { ok: true, queues: [] as any[] };
              try {
                const rows = await prisma.$queryRaw<{
                  name: string;
                  count: bigint | number | string;
                  oldest: Date | null;
                  newest: Date | null;
                }[]>(
                  Prisma.sql`
                    SELECT
                      name::text as name,
                      COUNT(*)::bigint as count,
                      MIN(created_on) as oldest,
                      MAX(created_on) as newest
                    FROM pgboss.job
                    WHERE name IN (${Prisma.join(dlqQueues)})
                    GROUP BY name
                    ORDER BY name ASC
                  `,
                );

                const countsByName = new Map<string, any>();
                for (const row of rows) {
                  const rawCount = row.count;
                  const count = typeof rawCount === 'bigint'
                    ? Number(rawCount)
                    : typeof rawCount === 'number'
                      ? rawCount
                      : Number(BigInt(rawCount));
                  countsByName.set(String(row.name), {
                    name: String(row.name),
                    count,
                    oldest: row.oldest ? row.oldest.toISOString() : null,
                    newest: row.newest ? row.newest.toISOString() : null,
                  });
                }

                const queues = dlqQueues.map((name) => countsByName.get(name) ?? { name, count: 0, oldest: null, newest: null });
                return { ok: true, queues };
              } catch (err: unknown) {
                const normalized = normalizeRuntimeError(err);
                return {
                  ok: false,
                  error: normalized.message,
                  error_code: normalized.code,
                  queues: [] as any[],
                };
              }
            };

            const queryDlqJobs = async (queueName: string, limit: number) => {
              const maxLimit = Math.max(1, Math.min(200, limit));
              try {
                const rows = await prisma.$queryRaw<{
                  id: string;
                  queue: string;
                  state: string;
                  created_on: Date;
                  data: any;
                  output: any;
                }[]>(
                  Prisma.sql`
                    SELECT
                      id::text as id,
                      name::text as queue,
                      state::text as state,
                      created_on,
                      data,
                      output
                    FROM pgboss.job
                    WHERE name = ${queueName}
                    ORDER BY created_on DESC
                    LIMIT ${maxLimit}
                  `,
                );

                return rows.map((row) => {
                  const output = extractOutputMessage(row.output);
                  return {
                    id: row.id,
                    queue: row.queue,
                    state: row.state,
                    created_on: row.created_on ? row.created_on.toISOString() : null,
                    data_summary: safeJobSummary(row.data),
                    error_message: output.message,
                    error_stack: output.stack,
                  };
                });
              } catch (err: unknown) {
                const normalized = normalizeRuntimeError(err);
                const output = extractOutputMessage({ value: { message: normalized.message } });
                return [{
                  id: 'query_failed',
                  queue: queueName,
                  state: 'error',
                  created_on: null,
                  data_summary: {},
                  error_message: output.message,
                  error_stack: output.stack,
                }];
              }
            };

            if (method === 'post') {
              const payload = request?.payload && typeof request.payload === 'object' ? (request.payload as Record<string, unknown>) : {};
              const action = typeof payload.action === 'string' ? payload.action.trim() : '';

              if (action === 'dlq_list') {
                const queueName = typeof payload.queue === 'string' ? payload.queue.trim() : '';
                if (!queueName || !dlqQueues.includes(queueName)) {
                  return { ok: false, error: 'invalid_queue' };
                }
                const jobs = await queryDlqJobs(queueName, coerceInt(payload.limit, 50));
                return { ok: true, queue: queueName, jobs };
              }

              if (action === 'dlq_delete') {
                const queueName = typeof payload.queue === 'string' ? payload.queue.trim() : '';
                const jobId = normalizeUuid(payload.job_id ?? payload.jobId);
                if (!queueName || !dlqQueues.includes(queueName)) return { ok: false, error: 'invalid_queue' };
                if (!jobId) return { ok: false, error: 'invalid_job_id' };

                const deleted = await prisma.$executeRaw(
                  Prisma.sql`DELETE FROM pgboss.job WHERE name = ${queueName} AND id = ${jobId}::uuid`,
                );

                auditAdminModelChange({
                  action: 'dlq_job_delete',
                  resource: 'PgBossJob',
                  record_id: jobId,
                  req: request,
                  detail: { queue: queueName, deleted },
                });

                return { ok: true, deleted };
              }

              if (action === 'dlq_retry') {
                const queueName = typeof payload.queue === 'string' ? payload.queue.trim() : '';
                const jobId = normalizeUuid(payload.job_id ?? payload.jobId);
                if (!queueName || !dlqQueues.includes(queueName)) return { ok: false, error: 'invalid_queue' };
                if (!jobId) return { ok: false, error: 'invalid_job_id' };

                // eslint-disable-next-line @typescript-eslint/no-var-requires
                const { getBaseQueueNameFromDlq } = require('../queue/queue') as typeof import('../queue/queue');
                const baseQueue = getBaseQueueNameFromDlq(queueName);
                if (!baseQueue) return { ok: false, error: 'unsupported_dlq_queue' };

                const job = await prisma.$queryRaw<{ data: any }[]>(
                  Prisma.sql`SELECT data FROM pgboss.job WHERE name = ${queueName} AND id = ${jobId}::uuid LIMIT 1`,
                );
                const data = job?.[0]?.data;
                if (!data) return { ok: false, error: 'job_not_found' };

                const summary = safeJobSummary(data);
                let newJobId: string | null = null;

                try {
                  if (baseQueue === 'hydrate_metadata') {
                    // eslint-disable-next-line @typescript-eslint/no-var-requires
                    const { enqueueHydrateMetadata } = require('../jobs/hydrateMetadata') as typeof import('../jobs/hydrateMetadata');
                    const illustIdRaw = data.illust_id ?? data.illustId ?? data.illustID ?? data.id;
                    if (illustIdRaw === undefined || illustIdRaw === null || !String(illustIdRaw).trim()) return { ok: false, error: 'missing_illust_id' };
                    newJobId = await enqueueHydrateMetadata(BigInt(String(illustIdRaw).trim()), typeof summary.request_id === 'string' ? summary.request_id : undefined);
                  } else if (baseQueue === 'heal_url') {
                    // eslint-disable-next-line @typescript-eslint/no-var-requires
                    const { enqueueHealUrl } = require('../jobs/healUrl') as typeof import('../jobs/healUrl');
                    const illustIdRaw = data.illust_id ?? data.illustId ?? data.illustID ?? data.id;
                    if (illustIdRaw === undefined || illustIdRaw === null || !String(illustIdRaw).trim()) return { ok: false, error: 'missing_illust_id' };
                    newJobId = await enqueueHealUrl(BigInt(String(illustIdRaw).trim()), typeof summary.request_id === 'string' ? summary.request_id : undefined);
                  } else if (baseQueue === 'hydration_backfill') {
                    // eslint-disable-next-line @typescript-eslint/no-var-requires
                    const { enqueueHydrationBackfillRun } = require('../jobs/hydrationBackfill') as typeof import('../jobs/hydrationBackfill');
                    const runIdRaw = data.run_id ?? data.runId ?? data.runID ?? data.id;
                    if (runIdRaw === undefined || runIdRaw === null || !String(runIdRaw).trim()) return { ok: false, error: 'missing_run_id' };
                    newJobId = await enqueueHydrationBackfillRun(BigInt(String(runIdRaw).trim()), typeof summary.request_id === 'string' ? summary.request_id : undefined);
                  } else {
                    return { ok: false, error: 'unsupported_base_queue' };
                  }
                } catch (err: unknown) {
                  const normalized = normalizeRuntimeError(err);
                  return { ok: false, error: normalized.message, error_code: normalized.code };
                }

                if (!newJobId) {
                  return { ok: false, error: 'enqueue_returned_null', message: '入队返回空值（可能被限流）。' };
                }

                const deleted = await prisma.$executeRaw(
                  Prisma.sql`DELETE FROM pgboss.job WHERE name = ${queueName} AND id = ${jobId}::uuid`,
                );

                auditAdminModelChange({
                  action: 'dlq_job_retry',
                  resource: 'PgBossJob',
                  record_id: jobId,
                  req: request,
                  detail: { dlq_queue: queueName, base_queue: baseQueue, new_job_id: newJobId, deleted, data: summary },
                });

                return { ok: true, new_job_id: newJobId, deleted, message: `已入队 ${baseQueue}` };
              }

              return { ok: false, error: 'unknown_action' };
            }

            const generatedAt = new Date().toISOString();

            let runs: any[] = [];
            try {
              const rows = await prisma.hydrationRun.findMany({
                orderBy: [{ createdAt: 'desc' }],
                take: 30,
                select: {
                  id: true,
                  type: true,
                  status: true,
                  total: true,
                  processed: true,
                  success: true,
                  failed: true,
                  updatedAt: true,
                  lastErrorCode: true,
                  lastErrorMsg: true,
                },
              });
              runs = rows.map((row) => ({
                id: row.id.toString(),
                type: row.type,
                status: row.status,
                total: row.total,
                processed: row.processed,
                success: row.success,
                failed: row.failed,
                updated_at: row.updatedAt ? row.updatedAt.toISOString() : null,
                last_error_code: row.lastErrorCode,
                last_error_msg: row.lastErrorMsg,
              }));
            } catch {
              runs = [];
            }

            const dlqMeta = await queryDlqQueues();
            const defaultQueueName = dlqMeta.ok && dlqMeta.queues.length > 0 ? String(dlqMeta.queues[0]?.name || '') : '';
            const jobs = defaultQueueName ? await queryDlqJobs(defaultQueueName, 50) : [];

            return {
              ok: true,
              generated_at: generatedAt,
              queue,
              runs,
              dlq: {
                enabled: dlqEnabled,
                ok: dlqMeta.ok,
                error: (dlqMeta as any).error ?? null,
                queues: dlqMeta.queues,
                jobs,
              },
            };
          },
        },
        easyProxiesImport: {
          label: 'easy_proxies 导入/刷新',
          component: EasyProxiesImport,
          handler: async () => {
            try {
              const config = await loadEasyProxiesRuntimeConfig({ prisma });
              const autoRefresh = getEasyProxiesAutoRefreshSnapshot();

              const envBaseUrl = String(process.env.EASY_PROXIES_BASE_URL || '').trim() || null;
              const envPasswordConfigured = Boolean(String(process.env.EASY_PROXIES_PASSWORD || '').trim());

              let proxyCounts: { total: number; enabled_total: number; easy_total: number; easy_enabled: number } | null = null;
              try {
                const [total, enabledTotal, easyTotal, easyEnabled] = await Promise.all([
                  prisma.proxyEndpoint.count(),
                  prisma.proxyEndpoint.count({ where: { enabled: true } }),
                  prisma.proxyEndpoint.count({ where: { source: 'easy_proxies' } }),
                  prisma.proxyEndpoint.count({ where: { source: 'easy_proxies', enabled: true } }),
                ]);
                proxyCounts = { total, enabled_total: enabledTotal, easy_total: easyTotal, easy_enabled: easyEnabled };
              } catch {
                proxyCounts = null;
              }

              return {
                ok: true,
                generated_at: new Date().toISOString(),
                config: {
                  source: config.source,
                  base_url: config.baseUrl,
                  password_configured: Boolean(config.password),
                  auto_refresh_enabled: config.autoRefreshEnabled,
                  refresh_interval_ms: config.refreshIntervalMs,
                },
                auto_refresh: autoRefresh,
                proxies: proxyCounts,
                env: {
                  base_url: envBaseUrl,
                  password_configured: envPasswordConfigured,
                },
              };
            } catch (err: unknown) {
              return { ok: false, error: err instanceof Error ? err.message : String(err) };
            }
          },
        },
        tokenProxyBindings: {
          label: 'Token↔Proxy 绑定',
          component: TokenProxyBindings,
          handler: async () => {
            try {
              const generatedAt = new Date().toISOString();

              const tokens = await prisma.pixivToken.findMany({
                where: { enabled: true },
                select: { id: true, label: true, enabled: true, refreshTokenMasked: true, updatedAt: true },
                orderBy: [{ id: 'asc' }],
              });

              const proxies = await prisma.proxyEndpoint.findMany({
                where: { enabled: true },
                select: { id: true, scheme: true, host: true, port: true, username: true, enabled: true, source: true, sourceRef: true },
                orderBy: [{ id: 'asc' }],
              });

              const pool = await prisma.proxyPool.findUnique({
                where: { name: 'default' },
                select: { id: true, name: true, enabled: true, updatedAt: true },
              });

              const proxyById = new Map<string, any>();
              const proxyIds: string[] = [];
              for (const p of proxies) {
                const id = p.id.toString();
                proxyById.set(id, p);
                proxyIds.push(id);
              }

              const bindings = pool
                ? await prisma.tokenProxyBinding.findMany({
                  where: { poolId: pool.id, tokenId: { in: tokens.map((t) => t.id) } },
                  select: {
                    id: true,
                    tokenId: true,
                    poolId: true,
                    primaryProxyId: true,
                    overrideProxyId: true,
                    overrideExpiresAt: true,
                    updatedAt: true,
                    createdAt: true,
                  },
                })
                : [];

              const bindingByToken = new Map<string, any>();
              for (const b of bindings) {
                bindingByToken.set(b.tokenId.toString(), b);
              }

              const now = new Date();
              const salt = pool ? `pool:${pool.id.toString()}` : 'pool:default';

              const formatProxyDisplay = (p: any): string => {
                if (!p) return '';
                const scheme = String(p.scheme ?? '').toLowerCase();
                const host = String(p.host ?? '').trim();
                const port = Number(p.port);
                const username = String(p.username ?? '').trim();
                const auth = username ? `${username}@` : '';
                const hostForUri = host.includes(':') && !host.startsWith('[') && !host.endsWith(']') ? `[${host}]` : host;
                return `${scheme}://${auth}${hostForUri}:${port}`;
              };

              const tokenRows = tokens.map((t) => ({ id: t.id.toString(), label: t.label ?? null, refreshTokenMasked: t.refreshTokenMasked }));
              const proxyRows = proxies.map((p) => ({
                id: p.id.toString(),
                enabled: Boolean(p.enabled),
                source: p.source,
                sourceRef: p.sourceRef ?? null,
                display: formatProxyDisplay(p),
              }));

              const bindingRows = tokenRows.map((t) => {
                const b = bindingByToken.get(t.id) ?? null;

                const suggestedPrimaryProxyId =
                  proxyIds.length > 0
                    ? pickPrimaryProxyRendezvous(t.id, proxyIds, salt)
                    : null;

                if (!b) {
                  return {
                    tokenId: t.id,
                    bindingId: null,
                    primaryProxyId: null,
                    overrideProxyId: null,
                    overrideExpiresAt: null,
                    effectiveProxyId: null,
                    effectiveMode: null,
                    suggestedPrimaryProxyId,
                  };
                }

                const effective = resolveEffectiveProxy({
                  primaryProxyId: b.primaryProxyId.toString(),
                  overrideProxyId: b.overrideProxyId ? b.overrideProxyId.toString() : null,
                  overrideExpiresAt: b.overrideExpiresAt ?? null,
                }, now);

                return {
                  tokenId: t.id,
                  bindingId: b.id.toString(),
                  primaryProxyId: b.primaryProxyId.toString(),
                  overrideProxyId: b.overrideProxyId ? b.overrideProxyId.toString() : null,
                  overrideExpiresAt: b.overrideExpiresAt ? b.overrideExpiresAt.toISOString() : null,
                  effectiveProxyId: effective.proxyId,
                  effectiveMode: effective.mode,
                  suggestedPrimaryProxyId,
                };
              });

              return {
                ok: true,
                generated_at: generatedAt,
                pool: pool ? { id: pool.id.toString(), name: pool.name, enabled: Boolean(pool.enabled), updated_at: pool.updatedAt.toISOString() } : null,
                tokens: tokenRows,
                proxies: proxyRows,
                bindings: bindingRows,
                summary: {
                  tokens_total: tokenRows.length,
                  proxies_total: proxyRows.length,
                  bindings_total: bindings.length,
                  missing_bindings: bindingRows.filter((b: any) => !b.bindingId).length,
                },
                note: '手动 rebind/override 会写入 token_proxy_bindings，并写入 AdminAudit（不含敏感信息）。',
                proxy_by_id: Object.fromEntries(Array.from(proxyById.entries()).map(([id, p]) => [id, { display: formatProxyDisplay(p) }])),
              };
            } catch (err: unknown) {
              return { ok: false, error: err instanceof Error ? err.message : String(err) };
            }
          },
        },
        proxyPoolOverview: {
          label: '[统计] 代理池概览',
          component: ProxyPoolOverview,
          handler: async () => {
            try {
              const generatedAt = new Date().toISOString();

              const proxies = await prisma.proxyEndpoint.findMany({
                where: { enabled: true },
                select: { id: true, scheme: true, host: true, port: true, username: true, enabled: true, source: true, sourceRef: true },
                orderBy: [{ id: 'asc' }],
              });

              const formatProxyDisplay = (p: any): string => {
                if (!p) return '';
                const scheme = String(p.scheme ?? '').toLowerCase();
                const host = String(p.host ?? '').trim();
                const port = Number(p.port);
                const username = String(p.username ?? '').trim();
                const auth = username ? `${username}@` : '';
                const hostForUri = host.includes(':') && !host.startsWith('[') && !host.endsWith(']') ? `[${host}]` : host;
                return `${scheme}://${auth}${hostForUri}:${port}`;
              };

              const proxyDisplayById: Record<string, string> = {};
              for (const p of proxies) {
                proxyDisplayById[p.id.toString()] = formatProxyDisplay(p);
              }

              const options = getProxyHealthOptions();
              let report = getProxyHealthReport();
              const nowMs = Date.now();
              const staleCutoffMs = Math.min(30_000, options.intervalMs);
              const stale = report ? (nowMs - report.checkedAt) > staleCutoffMs : true;
              const canProbeNow = process.env.NODE_ENV !== 'test';
              const refreshTimeoutMs = Math.max(
                1_500,
                Math.min(
                  12_000,
                  Number.parseInt(String(process.env.ADMIN_PROXY_OVERVIEW_REFRESH_TIMEOUT_MS ?? '3500'), 10) || 3_500,
                ),
              );
              const refreshMeta = {
                attempted: false,
                timeout_ms: refreshTimeoutMs,
                timed_out: false,
                error: null as string | null,
              };

              if ((report === null || stale) && canProbeNow) {
                // Best-effort refresh for the admin page; the health checker caches samples in-memory.
                refreshMeta.attempted = true;
                const refreshResult = await runWithTimeout(
                  runProxyHealthCheckOnce({ prisma, options: { maxConcurrency: Math.min(options.maxConcurrency, 10) } }),
                  refreshTimeoutMs,
                );
                if (refreshResult.status === 'ok') {
                  report = refreshResult.value;
                } else if (refreshResult.status === 'timeout') {
                  refreshMeta.timed_out = true;
                } else {
                  refreshMeta.error = refreshResult.error;
                }
              }

              const reportAgeMs = report ? Math.max(0, nowMs - report.checkedAt) : null;
              const staleFallback = reportAgeMs !== null && reportAgeMs > staleCutoffMs;

              const health = (() => {
                if (!report) {
                  if (refreshMeta.timed_out) {
                    return {
                      ok: false,
                      reason: 'refresh_timeout',
                      refresh: refreshMeta,
                    };
                  }
                  return {
                    ok: false,
                    reason: refreshMeta.error ? 'refresh_error' : 'no_report',
                    refresh: refreshMeta,
                  };
                }

                const counts = { healthy: 0, warning: 0, error: 0, unknown: 0 };
                let success = 0;
                let failure = 0;
                const latencies: number[] = [];

                for (const entry of report.entries || []) {
                  if (entry.status === 'healthy') counts.healthy += 1;
                  else if (entry.status === 'warning') counts.warning += 1;
                  else if (entry.status === 'error') counts.error += 1;
                  else counts.unknown += 1;

                  success += Number(entry.success || 0);
                  failure += Number(entry.failure || 0);

                  const latency = Number(entry.lastLatencyMs);
                  if (Number.isFinite(latency) && latency >= 0) latencies.push(latency);
                }

                latencies.sort((a, b) => a - b);
                const percentile = (p: number): number | null => {
                  if (latencies.length === 0) return null;
                  const idx = Math.floor((latencies.length - 1) * p);
                  return latencies[Math.min(Math.max(idx, 0), latencies.length - 1)] ?? null;
                };

                const totalSamples = success + failure;
                const successRate = totalSamples > 0 ? success / totalSamples : null;

                const recentFailures = (report.entries || [])
                  .filter((e) => e.lastOk === false && e.lastError)
                  .sort((a, b) => (b.lastCheckedAt ?? 0) - (a.lastCheckedAt ?? 0))
                  .slice(0, 20)
                  .map((e) => ({
                    id: e.id,
                    display: proxyDisplayById[e.id] ?? e.id,
                    status: e.status,
                    lastCheckedAt: e.lastCheckedAt ? new Date(e.lastCheckedAt).toISOString() : null,
                    lastLatencyMs: e.lastLatencyMs ?? null,
                    successRate: e.successRate ?? null,
                    lastError: e.lastError ?? null,
                  }));

                const entries = (report.entries || []).map((e) => ({
                  id: e.id,
                  display: proxyDisplayById[e.id] ?? e.id,
                  status: e.status,
                  lastOk: e.lastOk,
                  lastCheckedAt: e.lastCheckedAt ? new Date(e.lastCheckedAt).toISOString() : null,
                  lastLatencyMs: e.lastLatencyMs ?? null,
                  lastError: e.lastError ?? null,
                  samples: e.samples,
                  success: e.success,
                  failure: e.failure,
                  successRate: e.successRate,
                  avgLatencyMs: e.avgLatencyMs,
                  score: e.score,
                }));

                return {
                  ok: true,
                  checked_at: new Date(report.checkedAt).toISOString(),
                  checked_age_ms: reportAgeMs,
                  stale_fallback: staleFallback,
                  probe_url: report.probeUrl,
                  timeout_ms: report.timeoutMs,
                  min_healthy: report.minHealthy,
                  pool_total: report.total,
                  pool_healthy: report.healthy,
                  pool_ok: report.ok,
                  counts,
                  totals: { success, failure, samples: totalSamples, success_rate: successRate },
                  latency_ms: {
                    min: latencies.length ? latencies[0] : null,
                    p50: percentile(0.5),
                    p90: percentile(0.9),
                    p95: percentile(0.95),
                    max: latencies.length ? latencies[latencies.length - 1] : null,
                  },
                  recent_failures: recentFailures,
                  entries,
                  refresh: refreshMeta,
                };
              })();

              const outboundMetric = await getOutboundErrorsTotalCounter().get();
              const outbound = {
                metric: outboundMetric?.name ?? 'outbound_errors_total',
                help: outboundMetric?.help ?? null,
                values: (outboundMetric?.values || [])
                  .map((row: any) => ({ type: String(row.labels?.type ?? 'unknown'), value: Number(row.value || 0) }))
                  .sort((a: any, b: any) => b.value - a.value)
                  .slice(0, 30),
              };

              return {
                ok: true,
                generated_at: generatedAt,
                proxies: {
                  enabled_total: proxies.length,
                },
                health,
                outbound_errors_total: outbound,
                note: 'outbound_errors_total 来自 prom-client registry（应与 /metrics 一致）；健康检查数据来自内存窗口采样（可用于排障/筛选）。',
              };
            } catch (err: unknown) {
              return { ok: false, error: err instanceof Error ? err.message : String(err) };
            }
          },
        },
      },
      dashboard: {
        component: Dashboard,
        handler: async () => {
          let imagesTotal = 0;
          let imagesActive = 0;
          let imagesDisabled = 0;
          let imagesBroken = 0;
          let topErrors: { code: string; count: number }[] = [];

          let importsTotal = 0;
          let importsLast24h = 0;
          let lastImportAt: string | null = null;

          let dbError: string | null = null;

          try {
            const [total, active, disabled, broken] = await Promise.all([
              prisma.image.count(),
              prisma.image.count({ where: { status: 1 } }),
              prisma.image.count({ where: { status: 2 } }),
              prisma.image.count({ where: { status: 3 } }),
            ]);

            imagesTotal = total;
            imagesActive = active;
            imagesDisabled = disabled;
            imagesBroken = broken;

            const topErrorsRows = await prisma.$queryRaw<{ last_error_code: string; count: bigint | string }[]>(
              Prisma.sql`
                SELECT last_error_code, COUNT(*)::bigint AS count
                FROM images
                WHERE last_error_code IS NOT NULL AND last_error_code <> ''
                GROUP BY last_error_code
                ORDER BY count DESC
                LIMIT 10
              `,
            );

            topErrors = topErrorsRows.map((row) => ({
              code: row.last_error_code,
              count: typeof row.count === 'bigint' ? Number(row.count) : Number(BigInt(row.count)),
            }));

            const last24hCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
            const [impTotal, impLast24h, lastImport] = await Promise.all([
              prisma.import.count(),
              prisma.import.count({ where: { createdAt: { gte: last24hCutoff } } }),
              prisma.import.findFirst({ orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
            ]);

            importsTotal = impTotal;
            importsLast24h = impLast24h;
            lastImportAt = lastImport?.createdAt ? lastImport.createdAt.toISOString() : null;
          } catch (err: unknown) {
            dbError = err instanceof Error ? err.message : String(err);
          }

          const brokenRatio = imagesTotal > 0 ? imagesBroken / imagesTotal : 0;

          let queue: { ok: boolean; message: string | null } = { ok: false, message: 'unknown' };
          try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { getQueueHealth } = require('../queue/queue') as typeof import('../queue/queue');
            queue = await getQueueHealth();
          } catch (err: unknown) {
            queue = { ok: false, message: err instanceof Error ? err.message : String(err) };
          }

          let traffic: any = { ok: false };
          try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { getHttpRequestsTotalCounter } = require('../metrics/httpMetrics') as typeof import('../metrics/httpMetrics');
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { getRandomSuccessTotalCounter, getRandomFailTotalCounter } = require('../metrics/randomMetrics') as typeof import('../metrics/randomMetrics');

            const httpMetric = await getHttpRequestsTotalCounter().get();
            let httpTotal = 0;
            let http2xx = 0;
            let http4xx = 0;
            let http5xx = 0;
            for (const row of httpMetric.values || []) {
              const value = Number(row.value) || 0;
              httpTotal += value;
              const status = String(row.labels?.status || '');
              if (status.startsWith('2')) http2xx += value;
              else if (status.startsWith('4')) http4xx += value;
              else if (status.startsWith('5')) http5xx += value;
            }

            const randomSuccessMetric = await getRandomSuccessTotalCounter().get();
            const randomFailMetric = await getRandomFailTotalCounter().get();
            const randomSuccess = Number(randomSuccessMetric.values?.[0]?.value || 0);
            const randomFail = Number(randomFailMetric.values?.[0]?.value || 0);
            const randomTotal = randomSuccess + randomFail;

            traffic = {
              ok: true,
              http: {
                total: httpTotal,
                status_2xx: http2xx,
                status_4xx: http4xx,
                status_5xx: http5xx,
                success_ratio: httpTotal > 0 ? http2xx / httpTotal : null,
              },
              random: {
                success_total: randomSuccess,
                fail_total: randomFail,
                total: randomTotal,
                success_ratio: randomTotal > 0 ? randomSuccess / randomTotal : null,
              },
            };
          } catch {
            traffic = { ok: false };
          }

          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { getEnv } = require('../config/env') as { getEnv: () => { METRICS_ENABLED: boolean; PROMETHEUS_URL?: string } };
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { getMetricsRegistry } = require('../metrics/registry') as { getMetricsRegistry: () => { getMetricsAsJSON: () => Promise<any[]> } };

          const env = getEnv();
          const registry = getMetricsRegistry();
          let metricNames: string[] = [];
          try {
            const metricsJson = await registry.getMetricsAsJSON();
            metricNames = Array.isArray(metricsJson)
              ? metricsJson.map((metric) => metric?.name).filter((name) => typeof name === 'string').sort()
              : [];
          } catch {
            metricNames = [];
          }

          const prometheus: any = {
            configured: Boolean(env.PROMETHEUS_URL),
            ok: false,
            error: null,
            cached: false,
            fetched_at: null,
            requests_24h: { value: null, error: null },
            top_errors_24h: { rows: [], error: null },
            latency_p50_p90_p95: { p50_s: null, p90_s: null, p95_s: null, error: null },
          };

          if (env.PROMETHEUS_URL) {
            const res = await queryPrometheusInstant('1', { baseUrl: env.PROMETHEUS_URL });
            prometheus.cached = res.cached;
            prometheus.fetched_at = res.fetchedAt;
            if (res.ok) {
              prometheus.ok = true;
            } else {
              prometheus.ok = false;
              prometheus.error = res.error;
            }

            const requestsRes = await queryPrometheusInstant(
              'sum(increase(http_requests_total[24h]))',
              { baseUrl: env.PROMETHEUS_URL },
            );
            if (requestsRes.ok) {
              const value = extractFirstSampleValue(requestsRes);
              prometheus.requests_24h.value = value;
              if (value === null) prometheus.requests_24h.error = 'no_data';
            } else {
              prometheus.requests_24h.error = requestsRes.error;
            }

            const errorsRes = await queryPrometheusInstant(
              'topk(10, sum by (status) (increase(http_requests_total{status=~"4..|5.."}[24h])))',
              { baseUrl: env.PROMETHEUS_URL },
            );
            if (errorsRes.ok) {
              prometheus.top_errors_24h.rows = extractVectorSamples(errorsRes)
                .map((sample) => ({ status: String(sample.metric.status ?? 'unknown'), count: Math.round(sample.value) }));
            } else {
              prometheus.top_errors_24h.error = errorsRes.error;
            }

            const q50 = await queryPrometheusInstant(
              'histogram_quantile(0.5, sum(rate(request_duration_seconds_bucket[24h])) by (le))',
              { baseUrl: env.PROMETHEUS_URL },
            );
            const q90 = await queryPrometheusInstant(
              'histogram_quantile(0.9, sum(rate(request_duration_seconds_bucket[24h])) by (le))',
              { baseUrl: env.PROMETHEUS_URL },
            );
            const q95 = await queryPrometheusInstant(
              'histogram_quantile(0.95, sum(rate(request_duration_seconds_bucket[24h])) by (le))',
              { baseUrl: env.PROMETHEUS_URL },
            );

            if (q50.ok) prometheus.latency_p50_p90_p95.p50_s = extractFirstSampleValue(q50);
            else prometheus.latency_p50_p90_p95.error = q50.error;

            if (q90.ok) prometheus.latency_p50_p90_p95.p90_s = extractFirstSampleValue(q90);
            else prometheus.latency_p50_p90_p95.error ??= q90.error;

            if (q95.ok) prometheus.latency_p50_p90_p95.p95_s = extractFirstSampleValue(q95);
            else prometheus.latency_p50_p90_p95.error ??= q95.error;
          }

          const mem = process.memoryUsage();

          const easyProxies: any = {
            configured: false,
            ok: false,
            error: null,
            total_nodes: 0,
            available_nodes: 0,
            nodes: [],
            region_stats: {},
            region_healthy: {},
          };

          const easyProxiesBaseUrl = String(process.env.EASY_PROXIES_BASE_URL || '').trim();
          if (easyProxiesBaseUrl) {
            easyProxies.configured = true;
            try {
              const password = String(process.env.EASY_PROXIES_PASSWORD || '').trim() || undefined;

              const fetchWithTimeout = (timeoutMs: number) => (input: any, init: any = {}) => {
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), timeoutMs);
                return fetch(input, { ...(init ?? {}), signal: controller.signal })
                  .finally(() => clearTimeout(timer));
              };

              // eslint-disable-next-line @typescript-eslint/no-var-requires
              const { easyProxiesNodes } = require('../proxy/easyProxiesClient') as typeof import('../proxy/easyProxiesClient');

              const nodesRes = await easyProxiesNodes({
                baseUrl: easyProxiesBaseUrl,
                password,
                fetch: fetchWithTimeout(2000),
              });

              if (nodesRes.ok) {
                easyProxies.ok = true;
                easyProxies.total_nodes = nodesRes.total_nodes;
                easyProxies.available_nodes = nodesRes.nodes.length;
                easyProxies.region_stats = nodesRes.region_stats;
                easyProxies.region_healthy = nodesRes.region_healthy;

                easyProxies.nodes = nodesRes.nodes
                  .map((n) => ({
                    tag: n.tag,
                    name: n.name,
                    mode: n.mode,
                    port: n.port ?? null,
                    region: n.region ?? null,
                    country: n.country ?? null,
                    last_latency_ms: n.last_latency_ms ?? null,
                    available: n.available ?? null,
                    initial_check_done: n.initial_check_done ?? null,
                    blacklisted: n.blacklisted ?? null,
                  }))
                  .sort((a, b) => {
                    const la = typeof a.last_latency_ms === 'number' ? a.last_latency_ms : Number.POSITIVE_INFINITY;
                    const lb = typeof b.last_latency_ms === 'number' ? b.last_latency_ms : Number.POSITIVE_INFINITY;
                    return la - lb;
                  })
                  .slice(0, 100);
              } else {
                easyProxies.ok = false;
                easyProxies.error = nodesRes.error;
              }
            } catch (err: unknown) {
              easyProxies.ok = false;
              easyProxies.error = err instanceof Error ? err.message : String(err);
            }
          }

          let pixivTokens: any = { ok: false, error: null, source: null, tokens: [] };
          try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { getPixivTokenRuntimeStates } = require('../services/pixivAuthService') as typeof import('../services/pixivAuthService');
            pixivTokens = await getPixivTokenRuntimeStates();
          } catch (err: unknown) {
            pixivTokens = { ok: false, error: err instanceof Error ? err.message : String(err), source: null, tokens: [] };
          }

          let runtimeConfig: any = { ok: false, error: null, source: null, version: null, fetched_at: null, proxy_enabled: null };
          try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { getRuntimeConfigSnapshot } = require('../config/runtimeConfig') as typeof import('../config/runtimeConfig');
            const snapshot = await getRuntimeConfigSnapshot({ prisma });
            runtimeConfig = {
              ok: true,
              error: null,
              source: snapshot.source,
              version: snapshot.version,
              fetched_at: snapshot.fetchedAt,
              proxy_enabled: snapshot.config.proxyEnabled,
              proxy_fail_closed: snapshot.config.proxyFailClosed,
              proxy_route_mode: snapshot.config.proxyRouteMode,
            };
          } catch (err: unknown) {
            runtimeConfig = { ok: false, error: err instanceof Error ? err.message : String(err), source: null, version: null, fetched_at: null, proxy_enabled: null };
          }

          return {
            generated_at: new Date().toISOString(),
            runtime_config: runtimeConfig,
            images: {
              total: imagesTotal,
              active: imagesActive,
              disabled: imagesDisabled,
              broken: imagesBroken,
              broken_ratio: brokenRatio,
              top_errors: topErrors,
            },
            imports: {
              total: importsTotal,
              last_24h: importsLast24h,
              last_at: lastImportAt,
            },
            process: {
              uptime_s: process.uptime(),
              rss_bytes: mem.rss,
              heap_used_bytes: mem.heapUsed,
              heap_total_bytes: mem.heapTotal,
              external_bytes: mem.external,
              array_buffers_bytes: (mem as any).arrayBuffers ?? 0,
            },
            queue,
            pixiv_tokens: pixivTokens,
            easy_proxies: easyProxies,
            metrics: {
              enabled: env.METRICS_ENABLED,
              metric_names: metricNames,
            },
            prometheus,
            traffic,
            errors: {
              db: dbError,
            },
          };
        },
      },
      resources: (() => {
        const resources = [
          {
            resource: { model: getModelByName('Image', prismaClientModule), client: prisma, clientModule: prismaClientModule },
            options: imageResourceOptions,
          },
          {
            resource: { model: getModelByName('Tag', prismaClientModule), client: prisma, clientModule: prismaClientModule },
            options: { navigation: { name: '导入与图片', icon: 'Database' }, label: '标签' },
          },
          {
            resource: { model: getModelByName('PixivToken', prismaClientModule), client: prisma, clientModule: prismaClientModule },
            options: pixivTokenResourceOptions,
          },
          {
            resource: { model: getModelByName('TokenProxyBinding', prismaClientModule), client: prisma, clientModule: prismaClientModule },
            options: {
              navigation: { name: '令牌', icon: 'Key' },
              label: '令牌↔代理 绑定（操作）',
              listProperties: [
                'id',
                'tokenId',
                'poolId',
                'primaryProxyId',
                'overrideProxyId',
                'overrideExpiresAt',
                'updatedAt',
                'createdAt',
              ],
              filterProperties: [
                'tokenId',
                'poolId',
                'primaryProxyId',
                'overrideProxyId',
                'overrideExpiresAt',
                'updatedAt',
                'createdAt',
              ],
              actions: {
                new: { isAccessible: false, isVisible: false },
                edit: { isAccessible: false, isVisible: false },
                delete: { isAccessible: false, isVisible: false },

                rebindPrimary: {
                  actionType: 'resource',
                  icon: 'Shuffle',
                  label: '重绑主代理（页面入口）',
                  handler: async (request: any, _res: any, context: any) => {
                    if (String(request?.method || '').toLowerCase() === 'get') return {};

                    const toBigIntId = (value: any, label: string): bigint => {
                      try {
                        const raw = typeof value === 'bigint' ? value : BigInt(String(value ?? '').trim());
                        if (raw <= 0n) throw new Error('non_positive');
                        return raw;
                      } catch {
                        throw new Error(`${label} 必须是 bigint 类型的 ID。`);
                      }
                    };

                    const parseBool = (value: any, defaultValue: boolean): boolean => {
                      if (typeof value === 'boolean') return value;
                      if (typeof value === 'number') return value !== 0;
                      if (typeof value === 'string') {
                        const normalized = value.trim().toLowerCase();
                        if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
                        if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
                      }
                      return defaultValue;
                    };

                    const reasonRaw = (request as any)?.payload?.reason;
                    const reason = typeof reasonRaw === 'string' && reasonRaw.trim() ? reasonRaw.trim().slice(0, 200) : null;
                    const clearOverride = parseBool((request as any)?.payload?.clearOverride, true);

                    let tokenId: bigint;
                    let primaryProxyId: bigint;
                    try {
                      tokenId = toBigIntId((request as any)?.payload?.tokenId, 'tokenId');
                      primaryProxyId = toBigIntId((request as any)?.payload?.primaryProxyId, 'primaryProxyId');
                    } catch (err: unknown) {
                      return {
                        notice: { type: 'error', message: err instanceof Error ? err.message : String(err) },
                        redirectUrl: context.h.resourceUrl({ resourceId: context.resource.id() }),
                      };
                    }

                    const [token, proxy] = await Promise.all([
                      prisma.pixivToken.findUnique({ where: { id: tokenId }, select: { id: true, enabled: true, label: true } }),
                      prisma.proxyEndpoint.findUnique({ where: { id: primaryProxyId }, select: { id: true, enabled: true, scheme: true, host: true, port: true, username: true } }),
                    ]);

                    if (!token || !token.enabled) {
                      return {
                        notice: { type: 'error', message: '令牌不存在或已禁用。' },
                        redirectUrl: context.h.resourceUrl({ resourceId: context.resource.id() }),
                      };
                    }

                    if (!proxy || !proxy.enabled) {
                      return {
                        notice: { type: 'error', message: '代理不存在或已禁用。' },
                        redirectUrl: context.h.resourceUrl({ resourceId: context.resource.id() }),
                      };
                    }

                    const getOrCreateDefaultPool = async (): Promise<{ id: bigint; name: string }> => {
                      const existing = await prisma.proxyPool.findUnique({ where: { name: 'default' }, select: { id: true, name: true } });
                      if (existing) return existing;
                      try {
                        const created = await prisma.proxyPool.create({
                          data: { name: 'default', enabled: true, description: '系统自动创建的默认池（用于令牌↔代理绑定）。' },
                          select: { id: true, name: true },
                        });

                        auditAdminModelChange({
                          action: 'proxy_pool_create_default',
                          resource: 'ProxyPool',
                          record_id: created.id.toString(),
                          req: request,
                          detail: { name: created.name, auto: true },
                        });

                        return created;
                      } catch {
                        const fallback = await prisma.proxyPool.findUnique({ where: { name: 'default' }, select: { id: true, name: true } });
                        if (!fallback) throw new Error('创建默认代理池失败。');
                        return fallback;
                      }
                    };

                    const pool = await getOrCreateDefaultPool();
                    const now = new Date();

                    const prev = await prisma.tokenProxyBinding.findUnique({
                      where: { tokenId_poolId: { tokenId, poolId: pool.id } },
                      select: { id: true, primaryProxyId: true, overrideProxyId: true, overrideExpiresAt: true },
                    });

                    const updated = await prisma.tokenProxyBinding.upsert({
                      where: { tokenId_poolId: { tokenId, poolId: pool.id } },
                      update: {
                        primaryProxyId,
                        ...(clearOverride ? { overrideProxyId: null, overrideExpiresAt: null } : {}),
                      },
                      create: { tokenId, poolId: pool.id, primaryProxyId },
                      select: { id: true, primaryProxyId: true, overrideProxyId: true, overrideExpiresAt: true },
                    });

                    const prevEffective = prev
                      ? resolveEffectiveProxy({
                        primaryProxyId: prev.primaryProxyId.toString(),
                        overrideProxyId: prev.overrideProxyId ? prev.overrideProxyId.toString() : null,
                        overrideExpiresAt: prev.overrideExpiresAt ?? null,
                      }, now)
                      : null;

                    const nextEffective = resolveEffectiveProxy({
                      primaryProxyId: updated.primaryProxyId.toString(),
                      overrideProxyId: updated.overrideProxyId ? updated.overrideProxyId.toString() : null,
                      overrideExpiresAt: updated.overrideExpiresAt ?? null,
                    }, now);

                    auditAdminModelChange({
                      action: 'token_proxy_binding_rebind_primary',
                      resource: 'TokenProxyBinding',
                      record_id: updated.id.toString(),
                      req: request,
                      detail: {
                        tokenId: tokenId.toString(),
                        tokenLabel: token.label ?? null,
                        pool: { id: pool.id.toString(), name: pool.name },
                        prev: prev ? {
                          primaryProxyId: prev.primaryProxyId.toString(),
                          overrideProxyId: prev.overrideProxyId ? prev.overrideProxyId.toString() : null,
                          overrideExpiresAt: prev.overrideExpiresAt ? prev.overrideExpiresAt.toISOString() : null,
                          effective: prevEffective,
                        } : null,
                        next: {
                          primaryProxyId: updated.primaryProxyId.toString(),
                          overrideProxyId: updated.overrideProxyId ? updated.overrideProxyId.toString() : null,
                          overrideExpiresAt: updated.overrideExpiresAt ? updated.overrideExpiresAt.toISOString() : null,
                          effective: nextEffective,
                        },
                        clearOverride,
                        reason,
                        impact: { affected_bindings: 1, affected_tokens: 1 },
                      },
                    });

                    return {
                      notice: {
                        type: 'success',
                        message: `主代理重绑成功（token=${tokenId.toString()} prev=${prevEffective?.proxyId ?? '-'} next=${nextEffective.proxyId} affected=1）`,
                      },
                      redirectUrl: context.h.resourceUrl({ resourceId: context.resource.id() }),
                    };
                  },
                },

                setOverride: {
                  actionType: 'resource',
                  icon: 'Clock',
                  label: '设置临时覆盖（页面入口）',
                  handler: async (request: any, _res: any, context: any) => {
                    if (String(request?.method || '').toLowerCase() === 'get') return {};

                    const toBigIntId = (value: any, label: string): bigint => {
                      try {
                        const raw = typeof value === 'bigint' ? value : BigInt(String(value ?? '').trim());
                        if (raw <= 0n) throw new Error('non_positive');
                        return raw;
                      } catch {
                        throw new Error(`${label} 必须是 bigint 类型的 ID。`);
                      }
                    };

                    const reasonRaw = (request as any)?.payload?.reason;
                    const reason = typeof reasonRaw === 'string' && reasonRaw.trim() ? reasonRaw.trim().slice(0, 200) : null;

                    const ttlMinutesRaw = (request as any)?.payload?.ttlMinutes;
                    const ttlMinutes = Number(ttlMinutesRaw);
                    if (!Number.isFinite(ttlMinutes) || ttlMinutes <= 0 || ttlMinutes > 7 * 24 * 60) {
                      return {
                        notice: { type: 'error', message: 'ttlMinutes 必须在 (0, 10080] 区间内。' },
                        redirectUrl: context.h.resourceUrl({ resourceId: context.resource.id() }),
                      };
                    }

                    let tokenId: bigint;
                    let overrideProxyId: bigint;
                    try {
                      tokenId = toBigIntId((request as any)?.payload?.tokenId, 'tokenId');
                      overrideProxyId = toBigIntId((request as any)?.payload?.overrideProxyId, 'overrideProxyId');
                    } catch (err: unknown) {
                      return {
                        notice: { type: 'error', message: err instanceof Error ? err.message : String(err) },
                        redirectUrl: context.h.resourceUrl({ resourceId: context.resource.id() }),
                      };
                    }

                    const [token, proxy] = await Promise.all([
                      prisma.pixivToken.findUnique({ where: { id: tokenId }, select: { id: true, enabled: true, label: true } }),
                      prisma.proxyEndpoint.findUnique({ where: { id: overrideProxyId }, select: { id: true, enabled: true } }),
                    ]);

                    if (!token || !token.enabled) {
                      return {
                        notice: { type: 'error', message: '令牌不存在或已禁用。' },
                        redirectUrl: context.h.resourceUrl({ resourceId: context.resource.id() }),
                      };
                    }

                    if (!proxy || !proxy.enabled) {
                      return {
                        notice: { type: 'error', message: '代理不存在或已禁用。' },
                        redirectUrl: context.h.resourceUrl({ resourceId: context.resource.id() }),
                      };
                    }

                    const getOrCreateDefaultPool = async (): Promise<{ id: bigint; name: string }> => {
                      const existing = await prisma.proxyPool.findUnique({ where: { name: 'default' }, select: { id: true, name: true } });
                      if (existing) return existing;
                      try {
                        const created = await prisma.proxyPool.create({
                          data: { name: 'default', enabled: true, description: '系统自动创建的默认池（用于令牌↔代理绑定）。' },
                          select: { id: true, name: true },
                        });

                        auditAdminModelChange({
                          action: 'proxy_pool_create_default',
                          resource: 'ProxyPool',
                          record_id: created.id.toString(),
                          req: request,
                          detail: { name: created.name, auto: true },
                        });

                        return created;
                      } catch {
                        const fallback = await prisma.proxyPool.findUnique({ where: { name: 'default' }, select: { id: true, name: true } });
                        if (!fallback) throw new Error('创建默认代理池失败。');
                        return fallback;
                      }
                    };

                    const pool = await getOrCreateDefaultPool();
                    const now = new Date();
                    const overrideExpiresAt = new Date(now.getTime() + ttlMinutes * 60 * 1000);

                    const prev = await prisma.tokenProxyBinding.findUnique({
                      where: { tokenId_poolId: { tokenId, poolId: pool.id } },
                      select: { id: true, primaryProxyId: true, overrideProxyId: true, overrideExpiresAt: true },
                    });

                    const primaryProxyId = (() => {
                      if (prev) return prev.primaryProxyId;
                      return null;
                    })();

                    const ensurePrimaryProxyId = async (): Promise<bigint> => {
                      if (primaryProxyId) return primaryProxyId;
                      const enabledIds = await prisma.proxyEndpoint.findMany({ where: { enabled: true }, select: { id: true }, orderBy: [{ id: 'asc' }] });
                      const proxyIds = enabledIds.map((row) => row.id.toString());
                      if (proxyIds.length === 0) throw new Error('当前没有可用代理。');
                      const picked = pickPrimaryProxyRendezvous(tokenId.toString(), proxyIds, `pool:${pool.id.toString()}`);
                      return BigInt(picked);
                    };

                    let computedPrimary: bigint;
                    try {
                      computedPrimary = await ensurePrimaryProxyId();
                    } catch (err: unknown) {
                      return {
                        notice: { type: 'error', message: err instanceof Error ? err.message : String(err) },
                        redirectUrl: context.h.resourceUrl({ resourceId: context.resource.id() }),
                      };
                    }

                    const updated = await prisma.tokenProxyBinding.upsert({
                      where: { tokenId_poolId: { tokenId, poolId: pool.id } },
                      update: { overrideProxyId, overrideExpiresAt },
                      create: {
                        tokenId,
                        poolId: pool.id,
                        primaryProxyId: computedPrimary,
                        overrideProxyId,
                        overrideExpiresAt,
                      },
                      select: { id: true, primaryProxyId: true, overrideProxyId: true, overrideExpiresAt: true },
                    });

                    const prevEffective = prev
                      ? resolveEffectiveProxy({
                        primaryProxyId: prev.primaryProxyId.toString(),
                        overrideProxyId: prev.overrideProxyId ? prev.overrideProxyId.toString() : null,
                        overrideExpiresAt: prev.overrideExpiresAt ?? null,
                      }, now)
                      : null;

                    const nextEffective = resolveEffectiveProxy({
                      primaryProxyId: updated.primaryProxyId.toString(),
                      overrideProxyId: updated.overrideProxyId ? updated.overrideProxyId.toString() : null,
                      overrideExpiresAt: updated.overrideExpiresAt ?? null,
                    }, now);

                    auditAdminModelChange({
                      action: 'token_proxy_binding_set_override',
                      resource: 'TokenProxyBinding',
                      record_id: updated.id.toString(),
                      req: request,
                      detail: {
                        tokenId: tokenId.toString(),
                        tokenLabel: token.label ?? null,
                        pool: { id: pool.id.toString(), name: pool.name },
                        prev: prev ? {
                          primaryProxyId: prev.primaryProxyId.toString(),
                          overrideProxyId: prev.overrideProxyId ? prev.overrideProxyId.toString() : null,
                          overrideExpiresAt: prev.overrideExpiresAt ? prev.overrideExpiresAt.toISOString() : null,
                          effective: prevEffective,
                        } : null,
                        next: {
                          primaryProxyId: updated.primaryProxyId.toString(),
                          overrideProxyId: updated.overrideProxyId ? updated.overrideProxyId.toString() : null,
                          overrideExpiresAt: updated.overrideExpiresAt ? updated.overrideExpiresAt.toISOString() : null,
                          effective: nextEffective,
                        },
                        ttlMinutes,
                        reason,
                        impact: { affected_bindings: 1, affected_tokens: 1 },
                      },
                    });

                    return {
                      notice: { type: 'success', message: `临时覆盖已设置（token=${tokenId.toString()} effective=${nextEffective.proxyId} ttl_min=${ttlMinutes}）` },
                      redirectUrl: context.h.resourceUrl({ resourceId: context.resource.id() }),
                    };
                  },
                },

                clearOverride: {
                  actionType: 'resource',
                  icon: 'Close',
                  label: '清空临时覆盖（页面入口）',
                  handler: async (request: any, _res: any, context: any) => {
                    if (String(request?.method || '').toLowerCase() === 'get') return {};

                    const toBigIntId = (value: any, label: string): bigint => {
                      try {
                        const raw = typeof value === 'bigint' ? value : BigInt(String(value ?? '').trim());
                        if (raw <= 0n) throw new Error('non_positive');
                        return raw;
                      } catch {
                        throw new Error(`${label} 必须是 bigint 类型的 ID。`);
                      }
                    };

                    const reasonRaw = (request as any)?.payload?.reason;
                    const reason = typeof reasonRaw === 'string' && reasonRaw.trim() ? reasonRaw.trim().slice(0, 200) : null;

                    let tokenId: bigint;
                    try {
                      tokenId = toBigIntId((request as any)?.payload?.tokenId, 'tokenId');
                    } catch (err: unknown) {
                      return {
                        notice: { type: 'error', message: err instanceof Error ? err.message : String(err) },
                        redirectUrl: context.h.resourceUrl({ resourceId: context.resource.id() }),
                      };
                    }

                    const token = await prisma.pixivToken.findUnique({ where: { id: tokenId }, select: { id: true, enabled: true, label: true } });
                    if (!token || !token.enabled) {
                      return {
                        notice: { type: 'error', message: '令牌不存在或已禁用。' },
                        redirectUrl: context.h.resourceUrl({ resourceId: context.resource.id() }),
                      };
                    }

                    const getOrCreateDefaultPool = async (): Promise<{ id: bigint; name: string }> => {
                      const existing = await prisma.proxyPool.findUnique({ where: { name: 'default' }, select: { id: true, name: true } });
                      if (existing) return existing;
                      try {
                        const created = await prisma.proxyPool.create({
                          data: { name: 'default', enabled: true, description: '系统自动创建的默认池（用于令牌↔代理绑定）。' },
                          select: { id: true, name: true },
                        });

                        auditAdminModelChange({
                          action: 'proxy_pool_create_default',
                          resource: 'ProxyPool',
                          record_id: created.id.toString(),
                          req: request,
                          detail: { name: created.name, auto: true },
                        });

                        return created;
                      } catch {
                        const fallback = await prisma.proxyPool.findUnique({ where: { name: 'default' }, select: { id: true, name: true } });
                        if (!fallback) throw new Error('创建默认代理池失败。');
                        return fallback;
                      }
                    };

                    const pool = await getOrCreateDefaultPool();

                    const prev = await prisma.tokenProxyBinding.findUnique({
                      where: { tokenId_poolId: { tokenId, poolId: pool.id } },
                      select: { id: true, primaryProxyId: true, overrideProxyId: true, overrideExpiresAt: true },
                    });

                    if (!prev) {
                      return {
                        notice: { type: 'warning', message: `未找到绑定记录（token=${tokenId.toString()}）。` },
                        redirectUrl: context.h.resourceUrl({ resourceId: context.resource.id() }),
                      };
                    }

                    const updated = await prisma.tokenProxyBinding.update({
                      where: { id: prev.id },
                      data: { overrideProxyId: null, overrideExpiresAt: null },
                      select: { id: true, primaryProxyId: true, overrideProxyId: true, overrideExpiresAt: true },
                    });

                    auditAdminModelChange({
                      action: 'token_proxy_binding_clear_override',
                      resource: 'TokenProxyBinding',
                      record_id: updated.id.toString(),
                      req: request,
                      detail: {
                        tokenId: tokenId.toString(),
                        tokenLabel: token.label ?? null,
                        pool: { id: pool.id.toString(), name: pool.name },
                        prev: {
                          primaryProxyId: prev.primaryProxyId.toString(),
                          overrideProxyId: prev.overrideProxyId ? prev.overrideProxyId.toString() : null,
                          overrideExpiresAt: prev.overrideExpiresAt ? prev.overrideExpiresAt.toISOString() : null,
                        },
                        next: {
                          primaryProxyId: updated.primaryProxyId.toString(),
                          overrideProxyId: null,
                          overrideExpiresAt: null,
                        },
                        reason,
                        impact: { affected_bindings: 1, affected_tokens: 1 },
                      },
                    });

                    return {
                      notice: { type: 'success', message: `临时覆盖已清除（token=${tokenId.toString()} affected=1）。` },
                      redirectUrl: context.h.resourceUrl({ resourceId: context.resource.id() }),
                    };
                  },
                },
              },
            },
          },
          {
            resource: {
              model: getModelByName('ProxyEndpoint', prismaClientModule),
              client: prisma,
              clientModule: prismaClientModule,
            },
            options: {
              navigation: { name: '代理', icon: 'Network' },
              label: '代理端点',
              actions: {
                setProxyEnabled: {
                  actionType: 'resource',
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
                      const { RUNTIME_SETTING_KEYS, upsertRuntimeSetting } = require('../config/runtimeSettings') as typeof import('../config/runtimeSettings');
                      // eslint-disable-next-line @typescript-eslint/no-var-requires
                      const { invalidateRuntimeCaches } = require('../config/runtimeConfig') as typeof import('../config/runtimeConfig');

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
                        const { invalidateRuntimeCaches } = require('../config/runtimeConfig') as typeof import('../config/runtimeConfig');
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
                      const { upsertRuntimeSetting } = require('../config/runtimeSettings') as typeof import('../config/runtimeSettings');

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
                        const { invalidateRuntimeCaches } = require('../config/runtimeConfig') as typeof import('../config/runtimeConfig');
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
                          const { upsertRuntimeSetting } = require('../config/runtimeSettings') as typeof import('../config/runtimeSettings');
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
                        const { invalidateRuntimeCaches } = require('../config/runtimeConfig') as typeof import('../config/runtimeConfig');
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
                  icon: 'Activity',
                  label: '立即探测',
                  guard: '确认立即探测该代理吗？',
                  handler: async (request: any, _res: any, context: any) => {
                    const { record, currentAdmin, h, resource } = context;
                    if (!record) throw new Error('Record is required');

                    if (String(request?.method || '').toLowerCase() === 'get') {
                      return { record: record.toJSON(currentAdmin) };
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
                        select: { id: true, enabled: true, scheme: true, host: true, port: true, username: true, password: true },
                      });

                      if (!endpoint) {
                        return {
                          notice: { type: 'error', message: '记录不存在。' },
                          redirectUrl: h.resourceUrl({ resourceId: resource.id() }),
                        };
                      }

                      const formatHostForUri = (host: string): string => {
                        const trimmed = String(host ?? '').trim();
                        if (!trimmed) throw new Error('代理主机不能为空。');
                        if (trimmed.includes(':') && !trimmed.startsWith('[') && !trimmed.endsWith(']')) return `[${trimmed}]`;
                        return trimmed;
                      };

                      const scheme = String(endpoint.scheme ?? '').trim().toLowerCase();
                      const host = formatHostForUri(String(endpoint.host ?? ''));
                      const port = Number(endpoint.port);
                      if (!scheme) throw new Error('代理协议不能为空。');
                      if (!Number.isFinite(port) || port <= 0 || port > 65535) throw new Error('代理端口不合法。');

                      const username = String(endpoint.username ?? '');
                      const password = String(endpoint.password ?? '');
                      const authNeeded = username !== '' || password !== '';
                      const auth = authNeeded
                        ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`
                        : '';
                      const proxyUri = `${scheme}://${auth}${host}:${port}`;

                      const probeTimeoutMs = Math.max(
                        1_500,
                        Math.min(
                          12_000,
                          Number.parseInt(String(process.env.ADMIN_PROXY_PROBE_TIMEOUT_MS ?? '4500'), 10) || 4_500,
                        ),
                      );

                      const probeResult = await runWithTimeout(
                        runProxyHealthCheckOnce({
                          candidates: [{ id: endpoint.id.toString(), proxyUri }],
                          options: {
                            maxConcurrency: 1,
                            minHealthy: 0,
                            windowSize: 1,
                            timeoutMs: probeTimeoutMs,
                          },
                        }),
                        probeTimeoutMs + 300,
                      );

                      if (probeResult.status === 'timeout') {
                        auditAdminModelChange({
                          action: 'proxy_endpoint_probe_timeout',
                          resource: 'ProxyEndpoint',
                          record_id: endpoint.id.toString(),
                          req: request,
                          detail: {
                            timeoutMs: probeTimeoutMs,
                          },
                        });
                        return {
                          record: record.toJSON(currentAdmin),
                          notice: { type: 'error', message: `探测超时（>${probeTimeoutMs}ms），请稍后重试。` },
                          redirectUrl: h.recordActionUrl({ resourceId: resource.id(), recordId: record.id(), actionName: 'show' }),
                        };
                      }

                      if (probeResult.status === 'error') {
                        throw new Error(`探测失败: ${probeResult.error}`);
                      }

                      const report = probeResult.value;
                      const entry = report.entries.find((e) => e.id === endpoint.id.toString()) ?? null;

                      const ok = Boolean(entry?.lastOk);
                      const status = entry?.status ?? 'unknown';
                      const latencyMs = entry?.lastLatencyMs;
                      const error = entry?.lastError;

                      auditAdminModelChange({
                        action: ok ? 'proxy_endpoint_probe_ok' : 'proxy_endpoint_probe_fail',
                        resource: 'ProxyEndpoint',
                        record_id: endpoint.id.toString(),
                        req: request,
                        detail: {
                          enabled: endpoint.enabled,
                          status,
                          latencyMs: typeof latencyMs === 'number' && Number.isFinite(latencyMs) ? Math.round(latencyMs) : null,
                          error,
                          probeUrl: report.probeUrl,
                          timeoutMs: report.timeoutMs,
                        },
                      });

                      const messageParts: string[] = [];
                      messageParts.push(`状态:${status}`);
                      if (typeof latencyMs === 'number' && Number.isFinite(latencyMs)) messageParts.push(`延迟ms:${Math.round(latencyMs)}`);
                      if (error) messageParts.push(`错误:${error}`);

                      return {
                        record: record.toJSON(currentAdmin),
                        notice: { type: ok ? 'success' : 'error', message: messageParts.join(' ') },
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

                      return {
                        record: record.toJSON(currentAdmin),
                        notice: { type: 'error', message: err instanceof Error ? err.message : String(err) },
                        redirectUrl: h.recordActionUrl({ resourceId: resource.id(), recordId: record.id(), actionName: 'show' }),
                      };
                    }
                  },
                },
                new: {
                  after: async (response: any, request: any, context: any) => {
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
                      const { invalidateRuntimeCaches } = require('../config/runtimeConfig') as typeof import('../config/runtimeConfig');
                      invalidateRuntimeCaches({ proxies: true });
                    } catch {
                      // best-effort
                    }

                    return response;
                  },
                },
                edit: {
                  after: async (response: any, request: any, context: any) => {
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
                      const { invalidateRuntimeCaches } = require('../config/runtimeConfig') as typeof import('../config/runtimeConfig');
                      invalidateRuntimeCaches({ proxies: true });
                    } catch {
                      // best-effort
                    }

                    return response;
                  },
                },
                delete: {
                  after: async (response: any, request: any, context: any) => {
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
                      const { invalidateRuntimeCaches } = require('../config/runtimeConfig') as typeof import('../config/runtimeConfig');
                      invalidateRuntimeCaches({ proxies: true });
                    } catch {
                      // best-effort
                    }

                    return response;
                  },
                },
              },
              properties: {
                password: { isVisible: { list: false, filter: false, show: false, edit: true } },
              },
            },
          },
        ] as any[];

        resources.push({
          resource: { model: getModelByName('HydrationRun', prismaClientModule), client: prisma, clientModule: prismaClientModule },
          options: {
            navigation: { name: '补全', icon: 'Activity' },
            label: '补全运行',
            listProperties: [
              'id',
              'type',
              'status',
              'total',
              'processed',
              'success',
              'failed',
              'startedAt',
              'finishedAt',
              'updatedAt',
              'createdAt',
            ],
            filterProperties: [
              'type',
              'status',
              'requestedBy',
              'startedAt',
              'finishedAt',
              'updatedAt',
              'createdAt',
            ],
            actions: {
              new: { isAccessible: false, isVisible: false },
              edit: { isAccessible: false, isVisible: false },
              delete: { isAccessible: false, isVisible: false },

              pause: {
                actionType: 'record',
                icon: 'Pause',
                label: '暂停',
                guard: '确认暂停该 backfill 任务吗？',
                handler: async (request: any, _res: any, context: any) => {
                  const { record, currentAdmin, h, resource } = context;
                  if (!record) throw new Error('Record is required');

                  if (String(request?.method || '').toLowerCase() === 'get') {
                    return { record: record.toJSON(currentAdmin) };
                  }

                  const idRaw = record.id?.() ?? record.params?.id;
                  let id: bigint;
                  try {
                    id = typeof idRaw === 'bigint' ? idRaw : BigInt(String(idRaw));
                  } catch {
                    return { notice: { type: 'error', message: '记录 ID 非法。' }, redirectUrl: h.resourceUrl({ resourceId: resource.id() }) };
                  }

                  const run = await prisma.hydrationRun.findUnique({ where: { id }, select: { id: true, type: true, status: true } });
                  if (!run) {
                    return { notice: { type: 'error', message: '记录不存在。' }, redirectUrl: h.resourceUrl({ resourceId: resource.id() }) };
                  }

                  if (run.type !== 'backfill') {
                    return { notice: { type: 'error', message: `仅 backfill 类型支持暂停（type=${run.type}）。` }, redirectUrl: h.recordActionUrl({ resourceId: resource.id(), recordId: record.id(), actionName: 'show' }) };
                  }

                  const prevStatus = run.status;
                  const terminal = prevStatus === 'completed' || prevStatus === 'canceled' || prevStatus === 'failed';
                  if (terminal) {
                    return { notice: { type: 'error', message: `任务已终态，无法暂停（status=${prevStatus}）。` }, redirectUrl: h.recordActionUrl({ resourceId: resource.id(), recordId: record.id(), actionName: 'show' }) };
                  }

                  if (prevStatus !== 'paused') {
                    await prisma.hydrationRun.update({ where: { id }, data: { status: 'paused', finishedAt: null } });
                  }

                  auditAdminModelChange({
                    action: 'hydration_run_pause',
                    resource: 'HydrationRun',
                    record_id: id.toString(),
                    req: request,
                    detail: { prev_status: prevStatus, next_status: 'paused' },
                  });

                  return {
                    record: record.toJSON(currentAdmin),
                    notice: { type: 'success', message: prevStatus === 'paused' ? '任务已处于暂停状态。' : '任务已暂停。' },
                    redirectUrl: h.recordActionUrl({ resourceId: resource.id(), recordId: record.id(), actionName: 'show' }),
                  };
                },
              },

              resume: {
                actionType: 'record',
                icon: 'Play',
                label: '恢复',
                guard: '确认恢复该 backfill 任务吗？',
                handler: async (request: any, _res: any, context: any) => {
                  const { record, currentAdmin, h, resource } = context;
                  if (!record) throw new Error('Record is required');

                  if (String(request?.method || '').toLowerCase() === 'get') {
                    return { record: record.toJSON(currentAdmin) };
                  }

                  const idRaw = record.id?.() ?? record.params?.id;
                  let id: bigint;
                  try {
                    id = typeof idRaw === 'bigint' ? idRaw : BigInt(String(idRaw));
                  } catch {
                    return { notice: { type: 'error', message: '记录 ID 非法。' }, redirectUrl: h.resourceUrl({ resourceId: resource.id() }) };
                  }

                  const run = await prisma.hydrationRun.findUnique({ where: { id }, select: { id: true, type: true, status: true, startedAt: true } });
                  if (!run) {
                    return { notice: { type: 'error', message: '记录不存在。' }, redirectUrl: h.resourceUrl({ resourceId: resource.id() }) };
                  }

                  if (run.type !== 'backfill') {
                    return { notice: { type: 'error', message: `仅 backfill 类型支持恢复（type=${run.type}）。` }, redirectUrl: h.recordActionUrl({ resourceId: resource.id(), recordId: record.id(), actionName: 'show' }) };
                  }

                  const prevStatus = run.status;
                  const terminal = prevStatus === 'completed' || prevStatus === 'canceled' || prevStatus === 'failed';
                  if (terminal) {
                    return { notice: { type: 'error', message: `任务已终态，无法恢复（status=${prevStatus}）。` }, redirectUrl: h.recordActionUrl({ resourceId: resource.id(), recordId: record.id(), actionName: 'show' }) };
                  }

                  await prisma.hydrationRun.update({
                    where: { id },
                    data: {
                      status: 'running',
                      finishedAt: null,
                      startedAt: run.startedAt ?? new Date(),
                      lastErrorCode: null,
                      lastErrorMsg: null,
                    },
                  });

                  try {
                    // eslint-disable-next-line @typescript-eslint/no-var-requires
                    const { enqueueHydrationBackfillRun } = require('../jobs/hydrationBackfill') as typeof import('../jobs/hydrationBackfill');
                    const reqId = request?.request_id || request?.headers?.['x-request-id'];
                    await enqueueHydrationBackfillRun(id, typeof reqId === 'string' ? reqId : undefined);
                  } catch (err: unknown) {
                    await prisma.hydrationRun.update({ where: { id }, data: { status: 'paused', lastErrorCode: 'enqueue_failed', lastErrorMsg: err instanceof Error ? err.message : String(err) } });

                    auditAdminModelChange({
                      action: 'hydration_run_resume_enqueue_failed',
                      resource: 'HydrationRun',
                      record_id: id.toString(),
                      req: request,
                      detail: { prev_status: prevStatus, next_status: 'paused', error: err instanceof Error ? err.message : String(err) },
                    });

                    return {
                      record: record.toJSON(currentAdmin),
                      notice: { type: 'error', message: err instanceof Error ? err.message : String(err) },
                      redirectUrl: h.recordActionUrl({ resourceId: resource.id(), recordId: record.id(), actionName: 'show' }),
                    };
                  }

                  auditAdminModelChange({
                    action: 'hydration_run_resume',
                    resource: 'HydrationRun',
                    record_id: id.toString(),
                    req: request,
                    detail: { prev_status: prevStatus, next_status: 'running' },
                  });

                  return {
                    record: record.toJSON(currentAdmin),
                    notice: { type: 'success', message: prevStatus === 'running' ? '任务已在运行中。' : '任务已恢复。' },
                    redirectUrl: h.recordActionUrl({ resourceId: resource.id(), recordId: record.id(), actionName: 'show' }),
                  };
                },
              },

              cancel: {
                actionType: 'record',
                icon: 'Close',
                label: '取消',
                guard: '确认取消该 backfill 任务吗？',
                handler: async (request: any, _res: any, context: any) => {
                  const { record, currentAdmin, h, resource } = context;
                  if (!record) throw new Error('Record is required');

                  if (String(request?.method || '').toLowerCase() === 'get') {
                    return { record: record.toJSON(currentAdmin) };
                  }

                  const idRaw = record.id?.() ?? record.params?.id;
                  let id: bigint;
                  try {
                    id = typeof idRaw === 'bigint' ? idRaw : BigInt(String(idRaw));
                  } catch {
                    return { notice: { type: 'error', message: '记录 ID 非法。' }, redirectUrl: h.resourceUrl({ resourceId: resource.id() }) };
                  }

                  const run = await prisma.hydrationRun.findUnique({ where: { id }, select: { id: true, type: true, status: true } });
                  if (!run) {
                    return { notice: { type: 'error', message: '记录不存在。' }, redirectUrl: h.resourceUrl({ resourceId: resource.id() }) };
                  }

                  if (run.type !== 'backfill') {
                    return { notice: { type: 'error', message: `仅 backfill 类型支持取消（type=${run.type}）。` }, redirectUrl: h.recordActionUrl({ resourceId: resource.id(), recordId: record.id(), actionName: 'show' }) };
                  }

                  const prevStatus = run.status;
                  if (prevStatus !== 'canceled' && prevStatus !== 'completed') {
                    await prisma.hydrationRun.update({ where: { id }, data: { status: 'canceled', finishedAt: new Date() } });
                  }

                  auditAdminModelChange({
                    action: 'hydration_run_cancel',
                    resource: 'HydrationRun',
                    record_id: id.toString(),
                    req: request,
                    detail: { prev_status: prevStatus, next_status: 'canceled' },
                  });

                  return {
                    record: record.toJSON(currentAdmin),
                    notice: { type: 'success', message: prevStatus === 'canceled' ? '任务已取消。' : '任务取消成功。' },
                    redirectUrl: h.recordActionUrl({ resourceId: resource.id(), recordId: record.id(), actionName: 'show' }),
                  };
                },
              },
            },
            properties: {
              criteria: { isVisible: { list: false, filter: false, show: true, edit: false } },
              cursor: { isVisible: { list: false, filter: false, show: true, edit: false } },
            },
          },
        });

        if (auditViewEnabled) {
          resources.push({
            resource: { model: getModelByName('AdminAudit', prismaClientModule), client: prisma, clientModule: prismaClientModule },
            options: adminAuditResourceOptions,
          });
        }

        resources.push({
          resource: { model: getModelByName('RequestLog', prismaClientModule), client: prisma, clientModule: prismaClientModule },
          options: requestLogResourceOptions,
        });

        resources.push({
          resource: { model: getModelByName('Import', prismaClientModule), client: prisma, clientModule: prismaClientModule },
          options: importResourceOptions,
        });

        return resources;
      })(),
    });

    // AdminJS Express starts bundling asynchronously (not awaited). If we serve pages before the
    // bundle is refreshed, custom pages can fall back to "no component specified".
    const shouldEnsureBundle = process.env.NODE_ENV !== 'test'
      && String(process.env.ADMIN_JS_SKIP_BUNDLE || '').trim().toLowerCase() !== 'true';

    let router: Router;
    if (shouldEnsureBundle) {
      const prevSkip = process.env.ADMIN_JS_SKIP_BUNDLE;
      const prevNodeEnv = process.env.NODE_ENV;
      process.env.ADMIN_JS_SKIP_BUNDLE = 'true';
      if (process.env.NODE_ENV !== 'production') {
        process.env.NODE_ENV = 'production';
      }
      try {
        router = AdminJSExpress.buildRouter(admin);
      } finally {
        if (prevSkip === undefined) delete process.env.ADMIN_JS_SKIP_BUNDLE;
        else process.env.ADMIN_JS_SKIP_BUNDLE = prevSkip;
      }
      try {
        await admin.initialize();
      } finally {
        if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = prevNodeEnv;
      }
    } else {
      router = AdminJSExpress.buildRouter(admin);
    }

    cachedRouter = router;
    return router;
  })();

  try {
    return await cachedPromise;
  } finally {
    cachedPromise = null;
  }
}
