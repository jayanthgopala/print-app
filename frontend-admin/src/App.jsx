import React, { useState } from 'react'
import Login from './components/Login'
import Dashboard from './components/Dashboard'

export default function App(){
  const [token, setToken] = useState(sessionStorage.getItem('admin_token') || '')
  const [admin, setAdmin] = useState(() => {
    const raw = sessionStorage.getItem('admin_profile')
    try {
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  })

  function handleLogin(t, a){
    setToken(t)
    setAdmin(a || null)
    sessionStorage.setItem('admin_token', t)
    sessionStorage.setItem('admin_profile', JSON.stringify(a || null))
    localStorage.removeItem('admin_token')
    localStorage.removeItem('admin_profile')
  }

  function handleLogout(){
    setToken('')
    setAdmin(null)
    sessionStorage.removeItem('admin_token')
    sessionStorage.removeItem('admin_profile')
    localStorage.removeItem('admin_token')
    localStorage.removeItem('admin_profile')
  }

  return (
    <div className="app">
      {!token ? (
        <Login onLogin={handleLogin} />
      ) : (
        <Dashboard token={token} admin={admin} onLogout={handleLogout} />
      )}
    </div>
  )
}
