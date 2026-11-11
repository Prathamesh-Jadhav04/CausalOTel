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
import { AuthProvider, useAuth } from './lib/AuthContext.jsx';

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
              <Route path="/" element={<Overview />} />
              <Route path="/services" element={<Services />} />
              <Route path="/graph" element={<DependencyGraph />} />
              <Route path="/traces" element={<Traces />} />
              <Route path="/traces/:traceId" element={<TraceDetail />} />
              <Route path="/incidents" element={<Incidents />} />
              <Route path="/rca" element={<RcaDetail />} />
              <Route path="/rca/:incidentId" element={<RcaDetail />} />
              <Route path="/metrics" element={<Metrics />} />
              <Route path="/fault-injection" element={<FaultInjection />} />
              <Route path="/settings" element={<Settings />} />
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
