// the base for dist files
var baseDistFile = 'dist/router-<%= pkg.version %>.';
var builds = ['amd.', '' /* normal router.js */ ];
var s3Uploads = [];
builds.forEach(function(build){
  var srcFile = baseDistFile + build + 'js';
  s3Uploads.push({ src: srcFile, dest: 'router-<%= env.TRAVIS_COMMIT %>.' + build + 'js' });
  s3Uploads.push({ src: srcFile, dest: 'router-latest.' + build + 'js' });
});

module.exports = {
  options: {
    bucket: 'routerjs-builds',
    access: 'public-read'
  },
  dev: {
    upload: s3Uploads
  }
};
