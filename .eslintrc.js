module.exports = {
  root: true,
  extends: ['eslint:recommended', 'prettier'],
  plugins: ['prettier'],
  parserOptions: {
    ecmaVersion: 2017,
    sourceType: 'module',
  },
  env: {
    browser: true,
    node: false,
  },
  rules: {
    'prettier/prettier': ['error', { singleQuote: true, trailingComma: 'es5' }],
  },
};
