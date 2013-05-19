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
require 'qunit-cli-runner'

directory "dist"

def file_task(type)
  filename = ["dist/router"]
  filename << type unless type == "globals"
  filename << "js"

  filename = filename.join(".")

  file filename => ["dist", "lib/router.js"] do
    router = File.read("lib/router.js")

    open filename, "w" do |file|
      converter = JsModuleTranspiler::Compiler.new(router, "router", into: "Router", imports: { "route-recognizer" => "RouteRecognizer", "rsvp" => "RSVP" })
      file.puts converter.send("to_#{type}")
    end
  end

  debug_filename = filename.sub(/\.js$/, ".debug.js")

  file debug_filename => ["dist", "lib/router.js"] do
    router = replace_debug("lib/router.js")

    open debug_filename, "w" do |file|
      converter = JsModuleTranspiler::Compiler.new(router, "router", into: "Router", imports: { "route-recognizer" => "RouteRecognizer", "rsvp" => "RSVP" })
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

task :browser_test, :debug do |task, args|
  if args["debug"]
    sh "open tests/index.debug.html"
  else
    sh "open tests/index.html"
  end
end
task :browser_test => :release

QunitCliRunner::Task.new('test')
task :test => :release

task :default => :test

task :publish do
  access_key_id = ENV['S3_ACCESS_KEY_ID']
  secret_access_key = ENV['S3_SECRET_ACCESS_KEY']
  bucket_name = ENV['S3_BUCKET_NAME']
  rev = `git rev-list HEAD -n 1`.to_s.strip
  master_rev = `git rev-list origin/master -n 1`.to_s.strip
  upload = true if rev == master_rev
  upload = upload && access_key_id && secret_access_key && bucket_name
  if upload
    require 'aws-sdk'
    root = File.expand_path(File.dirname(__FILE__)) + '/dist/'
    s3 = AWS::S3.new(access_key_id: access_key_id,secret_access_key: secret_access_key)
    bucket = s3.buckets[bucket_name]
    files = ['router.js','router.amd.js','router.cjs.js'].map{ |f| root + f }
    files.each do |file|
      basename = Pathname.new(file).basename.sub_ext('')
      s3_objs = ["#{basename}-latest.js", "#{basename}-#{rev}.js"].map do |file|
        bucket.objects[file]
      end
      s3_objs.each { |obj| obj.write(Pathname.new(file)) }
    end
  else
    puts "Not uploading any files to S3!"
  end
end
