/**
 * Mock civil registry.
 *
 * The proposal (§6) notes that access to the real national ID database needs permissions
 * this project does not have, so a mock is the expected state. Every record below is
 * obviously synthetic — NO REAL CITIZEN DATA MAY EVER BE ADDED HERE.
 *
 * TO REPLACE IN PRODUCTION: implement `NidProvider` against the real registry, register it
 * in `providers/index.ts`, and set NID_PROVIDER to its name. Startup refuses to run with
 * this provider when NODE_ENV=production.
 *
 * The fixtures match the list the frontend's registration page shows in demo mode.
 */
import { normaliseNid } from '../crypto/commitment.js'
import type { NidLookupResult, NidProvider } from './types.js'

/**
 * Fictional Upazila codes used by the fixtures. Real deployments would use the official
 * codes; nothing in the system assumes they are sequential.
 */
export const DEMO_UPAZILAS = [
  { upazilaId: 101, name: 'Shapla Test Upazila', district: 'Test District' },
  { upazilaId: 202, name: 'Kadam Test Upazila', district: 'Test District' },
] as const

interface Fixture {
  fullName: string
  dateOfBirth: string
  isCitizen: boolean
  address: string
  upazilaId: number
}

const FIXTURES: Record<string, Fixture> = {
  '1990123456789': { fullName: 'Ayesha Rahman', dateOfBirth: '1990-04-12', isCitizen: true, address: '12 Shapla Road, Shapla', upazilaId: 101 },
  '1995077788899': { fullName: 'Tanvir Ahmed', dateOfBirth: '1995-07-07', isCitizen: true, address: '4 Civic Lane, Shapla', upazilaId: 101 },
  '2001045566778': { fullName: 'Sadia Noor', dateOfBirth: '2001-04-05', isCitizen: true, address: '9 River View, Shapla', upazilaId: 101 },
  '1999012233445': { fullName: 'Rakib Hasan', dateOfBirth: '1999-01-22', isCitizen: true, address: '31 Market Street, Shapla', upazilaId: 101 },
  '2010099887766': { fullName: 'Minor Person', dateOfBirth: '2010-09-09', isCitizen: true, address: '2 School Road, Shapla', upazilaId: 101 },
  '1988061122334': { fullName: 'Nusrat Jahan', dateOfBirth: '1988-06-11', isCitizen: true, address: '7 Kadam Bazar, Kadam', upazilaId: 202 },
  '1992033344556': { fullName: 'Imran Chowdhury', dateOfBirth: '1992-03-03', isCitizen: true, address: '18 Ferry Ghat, Kadam', upazilaId: 202 },
  '1985091122445': { fullName: 'Farhana Akter', dateOfBirth: '1985-09-11', isCitizen: true, address: '5 Hill Road, Kadam', upazilaId: 202 },
  '1993051234567': { fullName: 'Tahmina Islam', dateOfBirth: '1993-05-12', isCitizen: true, address: '22 Shapla Bazar, Shapla', upazilaId: 101 },
  '1991070987654': { fullName: 'Jubayer Alam', dateOfBirth: '1991-07-09', isCitizen: true, address: '14 Canal Road, Shapla', upazilaId: 101 },
  '1994081122330': { fullName: 'Mitu Barua', dateOfBirth: '1994-08-11', isCitizen: true, address: '3 Station Road, Shapla', upazilaId: 101 },
  '1996090011223': { fullName: 'Rashed Karim', dateOfBirth: '1996-09-01', isCitizen: true, address: '41 Garden Street, Kadam', upazilaId: 202 },
  '1997060011224': { fullName: 'Shireen Akter', dateOfBirth: '1997-06-01', isCitizen: true, address: '8 Boat Club Road, Kadam', upazilaId: 202 },
}

export class MockNidProvider implements NidProvider {
  readonly name = 'mock'

  lookup(nid: string): Promise<NidLookupResult> {
    let normalised: string
    try {
      normalised = normaliseNid(nid)
    } catch {
      return Promise.resolve({ found: false })
    }
    const record = FIXTURES[normalised]
    return Promise.resolve(record ? { found: true, ...record } : { found: false })
  }
}

/** Exposed for the demo seed script only. */
export const MOCK_NID_FIXTURES = FIXTURES
