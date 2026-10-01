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

const FIXTURES: Record<string, { fullName: string; dateOfBirth: string; isCitizen: boolean }> = {
  '1990123456789': { fullName: 'Ayesha Rahman', dateOfBirth: '1990-04-12', isCitizen: true },
  '1995077788899': { fullName: 'Tanvir Ahmed', dateOfBirth: '1995-07-07', isCitizen: true },
  '2001045566778': { fullName: 'Sadia Noor', dateOfBirth: '2001-04-05', isCitizen: true },
  '1999012233445': { fullName: 'Rakib Hasan', dateOfBirth: '1999-01-22', isCitizen: true },
  '2010099887766': { fullName: 'Minor Person', dateOfBirth: '2010-09-09', isCitizen: true },
  '1988061122334': { fullName: 'Nusrat Jahan', dateOfBirth: '1988-06-11', isCitizen: true },
  '1992033344556': { fullName: 'Imran Chowdhury', dateOfBirth: '1992-03-03', isCitizen: true },
  '1985091122445': { fullName: 'Farhana Akter', dateOfBirth: '1985-09-11', isCitizen: true },
  '1993051234567': { fullName: 'Tahmina Islam', dateOfBirth: '1993-05-12', isCitizen: true },
  '1991070987654': { fullName: 'Jubayer Alam', dateOfBirth: '1991-07-09', isCitizen: true },
  '1994081122330': { fullName: 'Mitu Barua', dateOfBirth: '1994-08-11', isCitizen: true },
  '1996090011223': { fullName: 'Rashed Karim', dateOfBirth: '1996-09-01', isCitizen: true },
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
