import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import Navbar from './components/Navbar';
import Overview from './pages/Overview';
import Services from './pages/Services';
import DependencyGraph from './pages/DependencyGraph';
import Traces from './pages/Traces';
import TraceDetail from './pages/TraceDetail';
import Incidents from './pages/Incidents';
import RcaDetail from './pages/RcaDetail';
import Metrics from './pages/Metrics';
import FaultInjection from './pages/FaultInjection';
import Settings from './pages/Settings';
import Login from './pages/Login';
import NotFound from './pages/NotFound';
import { AuthProvider, useAuth } from './lib/AuthContext.jsx';
import { NOT_FOUND_ROUTE, ROUTE_PATHS } from './lib/routes.js';

function Shell() {
  const { session } = useAuth();

  if (!session) {
    return <Login />;
  }

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 font-sans overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Navbar />
        <main className="flex-1 overflow-y-auto p-8 bg-slate-950">
          <div className="max-w-7xl mx-auto">
            <Routes>
              <Route path={ROUTE_PATHS.overview} element={<Overview />} />
              <Route path={ROUTE_PATHS.services} element={<Services />} />
              <Route path={ROUTE_PATHS.graph} element={<DependencyGraph />} />
              <Route path={ROUTE_PATHS.traces} element={<Traces />} />
              <Route path={ROUTE_PATHS.traceDetail} element={<TraceDetail />} />
              <Route path={ROUTE_PATHS.incidents} element={<Incidents />} />
              <Route path={ROUTE_PATHS.incidentDetail} element={<RcaDetail />} />
              <Route path={ROUTE_PATHS.rca} element={<RcaDetail />} />
              <Route path={ROUTE_PATHS.rcaDetail} element={<RcaDetail />} />
              <Route path={ROUTE_PATHS.metrics} element={<Metrics />} />
              <Route path={ROUTE_PATHS.faultInjection} element={<FaultInjection />} />
              <Route path={ROUTE_PATHS.settings} element={<Settings />} />
              <Route path={NOT_FOUND_ROUTE} element={<NotFound />} />
            </Routes>
          </div>
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Shell />
      </BrowserRouter>
    </AuthProvider>
  );
}
