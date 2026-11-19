import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import Shell from './components/Shell.jsx';
import Login from './pages/Login.jsx';
import ChangePassword from './pages/ChangePassword.jsx';
import Dashboard from './pages/Dashboard.jsx';
import OrgStructure from './pages/OrgStructure.jsx';
import Settings from './pages/Settings.jsx';
import Audit from './pages/Audit.jsx';

function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="fullscreen-center" role="status">Carregando…</div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (user.must_change_password && location.pathname !== '/trocar-senha') return <Navigate to="/trocar-senha" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/trocar-senha" element={<RequireAuth><ChangePassword /></RequireAuth>} />
      <Route element={<RequireAuth><Shell /></RequireAuth>}>
        <Route index element={<Dashboard />} />
        <Route path="admin/estrutura/:entity?" element={<OrgStructure />} />
        <Route path="admin/parametros" element={<Settings />} />
        <Route path="admin/auditoria" element={<Audit />} />
        <Route path="*" element={<div className="empty">Página não encontrada.</div>} />
      </Route>
    </Routes>
  );
}
