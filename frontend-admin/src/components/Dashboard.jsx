import React, { useEffect, useState } from 'react'
import { apiGet, apiPost, apiDelete, apiPatch } from '../lib/api'

export default function Dashboard({ token, onLogout }){
  const [shops, setShops] = useState([])
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({ shopCode: '', shopName: '', password: '', colorPrice: '', bwPrice: '', subscriptionEnd: '' })
  const [msg, setMsg] = useState('')

  async function load(){
    setLoading(true); setMsg('')
    try{
      const res = await apiGet('/admin/shops', token)
      setShops(res.shops || [])
    }catch(err){ setMsg(err.message || 'Failed to load') }
    setLoading(false)
  }

  useEffect(()=>{ load() }, [])

  async function createShop(e){
    e.preventDefault(); setMsg('')
    if(!form.shopCode || !form.password){ setMsg('shopCode and password required'); return }
    try{
      const res = await apiPost('/admin/create-shop', form, token)
      if(res && res.success){ setMsg('Shop created'); setForm({ shopCode:'', shopName:'', password:'', colorPrice:'', bwPrice:'', subscriptionDays:365 }); load() }
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

  return (
    <div className="dashboard">
      <div className="top">
        <h2>Admin Dashboard</h2>
        <button onClick={onLogout}>Logout</button>
      </div>

      <div className="card">
        <h3>Create Shop</h3>
        {msg && <div className="msg">{msg}</div>}
        <form onSubmit={createShop}>
          <label>Shop Code</label>
          <input value={form.shopCode} onChange={e=>setForm({...form, shopCode: e.target.value})} />
          <label>Shop Name</label>
          <input value={form.shopName} onChange={e=>setForm({...form, shopName: e.target.value})} />
          <label>Password</label>
          <input value={form.password} type="password" onChange={e=>setForm({...form, password: e.target.value})} />
          <div style={{display:'flex', gap:8}}>
            <div style={{flex:1}}>
              <label>Color Price</label>
              <input value={form.colorPrice} onChange={e=>setForm({...form, colorPrice: e.target.value})} />
            </div>
            <div style={{flex:1}}>
              <label>BW Price</label>
              <input value={form.bwPrice} onChange={e=>setForm({...form, bwPrice: e.target.value})} />
            </div>
          </div>
          <label>Subscription End Date</label>
          <input type="date" value={form.subscriptionEnd} onChange={e=>setForm({...form, subscriptionEnd: e.target.value})} />
          <button>Create Shop</button>
        </form>
      </div>

      <div className="card">
        <h3>Shops</h3>
        {loading ? <div>Loading...</div> : (
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
        )}
      </div>
    </div>
  )
}
