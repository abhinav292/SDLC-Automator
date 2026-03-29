import React, { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import {
  LayoutDashboard, CheckSquare, Network, Settings, Bell, User, Activity, Menu, X
} from 'lucide-react';
import './Layout.css';

const NavigationItem = ({ to, icon: Icon, label, exact, onClick }) => (
  <NavLink to={to} end={exact} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={onClick}>
    <Icon size={18} />
    <span>{label}</span>
  </NavLink>
);

const DOMAIN = typeof __ATLASSIAN_DOMAIN__ !== 'undefined' ? __ATLASSIAN_DOMAIN__ : '';

export const Layout = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const closeSidebar = () => setSidebarOpen(false);

  return (
    <div className="app-container">
      {sidebarOpen && <div className="sidebar-overlay" onClick={closeSidebar} aria-hidden="true" />}

      <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
        <div className="sidebar-header">
          <div className="logo-icon glass-panel" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Activity size={22} style={{ color: 'var(--color-primary)' }} />
          </div>
          <div style={{ minWidth: 0 }}>
            <h1 className="logo-text">Autopilot</h1>
            <span className="logo-subtext">SDLC Command Center</span>
          </div>
          <button className="sidebar-close-btn" onClick={closeSidebar} aria-label="Close menu">
            <X size={18} />
          </button>
        </div>

        <nav className="sidebar-nav">
          <div className="nav-section">Main</div>
          <NavigationItem to="/" icon={LayoutDashboard} label="Dashboard" exact onClick={closeSidebar} />
          <NavigationItem to="/review" icon={CheckSquare} label="Review Pipeline" onClick={closeSidebar} />
          <NavigationItem to="/handoff" icon={Network} label="Artifacts & Sync" onClick={closeSidebar} />
        </nav>

        <div className="sidebar-footer">
          <NavigationItem to="/settings" icon={Settings} label="Settings" onClick={closeSidebar} />
        </div>
      </aside>

      <div className="main-content">
        <header className="topbar glass-panel">
          <div className="topbar-left">
            <button className="hamburger-btn" onClick={() => setSidebarOpen(s => !s)} aria-label="Open menu">
              <Menu size={20} />
            </button>
            <span className="topbar-env">
              Active Environment:{' '}
              <span className="gradient-text">
                {DOMAIN ? DOMAIN.replace('.atlassian.net', '') : 'Production'} / Org-Main
              </span>
            </span>
          </div>
          <div className="topbar-actions">
            <button className="btn icon-btn relative" aria-label="Notifications">
              <Bell size={17} />
              <span className="badge-notification" aria-hidden="true" />
            </button>
            <div className="user-profile">
              <div className="avatar">
                <User size={16} />
              </div>
              <span className="user-name">Sarah (TPM)</span>
            </div>
          </div>
        </header>

        <main className="page-wrapper scrollable-y">
          <div className="page-container animate-fade-in">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
};
