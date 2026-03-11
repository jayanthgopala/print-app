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
    if(!username || !password){ setMsg('Enter username and password'); return }
    setLoading(true)
    try{
      const res = await apiPost('/admin/login', { username, password })
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
    <div className="card">
      <h2>Admin Login</h2>
      {msg && <div className="msg">{msg}</div>}
      <form onSubmit={submit}>
        <label>Username</label>
        <input value={username} onChange={e=>setUsername(e.target.value)} />
        <label>Password</label>
        <input type="password" value={password} onChange={e=>setPassword(e.target.value)} />
        <button disabled={loading}>{loading? 'Signing in...':'Sign In'}</button>
      </form>
    </div>
  )
}
