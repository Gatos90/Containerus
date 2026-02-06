import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClipboardService } from './clipboard.service';

describe('ClipboardService', () => {
  let service: ClipboardService;
  let writeTextMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    service = new ClipboardService();
    writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextMock },
      writable: true,
      configurable: true,
    });
  });

  describe('copy', () => {
    it('should copy text to clipboard', async () => {
      const result = await service.copy('hello');
      expect(writeTextMock).toHaveBeenCalledWith('hello');
      expect(result).toBe(true);
    });

    it('should return false on clipboard error', async () => {
      writeTextMock.mockRejectedValue(new Error('denied'));
      const result = await service.copy('hello');
      expect(result).toBe(false);
    });
  });

  describe('copyMultiple', () => {
    it('should format and copy key-value pairs', async () => {
      await service.copyMultiple([
        { label: 'Name', value: 'web' },
        { label: 'Image', value: 'nginx' },
      ]);
      expect(writeTextMock).toHaveBeenCalledWith('Name: web\nImage: nginx');
    });
  });

  describe('copyEnvVars', () => {
    it('should format environment variables', async () => {
      await service.copyEnvVars({ PORT: '8080', HOST: '0.0.0.0' });
      expect(writeTextMock).toHaveBeenCalledWith('PORT=8080\nHOST=0.0.0.0');
    });

    it('should handle empty env vars', async () => {
      await service.copyEnvVars({});
      expect(writeTextMock).toHaveBeenCalledWith('');
    });
  });

  describe('copyPorts', () => {
    it('should format port mappings', async () => {
      await service.copyPorts([
        { hostIp: '0.0.0.0', hostPort: 8080, containerPort: 80, protocol: 'tcp' },
        { hostIp: '0.0.0.0', hostPort: 443, containerPort: 443, protocol: 'tcp' },
      ]);
      expect(writeTextMock).toHaveBeenCalledWith('8080:80/tcp\n443:443/tcp');
    });
  });

  describe('copyValue', () => {
    it('should copy string values', async () => {
      await service.copyValue('test');
      expect(writeTextMock).toHaveBeenCalledWith('test');
    });

    it('should convert numbers to strings', async () => {
      await service.copyValue(42);
      expect(writeTextMock).toHaveBeenCalledWith('42');
    });
  });
});
