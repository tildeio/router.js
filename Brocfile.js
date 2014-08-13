var concat = require('broccoli-concat');
var filterES6Modules = require('broccoli-es6-module-filter');
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
  createCommonJSTree(),
  createStandaloneTree(),

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
  var tests = filterES6Modules('test/tests', {
    moduleType: 'amd',
    packageName: 'tests',
    anonymous: false
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
  // dist/router.amd.js: all AMD compiled modules concatenated into 1 file
  var amd = filterES6Modules('lib', {
    moduleType: 'amd',
    anonymous: false
  });

  amd = concat(amd, {
    // to be consinstent with old behavior, we include 'router.js' at the end
    inputFiles: ['router/**/*.js', 'router.js'],
    outputFile: '/router.amd.js'
  });

  return amd;
}



function createCommonJSTree() {
  // CommonJS version of router.js; will be located in 'dist/commonjs'
  var commonJs = pickFiles('lib', {
    srcDir: '/',
    destDir: '/commonjs'
  });
  commonJs = filterES6Modules(commonJs, {
    moduleType: 'cjs'
  });

  // rename router.js to main.js
  commonJs = moveFile(commonJs, {
    srcFile: '/commonjs/router.js',
    destFile: '/commonjs/main.js'
  });

  return commonJs;
}



function createStandaloneTree() {
  // dist/router.js: IIFE version of router.js, using RSVP and RouteRecognizer globals
  var begin = '(function(globals, RSVP, RouteRecognizer) {\n';
  var end = [];
  end.push('define("route-recognizer", [], function() { return {"default": RouteRecognizer}; });');
  end.push('define("rsvp", [], function() { return RSVP;});');
  end.push('define("rsvp/promise", [], function() { return {"default": RSVP.Promise}; });');
  end.push("window.Router = requireModule('router');");
  end.push('}(window, window.RSVP, window.RouteRecognizer));');
  end = end.join('\n');

  var browser = pickFiles('vendor', {
    files: ['loader.js'],
    srcDir: '/',
    destDir: '/'
  });
  browser = mergeTrees([browser, createAMDTree()]);
  browser = concat(browser, {
    inputFiles: ['loader.js', '*.js'],
    outputFile: '/router.js'
  });
  browser = wrapFiles(browser, {
    wrapper: [begin, end],
    extensions: ['js']
  });

  // dist/router.min.js
  var minified = pickFiles(browser, {
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

  return mergeTrees([browser, minified]);
}
