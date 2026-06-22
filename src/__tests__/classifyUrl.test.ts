import { classifyURL, effectiveURLs } from '../utils/classifyUrl';

describe('classifyURL', () => {
  describe('LAN addresses', () => {
    it('classifies 10.x.x.x as lan', () => {
      expect(classifyURL('http://10.0.0.1:5033/')).toBe('lan');
      expect(classifyURL('https://10.255.255.255:443/')).toBe('lan');
    });

    it('classifies 172.16-31.x.x as lan', () => {
      expect(classifyURL('http://172.16.0.1:5033/')).toBe('lan');
      expect(classifyURL('http://172.31.255.255:5033/')).toBe('lan');
    });

    it('classifies 192.168.x.x as lan', () => {
      expect(classifyURL('http://192.168.1.100:5033/')).toBe('lan');
      expect(classifyURL('http://192.168.0.1/')).toBe('lan');
    });

    it('classifies 169.254.x.x (link-local) as lan', () => {
      expect(classifyURL('http://169.254.1.1:5033/')).toBe('lan');
    });

    it('classifies .local hostnames as lan', () => {
      expect(classifyURL('http://mynas.local:5033/')).toBe('lan');
      expect(classifyURL('https://clip.home.local/')).toBe('lan');
    });
  });

  describe('Tailscale addresses', () => {
    it('classifies 100.64-127.x.x as tailscale', () => {
      expect(classifyURL('http://100.64.0.1:5033/')).toBe('tailscale');
      expect(classifyURL('http://100.127.255.255:5033/')).toBe('tailscale');
      expect(classifyURL('http://100.100.100.100:5033/')).toBe('tailscale');
    });

    it('classifies .ts.net hostnames as tailscale', () => {
      expect(classifyURL('http://myhost.ts.net:5033/')).toBe('tailscale');
      expect(classifyURL('https://clip.tail12345.ts.net/')).toBe('tailscale');
    });
  });

  describe('WAN addresses', () => {
    it('classifies public IPs as wan', () => {
      expect(classifyURL('http://1.2.3.4:5033/')).toBe('wan');
      expect(classifyURL('http://203.0.113.1:5033/')).toBe('wan');
    });

    it('classifies public hostnames as wan', () => {
      expect(classifyURL('https://clip.example.com/')).toBe('wan');
      expect(classifyURL('https://sync.myserver.net:5033/')).toBe('wan');
    });

    it('classifies 172.32+ as wan (not private range)', () => {
      expect(classifyURL('http://172.32.0.1:5033/')).toBe('wan');
    });

    it('classifies 100.63 and 100.128+ as wan (not CGNAT)', () => {
      expect(classifyURL('http://100.63.0.1:5033/')).toBe('wan');
      expect(classifyURL('http://100.128.0.1:5033/')).toBe('wan');
    });
  });

  describe('edge cases', () => {
    it('returns wan for invalid URLs', () => {
      expect(classifyURL('not-a-url')).toBe('wan');
      expect(classifyURL('')).toBe('wan');
    });

    it('handles URLs with extra whitespace', () => {
      expect(classifyURL('  http://192.168.1.1:5033/  ')).toBe('lan');
    });

    it('is case-insensitive for hostnames', () => {
      expect(classifyURL('http://MyHost.TS.NET:5033/')).toBe('tailscale');
      expect(classifyURL('http://server.LOCAL/')).toBe('lan');
    });
  });
});

describe('effectiveURLs', () => {
  it('returns urls array when non-empty', () => {
    expect(effectiveURLs(['http://a', 'http://b'], 'http://a')).toEqual(['http://a', 'http://b']);
  });

  it('falls back to [url] when urls is undefined', () => {
    expect(effectiveURLs(undefined, 'http://a')).toEqual(['http://a']);
  });

  it('falls back to [url] when urls is empty', () => {
    expect(effectiveURLs([], 'http://a')).toEqual(['http://a']);
  });
});
