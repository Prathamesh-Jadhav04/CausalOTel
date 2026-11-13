import React, { createContext, useContext, useMemo, useState } from 'react';
import api from './api.js';
import { clearSession, readSession, saveSession } from './auth.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(() => readSession());

  const value = useMemo(() => ({
    session,
    isAdmin: session?.role === 'ROLE_ADMIN',

    async login(usernameOrEmail, password) {
      const response = await api.post('/api/auth/login', { usernameOrEmail, password });
      setSession(saveSession(response.data.token));
      return response.data;
    },

    async register(username, email, password) {
      const response = await api.post('/api/auth/register', { username, email, password });
      setSession(saveSession(response.data.token));
      return response.data;
    },

    async bootstrapAdmin(bootstrapToken, username, email, password) {
      const response = await api.post('/api/users/bootstrap-admin',
        { username, email, password },
        { headers: { 'X-Bootstrap-Token': bootstrapToken } });
      return response.data;
    },

    logout() {
      clearSession();
      setSession(null);
    }
  }), [session]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return context;
}
