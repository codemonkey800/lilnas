import { JwtService } from '@nestjs/jwt'

import { AuthService } from 'src/auth/auth.service'
import { db } from 'src/db'

const ADMIN_EMAIL = 'admin@example.com'

// Helper to configure the Drizzle mock chain (update/set/where/returning)
function configureDbUpdate(returning: unknown[]) {
  const mockReturning = jest.fn().mockResolvedValue(returning)
  const mockWhere = jest.fn().mockReturnValue({ returning: mockReturning })
  const mockSet = jest.fn().mockReturnValue({ where: mockWhere })
  ;(db.update as jest.Mock).mockReturnValue({ set: mockSet })
  return { mockReturning, mockWhere, mockSet }
}

// Helper to configure insert returning
function configureDbInsert(returning: unknown[]) {
  const mockReturning = jest.fn().mockResolvedValue(returning)
  const mockOnConflict = jest.fn().mockResolvedValue(undefined)
  const mockValues = jest.fn().mockReturnValue({
    returning: mockReturning,
    onConflictDoNothing: mockOnConflict,
    onConflictDoUpdate: mockOnConflict,
  })
  ;(db.insert as jest.Mock).mockReturnValue({ values: mockValues })
  return { mockValues, mockReturning, mockOnConflict }
}

describe('AuthService', () => {
  let service: AuthService
  let mockJwt: jest.Mocked<JwtService>

  beforeEach(() => {
    mockJwt = {
      signAsync: jest.fn().mockResolvedValue('jwt-token'),
    } as unknown as jest.Mocked<JwtService>
    service = new AuthService(mockJwt)
    process.env.ADMIN_EMAIL = ADMIN_EMAIL
  })

  afterEach(() => {
    delete process.env.ADMIN_EMAIL
  })

  // ---------------------------------------------------------------------------
  // findOrCreateUser
  // ---------------------------------------------------------------------------

  describe('findOrCreateUser', () => {
    const baseProfile = {
      id: 'google-123',
      emails: [{ value: 'test@example.com' }],
      displayName: 'Test User',
      photos: [{ value: 'https://example.com/photo.jpg' }],
    }

    it.each([
      { emails: [], label: 'empty array' },
      { emails: undefined, label: 'undefined' },
    ])('throws Error when profile emails is $label', async ({ emails }) => {
      const profile = { ...baseProfile, emails }
      await expect(service.findOrCreateUser(profile as never)).rejects.toThrow(
        'No email in Google OAuth profile',
      )
    })

    describe('existing linked account', () => {
      it('updates user name and image then returns updated user', async () => {
        const existingAccount = { userId: 'user-1', provider: 'google' }
        const updatedUser = {
          id: 'user-1',
          email: 'test@example.com',
          name: 'Test User',
          status: 'approved',
        }
        ;(db.query.accounts.findFirst as jest.Mock).mockResolvedValue(
          existingAccount,
        )
        configureDbUpdate([updatedUser])

        const result = await service.findOrCreateUser(baseProfile as never)

        expect(result).toEqual(updatedUser)
      })

      it('does not create a new user when account already linked', async () => {
        const existingAccount = { userId: 'user-1', provider: 'google' }
        const updatedUser = {
          id: 'user-1',
          email: 'test@example.com',
          name: 'Test User',
          status: 'approved',
        }
        ;(db.query.accounts.findFirst as jest.Mock).mockResolvedValue(
          existingAccount,
        )
        configureDbUpdate([updatedUser])

        const result = await service.findOrCreateUser(baseProfile as never)
        expect(db.insert).not.toHaveBeenCalled()
        expect(result).toEqual(updatedUser)
      })
    })

    describe('no existing linked account', () => {
      beforeEach(() => {
        ;(db.query.accounts.findFirst as jest.Mock).mockResolvedValue(null)
      })

      it('links Google account for existing user found by email', async () => {
        const existingUser = {
          id: 'user-2',
          email: 'test@example.com',
          status: 'pending',
        }
        ;(db.query.users.findFirst as jest.Mock).mockResolvedValue(existingUser)
        configureDbInsert([])

        const result = await service.findOrCreateUser(baseProfile as never)

        expect(result).toEqual(existingUser)
      })

      it('creates new user with pending status for non-admin email', async () => {
        ;(db.query.users.findFirst as jest.Mock).mockResolvedValue(null)
        const newUser = {
          id: 'user-3',
          email: 'test@example.com',
          status: 'pending',
        }
        const insertSpy = configureDbInsert([newUser])

        const result = await service.findOrCreateUser(baseProfile as never)

        const insertedValues = insertSpy.mockValues.mock.calls[0]?.[0]
        expect(insertedValues?.status).toBe('pending')
        expect(result).toEqual(newUser)
      })

      it('creates new user with approved status for admin email', async () => {
        const adminProfile = {
          ...baseProfile,
          emails: [{ value: ADMIN_EMAIL }],
        }
        ;(db.query.users.findFirst as jest.Mock).mockResolvedValue(null)
        const newUser = { id: 'user-4', email: ADMIN_EMAIL, status: 'approved' }
        const insertSpy = configureDbInsert([newUser])

        await service.findOrCreateUser(adminProfile as never)

        const insertedValues = insertSpy.mockValues.mock.calls[0]?.[0]
        expect(insertedValues?.status).toBe('approved')
      })
    })
  })

  // ---------------------------------------------------------------------------
  // findOrCreateAgentUser
  // ---------------------------------------------------------------------------

  describe('findOrCreateAgentUser', () => {
    it('returns existing agent user when found', async () => {
      const existing = {
        id: 'agent-1',
        email: 'agent@yoink.local',
        status: 'approved',
      }
      ;(db.query.users.findFirst as jest.Mock).mockResolvedValue(existing)

      const result = await service.findOrCreateAgentUser()

      expect(db.insert).not.toHaveBeenCalled()
      expect(result).toEqual(existing)
    })

    it('creates agent user with approved status when not found', async () => {
      ;(db.query.users.findFirst as jest.Mock).mockResolvedValue(null)
      const created = {
        id: 'agent-2',
        email: 'agent@yoink.local',
        status: 'approved',
      }
      const insertSpy = configureDbInsert([created])

      const result = await service.findOrCreateAgentUser()

      const insertedValues = insertSpy.mockValues.mock.calls[0]?.[0]
      expect(insertedValues?.email).toBe('agent@yoink.local')
      expect(insertedValues?.status).toBe('approved')
      expect(result).toEqual(created)
    })
  })

  // ---------------------------------------------------------------------------
  // login
  // ---------------------------------------------------------------------------

  describe('login', () => {
    it('signs JWT with sub and email payload', async () => {
      const token = await service.login({
        id: 'user-1',
        email: 'test@example.com',
      })

      expect(mockJwt.signAsync).toHaveBeenCalledWith({
        sub: 'user-1',
        email: 'test@example.com',
      })
      expect(token).toBe('jwt-token')
    })
  })
})
