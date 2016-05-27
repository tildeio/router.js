var concat = require('broccoli-concat');
var ES6Modules = require('broccoli-es6modules');
var mergeTrees = require('broccoli-merge-trees');
var moveFile = require('broccoli-file-mover');
var pickFiles = require('broccoli-static-compiler');
var uglifyJavaScript = require('broccoli-uglify-js');
var wrapFiles = require('broccoli-wrap');
var concatFilenames = require('broccoli-concat-filenames');
var jshint = require('broccoli-jshint');
var recast = require('broccoli-es3-safe-recast');

var trees = [
  createAMDTree(),
  createUMDTree(),

  // TODO only add tests when Broccoli environment is development ...
  makeTests()
];

trees = trees.map(recast);

module.exports = mergeTrees(trees);

function makeTests() {
  // Concatenate all dependencies into tests/deps.js
  var deps = concat('vendor/deps', {
    inputFiles: ['*.js'],
    outputFile: '/tests/deps.js'
  });

  var jshintLib = jshint('lib');
  var jshintTests = jshint('test/tests');

  // Create AMD module 'tests' containing all tests in 'test/tests' and concatenate them into tests/tests.js
  var tests = new ES6Modules('test', {
    inputFiles: ["**/*_test.js"],
    esperantoOptions: {
      absolutePaths: true,
      strict: true
    }
  });

  tests = mergeTrees([jshintTests, jshintLib, tests]);

  tests = concat(tests, {
    inputFiles: ['**/*.js'],
    outputFile: '/tests/tests.js'
  });

  // Create /tests/tests_main.js which requires all tests (all test/tests/**/*_test.js files)
  var testsMain = concatFilenames("test", {
    inputFiles: ["**/*_test.js"],
    outputFile: "/tests/tests_main.js",
    transform: function(fileName) {
      return "require('" + fileName  + "');";
    }
  });

  // Copy files needed for QUnit
  var qunit = pickFiles('test', {
    files:  ['index.html', 'vendor/*'],
    srcDir: '/',
    destDir: '/tests'
  });

  // Copy vendor/loader.js to test/loader.js
  var loader = concat('vendor', {
    inputFiles: ['loader.js'],
    outputFile: '/tests/loader.js'
  });

  // Merge all test related stuff into tests tree
  return mergeTrees([deps, qunit, loader, tests, testsMain]);
}

function createAMDTree() {
  var amd = new ES6Modules('./lib', {
    esperantoOptions: {
      absolutePaths: true,
      strict: true
    }
  });

  amd = concat(amd, {
    inputFiles: ['**/*.js'],
    outputFile: '/router.amd.js'
  });

  return amd;
}

function createUMDTree() {
  var umd = new ES6Modules('./lib', {
    format: 'umd',
    bundleOptions: {
      entry: 'router.js',
      name: 'router'
    },
    esperantoOptions: {
      strict: true
    }
  });

  var minified = pickFiles(umd, {
    srcDir: '/',
    destDir: '/'
  });
  minified = moveFile(minified, {
    srcFile: '/router.js',
    destFile: '/router.min.js'
  });
  minified = uglifyJavaScript(minified, {
    mangle: true
  });

  return mergeTrees([umd, minified]);
}
