module.exports = {
  dist: {
    src: [
      'node_modules/grunt-microlib/assets/loader.js',
      'tmp/tests/*test.js',
      'tmp/<%= pkg.name %>/**/*.amd.js',
      'tmp/<%= pkg.name %>.amd.js'
    ],
    dest: 'tmp/tests.js'
  }
};
