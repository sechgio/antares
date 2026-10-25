export default {
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/skills-resolution.test.mjs'],
    testTimeout: 60000,
  },
};
