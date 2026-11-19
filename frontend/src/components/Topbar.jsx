import React from 'react';

export default function Topbar({ activeView }) {
  const titles = {
    prescribe: 'Patient Assessments & Tests / Prescribe Test',
    assessment: 'Patient Assessments & Tests / Patient Assessment',
    reports: 'Patient Assessments & Tests / View Test Reports',
    analytics: 'Patient Assessments & Tests / Assessment Analytics',
  };

  return (
    <header className="topbar">
      <span className="app-switcher">Open MindScribe</span>
      <span className="topbar-caption">
        {titles[activeView] || 'Patient Assessments & Tests'}
      </span>
    </header>
  );
}
