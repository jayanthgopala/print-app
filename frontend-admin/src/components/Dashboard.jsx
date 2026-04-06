import React, { useEffect, useState } from 'react'
import { apiGet, apiPost, apiDelete, apiPatch } from '../lib/api'

export default function Dashboard({ token, admin, onLogout }){
  const [shops, setShops] = useState([])
  const [failedJobs, setFailedJobs] = useState([])
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({ shopCode: '', shopName: '', password: '', colorPrice: '', bwPrice: '', subscriptionEnd: '' })
  const [msg, setMsg] = useState('')

  async function load(){
    setLoading(true); setMsg('')
    try{
      const res = await apiGet('/admin/shops', token)
      setShops(res.shops || [])
      const failed = await apiGet('/admin/jobs/failed', token)
      setFailedJobs(failed.jobs || [])
    }catch(err){ setMsg(err.message || 'Failed to load') }
    setLoading(false)
  }

  useEffect(()=>{ load() }, [])

  const activeShops = shops.filter(s => {
    const end = s.subscription_end || s.end_date || s.expires_at || null
    return !end || new Date(end).getTime() > Date.now()
  }).length

  async function createShop(e){
    e.preventDefault(); setMsg('')
    const shopCode = form.shopCode.trim().toUpperCase()
    const shopName = form.shopName.trim()
    const password = form.password.trim()
    if(!shopCode || !password){ setMsg('shopCode and password required'); return }
    if(password.length < 8){ setMsg('Shop password must be at least 8 characters'); return }
    try{
      const res = await apiPost('/admin/create-shop', {
        ...form,
        shopCode,
        shopName,
        password
      }, token)
      if(res && res.success){ setMsg('Shop created'); setForm({ shopCode:'', shopName:'', password:'', colorPrice:'', bwPrice:'', subscriptionEnd:'' }); load() }
      else setMsg(res.error || 'Failed to create')
    }catch(err){ setMsg(err.message || 'Create error') }
  }

  async function deleteShop(code){
    if(!confirm(`Delete shop ${code}? This cannot be undone.`)) return;
    setMsg('');
    try{
      const res = await apiDelete(`/admin/shop/${encodeURIComponent(code)}`, token)
      if(res && res.success){ setMsg('Shop deleted'); load() }
      else setMsg(res.error || 'Failed to delete')
    }catch(err){ setMsg(err.message || 'Delete error') }
  }

  async function editShop(code){
    const input = prompt('Enter subscription end date (YYYY-MM-DD) or number of days to set:')
    if(!input) return;
    setMsg('')
    let body = null
    const trimmed = input.trim()
    if(/^\d+$/.test(trimmed)){
      body = { subscriptionDays: parseInt(trimmed, 10) }
    } else {
      const d = new Date(trimmed)
      if(isNaN(d.getTime())){ setMsg('Invalid date or days'); return }
      body = { subscriptionEnd: d.toISOString() }
    }
    try{
      const res = await apiPatch(`/admin/shop/${encodeURIComponent(code)}`, body, token)
      if(res && res.success){ setMsg('Shop updated'); load() }
      else setMsg(res.error || 'Update failed')
    }catch(err){ setMsg(err.message || 'Update error') }
  }

  async function retryFailedJob(jobId){
    setMsg('')
    try{
      const res = await apiPost('/admin/job/retry', { jobId }, token)
      if(res && res.success){ setMsg('Failed job re-queued'); load() }
      else setMsg(res.error || 'Retry failed')
    }catch(err){ setMsg(err.message || 'Retry error') }
  }

  return (
    <div className="dashboard">
      <section className="hero card">
        <div className="hero-copy">
          <div className="eyebrow">Operations Console</div>
          <h2>Admin Dashboard</h2>
          <p>
            Monitor shop access, issue credentials, and recover failed print jobs from a single control surface.
          </p>
        </div>
        <div className="hero-actions">
          <div className="hero-user">
            <span className="hero-user-label">Signed in as</span>
            <strong>{admin?.username || 'Admin'}</strong>
          </div>
          <button className="ghost" onClick={onLogout}>Logout</button>
        </div>
      </section>

      <section className="stats-grid">
        <div className="stat-card">
          <span className="stat-label">Total shops</span>
          <strong>{shops.length}</strong>
        </div>
        <div className="stat-card">
          <span className="stat-label">Active shops</span>
          <strong>{activeShops}</strong>
        </div>
        <div className="stat-card">
          <span className="stat-label">Failed jobs</span>
          <strong>{failedJobs.length}</strong>
        </div>
      </section>

      <div className="card">
        <div className="section-head">
          <div>
            <div className="card-kicker">Provisioning</div>
            <h3>Create Shop</h3>
          </div>
        </div>
        {msg && <div className="msg">{msg}</div>}
        <form className="shop-form" onSubmit={createShop}>
          <div className="field">
            <label>Shop Code</label>
            <input value={form.shopCode} onChange={e=>setForm({...form, shopCode: e.target.value})} placeholder="SHOP002" />
          </div>
          <div className="field">
            <label>Shop Name</label>
            <input value={form.shopName} onChange={e=>setForm({...form, shopName: e.target.value})} placeholder="Main Branch" />
          </div>
          <div className="field field-wide">
            <label>Password</label>
            <input value={form.password} type="password" minLength={8} onChange={e=>setForm({...form, password: e.target.value})} placeholder="Minimum 8 characters" />
          </div>
          <div className="field">
            <label>Color Price</label>
            <input value={form.colorPrice} onChange={e=>setForm({...form, colorPrice: e.target.value})} placeholder="2" />
          </div>
          <div className="field">
            <label>BW Price</label>
            <input value={form.bwPrice} onChange={e=>setForm({...form, bwPrice: e.target.value})} placeholder="5" />
          </div>
          <div className="field field-wide">
            <label>Subscription End Date</label>
            <input type="date" value={form.subscriptionEnd} onChange={e=>setForm({...form, subscriptionEnd: e.target.value})} />
          </div>
          <button>Create Shop</button>
        </form>
      </div>

      <div className="card">
        <div className="section-head">
          <div>
            <div className="card-kicker">Directory</div>
            <h3>Shops</h3>
          </div>
        </div>
        {loading ? <div>Loading...</div> : (
          <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Code</th><th>Name</th><th>Color</th><th>BW</th><th>Status</th><th>Start</th><th>End</th><th>Actions</th></tr></thead>
            <tbody>
              {shops.map(s=> (
                <tr key={s.shop_code || s.shopCode || s.shop_code}>
                  <td>{s.shop_code || s.shopCode}</td>
                  <td>{s.shop_name || s.shopName}</td>
                  <td>{s.color_price || s.colorPrice}</td>
                  <td>{s.bw_price || s.bwPrice}</td>
                  {(() => {
                    const start = s.created_at || s.start_date || s.starts_at || null;
                    const end = s.subscription_end || s.end_date || s.expires_at || null;
                    const isOnline = !end || (new Date(end).getTime() > Date.now());
                    return (
                      <>
                        <td>{isOnline ? 'Online' : 'Offline'}</td>
                        <td>{start ? new Date(start).toLocaleString() : ''}</td>
                        <td>{end ? new Date(end).toLocaleString() : ''}</td>
                        <td>
                          <button onClick={()=>editShop(s.shop_code || s.shopCode)}>Edit</button>
                          <button className="danger" onClick={()=>deleteShop(s.shop_code || s.shopCode)}>Delete</button>
                        </td>
                      </>
                    )
                  })()}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>

      <div className="card">
        <div className="section-head">
          <div>
            <div className="card-kicker">Recovery</div>
            <h3>Failed Jobs</h3>
          </div>
        </div>
        {failedJobs.length === 0 ? <div>No failed jobs</div> : (
          <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Job ID</th><th>Shop</th><th>File</th><th>Retries</th><th>Error</th><th>Updated</th><th>Action</th></tr></thead>
            <tbody>
              {failedJobs.map(job => (
                <tr key={job.id}>
                  <td>{job.id}</td>
                  <td>{job.shop_code}</td>
                  <td>{job.file_name}</td>
                  <td>{job.retry_count}</td>
                  <td>{job.last_error}</td>
                  <td>{job.updated_at ? new Date(job.updated_at).toLocaleString() : ''}</td>
                  <td><button onClick={()=>retryFailedJob(job.id)}>Retry</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </div>
  )
}
