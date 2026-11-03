import { NavLink, Outlet } from "react-router-dom";
import { useTheme } from "../theme";

const nav = [
  { to: "/", end: true, label: "总览", icon: "◈" },
  { to: "/workers", label: "工蜂", icon: "⬡" },
  { to: "/jobs", label: "任务", icon: "▣" },
  { to: "/alerts", label: "告警", icon: "⚠" },
  { to: "/enroll", label: "SSH 装机", icon: "⇪" },
  { to: "/bootstrap", label: "装机命令", icon: "⌘" },
];

export function Shell({ version, online }: { version?: string; online?: number }) {
  const { theme, toggle } = useTheme();
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">🐝</div>
          <div>
            <div className="brand-title">Hive Nest</div>
            <div className="brand-sub">蜂巢控制台</div>
          </div>
        </div>
        <nav className="nav">
          {nav.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => (isActive ? "nav-item active" : "nav-item")}>
              <span className="nav-icon">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="muted small">
            v{version || "?"} · 在线 {online ?? "-"}
          </div>
          <button type="button" className="btn ghost theme-toggle" onClick={toggle} title="切换主题">
            {theme === "light" ? "深色模式" : "浅色模式"}
          </button>
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
