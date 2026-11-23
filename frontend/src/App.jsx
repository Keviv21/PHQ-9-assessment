import { Component, Suspense, lazy } from 'react';

const Clinic = lazy(() => import('./pages/ClinicPage.jsx'));
const Assessment = lazy(() => import('./pages/AssessmentPage.jsx'));
const Definition = lazy(() => import('./pages/DefinitionPage.jsx'));
const Draft = lazy(() => import('./pages/DraftPage.jsx'));
const Report = lazy(() => import('./pages/ReportPage.jsx'));
const Recommend = lazy(() => import('./pages/RecommendPage.jsx'));
const PatientSuggest = lazy(() => import('./pages/PatientSuggestPage.jsx'));

// Keep existing assignment/report URLs valid, including their query strings.
const routes = {
  '/': Clinic,
  '/clinic.html': Clinic,
  '/index.html': Assessment,
  '/assessment.html': Assessment,
  '/definition.html': Definition,
  '/draft-live.html': Draft,
  '/report.html': Report,
  '/recommend.html': Recommend,
  '/patient-suggest.html': PatientSuggest,
  '/assessment-library.html': Clinic,
};

class PageBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) return <main role="alert"><h1>Unable to load this screen</h1><p>{this.state.error.message}</p><a href="/">Return to assessments</a></main>;
    return this.props.children;
  }
}

export default function App() {
  const Page = routes[window.location.pathname];
  if (!Page) return <main><h1>Page not found</h1><a href="/">Return to assessments</a></main>;
  return <PageBoundary><Suspense fallback={<p role="status">Loading assessments…</p>}><Page /></Suspense></PageBoundary>;
}
