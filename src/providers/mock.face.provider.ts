/**
 * Mock facial verification.
 *
 * Simulates a match score and a liveness check. It is deterministic in the size and content
 * of the payload so tests can drive both outcomes, and it rejects implausibly small images
 * the way a real provider rejects a blank frame.
 *
 * TO REPLACE IN PRODUCTION: implement `FaceProvider` against a real service, and confirm the
 * provider is contractually bound not to retain the images. Startup refuses to run with this
 * provider when NODE_ENV=production.
 */
import { createHash } from 'node:crypto'
import type { FaceProvider, FaceVerificationInput, FaceVerificationResult } from './types.js'

/** Below this many bytes the payload cannot be a real photograph. */
const MINIMUM_IMAGE_BYTES = 1024

export class MockFaceProvider implements FaceProvider {
  readonly name = 'mock'

  constructor(private readonly defaultScore = 0.96) {}

  verify(input: FaceVerificationInput): Promise<FaceVerificationResult> {
    const { selfieImage } = input

    // An embedding, not the image: this is the only thing that may be persisted.
    const embedding = createHash('sha256').update(selfieImage).digest()

    if (selfieImage.length < MINIMUM_IMAGE_BYTES) {
      return Promise.resolve({ matchScore: 0.2, livenessPassed: false, embedding })
    }

    // A deterministic hook for tests: an image whose bytes contain this marker fails.
    const failsOnPurpose = selfieImage.includes(Buffer.from('FAIL_FACE_MATCH'))
    if (failsOnPurpose) {
      return Promise.resolve({ matchScore: 0.31, livenessPassed: true, embedding })
    }

    return Promise.resolve({ matchScore: this.defaultScore, livenessPassed: true, embedding })
  }
}
