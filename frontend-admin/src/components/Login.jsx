import React, { useState } from 'react'
import { apiPost } from '../lib/api'

export default function Login({ onLogin }){
  const ACCESS_PHRASE = 'AUTHORIZED'
  const [gateValue, setGateValue] = useState('')
  const [unlocked, setUnlocked] = useState(false)
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
        <h1>Restricted access.</h1>
        <div className="muted">Authorized personnel only</div>
      </section>

      <section className="card auth-card">
        <div className="card-kicker">Verification</div>
        <h2>System Access</h2>
        {msg && <div className="msg">{msg}</div>}
        {!unlocked ? (
          <div className="stack-form gate-panel">
            <label>Access phrase</label>
            <input value={gateValue} onChange={e=>setGateValue(e.target.value)} placeholder="Enter access phrase" autoComplete="off" />
            <button
              type="button"
              disabled={gateValue.trim().toUpperCase() !== ACCESS_PHRASE}
              onClick={() => {
                setUnlocked(true)
                setMsg('')
              }}
            >
              Unlock Access Form
            </button>
          </div>
        ) : (
          <form className="stack-form" onSubmit={submit}>
            <label>Identifier</label>
            <input value={username} onChange={e=>setUsername(e.target.value)} placeholder="Issued identifier" autoComplete="username" />
            <label>Credential</label>
            <input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Verification string" autoComplete="current-password" />
            <div className="inline-actions">
              <button disabled={loading}>{loading? 'Verifying...':'Proceed'}</button>
              <button
                type="button"
                className="ghost subtle"
                onClick={() => {
                  setUnlocked(false)
                  setUsername('')
                  setPassword('')
                  setGateValue('')
                  setMsg('')
                }}
              >
                Hide Form
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  )
}
