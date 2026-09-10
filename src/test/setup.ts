import '@testing-library/jest-dom/vitest';

// Mock Capacitor Preferences (used by Settings, Theme, Location contexts)
vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: vi.fn().mockResolvedValue({ value: null }),
    set: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock Capacitor Geolocation
vi.mock('@capacitor/geolocation', () => ({
  Geolocation: {
    getCurrentPosition: vi.fn().mockResolvedValue({
      coords: { latitude: 43.6532, longitude: -79.3832 },
    }),
    checkPermissions: vi.fn().mockResolvedValue({ location: 'granted' }),
    requestPermissions: vi.fn().mockResolvedValue({ location: 'granted' }),
  },
}));

// Mock Capacitor StatusBar
vi.mock('@capacitor/status-bar', () => ({
  StatusBar: {
    setStyle: vi.fn().mockResolvedValue(undefined),
    setBackgroundColor: vi.fn().mockResolvedValue(undefined),
    setOverlaysWebView: vi.fn().mockResolvedValue(undefined),
  },
  Style: { Dark: 'DARK', Light: 'LIGHT' },
}));

// Mock Capacitor App
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: vi.fn().mockResolvedValue({ remove: vi.fn() }),
    minimizeApp: vi.fn(),
  },
}));

// Mock Capacitor LocalNotifications
vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: {
    schedule: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn().mockResolvedValue(undefined),
    getPending: vi.fn().mockResolvedValue({ notifications: [] }),
    checkPermissions: vi.fn().mockResolvedValue({ display: 'granted' }),
    requestPermissions: vi.fn().mockResolvedValue({ display: 'granted' }),
    addListener: vi.fn().mockResolvedValue({ remove: vi.fn() }),
    createChannel: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock Capacitor Haptics
vi.mock('@capacitor/haptics', () => ({
  Haptics: {
    impact: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock Capacitor Motion
vi.mock('@capacitor/motion', () => ({
  Motion: {
    addListener: vi.fn().mockResolvedValue({ remove: vi.fn() }),
  },
}));

// Mock Capacitor Filesystem
vi.mock('@capacitor/filesystem', () => ({
  Filesystem: {
    readFile: vi.fn().mockResolvedValue({ data: '' }),
    writeFile: vi.fn().mockResolvedValue(undefined),
    deleteFile: vi.fn().mockResolvedValue(undefined),
    stat: vi.fn().mockRejectedValue(new Error('not found')),
    mkdir: vi.fn().mockResolvedValue(undefined),
  },
  Directory: { Data: 'DATA' },
  Encoding: { UTF8: 'utf8' },
}));

// Mock prayer tracking service. The pure day-key helpers stay real — stubbing
// getTodayKey would silently make any assertion about "Today" meaningless —
// while everything that reaches Preferences is stubbed out.
vi.mock('../services/prayerTrackingService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/prayerTrackingService')>();
  return {
    getTodayKey: actual.getTodayKey,
    getDateKey: actual.getDateKey,
    loadTrackingData: vi.fn().mockResolvedValue({ records: [] }),
    trackPrayer: vi.fn().mockResolvedValue(undefined),
    getPrayerStatus: vi.fn().mockResolvedValue('untracked'),
    getTodayStatuses: vi.fn().mockResolvedValue({}),
    resetTrackingCache: vi.fn(),
    getDailyRecord: vi.fn().mockResolvedValue({ date: actual.getTodayKey(), prayers: {} }),
    getRecentRecords: vi.fn().mockResolvedValue([]),
    getStats: vi.fn().mockResolvedValue({ totalTracked: 0, onTime: 0, missed: 0, percentage: 0 }),
  };
});
