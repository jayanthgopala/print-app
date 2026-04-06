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
        <div className="eyebrow">Restricted System</div>
        <h1>Internal access point for authorized operators only.</h1>
        <p>
          This interface is intended for internal operational use. Unrecognized access attempts are not supported here.
        </p>
        <div className="feature-list">
          <div className="feature-pill">Restricted</div>
          <div className="feature-pill">Authorized personnel</div>
          <div className="feature-pill">Internal workflow</div>
        </div>
      </section>

      <section className="card auth-card">
        <div className="card-kicker">Verification</div>
        <h2>System Access</h2>
        <p className="muted">Proceed only if you were explicitly issued credentials for this environment.</p>
        {msg && <div className="msg">{msg}</div>}
        <form className="stack-form" onSubmit={submit}>
          <label>Identifier</label>
          <input value={username} onChange={e=>setUsername(e.target.value)} placeholder="Issued identifier" autoComplete="username" />
          <label>Credential</label>
          <input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Verification string" autoComplete="current-password" />
          <button disabled={loading}>{loading? 'Verifying...':'Proceed'}</button>
        </form>
      </section>
    </div>
  )
}
