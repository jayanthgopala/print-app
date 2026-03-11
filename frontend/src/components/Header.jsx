import React from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import './Header.css';

function Header() {
  const { user, logout } = useAuth();

  return (
    <header className="header">
      <div className="header-content">
        <div className="header-left">
          <h1 className="header-title">🖨️ Cloud Printing</h1>
        </div>
        
        <div className="header-right">
          <span className="user-name">{user.shopCode}</span>
          <button onClick={logout} className="btn-logout">
            Sign Out
          </button>
        </div>
      </div>
    </header>
  );
}

export default Header;
