module.exports = function(grunt) {
  var config = require('load-grunt-config')(grunt, {
    configPath: 'tasks/options',
    init: false
  });

  grunt.loadTasks('tasks');

  this.registerTask('default', ['build']);

  // Run client-side tests on the command line.
  this.registerTask('test', 'Runs tests through the command line using PhantomJS', [
    'build', 'qunit'
  ]);

  // Run a server. This is ideal for running the QUnit tests in the browser.
  this.registerTask('server', ['broccoli:dist:serve']);

  // Build a new version of the library
  this.registerTask('build', 'Builds a distributable version of <%= cfg.name %>',
                    ['clean', 'jshint', 'broccoli:dist:build']);

  config.env = process.env;
  config.pkg = grunt.file.readJSON('package.json');

  // Load custom tasks from NPM
  grunt.initConfig(config);
};
