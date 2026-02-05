import { useEffect, useState } from 'react';
import { ApiClient } from 'adminjs';
import { mutedTextStyle, pageRootStyle } from './uiKit';

const api = new ApiClient();

const GROUPS = [
  {
    title: '导入与图片',
    hint: '先导入，再抽样检查图片与元信息。',
    links: [
      { href: '/admin/pages/importUrls', label: '批量导入 URL' },
      { href: '/admin/resources/Import', label: '导入记录（Imports）' },
      { href: '/admin/resources/Image', label: '图片资源（Images）' },
    ],
  },
  {
    title: '补全',
    hint: '管理 backfill 运行状态与 DLQ 排障。',
    links: [
      { href: '/admin/resources/HydrationRun', label: '补全运行（HydrationRun）' },
      { href: '/admin/pages/hydrationOps', label: '补全运行 / DLQ 面板' },
    ],
  },
  {
    title: '代理',
    hint: '导入代理、查看健康、排查失败。',
    links: [
      { href: '/admin/pages/easyProxiesImport', label: 'easy_proxies 导入/刷新' },
      { href: '/admin/resources/ProxyEndpoint', label: '代理端点（ProxyEndpoint）' },
      { href: '/admin/pages/proxyPoolOverview', label: '代理池概览（统计）' },
    ],
  },
  {
    title: '令牌',
    hint: 'token 维护与 token↔proxy 绑定策略。',
    links: [
      { href: '/admin/resources/PixivToken', label: 'Pixiv Token 管理' },
      { href: '/admin/pages/tokenProxyBindings', label: 'Token↔Proxy 绑定页' },
    ],
  },
  {
    title: '统计与审计',
    hint: '回归排障时先看统计，再核对审计。',
    links: [
      { href: '/admin', label: 'Dashboard（全局概览）' },
      { href: '/admin/resources/RequestLog', label: '请求日志' },
      { href: '/admin/resources/AdminAudit', label: '操作审计' },
    ],
  },
];

export default function OpsNavigatorPage() {
  const [meta, setMeta] = useState(null);

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
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div style={pageRootStyle}>
      <h2 style={{ marginTop: 0 }}>操作导航（推荐从这里进入）</h2>
      <p style={{ marginTop: 0, ...mutedTextStyle }}>
        目标：把「导入 / 补全 / 代理 / 令牌 / 统计」放到固定入口，降低误操作。
      </p>
      {meta?.generated_at ? (
        <p style={{ marginTop: 0, ...mutedTextStyle }}>生成时间：{String(meta.generated_at)}</p>
      ) : null}

      <div style={{
        border: '1px solid #fde68a',
        background: '#fffbeb',
        borderRadius: 12,
        padding: 12,
        color: '#92400e',
        marginBottom: 12,
      }}
      >
        高风险操作提示：关闭代理、删除/禁用图片、重试 DLQ 任务前，请先查看 Dashboard 与操作审计。
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
        {GROUPS.map((group) => (
          <section key={group.title} style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 12 }}>
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
