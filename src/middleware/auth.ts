/**
 * Authentication and authorisation guards.
 *
 * The user is re-read from the database on every request rather than trusted from the JWT:
 * a token issued before a revocation must stop working immediately, and roles must not be
 * whatever the client's token happened to claim when it was minted.
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express'
import type { Types } from 'mongoose'
import { User, type UserDocument } from '../models/index.js'
import { verifyToken, type UserRole } from '../services/auth.service.js'
import { ApiError } from '../utils/ApiError.js'

export interface AuthenticatedUser extends UserDocument {
  _id: Types.ObjectId
}

declare module 'express-serve-static-core' {
  interface Request {
    /** Set by `requireAuth` / `optionalAuth`. Never set from client input. */
    currentUser?: AuthenticatedUser
  }
}

function bearerToken(req: Request): string | null {
  const header = req.get('authorization')
  if (!header?.startsWith('Bearer ')) return null
  const token = header.slice('Bearer '.length).trim()
  return token.length > 0 ? token : null
}

async function loadUser(token: string): Promise<AuthenticatedUser> {
  const payload = verifyToken(token)
  const user = await User.findById(payload.sub)
  if (!user) throw ApiError.unauthorized('Your session is no longer valid. Please sign in again.')
  return user as unknown as AuthenticatedUser
}

export const requireAuth: RequestHandler = (req: Request, _res: Response, next: NextFunction) => {
  const token = bearerToken(req)
  if (!token) {
    next(ApiError.unauthorized('Please sign in to continue.'))
    return
  }
  loadUser(token)
    .then((user) => {
      req.currentUser = user
      next()
    })
    .catch(next)
}

/** Attaches the user when a valid token is present, and does nothing when it is not. */
export const optionalAuth: RequestHandler = (req: Request, _res: Response, next: NextFunction) => {
  const token = bearerToken(req)
  if (!token) {
    next()
    return
  }
  loadUser(token)
    .then((user) => {
      req.currentUser = user
      next()
    })
    .catch(() => next()) // an invalid token is treated as "not signed in", not as an error
}

export function requireRole(...roles: UserRole[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const user = req.currentUser
    if (!user) {
      next(ApiError.unauthorized('Please sign in to continue.'))
      return
    }
    const held = (user.roles ?? []) as UserRole[]
    if (!roles.some((role) => held.includes(role))) {
      next(ApiError.forbidden(`This area is restricted to ${roles.join(' or ')} accounts.`))
      return
    }
    if (user.revoked) {
      next(ApiError.forbidden('This account has been suspended. Contact the Election Commission.'))
      return
    }
    next()
  }
}

/** The signed-in user, for handlers that run behind `requireAuth`. */
export function currentUser(req: Request): AuthenticatedUser {
  if (!req.currentUser) throw ApiError.unauthorized('Please sign in to continue.')
  return req.currentUser
}
