import type { Router } from 'express';
import path from 'node:path';

import { getPrismaClient } from '../db/prismaClient';
import { queryPrometheusInstant } from '../metrics/prometheusQueryClient';
import * as PrismaModule from '@prisma/client';
import { Prisma } from '@prisma/client';

import { imageResourceOptions } from './resources/images';
import { importResourceOptions } from './resources/imports';
import { adminAuditResourceOptions } from './resources/adminAudits';

let cachedRouter: Router | null = null;
let cachedPromise: Promise<Router> | null = null;

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

    const ComponentLoader = (adminJSImport as any).ComponentLoader as new () => any;
    const componentLoader = new ComponentLoader();
    const Dashboard = componentLoader.add('Dashboard', path.join(__dirname, 'pages', 'dashboard'));

    const admin = new AdminJS({
      rootPath: '/admin',
      componentLoader,
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

          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { getEnv } = require('../config/env') as { getEnv: () => { METRICS_ENABLED: boolean; PROMETHEUS_URL?: string } };
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { getMetricsRegistry } = require('../metrics/registry') as { getMetricsRegistry: () => { getMetricsAsJSON: () => any[] } };

          const env = getEnv();
          const registry = getMetricsRegistry();
          const metricNames = registry.getMetricsAsJSON().map((metric) => metric.name).sort();

          const prometheus: any = {
            configured: Boolean(env.PROMETHEUS_URL),
            ok: false,
            error: null,
            cached: false,
            fetched_at: null,
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
            },
            top_errors: topErrors,
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
            metrics: {
              enabled: env.METRICS_ENABLED,
              metric_names: metricNames,
            },
            prometheus,
            errors: {
              db: dbError,
            },
          };
        },
      },
      resources: [
        {
          resource: { model: getModelByName('Image', prismaClientModule), client: prisma, clientModule: prismaClientModule },
          options: imageResourceOptions,
        },
        {
          resource: { model: getModelByName('Tag', prismaClientModule), client: prisma, clientModule: prismaClientModule },
          options: {},
        },
        {
          resource: { model: getModelByName('AdminAudit', prismaClientModule), client: prisma, clientModule: prismaClientModule },
          options: adminAuditResourceOptions,
        },
        {
          resource: { model: getModelByName('Import', prismaClientModule), client: prisma, clientModule: prismaClientModule },
          options: importResourceOptions,
        },
      ],
    });

    const router = AdminJSExpress.buildRouter(admin);
    cachedRouter = router;
    return router;
  })();

  try {
    return await cachedPromise;
  } finally {
    cachedPromise = null;
  }
}
