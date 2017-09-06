module.exports = {
  root: true,
  extends: "eslint:recommended",
  parserOptions: {
    ecmaVersion: 2017,
    sourceType: 'module',
  },
  env: {
    browser: true,
    node: false,
  },
};
