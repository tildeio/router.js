// the base for dist files
var baseDistFile = 'dist/router.';
var builds = ['amd.', '' /* normal rsvp.js */ ];
var s3Uploads = [];

builds.forEach(function(build){
  var srcFile = baseDistFile + build + 'js';
  s3Uploads.push({ src: srcFile, dest: 'router-<%= env.TRAVIS_COMMIT %>.' + build + 'js' });
  if (process.env.TRAVIS_BRANCH === 'master') {
    s3Uploads.push({ src: srcFile, dest: 'router-latest.' + build + 'js' });
  }
});

module.exports = {
  options: {
    bucket: 'routerjs.builds.emberjs.com',
    access: 'public-read',
    accessKeyId: '<%= env.S3_ACCESS_KEY_ID %>',
    secretAccessKey: '<%= env.S3_SECRET_ACCESS_KEY %>',
  },
  dev: {
    files: s3Uploads
  }
};
