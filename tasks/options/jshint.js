module.exports = {
  options: {
    'jshintrc': '.jshintrc',
    'force': true
  },
  dev: {
    src: ["Gruntfile.js", "Brocfile.js"]
  },
  output: {
    src: ['dist/<%= pkg.name %>.js']
  }
};
