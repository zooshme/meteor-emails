TAG = 'mailer'

Mailer = {
  settings: {
    silent: false,
    routePrefix: 'emails',
    baseUrl: process.env.ROOT_URL,
    testEmail: null,
    logger: console,
    disabled: false,
    addRoutes: process.env.NODE_ENV === 'development',
    language: 'html'
  }, 
  config: function(newSettings) {
    return this.settings = _.extend(this.settings, newSettings);
  }
}

Utils = share.MailerUtils

Helpers = {
  baseUrl: function(path) {
    return Utils.joinUrl(Mailer.settings.baseUrl, path);
  },
  emailUrlFor: function(route, params) {
    if(Router) return Utils.joinUrl(Mailer.settings.baseUrl(), Router.path.call(Router, route, params.hash));
  }
}

MailerClass = function(options) {
  check(options, Match.ObjectIncluding({
    templates: Object,
    helpers: Match.Optional(Object),
    layout: Match.Optional(Match.OneOf(Object, Boolean))
  }));

  settings = _.extend({}, Mailer.settings, options.settings);
  globalHelpers = _.extend({}, Helpers, Blaze._globalHelpers, options.helpers);

  Utils.setupLogger(settings.logger, {suppressInfo: settings.silent});

  addHelpers = function(template) {
    check(template.name, String);
    check(template.helpers, Match.Optional(Object));
    return Template[template.name].helpers(_.extend({}, globalHelpers, template.helpers));
  }

  compile = function(template) {
    check(template, Match.ObjectIncluding({
      path: String,
      name: String,
      scss: Match.Optional(String),
      css: Match.Optional(String)
    }));

    try {
      content = Utils.readFile(template.path);
    } catch(ex) {
      Utils.Logger.error('Could not read template file: '+template.path, TAG);
      return false;
    }

    juiceOpts = {
      preserveMediaQueries: true,
      removeStyleTags: true,
      webResources: {
        images: false
      }
    }

    addCSS = function(css, html) {
      if (!css) return html;

      try {
        return juice.inlineContent(html, css, juiceOpts)
      } catch(ex) {
        Utils.Logger.error('Could not add CSS to '+template.name+': ' + ex.message, TAG);
        return html;
      }
    }

    if (template.css) {
      content = addCSS(Utils.readFile(template.css), content);
    }

    if (options.layout !== false && template.layout !== false) {
      layout = options.layout;
      layoutContent = Utils.readFile(layout.path);

      if (layout.css) {
        layoutContent = addCSS(Utils.readFile(layout.css), layoutContent);
        content = addCSS(Utils.readFile(layout.css), content);
      }
        
      if (template.css) {
        layoutContent = addCSS(Utils.readFile(template.css), layoutContent);
      }

      SSR.compileTemplate(layout.name, layoutContent, language: settings.language)
      addHelpers(layout);
    }

    tmpl = SSR.compileTemplate(template.name, content, {language: settings.language});

    if (layout) {
      tmpl.__layout = layout.name
    }

    addHelpers(template);

    return tmpl;
  }

  render = function(templateName, data) {
    check(templateName, String);
    check(data, Match.Optional(Object));

    template = _.findWhere(options.templates, {name: templateName})

    if (!Template[templateName]) {
      compile(template);
    }

    tmpl = Template[templateName]

    if (!tmpl) {
      throw (new Meteor.Error(500, 'Could not find template: '+templateName));
    }

    rendered = SSR.render(tmpl, data);

    if (tmpl.__layout) {
      layout = tmpl.__layout

      if (tmpl.__helpers.has('preview')) {
        preview = tmpl.__helpers.get('preview');
      } else if (data.preview) {
        preview = data.preview
      }

      if (template.extraCSS) {
        try {
          css = Utils.readFile template.extraCSS
        } catch(ex) {
          Utils.Logger.error('Could not add extra CSS when rendering '+templateName+': '+ex.message, TAG)
        }
      }

      layoutData = _.extend({}, data, {
          body: rendered,
          css: css,
          preview: preview
        }
      );

      rendered = SSR.render(layout, layoutData);
    }
    Utils.addDoctype(rendered);
  }

  sendEmail = function(options) {
    check(options, {
      to: String,
      subject: String,
      template: String,
      replyTo: Match.Optional(String),
      from: Match.Optional(String),
      data: Match.Optional(Object),
      headers: Match.Optional(Object)
    });

    defaults = {
      from: settings.from
    }

    if (settings.replyTo) {
      defaults.replyTo = settings.replyTo;
    }

    opts = _.extend({}, defaults, options);

    try {
      opts.html = render options.template, options.data
    } catch(ex) {
      Utils.Logger.error('Could not render email before sending: ' + ex.message, TAG);
      return false;
    }

    try {
      if(!settings.disabled) {
        Email.send(opts);
      }
      return true
    } catch(ex) {
      Utils.Logger.error('Could not send email: ' + ex.message, TAG);
      return false;
    }
  }

  previewAction = function(template) {
    try {
      data = template.route.data and template.route.data.apply(this, arguments)
    } catch(ex) {
      msg = 'Exception in '+template.name+' data function: '+ex.message;
      Utils.Logger.error(msg, TAG);
      this.response.writeHead(500);
      return this.response.end(msg);
    }

    compile(template);

    Utils.Logger.info("Rendering #{template.name} ...", TAG);

    try {
      html = render(template.name, data);
      Utils.Logger.info("Rendering successful!", TAG);
    } catch(ex) {
      msg = 'Could not preview email: ' + ex.message;
      Utils.Logger.error(msg, TAG);
      html = msg;
    }

    this.response.writeHead(200, 'Content-Type': 'text/html');
    this.response.end(html, 'utf8')
  }

  sendAction = function(template) {
    to = this.params.query.to || settings.testEmail;

    Utils.Logger.info("Sending #{template.name} ...", TAG);

    if (to) {
      try {
        data = template.route.data && template.route.data.apply(this, arguments);
      } catch(ex) {
        Utils.Logger.error('Exception in '+template.name+' data function: '+ex.message, TAG);
        return
      }

      res = sendEmail({
        to: to,
        data: data,
        template: template.name,
        subject: '[TEST] ' + template.name
      })

      if (res === false) {
        this.response.writeHead(500);
        msg = 'Did not send test email, something went wrong. Check the logs.';
      } else {
        this.response.writeHead(200);
        reallySentEmail = !!process.env.MAIL_URL;
        msg = reallySentEmail ? "Sent test email to #{to}" : "Sent email to STDOUT";
      }

      this.response.end(msg);
    } else {
      this.response.writeHead(400);
      this.response.end("No testEmail provided.")
    }
  }

  addRoutes = function(template) {
    check(template.name, String);
    check(template.route.path, String);

    types = {
      preview: previewAction,
      send: sendAction
    }

    _.each(types, function(action, type) {
      path = "#{settings.routePrefix}/#{type}" + template.route.path;
      name = Utils.capitalizeFirstChar(template.name);
      routeName = "#{type}#{name}";

      Utils.Logger.info("Add route: [#{routeName}] at path /" + path, TAG);

      Router.route(routeName, {
        path: path,
        where: 'server',
        action: function() {
          return action.call(this, template)
        }
      });
    }
  }

  init = function() {
    if(options.templates) {
      _.each(options.templates, function(template, name) {
        template.name = name;

        compile(template);
        
        if(template.route && settings.addRoutes) {
          addRoutes(template)
        }
      });
    }
  }

  init();

  return {
    precompile: compile,
    render: render,
    send: sendEmail,
  }
}

Mailer.init = function(opts) {
  mailer = MailerClass(opts);
  _.extend(this, mailer);
}