// Estado de login compartilhado por toda a aplicação.
// Importante: esconder botões aqui é só conforto visual. Quem garante a segurança é o backend.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api('/auth/me')
      .then((r) => setUser(r.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
    const onUnauthorized = () => setUser(null);
    window.addEventListener('erp:unauthorized', onUnauthorized);
    return () => window.removeEventListener('erp:unauthorized', onUnauthorized);
  }, []);

  const login = useCallback(async (username, password) => {
    const r = await api('/auth/login', { method: 'POST', body: { username, password } });
    setUser(r.user);
    return r.user;
  }, []);

  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    setUser(null);
  }, []);

  const changePassword = useCallback(async (current_password, new_password) => {
    const r = await api('/auth/change-password', { method: 'POST', body: { current_password, new_password } });
    setUser(r.user);
  }, []);

  const can = useCallback((permission) => !!user?.permissions?.includes(permission), [user]);

  const value = useMemo(() => ({ user, loading, login, logout, changePassword, can }), [user, loading, login, logout, changePassword, can]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
