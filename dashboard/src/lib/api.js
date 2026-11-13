import axios from 'axios';
import { TOKEN_KEY } from './auth.js';

export const api = axios.create({ timeout: 15000 });

api.interceptors.request.use(config => {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) {
      config.headers = config.headers || {};
      config.headers.Authorization = `Bearer ${token}`;
    }
  } catch {
    // No local storage: requests proceed unauthenticated and the UI shows 401.
  }
  return config;
});

export default api;
