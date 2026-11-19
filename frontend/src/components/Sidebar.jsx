import React from 'react';
import { languages } from '../data/languages.js';

export default function Sidebar({
  activeView,
  onViewChange,
  collapsed,
  onToggleCollapse,
  currentLanguage,
  onLanguageChange,
}) {
  const currentLangObj = languages.find((l) => l.code === currentLanguage) || languages[0];

  return (
    <aside className="sidebar" aria-label="Main navigation">
      <button
        className="logo"
        type="button"
        onClick={onToggleCollapse}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        aria-expanded={!collapsed}
      >
        <img className="logo-mark" src="/openmind-mark.svg" alt="OpenMind" />
        <span className="logo-word">penMind</span>
        <svg className="collapse-icon" viewBox="0 0 24 24">
          <path d={collapsed ? 'm9 18 6-6-6-6' : 'm14 5-7 7 7 7'} />
        </svg>
      </button>

      <nav aria-label="Patient assessment navigation">
        <button
          className={`nav-row ${activeView === 'prescribe' ? 'active' : ''}`}
          type="button"
          onClick={() => onViewChange('prescribe')}
          title="Prescribe Test"
        >
          <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M5 3h9l4 4v5M5 3v18h8M14 3v5h4M18 15v7m-3.5-3.5h7" />
          </svg>
          <span className="nav-label">Prescribe Test</span>
        </button>

        <button
          className={`nav-row ${activeView === 'assessment' ? 'active' : ''}`}
          type="button"
          onClick={() => onViewChange('assessment')}
          title="Patient Assessment"
        >
          <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 4H6a2 2 0 0 0-2 2v15h16V6a2 2 0 0 0-2-2h-3M9 2h6v4H9V2Zm-1 9h8M8 15h8" />
          </svg>
          <span className="nav-label">Patient Assessment</span>
        </button>

        <button
          className={`nav-row ${activeView === 'reports' ? 'active' : ''}`}
          type="button"
          onClick={() => onViewChange('reports')}
          title="View Test Reports"
        >
          <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 3v18h17M8 16v-5m5 5V7m5 9V4" />
          </svg>
          <span className="nav-label">View Test Reports</span>
        </button>

        <button
          className={`nav-row ${activeView === 'analytics' ? 'active' : ''}`}
          type="button"
          onClick={() => onViewChange('analytics')}
          title="Analytics"
        >
          <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <path d="m4.93 4.93 4.24 4.24m5.66 5.66 4.24 4.24m-14.14 0 4.24-4.24m5.66-5.66 4.24-4.24" />
          </svg>
          <span className="nav-label">Analytics</span>
        </button>

        <div className="sidebar-language-section">
          <label
            className="sidebar-language-label"
            title={`Assessment Language: ${currentLangObj.name}`}
          >
            <span className="sidebar-language-title">
              <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="2" y1="12" x2="22" y2="12" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
              <span className="sidebar-language-text">Assessment Language</span>
            </span>
            <select
              className="sidebar-language-select"
              value={currentLanguage}
              onChange={(e) => onLanguageChange(e.target.value)}
              aria-label="Assessment Language"
            >
              {languages.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </nav>

      <div className="sidebar-footer">
        <span className="workspace-avatar" aria-hidden="true">OM</span>
        <div className="footer-label">
          <strong>Assessment workspace</strong>
          <small>Sample patient records</small>
        </div>
      </div>
    </aside>
  );
}
