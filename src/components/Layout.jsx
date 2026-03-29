import React from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import {
  LayoutDashboard, CheckSquare, Network, Settings, Bell, User, Activity
} from 'lucide-react';
import './Layout.css';

const NavigationItem = ({ to, icon: Icon, label, exact }) => (
  <NavLink to={to} end={exact} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
    <Icon size={20} />
    <span>{label}</span>
  </NavLink>
);

const DOMAIN = typeof __ATLASSIAN_DOMAIN__ !== 'undefined' ? __ATLASSIAN_DOMAIN__ : '';

export const Layout = () => {
  return (
    <div className="app-container">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="logo-icon glass-panel flex items-center justify-center">
            <Activity size={24} className="text-primary" style={{ color: 'var(--color-primary)' }} />
          </div>
          <div>
            <h1 className="logo-text">Autopilot</h1>
            <span className="logo-subtext">SDLC Command Center</span>
          </div>
        </div>

        <nav className="sidebar-nav">
          <div className="nav-section">Main</div>
          <NavigationItem to="/" icon={LayoutDashboard} label="Dashboard" exact />
          <NavigationItem to="/review" icon={CheckSquare} label="Review Pipeline" />
          <NavigationItem to="/handoff" icon={Network} label="Artifacts & Sync" />
        </nav>

        <div className="sidebar-footer">
          <NavigationItem to="/settings" icon={Settings} label="Settings" />
        </div>
      </aside>

      <div className="main-content">
        <header className="topbar glass-panel m-4">
          <div className="topbar-search">
            <span className="text-secondary" style={{ fontSize: '0.875rem', fontWeight: 500 }}>
              Active Environment:{' '}
              <span className="gradient-text">
                {DOMAIN ? DOMAIN.replace('.atlassian.net', '') : 'Production'} / Org-Main
              </span>
            </span>
          </div>
          <div className="topbar-actions flex items-center gap-4">
            <button className="btn btn-secondary icon-btn relative p-2" style={{ borderRadius: '50%' }}>
              <Bell size={18} />
              <span className="badge-notification"></span>
            </button>
            <div className="user-profile flex items-center gap-2">
              <div className="avatar">
                <User size={18} />
              </div>
              <div className="flex-col">
                <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>Sarah (TPM)</span>
              </div>
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
