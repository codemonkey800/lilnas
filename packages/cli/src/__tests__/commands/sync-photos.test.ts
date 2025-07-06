import { syncPhotos } from '../../commands/sync-photos'
import { runInteractive } from '../../utils'

// Mock dependencies
jest.mock('../../utils')

const mockRunInteractive = runInteractive as jest.MockedFunction<typeof runInteractive>

describe('sync-photos command', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockRunInteractive.mockReset()
  })

  describe('successful execution', () => {
    it('should run icloudpd docker container with required options', async () => {
      const options = {
        email: 'user@example.com',
        dest: '/home/user/photos'
      }

      await syncPhotos(options)

      expect(mockRunInteractive).toHaveBeenCalledWith(
        `docker run \\
      -it --rm \\
      --name icloudpd \\
      -v /home/user/photos:/icloud \\
      -e TZ=America/Los_Angeles \\
      icloudpd/icloudpd \\
      icloudpd --directory /icloud --username user@example.com`
      )
    })

    it('should handle absolute destination paths', async () => {
      const options = {
        email: 'test@icloud.com',
        dest: '/mnt/storage/icloud-photos'
      }

      await syncPhotos(options)

      expect(mockRunInteractive).toHaveBeenCalledWith(
        expect.stringContaining('-v /mnt/storage/icloud-photos:/icloud')
      )
    })

    it('should handle relative destination paths', async () => {
      const options = {
        email: 'user@me.com',
        dest: './photos'
      }

      await syncPhotos(options)

      expect(mockRunInteractive).toHaveBeenCalledWith(
        expect.stringContaining('-v ./photos:/icloud')
      )
    })

    it('should handle destination paths with spaces', async () => {
      const options = {
        email: 'user@icloud.com',
        dest: '/home/user/My Photos'
      }

      await syncPhotos(options)

      expect(mockRunInteractive).toHaveBeenCalledWith(
        expect.stringContaining('-v /home/user/My Photos:/icloud')
      )
    })

    it('should handle different email formats', async () => {
      const testCases = [
        'user@icloud.com',
        'test.user@me.com',
        'user+tag@mac.com',
        'user123@icloud.com'
      ]

      for (const email of testCases) {
        jest.clearAllMocks()
        await syncPhotos({ email, dest: '/photos' })

        expect(mockRunInteractive).toHaveBeenCalledWith(
          expect.stringContaining(`--username ${email}`)
        )
      }
    })
  })

  describe('input validation', () => {
    it('should require email parameter', async () => {
      const options = { dest: '/photos' }

      await expect(syncPhotos(options)).rejects.toThrow()
      expect(mockRunInteractive).not.toHaveBeenCalled()
    })

    it('should require dest parameter', async () => {
      const options = { email: 'user@example.com' }

      await expect(syncPhotos(options)).rejects.toThrow()
      expect(mockRunInteractive).not.toHaveBeenCalled()
    })

    it('should require both email and dest parameters', async () => {
      const options = {}

      await expect(syncPhotos(options)).rejects.toThrow()
      expect(mockRunInteractive).not.toHaveBeenCalled()
    })

    it('should validate email is a string', async () => {
      const options = { email: 123, dest: '/photos' }

      await expect(syncPhotos(options)).rejects.toThrow()
      expect(mockRunInteractive).not.toHaveBeenCalled()
    })

    it('should validate dest is a string', async () => {
      const options = { email: 'user@example.com', dest: 123 }

      await expect(syncPhotos(options)).rejects.toThrow()
      expect(mockRunInteractive).not.toHaveBeenCalled()
    })

    it('should reject empty email string', async () => {
      const options = { email: '', dest: '/photos' }

      await expect(syncPhotos(options)).rejects.toThrow()
      expect(mockRunInteractive).not.toHaveBeenCalled()
    })

    it('should reject empty dest string', async () => {
      const options = { email: 'user@example.com', dest: '' }

      await expect(syncPhotos(options)).rejects.toThrow()
      expect(mockRunInteractive).not.toHaveBeenCalled()
    })

    it('should handle null options', async () => {
      await expect(syncPhotos(null)).rejects.toThrow()
      expect(mockRunInteractive).not.toHaveBeenCalled()
    })

    it('should handle undefined options', async () => {
      await expect(syncPhotos(undefined)).rejects.toThrow()
      expect(mockRunInteractive).not.toHaveBeenCalled()
    })
  })

  describe('docker command structure', () => {
    it('should use correct docker image', async () => {
      await syncPhotos({ email: 'user@example.com', dest: '/photos' })

      expect(mockRunInteractive).toHaveBeenCalledWith(
        expect.stringContaining('icloudpd/icloudpd')
      )
    })

    it('should use interactive and remove flags', async () => {
      await syncPhotos({ email: 'user@example.com', dest: '/photos' })

      expect(mockRunInteractive).toHaveBeenCalledWith(
        expect.stringContaining('-it --rm')
      )
    })

    it('should set container name', async () => {
      await syncPhotos({ email: 'user@example.com', dest: '/photos' })

      expect(mockRunInteractive).toHaveBeenCalledWith(
        expect.stringContaining('--name icloudpd')
      )
    })

    it('should mount volume correctly', async () => {
      await syncPhotos({ email: 'user@example.com', dest: '/photos' })

      expect(mockRunInteractive).toHaveBeenCalledWith(
        expect.stringContaining('-v /photos:/icloud')
      )
    })

    it('should set timezone environment variable', async () => {
      await syncPhotos({ email: 'user@example.com', dest: '/photos' })

      expect(mockRunInteractive).toHaveBeenCalledWith(
        expect.stringContaining('-e TZ=America/Los_Angeles')
      )
    })

    it('should use correct icloudpd command', async () => {
      await syncPhotos({ email: 'user@example.com', dest: '/photos' })

      expect(mockRunInteractive).toHaveBeenCalledWith(
        expect.stringContaining('icloudpd --directory /icloud --username user@example.com')
      )
    })
  })

  describe('docker execution', () => {
    it('should pass through docker execution errors', async () => {
      mockRunInteractive.mockImplementation(() => {
        throw new Error('Docker daemon not running')
      })

      await expect(syncPhotos({ email: 'user@example.com', dest: '/photos' })).rejects.toThrow('Docker daemon not running')
    })

    it('should handle docker image not found', async () => {
      mockRunInteractive.mockImplementation(() => {
        throw new Error('Unable to find image: icloudpd/icloudpd')
      })

      await expect(syncPhotos({ email: 'user@example.com', dest: '/photos' })).rejects.toThrow('Unable to find image: icloudpd/icloudpd')
    })

    it('should handle volume mount errors', async () => {
      mockRunInteractive.mockImplementation(() => {
        throw new Error('No such file or directory')
      })

      await expect(syncPhotos({ email: 'user@example.com', dest: '/nonexistent' })).rejects.toThrow('No such file or directory')
    })

    it('should handle permission errors', async () => {
      mockRunInteractive.mockImplementation(() => {
        throw new Error('Permission denied')
      })

      await expect(syncPhotos({ email: 'user@example.com', dest: '/restricted' })).rejects.toThrow('Permission denied')
    })

    it('should handle authentication failures', async () => {
      mockRunInteractive.mockImplementation(() => {
        throw new Error('Authentication failed')
      })

      await expect(syncPhotos({ email: 'invalid@example.com', dest: '/photos' })).rejects.toThrow('Authentication failed')
    })
  })

  describe('edge cases', () => {
    it('should handle email with special characters', async () => {
      const options = {
        email: 'user+tag@sub-domain.example-site.com',
        dest: '/photos'
      }

      await syncPhotos(options)

      expect(mockRunInteractive).toHaveBeenCalledWith(
        expect.stringContaining('--username user+tag@sub-domain.example-site.com')
      )
    })

    it('should handle destination paths with special characters', async () => {
      const options = {
        email: 'user@example.com',
        dest: '/home/user/Photos & Videos/iCloud'
      }

      await syncPhotos(options)

      expect(mockRunInteractive).toHaveBeenCalledWith(
        expect.stringContaining('-v /home/user/Photos & Videos/iCloud:/icloud')
      )
    })

    it('should handle very long paths', async () => {
      const longPath = '/very/long/path/that/goes/deep/into/filesystem/structure/with/many/nested/directories/photos'
      const options = {
        email: 'user@example.com',
        dest: longPath
      }

      await syncPhotos(options)

      expect(mockRunInteractive).toHaveBeenCalledWith(
        expect.stringContaining(`-v ${longPath}:/icloud`)
      )
    })

    it('should handle paths with unicode characters', async () => {
      const options = {
        email: 'user@example.com',
        dest: '/home/user/фотографии'
      }

      await syncPhotos(options)

      expect(mockRunInteractive).toHaveBeenCalledWith(
        expect.stringContaining('-v /home/user/фотографии:/icloud')
      )
    })

    it('should handle emails with unicode domains', async () => {
      const options = {
        email: 'user@éxample.com',
        dest: '/photos'
      }

      await syncPhotos(options)

      expect(mockRunInteractive).toHaveBeenCalledWith(
        expect.stringContaining('--username user@éxample.com')
      )
    })
  })

  describe('integration scenarios', () => {
    it('should handle typical home directory sync', async () => {
      const options = {
        email: 'john.doe@icloud.com',
        dest: '/home/john/Pictures/iCloud'
      }

      await syncPhotos(options)

      expect(mockRunInteractive).toHaveBeenCalledWith(
        expect.stringContaining('-v /home/john/Pictures/iCloud:/icloud')
      )
      expect(mockRunInteractive).toHaveBeenCalledWith(
        expect.stringContaining('--username john.doe@icloud.com')
      )
    })

    it('should handle network attached storage sync', async () => {
      const options = {
        email: 'admin@company.com',
        dest: '/mnt/nas/shared/photos'
      }

      await syncPhotos(options)

      expect(mockRunInteractive).toHaveBeenCalledWith(
        expect.stringContaining('-v /mnt/nas/shared/photos:/icloud')
      )
    })

    it('should handle backup location sync', async () => {
      const options = {
        email: 'backup@family.com',
        dest: '/backup/family-photos/icloud-sync'
      }

      await syncPhotos(options)

      expect(mockRunInteractive).toHaveBeenCalledWith(
        expect.stringContaining('-v /backup/family-photos/icloud-sync:/icloud')
      )
    })
  })

  describe('command formatting', () => {
    it('should format multiline command correctly', async () => {
      await syncPhotos({ email: 'user@example.com', dest: '/photos' })

      const expectedCommand = `docker run \\
      -it --rm \\
      --name icloudpd \\
      -v /photos:/icloud \\
      -e TZ=America/Los_Angeles \\
      icloudpd/icloudpd \\
      icloudpd --directory /icloud --username user@example.com`

      expect(mockRunInteractive).toHaveBeenCalledWith(expectedCommand)
    })

    it('should maintain consistent spacing and line breaks', async () => {
      await syncPhotos({ email: 'test@test.com', dest: '/test' })

      const calledCommand = mockRunInteractive.mock.calls[0][0]
      
      // Check for consistent line breaks
      expect(calledCommand).toMatch(/\\\n\s+/g)
      
      // Check for proper structure
      expect(calledCommand).toContain('docker run \\')
      expect(calledCommand).toContain('-it --rm \\')
      expect(calledCommand).toContain('--name icloudpd \\')
    })
  })

  describe('additional parameters', () => {
    it('should ignore additional unknown parameters', async () => {
      const options = {
        email: 'user@example.com',
        dest: '/photos',
        unknownParam: 'should-be-ignored'
      }

      await syncPhotos(options)

      expect(mockRunInteractive).toHaveBeenCalledWith(
        expect.stringContaining('--username user@example.com')
      )
      expect(mockRunInteractive).toHaveBeenCalledWith(
        expect.not.stringContaining('unknownParam')
      )
    })

    it('should not include additional parameters in command', async () => {
      const options = {
        email: 'user@example.com',
        dest: '/photos',
        extra: 'parameter',
        another: 'value'
      }

      await syncPhotos(options)

      const calledCommand = mockRunInteractive.mock.calls[0][0]
      expect(calledCommand).not.toContain('extra')
      expect(calledCommand).not.toContain('parameter')
      expect(calledCommand).not.toContain('another')
      expect(calledCommand).not.toContain('value')
    })
  })
})