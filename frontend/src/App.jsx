import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import Shell from './components/Shell.jsx';
import Login from './pages/Login.jsx';
import ChangePassword from './pages/ChangePassword.jsx';
import Dashboard from './pages/Dashboard.jsx';
import OrgStructure from './pages/OrgStructure.jsx';
import Settings from './pages/Settings.jsx';
import Audit from './pages/Audit.jsx';
import Users from './pages/Users.jsx';
import Roles from './pages/Roles.jsx';
import Materials from './pages/mm/Materials.jsx';
import Suppliers from './pages/mm/Suppliers.jsx';
import Stock from './pages/mm/Stock.jsx';
import Requisitions from './pages/mm/Requisitions.jsx';
import PurchaseOrders from './pages/mm/PurchaseOrders.jsx';
import GoodsReceipts from './pages/mm/GoodsReceipts.jsx';
import Mrp from './pages/mm/Mrp.jsx';
import Customers from './pages/sd/Customers.jsx';
import Conditions from './pages/sd/Conditions.jsx';
import SalesOrders from './pages/sd/SalesOrders.jsx';
import Deliveries from './pages/sd/Deliveries.jsx';
import BillingPage from './pages/sd/Billing.jsx';
import Receivables from './pages/sd/Receivables.jsx';
import DocumentFlow from './pages/DocumentFlow.jsx';

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
        <Route path="admin/usuarios" element={<Users />} />
        <Route path="admin/roles" element={<Roles />} />
        <Route path="mm/materiais" element={<Materials />} />
        <Route path="mm/fornecedores" element={<Suppliers />} />
        <Route path="mm/estoque" element={<Stock />} />
        <Route path="mm/requisicoes" element={<Requisitions />} />
        <Route path="mm/pedidos" element={<PurchaseOrders />} />
        <Route path="mm/recebimentos" element={<GoodsReceipts />} />
        <Route path="mm/mrp" element={<Mrp />} />
        <Route path="sd/clientes" element={<Customers />} />
        <Route path="sd/condicoes" element={<Conditions />} />
        <Route path="sd/pedidos" element={<SalesOrders />} />
        <Route path="sd/entregas" element={<Deliveries />} />
        <Route path="sd/faturamento" element={<BillingPage />} />
        <Route path="sd/contas-a-receber" element={<Receivables />} />
        <Route path="fluxo" element={<DocumentFlow />} />
        <Route path="*" element={<div className="empty">Página não encontrada.</div>} />
      </Route>
    </Routes>
  );
}
