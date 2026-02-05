import type { Router } from 'express';
import path from 'node:path';

import { getPrismaClient } from '../db/prismaClient';
import { auditAdminModelChange } from '../audit/adminAudit';
import { extractFirstSampleValue, extractVectorSamples, queryPrometheusInstant } from '../metrics/prometheusQueryClient';
import { importProxyEndpointsFromEasyProxies } from '../proxy/easyProxiesImporter';
import * as PrismaModule from '@prisma/client';
import { Prisma } from '@prisma/client';

import { imageResourceOptions } from './resources/images';
import { importResourceOptions } from './resources/imports';
import { adminAuditResourceOptions } from './resources/adminAudits';
import { requestLogResourceOptions } from './resources/requestLogs';

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
          where[property.foreignColumnName()] = convertParam(property, modelFields, filter.value);
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

    const ComponentLoader = (adminJSImport as any).ComponentLoader as new () => any;
    const componentLoader = new ComponentLoader();
    // AdminJS bundler parses JSX reliably from .jsx/.tsx but not from plain .js in some environments.
    const Dashboard = componentLoader.add('Dashboard', path.join(__dirname, 'pages', 'dashboard.jsx'));
    const ImportUrls = componentLoader.add('ImportUrls', path.join(__dirname, 'pages', 'importUrls.jsx'));

    const admin = new AdminJS({
      rootPath: '/admin',
      locale: {
        language: 'zh-CN',
        availableLanguages: ['zh-CN', 'en'],
      },
      componentLoader,
      pages: {
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

          return {
            generated_at: new Date().toISOString(),
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
            options: { navigation: { name: '数据', icon: 'Database' }, label: '标签' },
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
                easyProxiesImport: {
                  actionType: 'resource',
                  icon: 'Download',
                  label: 'easy_proxies 导入',
                  guard: 'Import proxies from easy_proxies /api/export?',
                  handler: async (request: any, _res: any, context: any) => {
                    if (String(request?.method || '').toLowerCase() === 'get') {
                      return {};
                    }

                    const baseUrl = String(process.env.EASY_PROXIES_BASE_URL || '').trim();
                    const password = String(process.env.EASY_PROXIES_PASSWORD || '').trim() || undefined;
                    if (!baseUrl) {
                      return {
                        notice: { type: 'error', message: 'Missing EASY_PROXIES_BASE_URL.' },
                        redirectUrl: context.h.resourceUrl({ resourceId: context.resource.id() }),
                      };
                    }

                    try {
                      const result = await importProxyEndpointsFromEasyProxies({ baseUrl, password });
                      if (!result.ok) {
                        return {
                          notice: { type: 'error', message: `easy_proxies import failed: ${result.status}` },
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
                          token_used: result.token_used,
                        },
                      });

                      return {
                        notice: {
                          type: 'success',
                          message: `Imported: ${result.imported}/${result.total_lines} (invalid:${result.invalid})`,
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

    // AdminJS Express starts bundling asynchronously (not awaited). In production that can lead to the
    // first request for `/admin/frontend/assets/components.bundle.js` hitting before the file exists.
    // Ensure the bundle is built before serving the admin UI.
    const shouldEnsureBundle = process.env.NODE_ENV === 'production'
      && String(process.env.ADMIN_JS_SKIP_BUNDLE || '').trim().toLowerCase() !== 'true';

    let router: Router;
    if (shouldEnsureBundle) {
      const prevSkip = process.env.ADMIN_JS_SKIP_BUNDLE;
      process.env.ADMIN_JS_SKIP_BUNDLE = 'true';
      try {
        router = AdminJSExpress.buildRouter(admin);
      } finally {
        if (prevSkip === undefined) delete process.env.ADMIN_JS_SKIP_BUNDLE;
        else process.env.ADMIN_JS_SKIP_BUNDLE = prevSkip;
      }
      await admin.initialize();
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
