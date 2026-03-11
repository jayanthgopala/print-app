const BASE = import.meta.env.VITE_API_URL
if (!BASE) throw new Error('VITE_API_URL is not set. Set your backend URL in the frontend-admin build environment.');

export async function apiPost(path, body, token){
  const headers = { 'Content-Type': 'application/json' }
  if(token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(BASE + path, { method: 'POST', headers, body: JSON.stringify(body) })
  const ct = res.headers.get('content-type') || ''
  if(ct.includes('application/json')) return res.json()
  return { success: res.ok }
}

export async function apiDelete(path, token){
  const headers = {}
  if(token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(BASE + path, { method: 'DELETE', headers })
  const ct = res.headers.get('content-type') || ''
  if(ct.includes('application/json')) return res.json()
  return { success: res.ok }
}

export async function apiPatch(path, body, token){
  const headers = { 'Content-Type': 'application/json' }
  if(token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(BASE + path, { method: 'PATCH', headers, body: JSON.stringify(body) })
  const ct = res.headers.get('content-type') || ''
  if(ct.includes('application/json')) return res.json()
  return { success: res.ok }
}

export async function apiGet(path, token){
  const headers = {}
  if(token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(BASE + path, { headers })
  const ct = res.headers.get('content-type') || ''
  if(ct.includes('application/json')) return res.json()
  return {}
}
