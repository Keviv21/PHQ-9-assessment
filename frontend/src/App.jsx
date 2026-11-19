import React, { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar.jsx';
import Topbar from './components/Topbar.jsx';
import ClinicView from './components/ClinicView.jsx';
import AssessmentView from './components/AssessmentView.jsx';
import ReportsView from './components/ReportsView.jsx';
import AnalyticsView from './components/AnalyticsView.jsx';

export default function App() {
  const [activeView, setActiveView] = useState('prescribe');
  const [collapsed, setCollapsed] = useState(false);
  const [currentLanguage, setCurrentLanguage] = useState('en');
  const [activePrescriptionId, setActivePrescriptionId] = useState('');

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const viewParam = params.get('view');
      const presParam = params.get('prescriptionId');
      const langParam = params.get('language');

      if (viewParam) setActiveView(viewParam);
      if (presParam) setActivePrescriptionId(presParam);
      if (langParam) setCurrentLanguage(langParam);
    } catch (e) {
      console.error(e);
    }
  }, []);

  function handleViewChange(view) {
    setActiveView(view);
    const url = new URL(window.location.href);
    url.searchParams.set('view', view);
    if (view !== 'assessment') {
      url.searchParams.delete('prescriptionId');
    }
    window.history.pushState({}, '', url.href);
  }

  function handleOpenAssessment(prescriptionId, lang = 'en') {
    setActivePrescriptionId(prescriptionId);
    setCurrentLanguage(lang);
    setActiveView('assessment');

    const url = new URL(window.location.href);
    url.searchParams.set('view', 'assessment');
    url.searchParams.set('prescriptionId', prescriptionId);
    url.searchParams.set('language', lang);
    window.history.pushState({}, '', url.href);
  }

  function handleFinishAssessment(resultId) {
    setActiveView('reports');
    const url = new URL(window.location.href);
    url.searchParams.set('view', 'reports');
    if (resultId) url.searchParams.set('resultId', resultId);
    window.history.pushState({}, '', url.href);
  }

  return (
    <div className={`clinic-app ${collapsed ? 'sidebar-collapsed' : ''}`}>
      <Sidebar
        activeView={activeView}
        onViewChange={handleViewChange}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed(!collapsed)}
        currentLanguage={currentLanguage}
        onLanguageChange={setCurrentLanguage}
      />

      <div className="main-column">
        <Topbar activeView={activeView} />
        <main className="content">
          {activeView === 'prescribe' && (
            <ClinicView
              currentLanguage={currentLanguage}
              onOpenAssessment={handleOpenAssessment}
            />
          )}

          {activeView === 'assessment' && (
            <AssessmentView
              prescriptionId={activePrescriptionId}
              initialLanguage={currentLanguage}
              onFinishAssessment={handleFinishAssessment}
            />
          )}

          {activeView === 'reports' && <ReportsView />}

          {activeView === 'analytics' && <AnalyticsView />}
        </main>
      </div>
    </div>
  );
}
