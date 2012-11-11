directory "dist"

def replace_debug(file)
  content = File.read(file)

  content.gsub!(%r{^ *// DEBUG GROUP (.*) *$}, 'console.group(\1);')
  content.gsub!(%r{^ *// END DEBUG GROUP *$}, 'console.groupEnd();')
  content.gsub!(%r{^( *)// DEBUG (.*) *$}, '\1debug(\2);')
  content.gsub!(%r{^ */\*\* IF DEBUG\n}, "")
  content.gsub!(%r{ *END IF \*\*/\n}, "")

  content
end

file "dist/router.debug.js" => ["dist", "lib/router.js"] do
  router = replace_debug("lib/router.js")

  File.open("dist/router.debug.js", "w") do |file|
    file.puts router
  end
end

file "dist/router.js" => ["dist", "lib/router.js"] do
  File.open("dist/router.js", "w") do |file|
    file.puts File.read("lib/router.js");
  end
end

task :debug => "dist/router.debug.js"
task :build => "dist/router.js"

task :release => [:debug, :build]

task :test, :debug do |task, args|
  if args["debug"]
    sh "open tests/index.debug.html"
  else
    sh "open tests/index.html"
  end
end

task :test => :release
