import { useEffect, useState } from 'react';
import { ApiClient } from 'adminjs';
import { createCalloutStyle, createCardStyle, mutedTextStyle, pageRootStyle, pageTitleStyle } from './uiKit';

const api = new ApiClient();

const GROUPS = [
  {
    title: '导入与图片',
    hint: '先导入，再抽样检查图片与元信息。',
    links: [
      { href: '/admin/pages/importUrls', label: '批量导入 URL' },
      { href: '/admin/resources/Import', label: '导入记录' },
      { href: '/admin/resources/Image', label: '图片资源' },
    ],
  },
  {
    title: '补全',
    hint: '管理 backfill 运行状态与 DLQ 排障。',
    links: [
      { href: '/admin/resources/HydrationRun', label: '补全运行记录' },
      { href: '/admin/pages/hydrationOps', label: '补全运行 / DLQ 面板' },
      { href: '/admin/pages/adminJobs', label: '后台任务（Admin Jobs）' },
    ],
  },
  {
    title: '代理',
    hint: '导入代理、查看健康、排查失败。',
    links: [
      { href: '/admin/pages/easyProxiesImport', label: 'easy_proxies 导入/刷新' },
      { href: '/admin/resources/ProxyEndpoint', label: '代理端点（ProxyEndpoint）' },
      { href: '/admin/resources/ProxyPool', label: '代理池（ProxyPool）' },
      { href: '/admin/pages/proxyPoolOverview', label: '代理池概览（统计）' },
    ],
  },
  {
    title: '令牌',
    hint: 'token 维护与 token↔proxy 绑定策略。',
    links: [
      { href: '/admin/resources/PixivToken', label: 'Pixiv 令牌管理' },
      { href: '/admin/pages/tokenProxyBindings', label: '令牌与代理绑定页' },
    ],
  },
  {
    title: '统计与审计',
    hint: '回归排障时先看统计，再核对审计。',
    links: [
      { href: '/admin', label: '仪表盘（全局概览）' },
      { href: '/admin/resources/RequestLog', label: '请求日志' },
      { href: '/admin/resources/AdminAudit', label: '操作审计' },
    ],
  },
];

export default function OpsNavigatorPage() {
  const [meta, setMeta] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [dashboardError, setDashboardError] = useState(null);

  useEffect(() => {
    let mounted = true;
    api.getPage({ pageName: 'opsNavigator' })
      .then((res) => {
        if (!mounted) return;
        setMeta(res?.data || null);
      })
      .catch(() => {
        if (!mounted) return;
        setMeta(null);
      });

    api.getDashboard()
      .then((res) => {
        if (!mounted) return;
        setDashboard(res?.data || null);
      })
      .catch((err) => {
        if (!mounted) return;
        setDashboard(null);
        setDashboardError(err?.message || String(err));
      });
    return () => {
      mounted = false;
    };
  }, []);

  const imagesTotal = Number(dashboard?.images?.total ?? 0);
  const queueOk = dashboard?.queue?.ok;

  return (
    <div style={pageRootStyle}>
      <h2 style={pageTitleStyle}>操作导航（推荐入口）</h2>
      <p style={{ marginTop: 0, ...mutedTextStyle }}>
        目标：把「导入 / 补全 / 代理 / 令牌 / 统计」放到固定入口，降低误操作。
      </p>
      {meta?.generated_at ? (
        <p style={{ marginTop: 0, ...mutedTextStyle }}>生成时间：{String(meta.generated_at)}</p>
      ) : null}

      <div style={{ ...createCalloutStyle('warning'), marginBottom: 12 }}>
        高风险操作提示：关闭代理、删除/禁用图片、重试 DLQ 任务前，请先查看仪表盘与操作审计。
      </div>

      {dashboardError ? (
        <div style={{ ...createCalloutStyle('warning'), marginBottom: 12 }}>
          无法加载仪表盘数据：{String(dashboardError)}（仅影响本页告警提示；不影响功能使用）
        </div>
      ) : null}

      {dashboard && Number.isFinite(imagesTotal) && imagesTotal === 0 ? (
        <div style={{ ...createCalloutStyle('danger'), marginBottom: 12 }}>
          <b>图片库为空（Image=0）</b>
          <div style={{ marginTop: 6 }}>
            当前 `/random` 必然 NO_MATCH。请先导入 pximg 原图 URL，并确认导入任务已被队列消费。
          </div>
          <ul style={{ marginTop: 8, marginBottom: 0, paddingLeft: 18 }}>
            <li><a href="/admin/pages/importUrls" style={{ color: '#2563eb' }}>批量导入 URL（ImportUrls）</a></li>
            <li><a href="/admin/resources/Import" style={{ color: '#2563eb' }}>导入记录（Import）</a></li>
            <li><a href="/admin/pages/adminJobs" style={{ color: '#2563eb' }}>后台任务（AdminJobs）</a></li>
          </ul>
        </div>
      ) : null}

      {dashboard && queueOk === false ? (
        <div style={{ ...createCalloutStyle('warning'), marginBottom: 12 }}>
          <b>队列异常（导入/补全可能不会执行）</b>
          <div style={{ marginTop: 6 }}>
            建议先修复数据库连接/pg-boss，再进行导入与补全（可在仪表盘与 /healthz 查看详情）。
          </div>
          <ul style={{ marginTop: 8, marginBottom: 0, paddingLeft: 18 }}>
            <li><a href="/admin/pages/adminJobs" style={{ color: '#2563eb' }}>后台任务（AdminJobs）</a></li>
            <li><a href="/healthz" style={{ color: '#2563eb' }}>健康检查（/healthz）</a></li>
          </ul>
        </div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
        {GROUPS.map((group) => (
          <section key={group.title} style={createCardStyle({ alt: true })}>
            <h3 style={{ marginTop: 0, marginBottom: 6 }}>{group.title}</h3>
            <p style={{ marginTop: 0, color: '#6b7280', fontSize: 13 }}>{group.hint}</p>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {group.links.map((link) => (
                <li key={link.href} style={{ marginBottom: 6 }}>
                  <a href={link.href} style={{ color: '#2563eb' }}>{link.label}</a>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
