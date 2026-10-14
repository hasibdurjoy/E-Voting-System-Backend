/** Identity provider interfaces. Swapping a mock for a real service is an env change. */

export interface NidLookupResult {
  found: boolean
  fullName?: string
  /** ISO date. */
  dateOfBirth?: string
  isCitizen?: boolean
  /** Registered address, as the civil registry holds it. */
  address?: string
  /**
   * The Upazila the registry's address falls in. This is what a validator approves and
   * what becomes the voter's on-chain eligibility tag — the voter does not choose it.
   */
  upazilaId?: number
}

export interface NidProvider {
  readonly name: string
  lookup(nid: string): Promise<NidLookupResult>
}

export interface FaceVerificationInput {
  selfieImage: Buffer
  referencePhoto?: Buffer
  embedding?: Buffer
}

export interface FaceVerificationResult {
  matchScore: number
  livenessPassed: boolean
  /** Store this. Never store the image it came from. */
  embedding: Buffer
}

export interface FaceProvider {
  readonly name: string
  verify(input: FaceVerificationInput): Promise<FaceVerificationResult>
}
