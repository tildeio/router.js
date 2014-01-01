module.exports = function(grunt) {
  var config = require('load-grunt-config')(grunt, {
    configPath: 'tasks/options',
    init: false
  });

  grunt.loadTasks('tasks');

  this.registerTask('default', ['build']);

  // Run client-side tests on the command line.
  this.registerTask('test', 'Runs tests through the command line using PhantomJS', [
    'build', 'tests', 'qunit'
  ]);

  // Run a server. This is ideal for running the QUnit tests in the browser.
  this.registerTask('server', ['build', 'tests', 'connect', 'watch:server']);


  // Build test files
  this.registerTask('tests', 'Builds the test package', ['concat:deps',
                    'transpile:testsAmd', 'transpile:testsCommonjs', 'buildTests:dist']);

  // Build a new version of the library
  this.registerTask('build', 'Builds a distributable version of <%= cfg.name %>',
                    ['clean', 'transpile:amd', 'transpile:commonjs', 'concat:amdNoVersion',
                      'concat:browser', 'browser:distNoVersion', 'jshint', 'uglify:browserNoVersion']);

  config.env = process.env;
  config.pkg = grunt.file.readJSON('package.json');
  // Load custom tasks from NPM
  grunt.loadNpmTasks('grunt-browserify');
  // Merge config into emberConfig, overwriting existing settings
  grunt.initConfig(config);
};
