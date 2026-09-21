import { MenuOutlined } from "@ant-design/icons";
import { Button, Drawer, Grid, Layout } from "antd";
import { useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { formatMonth } from "../lib/dates";
import { useMonth, withMonth } from "../hooks/useMonth";
import { Sidebar } from "./Sidebar";
import { MonthPicker } from "./MonthPicker";
import { APP_NAME } from "../brand";

const { Sider, Content } = Layout;

export function AppShell() {
  const screens = Grid.useBreakpoint();
  const isMobile = screens.lg === false;
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { month, setMonth } = useMonth();
  const wide = location.pathname === "/year";

  function go(path: string) {
    navigate(withMonth(path, month));
    setOpen(false);
  }

  return (
    <Layout style={{ minHeight: "100vh", background: "var(--canvas)" }}>
      {!isMobile && (
        <Sider width={240} theme="light" className="app-sider" trigger={null}>
          <Sidebar pathname={location.pathname} onNavigate={go} />
        </Sider>
      )}
      <Layout style={{ background: "var(--canvas)", minWidth: 0 }}>
        <header className="app-header">
          <div className="app-header-left">
            {isMobile && (
              <>
                <Button
                  type="text"
                  icon={<MenuOutlined />}
                  onClick={() => setOpen(true)}
                  aria-label="Open navigation"
                />
                <img className="app-header-mark" src="/logo.svg" width={28} height={28} alt="" />
                <span className="app-header-month">{APP_NAME}</span>
              </>
            )}
            {!isMobile && <span className="app-header-month">{formatMonth(month)}</span>}
          </div>
          <MonthPicker month={month} onChange={setMonth} />
        </header>
        <Content className="app-content">
          <div className={`app-content-inner${wide ? " wide" : ""}`}>
            <Outlet />
          </div>
        </Content>
      </Layout>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        placement="left"
        width={280}
        styles={{ body: { padding: 0 } }}
        title={null}
      >
        <div className="app-drawer-body">
          <Sidebar pathname={location.pathname} onNavigate={go} />
        </div>
      </Drawer>
    </Layout>
  );
}
