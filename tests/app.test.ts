import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'

const app = createApp()

describe('GET /api/health', () => {
  it('returns the API status', async () => {
    const res = await request(app).get('/api/health')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true, message: 'E-Voting System API is running' })
  })

  it('sets security headers', async () => {
    const res = await request(app).get('/api/health')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['x-powered-by']).toBeUndefined()
    expect(res.headers['ratelimit-policy']).toBeDefined()
  })

  it('allows the configured CORS origin', async () => {
    const res = await request(app).get('/api/health').set('Origin', 'http://localhost:5173')
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173')
  })
})

describe('placeholder modules', () => {
  it.each(['auth', 'users', 'elections', 'candidates', 'votes', 'admin'])('/api/%s responds 501', async (module) => {
    const res = await request(app).get(`/api/${module}`)
    expect(res.status).toBe(501)
    expect(res.body.success).toBe(false)
  })
})

describe('blockchain status', () => {
  it('reports unconfigured blockchain without failing', async () => {
    const res = await request(app).get('/api/blockchain/status')
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ providerConfigured: false, contractConfigured: false })
  })
})

describe('error handling', () => {
  it('returns 404 JSON for unknown routes', async () => {
    const res = await request(app).get('/api/does-not-exist')
    expect(res.status).toBe(404)
    expect(res.body).toMatchObject({ success: false })
  })

  it('returns 400 for malformed JSON', async () => {
    const res = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{bad json')
    expect(res.status).toBe(400)
    expect(res.body.message).toBe('Malformed JSON in request body')
  })
})
