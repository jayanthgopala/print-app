import React, { useState } from 'react'
import { apiPost } from '../lib/api'

export default function Login({ onLogin }){
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [msg, setMsg] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(e){
    e.preventDefault()
    setMsg('')
    const normalizedUsername = username.trim()
    if(!normalizedUsername || !password){ setMsg('Enter username and password'); return }
    setLoading(true)
    try{
      const res = await apiPost('/admin/login', { username: normalizedUsername, password })
      if(res && res.token){
        onLogin(res.token, res.admin)
      } else {
        setMsg(res.error || 'Login failed')
      }
    }catch(err){
      setMsg(err.message || 'Login error')
    } finally { setLoading(false) }
  }

  return (
    <div className="auth-shell">
      <section className="auth-intro">
        <div className="eyebrow">BuilderGrids Admin</div>
        <h1>Control print shops, subscriptions, and failure recovery from one console.</h1>
        <p>
          Sign in to create shops, manage access windows, and re-queue failed jobs without leaving the dashboard.
        </p>
        <div className="feature-list">
          <div className="feature-pill">Shop provisioning</div>
          <div className="feature-pill">Subscription control</div>
          <div className="feature-pill">Failure retry queue</div>
        </div>
      </section>

      <section className="card auth-card">
        <div className="card-kicker">Secure access</div>
        <h2>Admin Login</h2>
        <p className="muted">Use your admin username and password to access the console.</p>
        {msg && <div className="msg">{msg}</div>}
        <form className="stack-form" onSubmit={submit}>
          <label>Username</label>
          <input value={username} onChange={e=>setUsername(e.target.value)} placeholder="ADMIN" autoComplete="username" />
          <label>Password</label>
          <input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Enter password" autoComplete="current-password" />
          <button disabled={loading}>{loading? 'Signing in...':'Sign In'}</button>
        </form>
      </section>
    </div>
  )
}
