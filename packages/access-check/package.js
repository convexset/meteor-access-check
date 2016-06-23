Package.describe({
	// [validatis:stack]
	name: 'convexset:access-check',
	version: '0.1.0_1',
	summary: 'A Meteor package for reusable authentication checks',
	git: 'https://github.com/convexset/meteor-access-check',
	documentation: '../../README.md'
});

Package.onUse(function(api) {
	api.versionsFrom('1.3.2.4');
	api.use(['ecmascript', 'check', 'ddp-rate-limiter']);
	api.use(['aldeed:simple-schema@1.5.3']);
	api.use('tmeasday:check-npm-versions@0.3.1');
	api.mainModule('access-check.js');
});