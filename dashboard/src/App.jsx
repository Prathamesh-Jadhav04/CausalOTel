import React, { useEffect, useRef, useState } from 'react';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import Navbar from './components/Navbar';
import BottomNav from './components/BottomNav';
import CommandPalette from './components/CommandPalette';
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
  const { pathname } = useLocation();
  const mainRef = useRef(null);
  const [commandOpen, setCommandOpen] = useState(false);

  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0, behavior: 'auto' });
  }, [pathname]);

  if (!session) {
    return <Login />;
  }

  return (
    <div className="app-shell relative flex h-[100dvh] overflow-hidden text-white">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[130] focus:rounded-full focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-ink-950"
      >
        Skip to content
      </a>
      <div className="ambient-glow" aria-hidden="true">
        <span className="ambient-orb" />
      </div>
      <Sidebar onOpenCommand={() => setCommandOpen(true)} />
      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <Navbar onOpenCommand={() => setCommandOpen(true)} />
        <main
          id="main-content"
          ref={mainRef}
          className="relative flex-1 overflow-y-auto overflow-x-hidden px-4 pb-[calc(env(safe-area-inset-bottom)+112px)] pt-4 sm:px-6 sm:pt-5 lg:px-9 lg:pb-10 lg:pt-1"
        >
          <div className="mx-auto w-full max-w-[1440px]">
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
        <BottomNav onOpenCommand={() => setCommandOpen(true)} />
      </div>
      <CommandPalette
        open={commandOpen}
        onOpen={() => setCommandOpen(true)}
        onClose={() => setCommandOpen(false)}
      />
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
