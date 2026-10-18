import { env, isProduction } from '../config/env.js'
import { logger } from '../utils/logger.js'
import { MockFaceProvider } from './mock.face.provider.js'
import { MockNidProvider } from './mock.nid.provider.js'
import type { FaceProvider, NidProvider } from './types.js'

function resolveNidProvider(): NidProvider {
  switch (env.NID_PROVIDER) {
    case 'mock':
      if (isProduction) {
        if (!env.ALLOW_MOCK_PROVIDERS) throw new Error('NID_PROVIDER=mock is refused in production')
        logger.warn('Running production on the MOCK NID provider (ALLOW_MOCK_PROVIDERS=true): demo use only')
      }
      return new MockNidProvider()
    default:
      throw new Error(`Unknown NID_PROVIDER "${env.NID_PROVIDER}" — register the adapter in providers/index.ts`)
  }
}

function resolveFaceProvider(): FaceProvider {
  switch (env.FACE_PROVIDER) {
    case 'mock':
      if (isProduction) {
        if (!env.ALLOW_MOCK_PROVIDERS) throw new Error('FACE_PROVIDER=mock is refused in production')
        logger.warn('Running production on the MOCK face provider (ALLOW_MOCK_PROVIDERS=true): demo use only')
      }
      return new MockFaceProvider()
    default:
      throw new Error(`Unknown FACE_PROVIDER "${env.FACE_PROVIDER}" — register the adapter in providers/index.ts`)
  }
}

export const nidProvider: NidProvider = resolveNidProvider()
export const faceProvider: FaceProvider = resolveFaceProvider()

export type { FaceProvider, NidProvider } from './types.js'
