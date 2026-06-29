module.exports = {
  preset: 'react-native',
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|js-sha256)',
  ],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^native-util$': '<rootDir>/modules/native-util/src',
    '^app-group-store$': '<rootDir>/modules/app-group-store/src',
    '^uc-core$': '<rootDir>/modules/uc-core/src',
    '^signalr-client$': '<rootDir>/modules/signalr-client/src',
    '^native-timer$': '<rootDir>/modules/native-timer/src',
    '^foreground-service$': '<rootDir>/modules/foreground-service/src',
    '^shortcut$': '<rootDir>/modules/shortcut/src',
    '^qr-scanner$': '<rootDir>/modules/qr-scanner/src',
  },
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  testMatch: ['**/__tests__/**/*.[jt]s?(x)', '**/?(*.)+(spec|test).[tj]s?(x)'],
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/**/*.d.ts', '!src/**/index.ts'],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
};
