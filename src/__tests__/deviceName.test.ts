import { resolveDefaultDeviceName } from '@/utils/deviceName';

describe('default device name', () => {
  it('prefers a user-assigned name and falls back to the model or localized label', () => {
    expect(resolveDefaultDeviceName("Mark's iPhone", 'iPhone 17 Pro', 'This device')).toBe(
      "Mark's iPhone"
    );
    expect(resolveDefaultDeviceName('iPhone', 'iPhone 17 Pro', 'This device')).toBe(
      'iPhone 17 Pro'
    );
    expect(resolveDefaultDeviceName(null, ' Pixel 10 ', 'This device')).toBe('Pixel 10');
    expect(resolveDefaultDeviceName(null, null, ' This device ')).toBe('This device');
  });
});
