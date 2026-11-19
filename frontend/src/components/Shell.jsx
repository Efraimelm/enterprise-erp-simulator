// Layout principal: barra superior, menu lateral por módulos e área de conteúdo.
import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { navigation } from '../modules.js';

export default function Shell() {
  const { user, logout, can } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="shell">
      <header className="shellbar">
        <button className="shellbar-menu" aria-label="Abrir menu" onClick={() => setMenuOpen((v) => !v)}>☰</button>
        <span className="shellbar-logo" aria-hidden>ERP</span>
        <span className="shellbar-title">Enterprise ERP Simulator</span>
        <span className="shellbar-env">Ambiente de simulação</span>
        <span className="shellbar-spacer" />
        <span className="shellbar-user" title={`Roles: ${user.roles.join(', ') || 'nenhuma'}\nEscopo: ${user.scopes.map((s) => s.label).join('; ') || 'nenhum'}`}>
          <span className="avatar" aria-hidden>{user.full_name.slice(0, 1)}</span>
          <span className="shellbar-user-name">{user.full_name}</span>
        </span>
        <button className="btn btn-ghost-light" onClick={logout}>Sair</button>
      </header>

      <nav className={`sidenav ${menuOpen ? 'open' : ''}`} aria-label="Módulos">
        {navigation.map((g) => (
          <div key={g.group} className="sidenav-group">
            <div className="sidenav-group-title">{g.group}</div>
            {g.items.map((item) =>
              item.path && (!item.permission || can(item.permission)) ? (
                <NavLink key={item.label} to={item.path} end={item.path === '/'} className="sidenav-item" onClick={() => setMenuOpen(false)}>
                  {item.label}
                </NavLink>
              ) : (
                <span key={item.label} className="sidenav-item disabled" aria-disabled="true">
                  {item.label}
                  {item.stage && <span className="tag">Etapa {item.stage}</span>}
                </span>
              ),
            )}
          </div>
        ))}
      </nav>

      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
