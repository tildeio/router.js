module.exports = function(grunt) {
  grunt.registerMultiTask('browser', 'Export the object in <%= pkg.name %> to the window', function() {
    this.files.forEach(function(f) {
      var output = ['(function(globals, RSVP, RouteRecognizer) {'];

      output.push.apply(output, f.src.map(grunt.file.read));

      output.push('define("route-recognizer", [], function() { return RouteRecognizer; });');
      output.push('define("rsvp", [], function() { return RSVP;});');

      output.push("window.<%= pkg.namespace %> = requireModule('<%= pkg.name %>');");

      output.push('}(window, window.RSVP, window.RouteRecognizer));');

      grunt.file.write(f.dest, grunt.template.process(output.join('\n')));
    });
  });
};
