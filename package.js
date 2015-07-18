var where = 'server';

Package.describe({
  name: 'zooshme:emails',
  summary: 'Send HTML emails with server side Blaze templates. Preview and debug in the browser.',
  version: '0.1.0',
  git: 'https://github.com/zooshme/meteor-emails.git'
});

Package.onUse(function(api) {

  api.versionsFrom('1.0.4');

  api.use([
    'check',
    'underscore',
    'coffeescript',
    'email',
    'sacha:juice@0.1.4',
    'iron:router@1.0.9',
    'meteorhacks:ssr@2.1.2'
  ], where);

  api.addFiles([
    'utils.js',
    'emails.js'
  ], where);

  api.export('Mailer', where);
});
