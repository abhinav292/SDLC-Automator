import React, { useState, useEffect, useRef } from 'react';
import { NavLink, Link, Outlet } from 'react-router-dom';
import {
  LayoutDashboard, CheckSquare, Network, Settings, Bell, User, Menu, X, FileText,
  Waypoints, Shield, Check, ChevronDown, UserCog
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { can, PERMS, ROLE_LABELS } from '../services/authzService';
import './Layout.css';

const NavigationItem = ({ to, icon: Icon, label, exact, onClick }) => (
  <NavLink to={to} end={exact} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={onClick}>
    <Icon size={18} />
    <span>{label}</span>
  </NavLink>
);

const DOMAIN = typeof __ATLASSIAN_DOMAIN__ !== 'undefined' ? __ATLASSIAN_DOMAIN__ : '';

/* Demo identity switcher — labelled honestly as a demo affordance.
   No real auth: switching identity just changes the local demo user. */
const IdentitySwitcher = () => {
  const { currentUser, users, switchUser } = useApp();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const triggerRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const list = Array.isArray(users) ? users : [];
  const roleLabel = currentUser ? (ROLE_LABELS[currentUser.role] || currentUser.role) : '';
  const isAdmin = can(currentUser, PERMS.MANAGE_USERS);

  return (
    <div className="identity-switcher" ref={wrapRef}>
      <button
        type="button"
        ref={triggerRef}
        className="user-profile identity-trigger"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={currentUser ? `Demo identity: ${currentUser.name} (${roleLabel}). Open identity switcher` : 'Open identity switcher'}
        title="Demo identity — connect SSO for real auth"
      >
        <div className="avatar">
          <User size={16} />
        </div>
        <span className="user-name">
          {currentUser ? `${currentUser.name} (${roleLabel})` : 'Guest'}
        </span>
        <ChevronDown size={14} className={`identity-caret ${open ? 'identity-caret-open' : ''}`} aria-hidden="true" />
      </button>

      {open && (
        <div className="identity-menu glass-panel" role="menu" aria-label="Switch demo identity">
          <div className="identity-menu-note">Demo identity — connect SSO for real auth</div>
          <div className="identity-menu-list">
            {list.length === 0 && (
              <div className="identity-menu-empty">No demo users available</div>
            )}
            {list.map(u => {
              const isCurrent = !!currentUser && u.id === currentUser.id;
              return (
                <button
                  key={u.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={isCurrent}
                  className={`identity-menu-item ${isCurrent ? 'is-current' : ''}`}
                  onClick={() => {
                    switchUser(u.id);
                    setOpen(false);
                  }}
                >
                  <span className="identity-item-avatar" aria-hidden="true">
                    {(u.name || '?').charAt(0).toUpperCase()}
                  </span>
                  <span className="identity-item-text">
                    <span className="identity-item-name">{u.name}</span>
                    <span className="identity-item-role">{ROLE_LABELS[u.role] || u.role}</span>
                  </span>
                  {isCurrent && <Check size={15} className="identity-item-check" aria-hidden="true" />}
                </button>
              );
            })}
          </div>
          {isAdmin && (
            <div className="identity-menu-footer">
              <Link to="/admin" className="identity-menu-manage" role="menuitem" onClick={() => setOpen(false)}>
                <UserCog size={14} />
                <span>Manage users</span>
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export const Layout = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const closeSidebar = () => setSidebarOpen(false);
  const { currentUser } = useApp();
  const showAdminNav = can(currentUser, PERMS.MANAGE_USERS);

  return (
    <div className="app-container">
      {sidebarOpen && <div className="sidebar-overlay" onClick={closeSidebar} aria-hidden="true" />}

      <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
        <div className="sidebar-header">
          <div className="logo-icon" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <defs>
                <linearGradient id="priorityMarkGrad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#6FC8B2" />
                  <stop offset="100%" stopColor="#DCE58E" />
                </linearGradient>
              </defs>
              {/* Rounded hexagon outline, open at the lower-left */}
              <path
                d="M4.21 16.5 L4.21 7.5 L12 3 L19.79 7.5 L19.79 16.5 L12 21"
                stroke="url(#priorityMarkGrad)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {/* Small filled hexagon core */}
              <path
                d="M12 8.8 L14.77 10.4 L14.77 13.6 L12 15.2 L9.23 13.6 L9.23 10.4 Z"
                fill="url(#priorityMarkGrad)"
              />
            </svg>
          </div>
          <div style={{ minWidth: 0 }}>
            <h1 className="logo-text">Autopilot</h1>
            <span className="logo-subtext">Priority · SDLC</span>
          </div>
          <button className="sidebar-close-btn" onClick={closeSidebar} aria-label="Close menu">
            <X size={18} />
          </button>
        </div>

        <nav className="sidebar-nav">
          <div className="nav-section">Main</div>
          <NavigationItem to="/" icon={LayoutDashboard} label="Dashboard" exact onClick={closeSidebar} />
          <NavigationItem to="/prd" icon={FileText} label="Draft PRD" onClick={closeSidebar} />
          <NavigationItem to="/review" icon={CheckSquare} label="Review Pipeline" onClick={closeSidebar} />
          <NavigationItem to="/handoff" icon={Network} label="Artifacts & Sync" onClick={closeSidebar} />
          <NavigationItem to="/trace" icon={Waypoints} label="Traceability" onClick={closeSidebar} />
        </nav>

        <div className="sidebar-footer">
          {showAdminNav && (
            <NavigationItem to="/admin" icon={Shield} label="Admin" onClick={closeSidebar} />
          )}
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
            <IdentitySwitcher />
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
