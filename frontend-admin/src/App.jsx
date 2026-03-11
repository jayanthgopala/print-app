import React, { useState } from 'react'
import Login from './components/Login'
import Dashboard from './components/Dashboard'

export default function App(){
  const [token, setToken] = useState(localStorage.getItem('admin_token') || '')
  const [admin, setAdmin] = useState(null)

  return (
    <div className="app">
      {!token ? (
        <Login onLogin={(t, a)=>{ setToken(t); setAdmin(a); localStorage.setItem('admin_token', t) }} />
      ) : (
        <Dashboard token={token} onLogout={()=>{ setToken(''); localStorage.removeItem('admin_token') }} />
      )}
    </div>
  )
}
