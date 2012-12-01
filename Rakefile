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

require "bundler/setup"
require "js_module_transpiler"

directory "dist"

def file_task(type)
  filename = ["dist/router"]
  filename << type unless type == "globals"
  filename << "js"

  filename = filename.join(".")

  file filename => ["dist", "lib/router.js"] do
    router = File.read("lib/router.js")

    open filename, "w" do |file|
      converter = JsModuleTranspiler::Compiler.new(router, "router", imports: { "route_recognizer" => "RouteRecognizer" })
      file.puts converter.send("to_#{type}")
    end
  end

  debug_filename = filename.sub(/\.js$/, ".debug.js")

  file debug_filename => ["dist", "lib/router.js"] do
    router = replace_debug("lib/router.js")

    open debug_filename, "w" do |file|
      converter = JsModuleTranspiler::Compiler.new(router, "router", imports: { "route_recognizer" => "RouteRecognizer" })
      file.puts converter.send("to_#{type}")
    end
  end

  min_filename = filename.sub(/\.js$/, ".min.js")

  file min_filename => filename do
    output = `cat #{filename} | uglifyjs`

    open min_filename, "w" do |file|
      file.puts output
    end
  end
end

file_task "globals"
file_task "amd"
file_task "cjs"

task :debug => ["dist/router.debug.js", "dist/router.amd.debug.js", "dist/router.cjs.debug.js"]
task :build => ["dist/router.js", "dist/router.amd.js", "dist/router.cjs.js"]

task :release => [:debug, :build]

task :test, :debug do |task, args|
  if args["debug"]
    sh "open tests/index.debug.html"
  else
    sh "open tests/index.html"
  end
end

task :test => :release
