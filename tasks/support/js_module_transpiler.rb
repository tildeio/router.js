# This is a shim that looks like the JsModuleTranspiler from
# https://github.com/wycats/js_module_transpiler but uses the ES6 Module
# Transpiler from https://github.com/square/es6-module-transpiler.
module JsModuleTranspiler
  class Compiler
    def initialize(script, name, options={})
      @script  = script
      @name    = name
      @options = options
    end

    def to_amd
      transpile :amd
    end

    def to_cjs
      transpile :cjs
    end

    def to_globals
      transpile :globals
    end

    private

    attr_reader :script, :name, :options

    def transpile(type)
      ensure_es6_transpiler_package_installed

      args = [es6_transpiler_binary]
      args << '--type' << type.to_s
      args << '--stdio'

      case type
      when :globals
        if options[:imports]
          imports = options[:imports].map {|path,global| "#{path}:#{global}" }.join(',')
          args << '--imports' << imports
        end

        if options[:into]
          args << '--global' << options[:into]
        end
      when :amd
        if name
          args << '--module-name' << name
        else
          args << '--anonymous'
        end
      end

      IO.popen(args, 'w+') do |io|
        io << script
        io.close_write
        return io.read
      end
    end

    def ensure_es6_transpiler_package_installed
      return if File.executable?(es6_transpiler_binary)
      %x{npm install}
    end

    def es6_transpiler_binary
      './node_modules/.bin/compile-modules'
    end
  end
end
